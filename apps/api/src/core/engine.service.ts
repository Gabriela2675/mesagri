/*
 * Motor del servidor: tiene el mundo vigente en memoria, aplica cada acción con las reglas de
 * @mesagri/shared, la guarda en MySQL dentro de una transacción y la difunde a los celulares.
 *
 * - Una acción a la vez (cola): el orden del servidor es el orden de todos.
 * - La hora la pone el servidor (reloj de la demo); el celular solo informa cuándo la hizo.
 * - Los códigos secretos (entrega, recojo, QR) los genera el servidor al azar.
 * - Cada cierto tiempo procesa los plazos vencidos (tareas programadas, 14.7).
 */
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';
import { applySafe, emptyWorld, structuredCloneSafe, hasDue, SEED_ANCHOR, SEED_VERSION, uid, HANDLERS, WorldTracker } from '@mesagri/shared';
import type { MEvent, World, Changes } from '@mesagri/shared';
import { CONFIG } from '../config';
import { createPool, exec, rows, tx, upsert, js } from '../db/db';
import { migrate } from '../db/migrate';
import { Persistence } from '../db/store/persistence';
import { writeReference } from '../db/store/reference';
import { DomainHttpError } from '../common/errors';

/** Acción aceptada: su número, el evento, lo que devolvió y qué entidades cambiaron (para mandar a cada perfil lo suyo). */
export interface Applied { seq: number; event: MEvent; result?: unknown; changes?: Changes }
export interface ApplyOk extends Applied { ok: true; duplicate?: boolean }
export interface ApplyFail { ok: false; error: { code: string; message: string; data?: unknown } }
export type ApplyResult = ApplyOk | ApplyFail;

export interface ApplyInput {
  id?: string;
  type: string;
  actor: string;
  p: any;
  device?: string;
  clientAt?: number;
}

/** Acciones que solo puede hacer el servidor. */
export const SYSTEM_ONLY = new Set(['WORLD_INIT', 'CLOCK_ADVANCE', 'CLOCK_TICK']);

const rand4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
const ALNUM = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const rand8 = () => Array.from({ length: 8 }, () => ALNUM[crypto.randomInt(0, ALNUM.length)]).join('');

@Injectable()
export class EngineService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Motor');
  pool!: Pool;
  store!: Persistence;
  world!: World;
  /** último número de acción aceptada (sync_events.seq) */
  seq = 0;
  /** cambia al reiniciar la demo: los celulares descartan lo que tenían */
  epoch = '';
  /** cambia cada vez que arranca el servidor: los celulares piden el mundo completo otra vez */
  readonly boot = 'b' + uid();
  readonly bus = new EventEmitter();
  /** Huellas de las entidades del mundo: dicen qué cambió con cada acción. */
  readonly tracker = new WorldTracker();
  /** Lo que se hace después de crear los datos de ejemplo (claves del equipo, por ejemplo). */
  readonly seedHooks: ((w: World) => Promise<void>)[] = [];
  /** Cambios a la historia de ejemplo antes de guardarla (el equipo de Mesagri vuelve con sus datos). */
  readonly seedTransforms: ((w: World) => Promise<void>)[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  ready = false;
  private readyResolve!: () => void;
  private readyReject!: (e: unknown) => void;
  /** Se cumple cuando el mundo ya está en memoria (las demás piezas esperan esto). */
  readonly whenReady: Promise<void> = new Promise((res, rej) => { this.readyResolve = res; this.readyReject = rej; });

  async onModuleInit() {
    try { await this.start(); this.readyResolve(); } catch (e) { this.readyReject(e); throw e; }
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    try { await this.heartbeat(false); } catch { /* base caída */ }
    try { await this.pool?.end(); } catch { /* ya cerrada */ }
  }

  /* ---------------- Arranque ---------------- */

  async start() {
    const ran = await migrate({ log: m => this.log.log(m) });
    if (ran.length) this.log.log(`Base al día (${ran.length} migraciones nuevas)`);
    this.pool = createPool();
    const ref = await rows(this.pool, 'SELECT COUNT(*) AS n FROM catalog_products');
    if (!Number(ref[0].n)) {
      await tx(this.pool, c => writeReference(c));
      this.log.log('Catálogo, ubigeo y precios de referencia cargados');
    }
    this.store = new Persistence(this.pool);
    await this.store.init();
    const stale = CONFIG.demo && (await this.store.hasWorld()) && (await this.getState<string>('seedVersion')) !== SEED_VERSION;
    if (stale) {
      // la historia de ejemplo cambió (modo demo): se carga la nueva una vez, con época nueva; el equipo se conserva
      this.log.log(`La historia de ejemplo cambió (${SEED_VERSION}): se vuelve a cargar`);
      await this.store.reset();
      await this.seed();
      await this.newEpoch();
      await this.setState('clock', { simNow: this.simNow(), realAt: Date.now() });
    } else if (await this.store.hasWorld()) {
      const t0 = Date.now();
      this.world = await this.store.load();
      this.log.log(`Mundo leído de MySQL en ${Date.now() - t0} ms`);
    } else {
      await this.seed();
    }
    this.epoch = (await this.getState<string>('epoch')) ?? (await this.newEpoch());
    const r = await rows(this.pool, 'SELECT COALESCE(MAX(seq), 0) AS s FROM sync_events WHERE epoch = ?', [this.epoch]);
    this.seq = Number(r[0].s);
    if (CONFIG.clockMode === 'resume') await this.resumeClock();
    this.timer = setInterval(() => { void this.heartbeat(true).catch(e => this.log.error(`Reloj: ${e?.message ?? e}`)); }, 20_000);
    this.tracker.reset(this.world);
    this.ready = true;
    this.log.log(`Listo · época ${this.epoch} · acción ${this.seq} · hora de la demo ${new Date(this.simNow()).toISOString()}`);
  }

  /** Crea el mundo de ejemplo y lo guarda (primera vez o al reiniciar la demo). */
  private async seed() {
    const t0 = Date.now();
    const w = emptyWorld();
    const r = applySafe(w, { id: 'init-' + uid(), type: 'WORLD_INIT', actor: 'system', t: SEED_ANCHOR, lamport: 0, p: { realAt: Date.now() } });
    if (!r.ok) throw new Error('No se pudo crear el mundo de ejemplo: ' + r.error?.message);
    for (const f of this.seedTransforms) await f(w);
    await tx(this.pool, async c => {
      const { commit } = await this.store.persist(c, undefined, w);
      commit();
    });
    this.world = w;
    await this.setState('seedVersion', SEED_VERSION);
    for (const h of this.seedHooks) await h(w);
    this.log.log(`Datos de ejemplo guardados en MySQL en ${Date.now() - t0} ms`);
  }

  private async newEpoch(): Promise<string> {
    const e = 'ep' + uid();
    await this.setState('epoch', e);
    return e;
  }

  async getState<T>(key: string): Promise<T | undefined> {
    const r = await rows(this.pool, 'SELECT value FROM system_state WHERE state_key = ?', [key]);
    return r[0]?.value as T | undefined;
  }

  async setState(key: string, value: unknown) {
    await upsert(this.pool, 'system_state', { state_key: key, value: js(value) }, { keys: ['state_key'], hasId: false });
  }

  /* ---------------- Reloj de la demo ---------------- */

  /** Hora de la demo (America/Lima, simulada): hora real + adelantos. */
  simNow(): number {
    return Date.now() + (this.world?.clockOffset ?? 0);
  }

  /** El reloj de la demo sigue donde quedó cuando se apagó el servidor. */
  private async resumeClock() {
    const hb = await this.getState<{ simNow: number }>('clock');
    if (!hb?.simNow) return;
    const offset = hb.simNow - Date.now();
    if (Math.abs(offset - this.world.clockOffset) < 60_000) return;
    await this.exclusive(async () => {
      const next = structuredCloneSafe(this.world);
      next.clockOffset = offset;
      await tx(this.pool, async c => { const { commit } = await this.store.persist(c, this.world, next); commit(); });
      this.world = next;
    });
    this.log.log('El reloj de la demo continúa donde se detuvo');
  }

  /** Guarda la hora de la demo y procesa los plazos vencidos (expirar pedidos, cerrar envíos, cierre de mes...). */
  private async heartbeat(processDue: boolean) {
    if (!this.pool) return;
    await this.setState('clock', { simNow: this.simNow(), realAt: Date.now() });
    if (processDue && this.ready && hasDue(this.world, this.simNow())) {
      const r = await this.apply({ type: 'CLOCK_TICK', actor: 'system', p: {} }, true);
      if (!r.ok) this.log.warn(`Tarea programada: ${r.error.message}`);
    }
  }

  /* ---------------- Acciones ---------------- */

  /** Ejecuta en orden (una acción a la vez). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Aplica una acción. `system` = la hace el servidor (reloj, tareas programadas).
   * Devuelve el evento tal como quedó (con la hora del servidor) y su número de orden.
   */
  apply(input: ApplyInput, system = false): Promise<ApplyResult> {
    return this.exclusive(() => this.applyNow(input, system));
  }

  private async applyNow(input: ApplyInput, system: boolean): Promise<ApplyResult> {
    if (!this.ready && !system) throw new DomainHttpError(503, 'STARTING', 'El servidor está arrancando. Intenta en unos segundos.');
    const type = String(input.type ?? '');
    if (!HANDLERS[type]) return { ok: false, error: { code: 'UNKNOWN', message: `Acción desconocida: ${type}` } };
    if (SYSTEM_ONLY.has(type) && !system) return { ok: false, error: { code: 'FORBIDDEN', message: 'Esta acción la hace solo el servidor.' } };
    const id = input.id && /^[A-Za-z0-9:_.-]{4,80}$/.test(input.id) ? input.id : 'e-' + uid();

    // Reintento de una acción ya aceptada (sin señal, doble toque): misma respuesta, sin duplicar
    const prior = await rows(this.pool, 'SELECT seq, type, actor_uuid, device, payload, simulated_at, result FROM sync_events WHERE event_uuid = ?', [id]);
    if (prior.length) {
      const r = prior[0];
      if (r.actor_uuid !== input.actor) return { ok: false, error: { code: 'DUPLICATE_ID', message: 'Ese identificador de acción ya se usó.' } };
      return { ok: true, duplicate: true, seq: Number(r.seq), event: { id, type: r.type, actor: r.actor_uuid, t: r.simulated_at.getTime(), lamport: 0, device: r.device ?? undefined, p: r.payload }, result: r.result ?? undefined };
    }

    const p = this.withSecrets(type, input.p && typeof input.p === 'object' ? structuredCloneSafe(input.p) : {});
    const t = Math.max(this.simNow(), this.world.now);
    const e: MEvent = { id, type, actor: input.actor, t, lamport: 0, device: input.device ? String(input.device).slice(0, 80) : undefined, p };
    const next = structuredCloneSafe(this.world);
    const r = applySafe(next, e);
    if (!r.ok) return { ok: false, error: r.error! };
    next.rejected = {};

    let seq = 0;
    let commit = () => {};
    try {
      await tx(this.pool, async c => {
        const res = await this.store.persist(c, this.world, next);
        commit = res.commit;
        const ins = await exec(c,
          'INSERT INTO sync_events (event_uuid, type, actor_uuid, device, payload, simulated_at, client_at, epoch, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, type, input.actor, e.device ?? null, JSON.stringify(p), new Date(t), input.clientAt ? new Date(input.clientAt) : null, this.epoch, r.result === undefined ? null : JSON.stringify(r.result)]);
        seq = Number(ins.insertId);
      });
    } catch (err: any) {
      await this.store.recover();
      this.log.error(`No se pudo guardar ${type}: ${err?.message ?? err}`);
      throw new DomainHttpError(500, 'STORAGE', 'No pudimos guardar en la base de datos. Intenta de nuevo.');
    }
    commit();
    this.world = next;
    this.seq = seq;
    const out: Applied = { seq, event: e, result: r.result, changes: this.tracker.diff(next) };
    this.bus.emit('event', out);
    return { ok: true, ...out };
  }

  /** El servidor genera al azar los códigos de entrega, recojo y QR (el celular no los elige). */
  private withSecrets(type: string, p: any): any {
    delete p.secrets;
    if (type === 'ORDER_PLACE' && Array.isArray(p.subs)) {
      p.secrets = Object.fromEntries(p.subs.map((s: any) => [String(s?.subOrderId), { delivery: rand4(), pickup: rand4(), qr: rand8() }]));
    } else if (type === 'REQUEST_ACCEPT' && p.subOrderId) {
      p.secrets = { [String(p.subOrderId)]: { delivery: rand4(), pickup: rand4(), qr: rand8() } };
    } else if (type === 'SCHEDULE_APPROVE' && Array.isArray(p.subOrderIds)) {
      p.secrets = Object.fromEntries(p.subOrderIds.map((id: any) => [String(id), { delivery: rand4(), pickup: rand4(), qr: rand8() }]));
    } else if (type === 'SHIP_SWITCH_MODE') {
      p.secrets = { pickup: rand4() };
    } else if (type === 'STO_BOOK') {
      p.secrets = { qr: rand8() };
    }
    return p;
  }

  /** Acciones aceptadas después de `after` (para un celular que se reconectó). */
  async eventsAfter(after: number, limit = 500): Promise<Applied[]> {
    const list = await rows(this.pool, 'SELECT seq, event_uuid, type, actor_uuid, device, payload, simulated_at, result FROM sync_events WHERE epoch = ? AND seq > ? ORDER BY seq LIMIT ?', [this.epoch, after, limit]);
    return list.map(r => ({ seq: Number(r.seq), event: { id: r.event_uuid, type: r.type, actor: r.actor_uuid, t: r.simulated_at.getTime(), lamport: 0, device: r.device ?? undefined, p: r.payload }, result: r.result ?? undefined }));
  }

  /* ---------------- Demo ---------------- */

  /** Reinicia la demo: vacía los datos (no el catálogo), vuelve a la historia de ejemplo y cambia la época. */
  async reset(opts: { team?: boolean } = {}): Promise<void> {
    await this.exclusive(async () => {
      this.ready = false;
      try {
        await this.store.reset();
        // también el equipo: vuelven las cuentas de prueba del panel tal como están en la historia de ejemplo
        if (opts.team) await exec(this.pool, 'DELETE FROM team_accounts');
        await this.seed();
        this.tracker.reset(this.world);
        this.epoch = await this.newEpoch();
        this.seq = 0;
        await this.setState('clock', { simNow: this.simNow(), realAt: Date.now() });
        try {
          if (fs.existsSync(CONFIG.filesDir)) for (const f of fs.readdirSync(CONFIG.filesDir)) fs.rmSync(path.join(CONFIG.filesDir, f), { recursive: true, force: true });
        } catch { /* sin carpeta de archivos */ }
      } finally {
        this.ready = true;
      }
    });
    this.bus.emit('reset', { epoch: this.epoch });
    this.log.log(`Demo reiniciada · época ${this.epoch}`);
  }
}
