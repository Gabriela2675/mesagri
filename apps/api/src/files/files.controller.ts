/*
 * Archivos (14.5, 14.9): la app comprime la foto (unos 300 KB) y la sube aparte, con reintento.
 * La referencia y el hash van en `files`; el contenido, en `file_blobs` (FILES_STORAGE=db, lo
 * normal y lo que sirve en la nube, donde el disco del servidor se borra) o en una carpeta
 * (FILES_STORAGE=disk).
 * Las fotos de productos se ven con su enlace; el DNI, la selfie y los documentos solo con un
 * enlace firmado de un minuto, y cada acceso queda en auditoría.
 */
import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { uid } from '@mesagri/shared';
import { CONFIG } from '../config';
import { exec, rows, tx } from '../db/db';
import { EngineService } from '../core/engine.service';
import { Auth, Me } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';

const KINDS = ['FOTO', 'DNI', 'SELFIE', 'DOCUMENTO', 'AUDIO'] as const;
type Kind = (typeof KINDS)[number];
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/webm': 'webm', 'audio/mpeg': 'mp3' };
const MAX = 5 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{4,80}$/;
const sign = (s: string) => crypto.createHmac('sha256', CONFIG.jwtSecret).update(s).digest('base64url');

class UploadDto {
  @ApiPropertyOptional({ description: 'Id creado en el celular (ph-...). Si se reintenta, no se duplica.' }) id?: string;
  @ApiPropertyOptional({ enum: KINDS }) kind?: Kind;
  @ApiProperty({ description: 'Imagen como data URL (data:image/jpeg;base64,...)' }) dataUrl!: string;
}
class UploadUrlDto { @ApiPropertyOptional({ enum: KINDS }) kind?: Kind; @ApiProperty({ example: 'image/jpeg' }) mime!: string; }

@ApiTags('Archivos')
@Controller('files')
export class FilesController {
  constructor(private readonly engine: EngineService) {}

  private async save(user: AuthUser, id: string, kind: Kind, mime: string, data: Buffer) {
    if (!MIME_EXT[mime]) throw new DomainHttpError(422, 'BAD_TYPE', 'Ese tipo de archivo no se acepta (fotos JPG, PNG o WEBP; documentos PDF).');
    if (data.length > MAX) throw new DomainHttpError(413, 'TOO_BIG', 'El archivo pesa más de 5 MB.');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    const prior = (await rows(this.engine.pool, 'SELECT uuid, sha256 FROM files WHERE uuid = ?', [id]))[0];
    if (prior) {
      if (prior.sha256 !== sha) throw new DomainHttpError(409, 'FILE_EXISTS', 'Ya existe otro archivo con ese id.');
      return { fileId: id, url: `/api/v1/files/${id}`, duplicate: true };
    }
    const sub = new Date().toISOString().slice(0, 7);
    const key = `${sub}/${id}.${MIME_EXT[mime]}`;
    if (!CONFIG.filesInDb) {
      fs.mkdirSync(path.join(CONFIG.filesDir, sub), { recursive: true });
      fs.writeFileSync(path.join(CONFIG.filesDir, key), data);
    }
    const purge = kind === 'DNI' || kind === 'SELFIE' ? new Date(Date.now() + 90 * 86_400_000) : kind === 'AUDIO' ? new Date(Date.now() + 30 * 86_400_000) : null;
    await tx(this.engine.pool, async c => {
      const ins = await exec(c, 'INSERT INTO files (uuid, owner_user_id, kind, mime_type, size_bytes, sha256, storage_key, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, this.engine.store.ids.opt('users', user.id), kind, mime, data.length, sha, CONFIG.filesInDb ? 'db:' + key : key, purge]);
      if (CONFIG.filesInDb) await exec(c, 'INSERT INTO file_blobs (file_id, data) VALUES (?, ?)', [ins.insertId, data]);
    });
    return { fileId: id, url: `/api/v1/files/${id}` };
  }

  @Post() @Auth()
  @ApiOperation({ summary: 'Sube una foto o documento (data URL). Idempotente por id.' })
  async upload(@Me() u: AuthUser, @Body() b: UploadDto) {
    const id = b?.id && ID_RE.test(b.id) ? b.id : 'f-' + uid();
    const kind: Kind = KINDS.includes(b?.kind as Kind) ? (b.kind as Kind) : 'FOTO';
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(b?.dataUrl ?? ''));
    if (!m) throw new DomainHttpError(422, 'BAD_DATA', 'No llegó la imagen.');
    return this.save(u, id, kind, m[1].toLowerCase(), Buffer.from(m[2], 'base64'));
  }

  @Post('upload-url') @Auth()
  @ApiOperation({ summary: 'Enlace firmado de corta vida para subir un archivo con PUT (como una URL prefirmada de S3)' })
  uploadUrl(@Me() u: AuthUser, @Body() b: UploadUrlDto) {
    const id = 'f-' + uid();
    const exp = Date.now() + 10 * 60_000;
    const kind: Kind = KINDS.includes(b?.kind as Kind) ? (b.kind as Kind) : 'FOTO';
    const token = `${u.id}.${kind}.${b.mime}.${exp}`;
    return { fileId: id, method: 'PUT', uploadUrl: `/api/v1/files/${id}/content?u=${encodeURIComponent(token)}&sig=${sign(id + ':' + token)}`, headers: { 'Content-Type': b.mime }, expiresAt: exp };
  }

  @Put(':id/content')
  @ApiOperation({ summary: 'Sube el contenido al enlace firmado' })
  async put(@Param('id') id: string, @Query('u') token: string, @Query('sig') sig: string, @Req() req: Request) {
    if (!ID_RE.test(id) || !token || sign(id + ':' + token) !== sig) throw new DomainHttpError(403, 'BAD_SIGNATURE', 'Enlace no válido.');
    const parts = token.split('.');
    const exp = Number(parts.pop());
    const mime = parts.slice(2).join('.');
    const [userId, kind] = parts;
    if (!(exp > Date.now())) throw new DomainHttpError(403, 'EXPIRED', 'El enlace venció. Pide otro.');
    const user = this.engine.world.users[userId];
    if (!user) throw new DomainHttpError(403, 'NO_USER', 'Enlace no válido.');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new DomainHttpError(422, 'EMPTY', 'No llegó el archivo.');
    return this.save({ id: user.id, role: user.role, orgId: user.orgId, name: user.name }, id, kind as Kind, mime, body);
  }

  @Get(':id/url') @Auth()
  @ApiOperation({ summary: 'Enlace firmado de un minuto para ver un documento de identidad (queda en auditoría)' })
  async signedUrl(@Me() u: AuthUser, @Param('id') id: string) {
    const f = (await rows(this.engine.pool, 'SELECT f.uuid, f.kind, o.uuid AS owner FROM files f LEFT JOIN users o ON o.id = f.owner_user_id WHERE f.uuid = ?', [id]))[0];
    if (!f) throw new DomainHttpError(404, 'NOT_FOUND', 'No encontramos ese archivo.');
    const can = f.owner === u.id || (u.role === 'ADMIN' && u.adminRole !== 'ANALYST');
    if (!can) throw new DomainHttpError(403, 'FORBIDDEN', 'No puedes ver este documento.');
    const exp = Date.now() + 60_000;
    if (f.kind !== 'FOTO' && u.role === 'ADMIN') await this.engine.apply({ type: 'AUDIT_VIEW', actor: u.id, p: { entity: id, detail: `Vio un documento (${f.kind.toLowerCase()})` } });
    return { url: `/api/v1/files/${id}?exp=${exp}&sig=${sign(id + ':' + exp)}`, expiresAt: exp };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Descarga el archivo (las fotos con su enlace; los documentos solo con enlace firmado)' })
  async get(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!ID_RE.test(id)) throw new DomainHttpError(404, 'NOT_FOUND', 'No encontramos ese archivo.');
    const f = (await rows(this.engine.pool, 'SELECT id, kind, mime_type, storage_key FROM files WHERE uuid = ?', [id]))[0];
    if (!f) throw new DomainHttpError(404, 'NOT_FOUND', 'No encontramos ese archivo.');
    if (f.kind !== 'FOTO') {
      if (!sig || sign(id + ':' + exp) !== sig || !(Number(exp) > Date.now())) throw new DomainHttpError(403, 'SIGNED_URL_REQUIRED', 'Este documento solo se ve con un enlace firmado vigente.');
    }
    const headers = () => {
      res.setHeader('Content-Type', f.mime_type);
      res.setHeader('Cache-Control', f.kind === 'FOTO' ? 'public, max-age=86400, immutable' : 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    };
    const blob = (await rows(this.engine.pool, 'SELECT data FROM file_blobs WHERE file_id = ?', [f.id]))[0];
    if (blob?.data) { headers(); res.end(blob.data); return; }
    // archivos guardados en la carpeta (FILES_STORAGE=disk o de antes de esta versión)
    const file = path.join(CONFIG.filesDir, String(f.storage_key).replace(/^db:/, ''));
    if (!fs.existsSync(file)) throw new DomainHttpError(404, 'NOT_FOUND', 'El archivo ya no está disponible.');
    headers();
    fs.createReadStream(file).pipe(res);
  }
}
