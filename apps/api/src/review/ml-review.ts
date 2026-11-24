/*
 * Primer filtro con Machine Learning en cada publicación (corre en este mismo servidor, gratis).
 *
 * Cuando un agricultor publica (o cambia fotos o precio, o corrige lo que le pidió el equipo), la
 * publicación queda «en revisión». Este servicio toma sus fotos, las pasa por un modelo de visión
 * (CLIP ViT-B/32 de OpenCLIP, int8, en models/clip-vit-b32, con ONNX Runtime) y decide con las reglas
 * de packages/shared/src/ml.ts si muestran el producto declarado: «cebolla roja» con la foto de una
 * botella de Gatorade sale «no corresponde». Además compara cada foto con las de otros agricultores
 * (vectores en ml_photo_vectors) para encontrar fotos copiadas aunque estén recortadas o recomprimidas.
 * Anota el resultado con LISTING_ML_REVIEW: recomendación (publicar, revisar, no publicar), motivos,
 * notas y un mensaje para el agricultor. No publica ni rechaza: eso lo decide el equipo (W-06).
 *
 * Memoria: el modelo se carga la primera vez que hace falta (unos 60 MB propios; los 88 MB de pesos se
 * leen del archivo con mmap) y se suelta si pasa un rato sin publicaciones nuevas.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import type { Listing } from '@mesagri/shared';
import { parseMlModel, mlReview, judgePhoto, toPixels, photoQuality, cosine, dHash, hamming, sameImage, isSamplePhoto, product, ML_IMAGE_SIZE, ML_T, type MlModel, type MlPhotoInput } from '@mesagri/shared';
import { CONFIG } from '../config';
import { rows, exec } from '../db/db';
import { EngineService, type Applied } from '../core/engine.service';

interface Job { listingId: string; queuedAt: number; key: string; tries: number; notBefore: number }
interface Loaded { ort: any; session: any; model: MlModel }

/** Carpeta del modelo (models/clip-vit-b32 en la raíz del repositorio). */
export function modelDir(): string {
  const c = [CONFIG.mlReview.dir, path.resolve(__dirname, '../../../../models/clip-vit-b32'), path.resolve(process.cwd(), 'models/clip-vit-b32'), path.resolve(process.cwd(), '../../models/clip-vit-b32')].filter(Boolean) as string[];
  return c.find(d => fs.existsSync(path.join(d, 'vision.onnx')) && fs.existsSync(path.join(d, 'labels.json'))) ?? c[c.length - 1];
}

/** El modelo de visión: carga perezosa, una foto o varias a la vez. */
export class ClipRunner {
  private loading?: Promise<Loaded>;
  private lastUse = 0;
  private timer?: NodeJS.Timeout;
  constructor(readonly dir = modelDir(), private readonly idleMs = CONFIG.mlReview.idleUnloadMs) {}

  available(): boolean {
    try {
      if (!['vision.onnx', 'vision-1.bin', 'vision-2.bin', 'labels.json'].every(f => fs.existsSync(path.join(this.dir, f)))) return false;
      require.resolve('onnxruntime-node');
      require.resolve('sharp');
      return true;
    } catch { return false; }
  }

  load(): Promise<Loaded> {
    this.lastUse = Date.now();
    if (!this.loading) {
      this.loading = (async () => {
        const ort = require('onnxruntime-node');
        const model = parseMlModel(JSON.parse(fs.readFileSync(path.join(this.dir, 'labels.json'), 'utf8')));
        // un hilo: el servidor gratis tiene poca CPU y atiende a la app al mismo tiempo. Sin copiar los
        // pesos a otro formato (disable_prepacking) ni reservar memoria de más: los pesos se quedan en el
        // archivo (mmap) y el modelo gasta unos 60 MB propios en vez de 130 MB, a cambio de ~25 % más de tiempo
        const session = await ort.InferenceSession.create(path.join(this.dir, 'vision.onnx'), {
          intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all',
          enableCpuMemArena: false, extra: { session: { disable_prepacking: '1' } },
        });
        return { ort, session, model };
      })();
      this.loading.catch(() => { this.loading = undefined; });
      if (this.idleMs > 0 && !this.timer) {
        this.timer = setInterval(() => { if (this.loading && Date.now() - this.lastUse > this.idleMs) void this.release(); }, Math.min(this.idleMs, 60_000));
        this.timer.unref?.();
      }
    }
    return this.loading;
  }

  async release() {
    const l = this.loading;
    this.loading = undefined;
    try { await (await l)?.session.release?.(); } catch { /* ya no estaba */ }
  }

  async model(): Promise<MlModel> { return (await this.load()).model; }

  /** Foto (JPG, PNG o WEBP) → píxeles de 224×224 (lado corto a 224 y recorte al centro, como CLIP), luz, nitidez y huella. */
  async prepare(img: Buffer): Promise<{ px: Float32Array; light: number; sharp: number; hash: string }> {
    const sharp = require('sharp');
    sharp.cache(false);
    sharp.concurrency(1);
    const opts = { failOn: 'none', limitInputPixels: 40_000_000 };
    const { data } = await sharp(img, opts).rotate()
      .resize(ML_IMAGE_SIZE, ML_IMAGE_SIZE, { fit: 'cover', position: 'centre', kernel: 'cubic' })
      .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const gray = await sharp(img, opts).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    const q = photoQuality(data, 3);
    return { px: toPixels(data, 3), ...q, hash: dHash(gray) };
  }

  /** Vectores (512 números, norma 1) de varias fotos ya preparadas. */
  async embed(pxs: Float32Array[]): Promise<Float32Array[]> {
    if (!pxs.length) return [];
    const { ort, session } = await this.load();
    const n = ML_IMAGE_SIZE * ML_IMAGE_SIZE * 3;
    const all = new Float32Array(pxs.length * n);
    pxs.forEach((p, i) => all.set(p, i * n));
    const out = await session.run({ pixels: new ort.Tensor('float32', all, [pxs.length, 3, ML_IMAGE_SIZE, ML_IMAGE_SIZE]) });
    const e = out.embedding.data as Float32Array;
    const d = e.length / pxs.length;
    this.lastUse = Date.now();
    return pxs.map((_, i) => e.slice(i * d, (i + 1) * d));
  }
}

const toF16 = (v: Float32Array): Buffer => {
  const b = Buffer.alloc(v.length * 2);
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < v.length; i++) {
    f[0] = v[i];
    const x = u[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    const h = e <= 0 ? s : e >= 31 ? s | 0x7c00 : s | (e << 10) | (m >>> 13);
    b.writeUInt16LE(h, i * 2);
  }
  return b;
};
const fromF16 = (b: Buffer): Float32Array => {
  const out = new Float32Array(b.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const h = b.readUInt16LE(i * 2), s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? 0 : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
};

@Injectable()
export class MlListingReview implements OnModuleInit {
  private readonly log = new Logger('Revisión con ML');
  readonly runner = new ClipRunner();
  private queue: Job[] = [];
  private seen = new Set<string>();
  private running = false;
  private timer?: NodeJS.Timeout;
  private stats = { today: 0, day: '', lastMs: 0 };
  /** espera entre reintentos mientras llegan las fotos (las pruebas la acortan) */
  retryMs = 20_000;

  constructor(private readonly engine: EngineService) {}

  configured(): boolean { return CONFIG.mlReview.enabled && this.runner.available(); }

  onModuleInit() {
    if (!this.configured()) {
      this.log.warn(CONFIG.mlReview.enabled ? `Sin modelo de ML (${this.runner.dir}): las publicaciones se revisan solo con reglas.` : 'Revisión con ML apagada (ML_REVIEW=false).');
      return;
    }
    this.engine.bus.on('event', (a: Applied) => {
      if (!['LISTING_PUBLISH', 'LISTING_EDIT', 'LISTING_RESUME'].includes(a.event.type)) return;
      this.consider(String(a.event.p?.listingId ?? ''));
    });
    this.engine.bus.on('reset', () => { this.queue = []; this.seen.clear(); setTimeout(() => this.scan(), 3_000).unref?.(); });
    // al arrancar: las que quedaron en revisión sin mirar (servidor reiniciado o modelo recién puesto)
    setTimeout(() => this.scan(), 6_000).unref?.();
  }

  /** Publicaciones en revisión que el modelo todavía no miró. */
  scan() {
    const w = this.engine.world;
    if (!w) return;
    for (const l of Object.values(w.listings)) if (l.status === 'IN_REVIEW' && l.review && l.review.mlState !== 'LISTA') this.consider(l.id);
  }

  private keyOf(l: Listing) { return `${l.id}@${l.review?.queuedAt}@${l.photoIds.join('|')}@${l.price}@${l.qtyTotal}`; }

  consider(listingId: string) {
    const l = this.engine.world?.listings[listingId];
    if (!l || l.status !== 'IN_REVIEW' || !l.review || l.review.mlState === 'LISTA') return;
    // sin fotos reales (ninguna, o solo dibujos de ejemplo de la demo) no hay nada que mirar: quedan las reglas
    if (!l.photoIds.some(id => !isSamplePhoto(id))) return;
    const key = this.keyOf(l);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
    this.queue = this.queue.filter(j => j.listingId !== l.id);
    this.queue.push({ listingId: l.id, queuedAt: l.review.queuedAt, key, tries: 0, notBefore: 0 });
    this.kick();
  }

  private kick(delay = 0) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, delay);
    this.timer.unref?.();
  }

  /** Revisa de a una publicación (cada una tarda menos de un segundo por foto). */
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const now = Date.now();
        const i = this.queue.findIndex(j => j.notBefore <= now);
        if (i < 0) { this.kick(Math.max(500, Math.min(...this.queue.map(j => j.notBefore)) - now)); break; }
        const job = this.queue.splice(i, 1)[0];
        try { await this.process(job); } catch (e: any) { this.log.warn(`No se pudo revisar ${job.listingId}: ${e?.message ?? e}`); }
      }
    } finally { this.running = false; }
  }

  private current(job: Job): Listing | undefined {
    const l = this.engine.world.listings[job.listingId];
    return l && l.review && l.review.queuedAt === job.queuedAt && l.status === 'IN_REVIEW' && this.keyOf(l) === job.key ? l : undefined;
  }

  private async mark(job: Job, l: Listing, state: 'PENDIENTE' | 'LISTA' | 'ERROR', extra: Record<string, unknown> = {}) {
    await this.engine.apply({ type: 'LISTING_ML_REVIEW', actor: 'system', p: { listingId: job.listingId, queuedAt: job.queuedAt, photos: l.photoIds.join('|'), price: l.price, state, ...extra } }, true);
  }

  async process(job: Job) {
    let l = this.current(job);
    if (!l) return;
    if (job.tries === 0) await this.mark(job, l, 'PENDIENTE');
    // las fotos se suben aparte (con reintento): se espera un poco a que lleguen
    const wanted = l.photoIds.slice(0, CONFIG.mlReview.maxPhotos);
    const real = wanted.filter(id => !isSamplePhoto(id));
    const files = await this.loadPhotos(real);
    const missing = real.filter(id => !files.has(id));
    if (missing.length && job.tries < 6) {
      this.queue.push({ ...job, tries: job.tries + 1, notBefore: Date.now() + this.retryMs });
      this.kick(this.retryMs);
      return;
    }
    const t0 = Date.now();
    let inputs: MlPhotoInput[];
    let model: MlModel;
    try {
      model = await this.runner.model();
      const prepared = new Map<string, { px: Float32Array; light: number; sharp: number; hash: string }>();
      for (const [id, buf] of files) { try { prepared.set(id, await this.runner.prepare(buf)); } catch { /* foto dañada: queda sin analizar */ } }
      const ids = [...prepared.keys()];
      const embs = await this.runner.embed(ids.map(id => prepared.get(id)!.px));
      const vec = new Map(ids.map((id, i) => [id, embs[i]]));
      l = this.current(job);
      if (!l) return;
      const hashes = new Map(ids.map(id => [id, prepared.get(id)!.hash]));
      const dups = await this.copies(l, vec, hashes);
      inputs = wanted.map(id => isSamplePhoto(id) ? { photoId: id, sample: true } : { photoId: id, emb: vec.get(id), light: prepared.get(id)?.light, sharp: prepared.get(id)?.sharp, dupOf: dups.get(id) });
      await this.saveVectors(l, vec, hashes);
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 200);
      this.log.warn(`El modelo no pudo revisar ${job.listingId}: ${msg}`);
      await this.logRun(job, undefined, 0, Date.now() - t0, msg);
      const cur = this.current(job);
      if (cur) await this.mark(job, cur, 'ERROR', { note: `El modelo no pudo mirar las fotos (${msg.slice(0, 100)}): quedó la revisión por reglas.` });
      return;
    }
    const ms = Date.now() - t0;
    const ml = mlReview(this.engine.world, l, inputs, model, this.engine.simNow(), ms);
    this.stats.lastMs = ms;
    const day = new Date().toISOString().slice(0, 10);
    if (this.stats.day !== day) this.stats = { ...this.stats, day, today: 0 };
    this.stats.today++;
    await this.logRun(job, ml, inputs.filter(x => x.emb).length, ms);
    const cur = this.current(job);
    if (cur) await this.mark(job, cur, 'LISTA', { ml });
  }

  /** Fotos de la publicación (de la base o de la carpeta de archivos). */
  private async loadPhotos(ids: string[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    if (!ids.length) return out;
    const list = await rows(this.engine.pool, `SELECT f.uuid, f.storage_key, b.data FROM files f LEFT JOIN file_blobs b ON b.file_id = f.id
      WHERE f.uuid IN (?) AND f.kind = 'FOTO' AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')`, [ids]);
    for (const r of list) {
      let data: Buffer | undefined = Buffer.isBuffer(r.data) ? r.data : undefined;
      if (!data && r.storage_key && !String(r.storage_key).startsWith('db:')) {
        const file = path.join(CONFIG.filesDir, String(r.storage_key));
        if (file.startsWith(path.resolve(CONFIG.filesDir)) && fs.existsSync(file)) data = fs.readFileSync(file);
      }
      if (data && data.length <= 8_000_000) out.set(r.uuid, data);
    }
    return out;
  }

  /** Fotos casi iguales a la de una publicación de otro agricultor (copiadas, recortadas o recomprimidas). */
  private async copies(l: Listing, vec: Map<string, Float32Array>, hashes: Map<string, string>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!vec.size) return out;
    const w = this.engine.world;
    const others = await rows(this.engine.pool, 'SELECT file_uuid, listing_uuid, vec, dhash FROM ml_photo_vectors WHERE org_uuid <> ? ORDER BY created_at DESC LIMIT 20000', [l.orgId]);
    for (const [id, v] of vec) {
      for (const r of others) {
        if (r.file_uuid === id || !Buffer.isBuffer(r.vec)) continue;
        const dist = hamming(hashes.get(id) ?? '', String(r.dhash ?? ''));
        if (dist > ML_T.dupHashNear) continue;
        if (sameImage(dist, cosine(v, fromF16(r.vec)))) {
          const other = w.listings[r.listing_uuid];
          out.set(id, other ? `${w.orgs[other.orgId]?.name ?? 'otro agricultor'} (${product(other.productId).name.toLowerCase()})` : 'otro agricultor');
          break;
        }
      }
    }
    return out;
  }

  private async saveVectors(l: Listing, vec: Map<string, Float32Array>, hashes: Map<string, string>) {
    for (const [id, v] of vec) {
      try {
        await exec(this.engine.pool, 'INSERT INTO ml_photo_vectors (file_uuid, listing_uuid, org_uuid, vec, dhash) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE listing_uuid = VALUES(listing_uuid), org_uuid = VALUES(org_uuid)', [id, l.id, l.orgId, toF16(v), hashes.get(id) ?? null]);
      } catch (e: any) { this.log.warn(`No se guardó el vector de ${id}: ${e?.message ?? e}`); }
    }
  }

  private async logRun(job: Job, ml: { decision: string; confidence: number; model: string } | undefined, photos: number, ms: number, error?: string) {
    try {
      await exec(this.engine.pool, 'INSERT INTO ml_reviews (listing_uuid, queued_at, model, decision, confidence, photos, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [job.listingId, new Date(job.queuedAt), (ml?.model ?? 'CLIP').slice(0, 80), ml?.decision ?? null, ml ? Math.max(0, Math.min(100, ml.confidence)) : null, photos, Math.round(ms), error ?? null]);
    } catch (e: any) { this.log.warn(`No se anotó la revisión: ${e?.message ?? e}`); }
  }

  /** Para el panel: si el modelo está, cuántas revisó hoy y cuánto tardó la última. */
  info() {
    const day = new Date().toISOString().slice(0, 10);
    return { ml: this.configured(), mlModel: this.configured() ? 'CLIP ViT-B/32 (OpenCLIP, LAION-2B) · int8' : null, mlToday: this.stats.day === day ? this.stats.today : 0, mlLastMs: this.stats.lastMs || null, mlPending: this.queue.length };
  }

  /** Prueba del modelo con una foto suelta (panel): qué ve y si muestra el producto. */
  async tryPhoto(img: Buffer, productId: string) {
    const model = await this.runner.model();
    const p = await this.runner.prepare(img);
    const [e] = await this.runner.embed([p.px]);
    const j = judgePhoto(model, e, productId);
    return { match: j.match, declared: j.declared, sees: j.sees, white: Math.round(j.white * 100), light: p.light, sharp: p.sharp };
  }
}
