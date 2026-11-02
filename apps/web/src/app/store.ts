/*
 * Copia del mundo en el navegador, sincronizada con el servidor de Mesagri.
 *
 * - El servidor (NestJS + MySQL) es la fuente de la verdad: aplica cada acción y la guarda. A cada
 *   celular le manda su copia del mundo según su perfil (lo de su cuenta y sus contrapartes; de los
 *   demás, lo público) y, por Socket.IO y en un orden único, solo las entidades que cambiaron.
 *   (En la versión autónoma, el «servidor» corre en el celular y se reaplican las acciones.)
 * - Lo que hace este celular se muestra al instante (optimista) y queda en una cola que se envía
 *   al servidor; si no hay señal, espera y se reintenta (RNF-05). Si el servidor la rechaza
 *   (por ejemplo, otra persona compró el último saco), se quita y se avisa.
 */
import type { MEvent, World } from '@mesagri/shared/types';
import { applySafe, tick, structuredCloneSafe } from '@mesagri/shared/engine/index';
import { nextDeadline } from '@mesagri/shared/engine/tick';
import { uid } from '@mesagri/shared/ids';
import { registerProducts } from '@mesagri/shared/catalog';
import { PROTOCOL } from '@mesagri/shared/protocol';
import { applyPatch, type Patch } from '@mesagri/shared/patch';
import { api, ApiError, API, isNetwork, Sessions, openSocket, teamHeaders, teamKey, saveDeviceKey, deviceKeyFor, markStage, type LiveSocket } from './net';
import { LOCAL } from './routes';
import { lsGet, lsSet, lsDel } from './persist';

export interface ActResult { ok: boolean; result?: any; error?: { code: string; message: string; data?: any } }
export type Mode = 'stage' | 'app' | 'panel';
export type Status = 'connecting' | 'online' | 'offline';

interface Applied { seq: number; event: MEvent; result?: unknown }
interface Pending { e: MEvent; tries: number; nextAt: number; sent?: boolean; seq?: number }

const INF = '__mesagri_inf__';
/** Infinity viaja como texto (JSON no lo tiene). */
export function revive<T>(x: T): T {
  if (x === (INF as any)) return Infinity as any;
  if (x === ('-' + INF as any)) return -Infinity as any;
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) (x as any)[i] = revive((x as any)[i]); return x; }
  if (x && typeof x === 'object') { for (const k of Object.keys(x)) (x as any)[k] = revive((x as any)[k]); return x; }
  return x;
}

const OUTBOX_KEY = 'mesagri.v2.outbox';
type Listener = () => void;

export class Store {
  /** Mundo para mostrar: lo confirmado por el servidor más lo pendiente de este navegador. */
  world!: World;
  /** Mundo confirmado por el servidor. */
  confirmed!: World;
  seq = 0;
  epoch = '';
  boot = '';
  /** Diferencia entre el reloj del servidor y el de este equipo. */
  skew = 0;
  version = 0;
  /** Acciones confirmadas que llegaron en esta sesión (para «último uso» en el panel). */
  events: MEvent[] = [];
  pending: Pending[] = [];
  status: Status = 'connecting';
  ready = false;
  problem = '';
  /** El servidor que respondió es de otra versión que esta app (p. ej. quedó abierto el anterior). */
  outdated?: { server: number; client: number };
  /** El escenario de la demo necesita la clave del equipo (el servidor está en la nube). */
  needTeam = false;
  /** Con qué perfil se pidió la copia del mundo ('team', 'admin', 'user' o 'anon'). */
  viewerKind = '';
  /** Persona que usa este celular o el panel (fuera del escenario): con su sesión se pide su copia. */
  viewerUserId?: string;
  readonly backend = { kind: 'server' as const };
  readonly sessions = new Sessions();
  /** Permiso para crear la cuenta, por celular (lo da el código verificado). */
  readonly tickets = new Map<string, string>();
  onLateReject?: (e: MEvent, err: { code: string; message: string }) => void;
  onReset?: () => void;
  private listeners = new Set<Listener>();
  private cache?: { version: number; until: number; world: World };
  private socket?: LiveSocket;
  private buffer = new Map<number, Applied>();
  private flushing = false;
  private gapTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setInterval>;
  private resyncing?: Promise<void>;
  private patchBuf: Patch[] = [];
  private helloRetries = 0;

  constructor(readonly mode: Mode = 'stage') {
    this.sessions.allowDemo = mode === 'stage';
    if (mode === 'stage') markStage();
  }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  emit() { this.version++; this.cache = undefined; for (const l of [...this.listeners]) l(); }

  /* ---------------- Conexión ---------------- */

  async start() {
    this.loadOutbox();
    this.sessions.preload();
    try {
      // en la versión autónoma todo está en el celular: la señal no importa
      if (!LOCAL) {
        window.addEventListener('offline', () => this.setStatus('offline'));
        window.addEventListener('online', () => { this.setStatus(this.socket?.connected ? 'online' : 'connecting'); this.socket?.connect(); void this.flush(); });
      }
    } catch { /* sin ventana */ }
    await this.resync();
    await this.connect();
    this.retryTimer = setInterval(() => { void this.flush(); }, 2500);
  }

  private setStatus(s: Status) {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  stop() {
    this.socket?.close();
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /** Credenciales con las que este celular pide su copia del mundo y se conecta al canal en vivo. */
  async credentials(): Promise<{ token?: string; team?: string }> {
    if (LOCAL) return {};
    if (this.mode === 'stage') return { team: teamKey() ?? '' };
    if (!this.viewerUserId) return {};
    try { return { token: await this.sessions.token(this.viewerUserId) }; } catch { return {}; }
  }

  /**
   * Quién usa este celular o el panel (fuera del escenario). Al ingresar o salir cambia lo que el
   * servidor le manda: se vuelve a pedir la copia del mundo y se reconecta el canal en vivo.
   */
  setViewer(userId: string | undefined) {
    if (this.mode === 'stage' || LOCAL || this.viewerUserId === userId) return;
    this.viewerUserId = userId;
    this.helloRetries = 0;
    if (!this.socket) return; // todavía arrancando: start() la pide con esta persona
    this.reconnect();
    void this.resync();
  }

  /** Después de escribir la clave del equipo: se vuelve a pedir el mundo y a conectar el canal en vivo. */
  retryTeam(): Promise<void> {
    this.needTeam = false;
    this.problem = '';
    this.reconnect();
    return this.resync();
  }

  private reconnect() {
    const s = this.socket;
    if (!s) return;
    try { s.disconnect?.(); } catch { /* ya cerrado */ }
    s.connect();
  }

  /** Pide la copia del mundo (al abrir, al reconectar, al ingresar o salir, o después de reiniciar la demo). */
  resync(): Promise<void> {
    if (!this.resyncing) this.resyncing = this.doResync().finally(() => { this.resyncing = undefined; this.drainPatches(); });
    return this.resyncing;
  }

  private async fetchSnapshot(): Promise<any> {
    if (LOCAL) return api<any>('/sync/snapshot');
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await this.credentials();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (c.team !== undefined) headers['x-team-key'] = c.team;
      if (c.token) headers.Authorization = 'Bearer ' + c.token;
      const r = await fetch(API + '/sync/snapshot', { headers }).catch(() => { throw new ApiError(0, 'NETWORK', 'Sin conexión con el servidor de Mesagri.'); });
      const text = await r.text();
      if (r.status === 401) {
        let code = '';
        try { code = JSON.parse(text)?.code ?? ''; } catch { /* sin cuerpo */ }
        if (code === 'TEAM_KEY') { this.needTeam = true; throw new ApiError(401, code, 'Falta la clave del equipo de Mesagri.'); }
        // la sesión venció o es de antes de reiniciar la demo: se renueva una vez y, si no, se sigue sin sesión
        if (this.viewerUserId) {
          if (attempt === 0) this.sessions.invalidate(this.viewerUserId);
          else { this.sessions.drop(this.viewerUserId); this.viewerUserId = undefined; }
          continue;
        }
      }
      if (!r.ok) throw new ApiError(r.status, 'HTTP_' + r.status, 'No pudimos leer los datos del servidor.');
      this.needTeam = false;
      return JSON.parse(text, (_k, v) => (v === INF ? Infinity : v === '-' + INF ? -Infinity : v));
    }
    throw new ApiError(401, 'SESSION', 'Tu sesión venció. Ingresa de nuevo.');
  }

  private async doResync(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const s: any = await this.fetchSnapshot();
        // servidor de otra versión: no se muestra un mundo que estas pantallas no entienden
        const proto = Number(s.protocol) || 1;
        if (proto !== PROTOCOL) {
          this.outdated = { server: proto, client: PROTOCOL };
          this.ready = false;
          this.status = 'online';
          this.emit();
          return;
        }
        this.outdated = undefined;
        this.viewerKind = String(s.viewer ?? 'team');
        normalizeWorld(s.world);
        const reset = !!this.epoch && s.epoch !== this.epoch;
        if (reset || !this.epoch) {
          if (reset) { this.pending = []; this.saveOutbox(); this.sessions.clear(); this.tickets.clear(); }
          this.sessions.load(s.epoch);
        }
        this.epoch = s.epoch;
        this.boot = s.boot;
        this.seq = s.seq;
        this.skew = s.serverNow - Date.now();
        this.confirmed = s.world;
        registerProducts(s.world?.catalogExtra);
        this.buffer.clear();
        this.events = [];
        // lo que ya estaba confirmado en el mundo nuevo deja de estar pendiente
        this.pending = this.pending.filter(p => !(p.seq && p.seq <= this.seq));
        this.recompute();
        this.ready = true;
        this.problem = '';
        this.status = 'online';
        this.emit();
        if (reset) this.onReset?.();
        void this.flush();
        return;
      } catch (e) {
        this.status = 'offline';
        this.problem = e instanceof ApiError && e.status && e.status < 500 ? e.message : 'No hay conexión con el servidor de Mesagri. Reintentando…';
        this.emit();
        // sin la clave del equipo no tiene sentido reintentar: la pantalla la pide
        if (this.needTeam) return;
        await new Promise(res => setTimeout(res, Math.min(10_000, 800 * 2 ** Math.min(attempt, 4))));
      }
    }
  }

  /** Cambios por entidad que llegan del servidor (fuera de la versión autónoma). */
  private receivePatch(p: Patch) {
    if (!p || typeof p.seq !== 'number' || this.outdated) return;
    this.patchBuf.push(p);
    if (!this.resyncing) this.drainPatches();
  }

  private drainPatches() {
    if (!this.ready || this.resyncing) return;
    const list = this.patchBuf.sort((a, b) => a.seq - b.seq);
    this.patchBuf = [];
    let changed = false;
    for (const p of list) {
      if (p.seq <= this.seq) continue;
      if (p.seq !== this.seq + 1) { void this.resync(); return; } // se perdió un cambio: se pide la copia completa
      applyPatch(this.confirmed, p);
      if (p.set?.catalogExtra) registerProducts(this.confirmed.catalogExtra);
      this.seq = p.seq;
      if (p.ev) {
        this.events.push({ id: p.ev.id, type: p.ev.type, actor: p.ev.actor, t: p.ev.t, lamport: 0, p: {} });
        if (this.events.length > 3000) this.events.splice(0, 1000);
        const i = this.pending.findIndex(x => x.e.id === p.ev!.id);
        if (i >= 0) this.pending.splice(i, 1);
      }
      changed = true;
    }
    if (changed) { this.saveOutbox(); this.recompute(); this.emit(); }
  }

  private async connect() {
    const s = await openSocket(() => this.credentials());
    this.socket = s;
    s.on('connect', () => { this.setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'); void this.flush(); });
    s.on('disconnect', () => this.setStatus('offline'));
    s.on('hello', (h: { epoch: string; boot: string; seq: number; serverNow: number; viewer?: string; authError?: string }) => {
      this.skew = h.serverNow - Date.now();
      if (!LOCAL) {
        if (h.authError === 'TEAM_KEY') { this.needTeam = true; this.emit(); return; }
        // la sesión venció: se renueva y se vuelve a conectar (pocas veces, para no insistir)
        if (h.authError && this.viewerUserId && this.helloRetries++ < 2) { this.sessions.invalidate(this.viewerUserId); this.reconnect(); return; }
        if (h.epoch !== this.epoch || h.boot !== this.boot || h.seq !== this.seq || (h.viewer && h.viewer !== this.viewerKind)) { void this.resync(); return; }
        this.helloRetries = 0;
        void this.flush();
        return;
      }
      if (h.epoch !== this.epoch || h.boot !== this.boot) { void this.resync(); return; }
      if (h.seq > this.seq) void this.catchUp();
      void this.flush();
    });
    s.on('event', (a: Applied) => this.receive(revive(a)));
    s.on('patch', (p: Patch) => this.receivePatch(revive(p)));
    s.on('reset', () => { void this.resync(); });
  }

  private receive(a: Applied) {
    if (!a || a.seq <= this.seq || this.outdated) return;
    this.buffer.set(a.seq, a);
    this.drain();
  }

  private drain() {
    let changed = false;
    while (this.buffer.has(this.seq + 1)) {
      const a = this.buffer.get(this.seq + 1)!;
      this.buffer.delete(a.seq);
      const r = applySafe(this.confirmed, a.event);
      this.confirmed.rejected = {};
      if (!r.ok) {
        // no debería pasar: la réplica se desfasó. Se vuelve a pedir el mundo completo.
        console.warn('[mesagri] la réplica no pudo aplicar', a.event.type, r.error);
        void this.resync();
        return;
      }
      this.seq = a.seq;
      this.events.push(a.event);
      if (this.events.length > 3000) this.events.splice(0, 1000);
      const i = this.pending.findIndex(p => p.e.id === a.event.id);
      if (i >= 0) this.pending.splice(i, 1);
      changed = true;
    }
    if (this.buffer.size && !this.gapTimer) {
      this.gapTimer = setTimeout(() => { this.gapTimer = undefined; void this.catchUp(); }, 700);
    }
    if (changed) { this.saveOutbox(); this.recompute(); this.emit(); }
  }

  private async catchUp() {
    try {
      const r = revive(await api<any>(`/sync/events?after=${this.seq}&boot=${encodeURIComponent(this.boot)}&epoch=${encodeURIComponent(this.epoch)}`));
      if (r.resync) { await this.resync(); return; }
      for (const a of r.events as Applied[]) if (a.seq > this.seq) this.buffer.set(a.seq, a);
      this.drain();
    } catch { /* sin señal: se intenta al reconectar */ }
  }

  private recompute() {
    if (!this.pending.length) { this.world = this.confirmed; this.cache = undefined; return; }
    const w = structuredCloneSafe(this.confirmed);
    for (const p of this.pending) applySafe(w, p.e);
    w.rejected = {};
    this.world = w;
    this.cache = undefined;
  }

  /* ---------------- Acciones ---------------- */

  /** Hora de la demo (America/Lima, simulada), según el reloj del servidor. */
  now(): number { return Date.now() + this.skew + (this.world?.clockOffset ?? 0); }

  realStart(): number { return Date.now(); }

  makeEvent(type: string, p: any, actor: string, device?: string, t?: number): MEvent {
    return { id: 'e-' + uid(), type, actor, t: t ?? this.now(), lamport: 0, device, p };
  }

  /** Aplica una acción propia: se valida aquí, se muestra al instante y se envía al servidor. */
  commit(e: MEvent): ActResult {
    if (!this.ready) return { ok: false, error: { code: 'OFFLINE', message: 'Todavía estamos conectando con el servidor. Intenta en unos segundos.' } };
    const copy = structuredCloneSafe(this.world);
    const r = applySafe(copy, e);
    if (!r.ok) return r;
    copy.rejected = {};
    this.world = copy;
    this.pending.push({ e, tries: 0, nextAt: 0 });
    this.saveOutbox();
    this.emit();
    void this.flush();
    return r;
  }

  /** Prueba una acción sin enviarla (la app orienta antes de enviar). */
  dry(e: MEvent, base?: World): ActResult {
    return applySafe(structuredCloneSafe(base ?? this.world), e);
  }

  /** Envía la cola en orden; si no hay señal, reintenta con espera creciente. */
  async flush() {
    if (this.flushing || !this.ready) return;
    this.flushing = true;
    try {
      for (;;) {
        const p = this.pending.find(x => !x.sent);
        if (!p || p.nextAt > Date.now()) break;
        const e = p.e;
        try {
          let res: any;
          if (e.type === 'USER_REGISTER') {
            const phone = String(e.p?.phone ?? '').replace(/\s/g, '');
            const ticket = this.tickets.get(phone);
            if (!ticket) { this.reject(p, { code: 'TICKET', message: 'Verifica tu celular otra vez para crear la cuenta.' }); continue; }
            const dk = deviceKeyFor(phone);
            const r = await api<any>('/auth/register', { body: { ticket, event: { id: e.id, p: e.p }, device: e.device }, headers: dk ? { 'x-device-key': dk } : {} });
            this.sessions.set(r.session);
            saveDeviceKey(phone, r.deviceKey, r.session?.userId);
            res = r;
          } else {
            const token = await this.sessions.token(e.actor);
            if (!token) { this.reject(p, { code: 'NO_SESSION', message: 'Tu sesión venció. Ingresa de nuevo para enviar esta acción.' }); continue; }
            const r = await api<any>('/sync/events', { token, body: { events: [{ id: e.id, type: e.type, p: e.p, device: e.device, t: e.t }] } });
            res = r.results[0];
          }
          if (this.status === 'offline' && this.socket?.connected) this.setStatus('online');
          if (!res?.ok) { this.reject(p, res?.error ?? { code: 'ERROR', message: 'No se pudo guardar.' }); continue; }
          p.sent = true;
          p.seq = res.seq;
          if (res.seq <= this.seq) {
            // ya estaba aplicada (reintento de algo que el servidor sí recibió, o ya llegó su cambio)
            const i = this.pending.indexOf(p);
            if (i >= 0) this.pending.splice(i, 1);
            this.saveOutbox(); this.recompute(); this.emit();
          } else if (res.event) this.receive({ seq: res.seq, event: revive(res.event), result: res.result });
          // con el servidor, lo confirmado llega por el canal en vivo (solo lo que este perfil puede ver)
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            this.sessions.invalidate(e.actor);
            p.tries++;
            if (p.tries > 3) this.reject(p, { code: err.code, message: err.message });
            else p.nextAt = Date.now() + 400;
            continue;
          }
          if (isNetwork(err)) {
            if (err instanceof ApiError && err.status === 0) this.setStatus('offline');
            p.tries++;
            p.nextAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(p.tries, 5));
            if (err instanceof ApiError && err.status >= 500 && p.tries > 4) this.reject(p, { code: err.code, message: err.message });
            break;
          }
          this.reject(p, { code: (err as ApiError).code ?? 'ERROR', message: (err as Error).message });
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private reject(p: Pending, err: { code: string; message: string }) {
    const i = this.pending.indexOf(p);
    if (i >= 0) this.pending.splice(i, 1);
    this.saveOutbox();
    this.recompute();
    this.emit();
    this.onLateReject?.(p.e, err);
  }

  /** Cantidad de acciones de un usuario que esperan confirmación del servidor. */
  waiting(userId?: string): number {
    return this.pending.filter(p => !userId || p.e.actor === userId).length;
  }

  private saveOutbox() {
    if (!this.epoch) return;
    if (!this.pending.length) { lsDel(OUTBOX_KEY); return; }
    lsSet(OUTBOX_KEY, JSON.stringify({ epoch: this.epoch, list: this.pending.map(p => ({ e: p.e, seq: p.seq })) }));
  }

  private loadOutbox() {
    try {
      const raw = JSON.parse(lsGet(OUTBOX_KEY) ?? 'null');
      if (raw?.list?.length) {
        this.pending = raw.list.map((x: any) => ({ e: x.e, seq: x.seq, sent: false, tries: 0, nextAt: 0 }));
        this.epoch = raw.epoch;
      }
    } catch { lsDel(OUTBOX_KEY); }
  }

  /* ---------------- Vista ---------------- */

  /** Mundo para mostrar con los plazos procesados hasta ahora (pedidos que vencen, etc.). */
  view(): World {
    const now = this.now();
    const c = this.cache;
    if (c && c.version === this.version && now < c.until) return c.world;
    const nd = nextDeadline(this.world);
    if (nd > now) {
      this.cache = { version: this.version, until: nd, world: this.world };
      return this.world;
    }
    const v = structuredCloneSafe(this.world);
    tick(v, now);
    this.cache = { version: this.version, until: nextDeadline(v), world: v };
    return v;
  }

  stale(): boolean {
    const c = this.cache;
    return !c || c.version !== this.version || this.now() >= c.until;
  }

  /* ---------------- Demo ---------------- */

  async advanceClock(ms: number) {
    await api('/demo/clock', { body: { ms }, headers: teamHeaders() });
  }

  async resetDemo() {
    await api('/demo/reset', { body: {}, headers: teamHeaders() });
    await this.resync();
  }
}

/** Vista de un celular sin señal: lo que tenía al perder la señal más lo que hizo desde entonces. */
/** Colecciones que pueden faltar en datos guardados por una versión anterior: siempre presentes. */
export function normalizeWorld(w: any) {
  if (!w || typeof w !== 'object') return;
  for (const k of ['requests', 'schedules', 'catalogExtra', 'proposals', 'favorites', 'translations', 'padron', 'monthlyGmv', 'rejected', 'usedOps', 'messages', 'reviews', 'disputes', 'complaints', 'tickets', 'statements', 'invoices', 'shipments', 'bookings', 'lots', 'releases', 'stoIncidents', 'farms', 'cases', 'listings', 'orders', 'subOrders', 'users', 'orgs', 'seq']) {
    if (!w[k] || typeof w[k] !== 'object') w[k] = {};
  }
  for (const k of ['movements', 'notifs', 'audit']) if (!Array.isArray(w[k])) w[k] = [];
}

export function offlineView(snapshot: World, outbox: MEvent[], now: number): World {
  const v = structuredCloneSafe(snapshot);
  for (const e of outbox) applySafe(v, e);
  tick(v, now);
  return v;
}
