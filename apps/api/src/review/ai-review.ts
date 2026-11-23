/*
 * Revisión de publicaciones con IA (primer filtro antes del equipo).
 *
 * Cuando un agricultor publica (o cambia fotos o precio, o corrige lo que le pidió el equipo), la
 * publicación queda «en revisión» con la revisión por reglas del motor. Si el servidor tiene
 * ANTHROPIC_API_KEY, este servicio le manda a Claude las fotos y los datos (producto, precio,
 * precios de referencia, cantidad, chacra, historial) y anota lo que encontró con
 * LISTING_AI_REVIEW. La IA no publica ni rechaza: eso lo decide el equipo en el panel (W-06).
 *
 * API de Claude (Messages): POST https://api.anthropic.com/v1/messages con x-api-key y
 * anthropic-version; las fotos van como imágenes en base64 y la respuesta sale estructurada con
 * una herramienta obligatoria (tool_choice). https://docs.claude.com/en/api/messages
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Listing, World } from '@mesagri/shared';
import { product, suggestedPricePerKg, DISTRICT_BY_CODE, PROVINCES, fromGallery, UNIT_LABEL, rulesReview, photosUsedElsewhere } from '@mesagri/shared';
import { CONFIG } from '../config';
import { rows, exec } from '../db/db';
import { EngineService, type Applied } from '../core/engine.service';

type Fetch = typeof fetch;
interface Job { listingId: string; queuedAt: number; tries: number; notBefore: number }
interface Photo { id: string; mime: string; data: Buffer; sha: string }
export interface AiOutput {
  veredicto: 'OK' | 'OBSERVAR' | 'RECHAZAR';
  puntaje: number;
  fotos: { numero: number; muestra_el_producto: boolean; que_se_ve: string; foto_real_de_cosecha: boolean; calidad: 'BUENA' | 'REGULAR' | 'MALA'; problemas?: string[] }[];
  precio: string;
  cantidad: string;
  resumen: string;
  mensaje_agricultor?: string;
}

const TOOL = {
  name: 'registrar_revision',
  description: 'Registra el resultado de la revisión de una publicación de cosecha en Mesagri.',
  input_schema: {
    type: 'object',
    properties: {
      veredicto: { type: 'string', enum: ['OK', 'OBSERVAR', 'RECHAZAR'], description: 'OK: nada raro. OBSERVAR: hay dudas, que el equipo mire con cuidado. RECHAZAR: señales claras de que no es verídica.' },
      puntaje: { type: 'integer', minimum: 0, maximum: 100, description: 'Qué tan creíble y correcta parece la publicación (100 = totalmente).' },
      fotos: {
        type: 'array',
        description: 'Una entrada por foto, en el orden recibido.',
        items: {
          type: 'object',
          properties: {
            numero: { type: 'integer', description: 'Número de la foto (1, 2, 3…)' },
            muestra_el_producto: { type: 'boolean', description: '¿Se ve el producto declarado?' },
            que_se_ve: { type: 'string', description: 'Qué se ve, en pocas palabras.' },
            foto_real_de_cosecha: { type: 'boolean', description: 'false si parece imagen de internet o de catálogo, captura de pantalla, dibujo, imagen generada o con marca de agua.' },
            calidad: { type: 'string', enum: ['BUENA', 'REGULAR', 'MALA'], description: 'Si se ve bien (nitidez, luz).' },
            problemas: { type: 'array', items: { type: 'string' }, description: 'Problemas concretos, si hay.' },
          },
          required: ['numero', 'muestra_el_producto', 'que_se_ve', 'foto_real_de_cosecha', 'calidad'],
        },
      },
      precio: { type: 'string', description: 'Una frase: ¿el precio es creíble frente a los de referencia?' },
      cantidad: { type: 'string', description: 'Una frase: ¿la cantidad es creíble para la chacra y lo que se ve?' },
      resumen: { type: 'string', description: 'Dos o tres frases para el equipo de Mesagri.' },
      mensaje_agricultor: { type: 'string', description: 'Si hay algo que corregir: una frase amable y simple para el agricultor. Vacío si todo está bien.' },
    },
    required: ['veredicto', 'puntaje', 'fotos', 'precio', 'cantidad', 'resumen'],
  },
} as const;

const SYSTEM = `Eres el revisor automático de Mesagri, una plataforma que conecta a agricultores de Arequipa (Perú) con restaurantes, hoteles y comedores. Antes de que una publicación de cosecha se vea en el catálogo, la revisas tú y después una persona del equipo decide si se publica. Tu trabajo es detectar publicaciones falsas, engañosas o con errores.

Revisa:
1. Fotos: ¿muestran el producto declarado (por ejemplo papa amarilla, no camote ni un dibujo)? ¿Parecen fotos reales tomadas por el agricultor (cosecha en la chacra, sacos, jabas, almacén) o imágenes de internet o de catálogo, capturas de pantalla, dibujos, imágenes generadas, con marca de agua o con textos de tiendas? ¿Se ven bien? ¿Lo que se ve es coherente con la cantidad y la calidad declaradas?
2. Precio: compáralo con los precios de referencia. Muy bajo puede ser un error de unidad (por arroba o por saco) o un señuelo; muy alto, un error al escribir.
3. Cantidad: frente al área de la chacra, lo que rinde el cultivo y lo que se ve en las fotos.
4. Coherencia: variedad, fecha de cosecha, calidad.

Reglas: no inventes lo que no ves; si algo no se puede saber por la foto, dilo. Usa OBSERVAR cuando tengas dudas y RECHAZAR solo con señales claras (la foto no es del producto, es de internet o de otra publicación, o el precio es imposible). Escribe en español sencillo. El mensaje para el agricultor es amable, corto y dice qué corregir. Responde solo con la herramienta registrar_revision.`;

const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/** Datos de la publicación para la IA, en texto. */
export function describeListing(w: World, l: Listing, photos: { n: number; gallery: boolean; dupOf?: string }[], t: number): string {
  const p = product(l.productId);
  const o = w.orgs[l.orgId];
  const farm = l.farmId ? w.farms[l.farmId] : undefined;
  const d = farm ? DISTRICT_BY_CODE[farm.district] : o ? DISTRICT_BY_CODE[o.district] : undefined;
  const kg = l.qtyTotal * (l.unitKg || 1);
  const ppk = l.price / (l.unitKg || 1);
  const days = Math.round((t - l.harvestDate) / 86_400_000);
  const mine = Object.values(w.listings).filter(x => x.orgId === l.orgId && x.id !== l.id);
  const rules = rulesReview(w, l, t);
  const unit = l.unit === 'kg' ? 'kg' : `${UNIT_LABEL[l.unit].many} de ${l.unitKg} kg`;
  return [
    'Publicación por revisar',
    `- Producto: ${p.name}${l.variety ? `, variedad ${l.variety}` : ''}. Calidad declarada: ${l.quality.toLowerCase()}.`,
    `- Cantidad: ${l.qtyTotal} ${unit}${l.unit === 'kg' ? '' : ` (${Math.round(kg)} kg en total)`}.`,
    `- Precio: S/ ${r2(l.price)} por ${l.unit === 'kg' ? 'kg' : UNIT_LABEL[l.unit].one}${l.unit === 'kg' ? '' : ` = S/ ${r2(ppk)} por kg`}.`,
    `- Precios de referencia por kg: en chacra S/ ${r2(p.ref.chacra)}, en el mercado mayorista S/ ${r2(p.ref.mayorista)} (${p.ref.source}). Sugerido en Mesagri: S/ ${r2(suggestedPricePerKg(p.id))}.`,
    `- Cosecha: ${days <= 0 ? 'hoy' : `hace ${days} ${days === 1 ? 'día' : 'días'}`}. Se conserva unos ${p.perishDays} días.`,
    l.fromLotId ? '- Sale de un lote pesado y guardado en un almacén aliado.' : farm ? `- Chacra: ${farm.name}, ${String(farm.areaHa).replace('.', ',')} ha${d ? `, ${d.name} (${PROVINCES[d.province].name})` : ''}. Este cultivo rinde hasta ~${p.yieldHigh} t por ha.` : `- Sin chacra registrada${d ? `; el agricultor es de ${d.name} (${PROVINCES[d.province].name})` : ''}.`,
    o ? `- Agricultor: nivel ${o.level} de verificación, ${o.counters.completedSales} ventas conformes, ${mine.filter(x => !!x.review?.approvedAt || ['ACTIVE', 'SOLD_OUT', 'EXPIRED'].includes(x.status)).length} publicaciones aprobadas antes, ${mine.filter(x => x.status === 'REJECTED').length} rechazadas.` : '',
    photos.length
      ? `- Fotos (${photos.length}): ${photos.map(f => `foto ${f.n} ${f.gallery ? 'elegida de la galería del celular' : 'tomada con la cámara de la app'}${f.dupOf ? ' — ¡ya está en una publicación de otro agricultor!' : ''}`).join('; ')}.`
      : '- No hay fotos que mirar.',
    `- Revisión por reglas: ${rules.checks.map(c => `${c.label} ${c.ok === true ? 'bien' : c.ok === false ? 'MAL' : 'dudoso'} (${c.detail})`).join(' ')}`,
    '',
    'Usa la herramienta registrar_revision.',
  ].filter(Boolean).join('\n');
}

/** Lo que devolvió la IA, como revisión automática para el motor. */
export function toAuto(out: AiOutput, model: string, nPhotos: number) {
  const fotos = Array.isArray(out.fotos) ? out.fotos.slice(0, nPhotos || 0) : [];
  const checks = fotos.map((f, i) => {
    const n = Number(f.numero) || i + 1;
    const bad = f.muestra_el_producto === false || f.foto_real_de_cosecha === false;
    const problems = (Array.isArray(f.problemas) ? f.problemas : []).filter(Boolean).slice(0, 4).join('; ');
    return {
      key: `foto${n}`, label: `Foto ${n}`, ok: bad ? false : f.calidad === 'MALA' ? null : true,
      detail: `${String(f.que_se_ve ?? '').trim()}${f.foto_real_de_cosecha === false ? ' · no parece una foto real de la cosecha' : ''}${f.muestra_el_producto === false ? ' · no se ve el producto declarado' : ''}${f.calidad === 'MALA' ? ' · se ve mal' : ''}${problems ? ` · ${problems}` : ''}`,
    };
  });
  checks.push({ key: 'precio', label: 'Precio', ok: null as any, detail: String(out.precio ?? '').trim() });
  checks.push({ key: 'cantidad', label: 'Cantidad', ok: null as any, detail: String(out.cantidad ?? '').trim() });
  return {
    model, verdict: out.veredicto, score: Math.round(Number(out.puntaje) || 0), checks,
    summary: String(out.resumen ?? '').trim(), farmerMessage: String(out.mensaje_agricultor ?? '').trim() || undefined,
  };
}

@Injectable()
export class AiListingReview implements OnModuleInit {
  private readonly log = new Logger('Revisión con IA');
  private queue: Job[] = [];
  private seen = new Set<string>();
  private running = false;
  private timer?: NodeJS.Timeout;
  /** se reemplaza en las pruebas */
  fetcher: Fetch = (...a) => fetch(...a);
  /** espera entre reintentos (las pruebas la acortan) */
  retryMs = 30_000;

  constructor(private readonly engine: EngineService) {}

  configured(): boolean { return !!CONFIG.aiReview.key; }

  onModuleInit() {
    this.engine.bus.on('event', (a: Applied) => {
      if (!this.configured()) return;
      if (!['LISTING_PUBLISH', 'LISTING_EDIT', 'LISTING_RESUME'].includes(a.event.type)) return;
      this.consider(String(a.event.p?.listingId ?? ''));
    });
    this.engine.bus.on('reset', () => { this.queue = []; this.seen.clear(); });
    // al arrancar: las que quedaron en revisión sin IA (servidor reiniciado o clave recién puesta)
    if (this.configured()) setTimeout(() => this.scan(), 8_000).unref?.();
  }

  /** Publicaciones en revisión que la IA todavía no miró. */
  scan() {
    const w = this.engine.world;
    if (!w) return;
    for (const l of Object.values(w.listings)) if (l.status === 'IN_REVIEW' && l.review && !l.review.ai) this.consider(l.id);
  }

  consider(listingId: string) {
    const l = this.engine.world?.listings[listingId];
    if (!l || l.status !== 'IN_REVIEW' || !l.review || l.review.ai) return;
    const key = `${l.id}@${l.review.queuedAt}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
    this.queue.push({ listingId: l.id, queuedAt: l.review.queuedAt, tries: 0, notBefore: 0 });
    this.kick();
  }

  private kick(delay = 0) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, delay);
    this.timer.unref?.();
  }

  /** Revisa de a una (cada llamada tarda unos segundos). */
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
    return l && l.review && l.review.queuedAt === job.queuedAt && l.status === 'IN_REVIEW' ? l : undefined;
  }

  private async mark(job: Job, state: 'PENDIENTE' | 'LISTA' | 'ERROR', extra: Record<string, unknown> = {}) {
    await this.engine.apply({ type: 'LISTING_AI_REVIEW', actor: 'system', p: { listingId: job.listingId, queuedAt: job.queuedAt, state, ...extra } }, true);
  }

  private async todayCount(): Promise<number> {
    const r = await rows(this.engine.pool, 'SELECT COUNT(*) AS n FROM ai_reviews WHERE created_at >= UTC_DATE() AND error IS NULL');
    return Number(r[0]?.n ?? 0);
  }

  async process(job: Job) {
    const l = this.current(job);
    if (!l) return;
    if (job.tries === 0) {
      if ((await this.todayCount()) >= CONFIG.aiReview.dailyMax) {
        await this.mark(job, 'ERROR', { note: `Se llegó al tope de ${CONFIG.aiReview.dailyMax} revisiones con IA de hoy: quedó la revisión por reglas.` });
        return;
      }
      await this.mark(job, 'PENDIENTE');
    }
    // las fotos se suben aparte (con reintento): se espera un poco a que lleguen
    const wanted = l.photoIds.filter(id => !id.startsWith('seed-photo-')).slice(0, CONFIG.aiReview.maxPhotos);
    const photos = await this.loadPhotos(wanted);
    const missing = wanted.filter(id => !photos.some(p => p.id === id));
    if (missing.length && job.tries < 6) {
      this.queue.push({ ...job, tries: job.tries + 1, notBefore: Date.now() + this.retryMs });
      this.kick(this.retryMs);
      return;
    }
    const dups = await this.duplicates(l, photos);
    const w = this.engine.world;
    const info = photos.map((p, i) => ({ n: i + 1, gallery: fromGallery(p.id), dupOf: dups.get(p.id) }));
    const text = describeListing(w, l, info, this.engine.simNow())
      + (missing.length ? `\n- No llegaron ${missing.length} ${missing.length === 1 ? 'foto' : 'fotos'} al servidor: no se pudieron mirar.` : '')
      + (l.photoIds.some(id => id.startsWith('seed-photo-')) ? '\n- Una foto es de ejemplo de la demo (no se manda).' : '');
    const t0 = Date.now();
    const model = CONFIG.aiReview.model;
    let out: AiOutput, usage: any = {};
    try {
      const r = await this.call(photos, text);
      out = r.out; usage = r.usage;
    } catch (e: any) {
      const retryable = /^(429|5\d\d|overloaded)$/.test(String(e?.code ?? '')) || /timeout|abort|fetch failed|ECONN/i.test(`${e?.name} ${e?.message}`);
      if (retryable && job.tries < 2) {
        this.queue.push({ ...job, tries: job.tries + 1, notBefore: Date.now() + this.retryMs });
        this.kick(this.retryMs);
        return;
      }
      await this.logRun(l.id, job.queuedAt, model, undefined, photos.length, usage, Date.now() - t0, String(e?.message ?? e).slice(0, 300));
      if (this.current(job)) await this.mark(job, 'ERROR', { note: `La IA no respondió (${String(e?.message ?? e).slice(0, 120)}): quedó la revisión por reglas.` });
      return;
    }
    const auto = toAuto(out, model, photos.length);
    // las fotos repetidas las sabe el servidor (por el contenido), aunque la IA no las note
    for (const [id, other] of dups) {
      const n = photos.findIndex(p => p.id === id) + 1;
      auto.checks.unshift({ key: `dup${n}`, label: `Foto ${n}`, ok: false, detail: `Es la misma imagen que una foto de otra publicación (${other}).` });
      if (auto.verdict === 'OK') auto.verdict = 'OBSERVAR';
    }
    await this.logRun(l.id, job.queuedAt, model, auto, photos.length, usage, Date.now() - t0);
    if (this.current(job)) await this.mark(job, 'LISTA', { auto });
  }

  /** Llama a la API de Claude con las fotos y los datos. */
  async call(photos: Photo[], text: string): Promise<{ out: AiOutput; usage: any }> {
    const content: any[] = photos.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data.toString('base64') } }));
    content.push({ type: 'text', text });
    const res = await this.fetcher(CONFIG.aiReview.url, {
      method: 'POST',
      headers: { 'x-api-key': CONFIG.aiReview.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.aiReview.model, max_tokens: 1500, system: SYSTEM, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name }, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(CONFIG.aiReview.timeoutMs),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j: any = await res.json(); msg = `${j?.error?.type ?? res.status}: ${j?.error?.message ?? ''}`.trim(); } catch { /* sin cuerpo */ }
      const err: any = new Error(msg);
      err.code = res.status === 529 ? 'overloaded' : String(res.status);
      throw err;
    }
    const j: any = await res.json();
    const tu = (Array.isArray(j?.content) ? j.content : []).find((c: any) => c?.type === 'tool_use' && c?.name === TOOL.name);
    if (!tu?.input) throw new Error('La IA no devolvió la revisión');
    return { out: tu.input as AiOutput, usage: j.usage ?? {} };
  }

  private async loadPhotos(ids: string[]): Promise<Photo[]> {
    if (!ids.length) return [];
    const list = await rows(this.engine.pool, `SELECT f.uuid, f.mime_type, f.sha256, b.data FROM files f LEFT JOIN file_blobs b ON b.file_id = f.id
      WHERE f.uuid IN (?) AND f.kind = 'FOTO' AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')`, [ids]);
    const out: Photo[] = [];
    for (const id of ids) {
      const r = list.find(x => x.uuid === id);
      if (!r?.data || !Buffer.isBuffer(r.data) || r.data.length > 3_700_000) continue;
      out.push({ id, mime: r.mime_type, data: r.data, sha: r.sha256 });
    }
    return out;
  }

  /** Fotos con el mismo contenido que una foto de otra publicación de otro agricultor. */
  private async duplicates(l: Listing, photos: Photo[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const w = this.engine.world;
    // misma foto (mismo id) en otra publicación: lo ve también la regla
    for (const other of photosUsedElsewhere(w, l)) for (const id of w.listings[other].photoIds) if (l.photoIds.includes(id)) out.set(id, product(w.listings[other].productId).name);
    if (!photos.length) return out;
    const same = await rows(this.engine.pool, 'SELECT uuid, sha256 FROM files WHERE sha256 IN (?) AND uuid NOT IN (?)', [photos.map(p => p.sha), photos.map(p => p.id)]);
    for (const r of same) {
      const holder = Object.values(w.listings).find(x => x.orgId !== l.orgId && x.photoIds.includes(r.uuid));
      const mine = photos.find(p => p.sha === r.sha256);
      if (holder && mine) out.set(mine.id, `${product(holder.productId).name} de ${w.orgs[holder.orgId]?.name ?? 'otro agricultor'}`);
    }
    return out;
  }

  private async logRun(listingId: string, queuedAt: number, model: string, auto: ReturnType<typeof toAuto> | undefined, photos: number, usage: any, ms: number, error?: string) {
    try {
      await exec(this.engine.pool, 'INSERT INTO ai_reviews (listing_uuid, queued_at, model, verdict, score, photos, input_tokens, output_tokens, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [listingId, new Date(queuedAt), model.slice(0, 60), auto?.verdict ?? null, auto ? Math.max(0, Math.min(100, auto.score)) : null, photos, usage?.input_tokens ?? null, usage?.output_tokens ?? null, ms, error ?? null]);
    } catch (e: any) { this.log.warn(`No se anotó la revisión: ${e?.message ?? e}`); }
  }

  /** Para el panel: si hay IA, qué modelo y cuántas revisiones van hoy. */
  async info() {
    const today = this.configured() ? await this.todayCount().catch(() => 0) : 0;
    return { ai: this.configured(), model: this.configured() ? CONFIG.aiReview.model : null, today, dailyMax: CONFIG.aiReview.dailyMax, pending: this.queue.length };
  }
}
