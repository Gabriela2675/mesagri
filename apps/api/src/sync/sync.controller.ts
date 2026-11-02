/*
 * Canal de sincronización: la copia del mundo que le toca a cada perfil y las acciones en el orden
 * del servidor. Así los celulares, el APK y el panel web se ven en vivo.
 * - GET /sync/snapshot: la copia del mundo para quien pregunta (privacidad por perfil, ver
 *   @mesagri/shared/privacy). Con la clave del equipo (x-team-key), el mundo completo.
 * - POST /sync/events: las acciones hechas en el celular (también sin señal).
 * - Lo demás llega por Socket.IO (/sync): después de cada acción, solo lo que cambió para ese perfil.
 */
import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import zlib from 'node:zlib';
import { EngineService, SYSTEM_ONLY } from '../core/engine.service';
import { Auth, Me } from '../auth/auth.guard';
import { AuthService, type AuthUser } from '../auth/auth.service';
import { CONFIG, BUILD_ID } from '../config';
import { PROTOCOL, maskWorld, viewerKind } from '@mesagri/shared';
import { DomainHttpError } from '../common/errors';
import { requireTeam } from '../common/team';
import { viewerOf } from './viewer';

/** Infinity no existe en JSON: viaja como este texto. */
export const INF = '__mesagri_inf__';
export const encodeWorld = (x: unknown) => JSON.stringify(x, (_k, v) => (v === Infinity ? INF : v === -Infinity ? '-' + INF : v));

class SyncEventDto { @ApiProperty() id!: string; @ApiProperty() type!: string; @ApiProperty() p!: any; @ApiProperty({ required: false }) device?: string; @ApiProperty({ required: false, description: 'Hora en que se hizo en el celular (ms)' }) t?: number; }
class SyncBatchDto { @ApiProperty({ type: [SyncEventDto] }) events!: SyncEventDto[]; }

function demoOnly() {
  if (!CONFIG.demo) throw new DomainHttpError(403, 'NOT_DEMO', 'El canal de sincronización solo existe en modo demo.');
}

@ApiTags('Sincronización')
@Controller('sync')
export class SyncController {
  constructor(private readonly engine: EngineService, private readonly auth: AuthService) {}

  @Get('snapshot')
  @ApiHeader({ name: 'x-team-key', required: false, description: 'Clave del equipo: mundo completo (escenario de varios celulares)' })
  @ApiOperation({ summary: 'Copia del mundo para quien pregunta (lo que su perfil puede ver)', description: 'Sin sesión: lo público. Con Authorization: Bearer, lo de su cuenta y sus contrapartes. El panel: todo menos los códigos secretos.' })
  async snapshot(@Res() res: Response, @Headers('accept-encoding') enc?: string, @Headers('authorization') authz?: string, @Headers('x-team-key') team?: string) {
    demoOnly();
    const { viewer, tokenError } = await viewerOf(this.auth, { token: authz, team });
    if (tokenError) throw tokenError;
    await this.engine.whenReady;
    const world = maskWorld(this.engine.world, viewer);
    const body = `{"protocol":${PROTOCOL},"build":${JSON.stringify(BUILD_ID)},"viewer":${JSON.stringify(viewerKind(viewer))},"epoch":${JSON.stringify(this.engine.epoch)},"boot":${JSON.stringify(this.engine.boot)},"seq":${this.engine.seq},"serverNow":${Date.now()},"world":${encodeWorld(world)}}`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (/\bgzip\b/.test(enc ?? '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.send(zlib.gzipSync(body, { level: 6 }));
    } else res.send(body);
  }

  @Get('events')
  @ApiHeader({ name: 'x-team-key', required: true })
  @ApiOperation({ summary: 'Acciones aceptadas después de un número, completas (solo el equipo: llevan datos de todas las cuentas)' })
  events(@Query('after') after: string, @Query('boot') boot: string, @Query('epoch') epoch: string, @Headers('x-team-key') team?: string) {
    demoOnly();
    if (team === undefined) throw new DomainHttpError(401, 'TEAM_KEY', 'Las acciones completas son solo para el equipo de Mesagri.');
    requireTeam(team);
    const n = Number(after) || 0;
    if (boot !== this.engine.boot || epoch !== this.engine.epoch || n > this.engine.seq) return { resync: true, epoch: this.engine.epoch, boot: this.engine.boot, seq: this.engine.seq };
    return this.engine.eventsAfter(n).then(list => ({ resync: false, epoch: this.engine.epoch, boot: this.engine.boot, seq: this.engine.seq, events: list.map(x => JSON.parse(encodeWorld(x))) }));
  }

  @Post('events') @HttpCode(200) @Auth()
  @ApiOperation({ summary: 'Envía acciones hechas en el celular (también las que se hicieron sin señal)', description: 'El actor es siempre el usuario de la sesión. Cada acción lleva su id: si se reintenta, no se duplica.' })
  async submit(@Me() u: AuthUser, @Body() b: SyncBatchDto) {
    demoOnly();
    const list = Array.isArray(b?.events) ? b.events.slice(0, 50) : [];
    const out: any[] = [];
    for (const e of list) {
      if (!e || typeof e.type !== 'string') { out.push({ id: e?.id, ok: false, error: { code: 'BAD_EVENT', message: 'Acción no válida.' } }); continue; }
      if (SYSTEM_ONLY.has(e.type) || e.type === 'USER_REGISTER') { out.push({ id: e.id, ok: false, error: { code: 'FORBIDDEN', message: 'Esta acción no se puede enviar por aquí.' } }); continue; }
      const r = await this.engine.apply({ id: e.id, type: e.type, actor: u.id, p: e.p ?? {}, device: e.device, clientAt: Number(e.t) || undefined });
      // la acción vuelve sin su contenido: el servidor le agrega códigos secretos que no son de quien la hizo
      out.push(r.ok ? { id: r.event.id, ok: true, seq: r.seq, t: r.event.t, result: r.result ?? null, duplicate: !!r.duplicate } : { id: e.id, ok: false, error: r.error });
    }
    return { results: out, seq: this.engine.seq };
  }
}
