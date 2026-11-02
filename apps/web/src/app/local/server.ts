/*
 * Servidor de Mesagri dentro del celular (APK y app web instalable).
 *
 * Responde las mismas rutas del API que usa la app (/auth, /sync, /demo, /admin, /files) con las
 * mismas reglas de packages/shared, así la app es idéntica con o sin servidor:
 * - ingreso con celular y código (el código se muestra en pantalla: no hay proveedor de SMS),
 *   según el tipo de usuario; el equipo entra al panel con correo, clave y código de 6 dígitos;
 * - cada acción se valida con el motor de reglas, recibe los códigos al azar (entrega, recojo, QR)
 *   y queda guardada en este celular (IndexedDB);
 * - el reloj de la demo sigue donde quedó al cerrar la app y los plazos se procesan solos.
 */
import type { MEvent, World } from '@mesagri/shared/types';
import { applySafe, structuredCloneSafe, emptyWorld } from '@mesagri/shared/engine/index';
import { HANDLERS } from '@mesagri/shared/engine/core';
import { hasDue } from '@mesagri/shared/engine/tick';
import { uid } from '@mesagri/shared/ids';
import { isPhoneValid } from '@mesagri/shared/rules';
import { SEED_ANCHOR } from '@mesagri/shared/seed';
import { PROTOCOL } from '@mesagri/shared/protocol';
import { ApiError } from '../net';
import { kvGet, kvSet, kvDel } from './kv';

interface Applied { seq: number; event: MEvent; result?: unknown }
interface Saved { v: 1; protocol: number; epoch: string; seq: number; world: World; simNow: number; revoked: Record<string, number> }
type Listener = (type: 'event' | 'reset', data: unknown) => void;

const SYSTEM_ONLY = new Set(['WORLD_INIT', 'CLOCK_ADVANCE', 'CLOCK_TICK']);
const ID_RE = /^[A-Za-z0-9:_.-]{3,80}$/;
const OTP_TTL = 5 * 60_000;
const TICKET_TTL = 15 * 60_000;
const ACCESS_TTL = 12 * 3600_000;
const ADMIN_PASSWORD = 'demo-mesagri';
const STATE_KEY = 'estado';

const ALNUM = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function randInt(max: number): number {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max; } catch { return Math.floor(Math.random() * max); }
}
const rand4 = () => String(randInt(10000)).padStart(4, '0');
const rand6 = () => String(randInt(1_000_000)).padStart(6, '0');
const rand8 = () => Array.from({ length: 8 }, () => ALNUM[randInt(ALNUM.length)]).join('');
const clean = (p: unknown) => String(p ?? '').replace(/\s/g, '');
const fail = (status: number, code: string, message: string, data?: unknown): never => { throw new ApiError(status, code, message, data); };

/** Código de 6 dígitos del «doble factor» de las cuentas del equipo en la versión autónoma (cambia cada 30 s). */
function teamCode(userId: string, epoch: string, step: number): string {
  let h = 2166136261;
  for (const ch of `${userId}|${epoch}|${step}|mesagri`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(h % 1_000_000).padStart(6, '0');
}

const ROLE_NAME: Record<string, string> = { FARMER: 'agricultor', BUYER: 'comprador (MYPE)', WAREHOUSE: 'almacén aliado', CARRIER: 'transportista aliado', ADMIN: 'equipo de Mesagri' };

export class LocalServer {
  world!: World;
  seq = 0;
  epoch = '';
  readonly boot = 'b' + uid();
  ready: Promise<void>;
  private log: Applied[] = [];
  private byId = new Map<string, Applied>();
  private otps = new Map<string, { code: string; exp: number; attempts: number }>();
  private tickets = new Map<string, { phone: string; exp: number }>();
  private revoked: Record<string, number> = {};
  private listeners = new Set<Listener>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  /** Otras pestañas o ventanas de la app en este mismo celular (comparten lo guardado). */
  private readonly tab = uid();
  private channel?: BroadcastChannel;

  constructor() {
    this.ready = this.init();
  }

  private async init() {
    const saved = await kvGet<Saved>(STATE_KEY);
    if (saved && saved.v === 1 && saved.protocol === PROTOCOL && saved.world && saved.epoch) {
      this.world = saved.world;
      this.seq = saved.seq;
      this.epoch = saved.epoch;
      this.revoked = saved.revoked ?? {};
      // el reloj de la demo sigue donde quedó al cerrar la app (no corre con la app cerrada)
      if (saved.simNow) this.world.clockOffset = saved.simNow - Date.now();
    } else {
      this.seed();
    }
    try {
      this.channel = new BroadcastChannel('mesagri-local');
      this.channel.onmessage = (m: MessageEvent) => { if (m.data?.type === 'saved' && m.data.tab !== this.tab) void this.reloadFromDisk(); };
    } catch { /* navegador sin BroadcastChannel: una sola pestaña */ }
    try {
      setInterval(() => this.heartbeat(), 20_000);
      const flush = () => { void this.saveNow(); };
      addEventListener('pagehide', flush);
      addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    } catch { /* sin ventana */ }
    this.heartbeat();
  }

  private seed() {
    const w = emptyWorld();
    const r = applySafe(w, { id: 'init-' + uid(), type: 'WORLD_INIT', actor: 'system', t: SEED_ANCHOR, lamport: 0, p: { realAt: Date.now() } });
    if (!r.ok) throw new Error('No se pudo crear el mundo de ejemplo: ' + r.error?.message);
    this.world = w;
    this.seq = 0;
    this.epoch = 'ep' + uid();
    this.revoked = {};
    this.log = [];
    this.byId.clear();
    this.otps.clear();
    this.tickets.clear();
    void this.saveNow();
  }

  simNow(): number { return Date.now() + (this.world?.clockOffset ?? 0); }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(type: 'event' | 'reset', data: unknown) { for (const l of [...this.listeners]) { try { l(type, data); } catch { /* una vista que falla no detiene a las demás */ } } }

  /* ---------------- Guardado en el celular ---------------- */

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.saveNow(); }, 400);
  }

  private async saveNow() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = undefined; }
    if (!this.world) return;
    const s: Saved = { v: 1, protocol: PROTOCOL, epoch: this.epoch, seq: this.seq, world: this.world, simNow: this.simNow(), revoked: this.revoked };
    await kvSet(STATE_KEY, s);
    try { this.channel?.postMessage({ type: 'saved', tab: this.tab, seq: this.seq, epoch: this.epoch }); } catch { /* sin canal */ }
  }

  /** Otra pestaña guardó cambios: se leen y la app se pone al día. */
  private async reloadFromDisk() {
    const saved = await kvGet<Saved>(STATE_KEY);
    if (!saved || saved.v !== 1 || saved.protocol !== PROTOCOL || !saved.world) return;
    this.world = saved.world;
    this.seq = saved.seq;
    this.epoch = saved.epoch;
    this.revoked = saved.revoked ?? {};
    if (saved.simNow) this.world.clockOffset = saved.simNow - Date.now();
    this.log = [];
    this.byId.clear();
    this.emit('reset', { epoch: this.epoch });
  }

  /* ---------------- Acciones ---------------- */

  private heartbeat() {
    if (!this.world) return;
    try { if (hasDue(this.world, this.simNow())) this.apply({ type: 'CLOCK_TICK', actor: 'system', p: {} }, true); } catch { /* se reintenta en el próximo latido */ }
  }

  /** Los códigos de entrega, recojo y QR se generan al azar aquí (como en el servidor). */
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

  apply(input: { id?: string; type: string; actor: string; p?: any; device?: string }, system = false): { ok: boolean; seq?: number; event?: MEvent; result?: unknown; error?: { code: string; message: string; data?: unknown }; duplicate?: boolean } {
    const type = String(input.type ?? '');
    if (!HANDLERS[type]) return { ok: false, error: { code: 'UNKNOWN', message: `Acción desconocida: ${type}` } };
    if (SYSTEM_ONLY.has(type) && !system) return { ok: false, error: { code: 'FORBIDDEN', message: 'Esta acción la hace solo el sistema.' } };
    const id = input.id && ID_RE.test(input.id) ? input.id : 'e-' + uid();
    const prior = this.byId.get(id);
    if (prior) {
      if (prior.event.actor !== input.actor) return { ok: false, error: { code: 'DUPLICATE_ID', message: 'Ese identificador de acción ya se usó.' } };
      return { ok: true, duplicate: true, seq: prior.seq, event: structuredCloneSafe(prior.event), result: prior.result };
    }
    const p = this.withSecrets(type, input.p && typeof input.p === 'object' ? structuredCloneSafe(input.p) : {});
    const t = Math.max(this.simNow(), this.world.now);
    const e: MEvent = { id, type, actor: input.actor, t, lamport: 0, device: input.device ? String(input.device).slice(0, 80) : undefined, p };
    const next = structuredCloneSafe(this.world);
    const r = applySafe(next, structuredCloneSafe(e));
    if (!r.ok) return { ok: false, error: r.error };
    next.rejected = {};
    this.world = next;
    this.seq += 1;
    const out: Applied = { seq: this.seq, event: e, result: r.result };
    this.log.push(out);
    this.byId.set(id, out);
    if (this.log.length > 1500) for (const x of this.log.splice(0, 500)) this.byId.delete(x.event.id);
    this.scheduleSave();
    this.emit('event', structuredCloneSafe(out));
    return { ok: true, seq: out.seq, event: structuredCloneSafe(e), result: r.result };
  }

  /* ---------------- Sesiones ---------------- */

  private issue(userId: string) {
    const at = Date.now();
    const accessToken = `L1|${encodeURIComponent(userId)}|${this.epoch}|${at}`;
    return { userId, accessToken, refreshToken: 'R' + accessToken, expiresAt: at + ACCESS_TTL };
  }

  private userOf(token?: string): string {
    const raw = String(token ?? '').replace(/^R/, '');
    const [v, uidEnc, ep, at] = raw.split('|');
    if (v !== 'L1' || !uidEnc) fail(401, 'TOKEN_INVALID', 'Tu sesión venció. Ingresa de nuevo.');
    if (ep !== this.epoch) fail(401, 'EPOCH', 'Los datos de ejemplo se reiniciaron. Ingresa de nuevo.');
    const userId = decodeURIComponent(uidEnc);
    const u = this.world.users[userId];
    if (!u) fail(401, 'NO_USER', 'Tu usuario ya no existe.');
    if (this.revoked[userId] && Number(at) < this.revoked[userId]) fail(401, 'TOKEN_INVALID', 'Tu sesión se cerró. Ingresa de nuevo con tu celular.');
    return userId;
  }

  private notActive(userId: string) {
    const w = this.world;
    const u = w.users[userId];
    if (!u || u.status !== 'SUSPENDED') return;
    const o = w.orgs[u.orgId];
    const m = o?.members?.find(x => x.userId === u.id);
    const titular = w.users[o?.memberIds[0] ?? '']?.name ?? 'El titular';
    if (m && !m.active) fail(403, 'MEMBER_PAUSED', `${titular} pausó tu acceso a ${o!.name}. Pídele que lo vuelva a activar.`);
    if (!m && o && o.memberIds[0] !== u.id && o.memberIds.includes(u.id)) fail(403, 'MEMBER_REMOVED', `${titular} te quitó el acceso a ${o.name}.`);
    fail(403, 'SUSPENDED', 'Tu cuenta está suspendida. Escribe a Soporte de Mesagri.');
  }

  /* ---------------- Códigos por mensaje ---------------- */

  private requestOtp(phoneRaw: unknown, purpose: unknown) {
    const phone = clean(phoneRaw);
    if (!isPhoneValid(phone)) fail(422, 'BAD_PHONE', 'Ese número no parece correcto (9 dígitos, empieza con 9).');
    if (!['REGISTER', 'LOGIN', 'RECOVER'].includes(String(purpose))) fail(422, 'BAD_PURPOSE', 'Motivo no válido.');
    const u = Object.values(this.world.users).find(x => x.phone === phone);
    if (purpose === 'REGISTER' && u) fail(409, 'PHONE_TAKEN', 'Ese celular ya tiene una cuenta. Ingresa con «Ya tengo cuenta».');
    if (purpose !== 'REGISTER' && !u) fail(404, 'NO_ACCOUNT', 'No hay una cuenta con ese celular. Regístrate gratis.');
    const code = rand6();
    this.otps.set(`${phone}:${purpose}`, { code, exp: Date.now() + OTP_TTL, attempts: 0 });
    return { sent: true, channel: 'WHATSAPP', expiresIn: OTP_TTL / 1000, demoCode: code };
  }

  private checkOtp(phone: string, purpose: string, code: unknown, consume = true) {
    const k = `${phone}:${purpose}`;
    const r = this.otps.get(k);
    if (!r || r.exp < Date.now()) fail(422, 'CODE_EXPIRED', 'El código venció o no existe. Pide uno nuevo.');
    if (r!.attempts >= 5) fail(429, 'TOO_MANY', 'Demasiados intentos con este código. Pide uno nuevo.');
    if (String(code ?? '').trim() !== r!.code) { r!.attempts++; fail(422, 'BAD_CODE', 'El código no es correcto. Revisa el mensaje y vuelve a intentar.'); }
    if (consume) this.otps.delete(k);
  }

  /* ---------------- Rutas del API ---------------- */

  async handle(method: string, path: string, body: any, token?: string): Promise<unknown> {
    await this.ready;
    const [route, qs] = path.split('?');
    const q = new URLSearchParams(qs ?? '');
    const b = body ?? {};
    const w = this.world;

    if (method === 'GET' && route === '/health') return { ok: true, db: true, epoch: this.epoch, seq: this.seq, simNow: this.simNow(), demo: true, version: '1.0.0', protocol: PROTOCOL, build: 'local' };

    if (method === 'GET' && route === '/sync/snapshot') {
      return { protocol: PROTOCOL, build: 'local', epoch: this.epoch, boot: this.boot, seq: this.seq, serverNow: Date.now(), world: structuredCloneSafe(w) };
    }
    if (method === 'GET' && route === '/sync/events') {
      const after = Number(q.get('after')) || 0;
      const first = this.log[0]?.seq ?? this.seq + 1;
      if (q.get('boot') !== this.boot || q.get('epoch') !== this.epoch || after > this.seq || after < first - 1) return { resync: true, epoch: this.epoch, boot: this.boot, seq: this.seq };
      return { resync: false, epoch: this.epoch, boot: this.boot, seq: this.seq, events: structuredCloneSafe(this.log.filter(x => x.seq > after).slice(0, 500)) };
    }
    if (method === 'POST' && route === '/sync/events') {
      const actor = this.userOf(token);
      this.notActive(actor);
      const list = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
      const results = list.map((e: any) => {
        if (!e || typeof e.type !== 'string') return { id: e?.id, ok: false, error: { code: 'BAD_EVENT', message: 'Acción no válida.' } };
        if (SYSTEM_ONLY.has(e.type) || e.type === 'USER_REGISTER') return { id: e.id, ok: false, error: { code: 'FORBIDDEN', message: 'Esta acción no se puede enviar por aquí.' } };
        const r = this.apply({ id: e.id, type: e.type, actor, p: e.p ?? {}, device: e.device });
        return r.ok ? { id: r.event!.id, ok: true, seq: r.seq, event: r.event, result: r.result ?? null, duplicate: !!r.duplicate } : { id: e.id, ok: false, error: r.error };
      });
      return { results, seq: this.seq };
    }

    if (method === 'POST' && route === '/auth/otp') return this.requestOtp(b.phone, b.purpose);
    if (method === 'POST' && route === '/auth/otp/verify') {
      const phone = clean(b.phone);
      this.checkOtp(phone, 'REGISTER', b.code);
      const ticket = 'T' + uid() + uid();
      this.tickets.set(ticket, { phone, exp: Date.now() + TICKET_TTL });
      return { ticket, expiresIn: TICKET_TTL / 1000 };
    }
    if (method === 'POST' && route === '/auth/register') {
      const t = this.tickets.get(String(b.ticket ?? ''));
      if (!t || t.exp < Date.now()) fail(401, 'TICKET', 'Verifica tu celular otra vez: el permiso para crear la cuenta venció.');
      const p = b.event?.p ?? {};
      if (clean(p.phone) !== t!.phone) fail(422, 'PHONE_MISMATCH', 'El celular no coincide con el que verificaste.');
      if (!ID_RE.test(String(p.userId ?? '')) || !ID_RE.test(String(p.orgId ?? ''))) fail(422, 'BAD_ID', 'Identificadores no válidos.');
      const r = this.apply({ id: b.event?.id, type: 'USER_REGISTER', actor: String(p.userId), p, device: b.device });
      if (!r.ok) fail(r.error!.code === 'NOT_FOUND' ? 404 : 422, r.error!.code, r.error!.message, r.error!.data);
      this.tickets.delete(String(b.ticket));
      return { ...r, session: this.issue(String(p.userId)) };
    }
    if (method === 'POST' && route === '/auth/login') {
      const phone = clean(b.phone);
      this.checkOtp(phone, 'LOGIN', b.code, false);
      const u = Object.values(w.users).find(x => x.phone === phone);
      if (!u) { this.otps.delete(`${phone}:LOGIN`); fail(404, 'NO_ACCOUNT', 'No hay una cuenta con ese celular.'); }
      if (u!.role === 'ADMIN') { this.otps.delete(`${phone}:LOGIN`); fail(409, 'USE_PANEL', 'Las cuentas del equipo de Mesagri entran por el panel web, con su correo, contraseña y doble factor.', { email: u!.email }); }
      const want = String(b.role ?? '');
      if (want && want !== u!.role && ['FARMER', 'BUYER', 'WAREHOUSE', 'CARRIER'].includes(want)) fail(409, 'ROLE_MISMATCH', `Ese celular está registrado como ${ROLE_NAME[u!.role]}. Elige «${ROLE_NAME[u!.role]}» para ingresar.`, { role: u!.role });
      if (u!.status === 'SUSPENDED') { this.otps.delete(`${phone}:LOGIN`); this.notActive(u!.id); }
      this.otps.delete(`${phone}:LOGIN`);
      return { userId: u!.id, role: u!.role, session: this.issue(u!.id) };
    }
    if (method === 'POST' && route === '/auth/admin/login') {
      const email = String(b.email ?? '').trim().toLowerCase();
      const u = Object.values(w.users).find(x => x.role === 'ADMIN' && (x.email ?? '').toLowerCase() === email);
      const step = Math.floor(Date.now() / 30_000);
      const code = String(b.code ?? '').trim();
      const okCode = !!u && [step, step - 1].some(s => teamCode(u.id, this.epoch, s) === code);
      if (!u || String(b.password ?? '') !== ADMIN_PASSWORD || !okCode) fail(401, 'BAD_LOGIN', 'El correo, la contraseña o el código de doble factor no son correctos.');
      if (u!.status !== 'ACTIVE') fail(403, 'SUSPENDED', 'Tu usuario está suspendido.');
      return { userId: u!.id, session: this.issue(u!.id) };
    }
    if (method === 'POST' && route === '/auth/refresh') {
      const userId = this.userOf(b.refreshToken);
      return this.issue(userId);
    }
    if (method === 'POST' && route === '/auth/logout') return { ok: true };

    if (method === 'POST' && route === '/demo/sessions') {
      return [...new Set<string>(Array.isArray(b.userIds) ? b.userIds : [])].slice(0, 40).filter(id => w.users[id]).map(id => this.issue(id));
    }
    if (method === 'GET' && route === '/demo/team') {
      const at = Date.now();
      const step = Math.floor(at / 30_000);
      return Object.values(w.users).filter(u => u.role === 'ADMIN' && u.email).map(u => ({ userId: u.id, name: u.name, email: u.email, adminRole: u.adminRole, password: ADMIN_PASSWORD, code: teamCode(u.id, this.epoch, step), validFor: 30 - Math.floor(at / 1000) % 30 }));
    }
    if (method === 'POST' && route === '/demo/clock') {
      const ms = Math.round(Number(b.ms));
      const r = this.apply({ type: 'CLOCK_ADVANCE', actor: 'system', p: { ms } }, true);
      if (!r.ok) fail(422, r.error!.code, r.error!.message);
      const t = this.apply({ type: 'CLOCK_TICK', actor: 'system', p: {} }, true);
      void this.saveNow();
      return { ok: true, seq: t.ok ? t.seq : r.seq, simNow: this.simNow() };
    }
    if (method === 'POST' && route === '/demo/reset') {
      this.seed();
      await this.saveNow();
      this.emit('reset', { epoch: this.epoch });
      return { ok: true, epoch: this.epoch, simNow: this.simNow() };
    }

    const reset = route.match(/^\/admin\/organizations\/([^/]+)\/reset-access$/);
    if (method === 'POST' && reset) {
      const actor = this.userOf(token);
      const a = w.users[actor];
      if (a?.role !== 'ADMIN' || !['GENERAL', 'SUPPORT'].includes(String(a.adminRole))) fail(403, 'FORBIDDEN', 'Tu rol no puede restablecer accesos.');
      const orgId = decodeURIComponent(reset[1]);
      const r = this.apply({ type: 'ACCESS_RESET', actor, p: { orgId, reason: b.reason } });
      if (!r.ok) fail(422, r.error!.code, r.error!.message);
      const members = w.orgs[orgId]?.memberIds ?? [];
      for (const m of members) this.revoked[m] = Date.now();
      this.scheduleSave();
      return { ok: true, sessionsClosed: members.length };
    }

    // las fotos y documentos viven en el celular (no hay servidor de archivos)
    if (method === 'POST' && route === '/files') return { ok: true, id: b.id };

    fail(404, 'NOT_FOUND', 'No existe esa ruta en la versión autónoma.');
    return undefined;
  }
}

let SERVER: LocalServer | undefined;
export function localServer(): LocalServer { return (SERVER ??= new LocalServer()); }

/** Mismo contrato que api() de net.ts, respondido dentro del celular. */
export async function localApi(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<unknown> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const body = opts.body === undefined ? undefined : structuredCloneSafe(opts.body as any);
  const out = await localServer().handle(method, path, body, opts.token);
  return out === undefined ? undefined : structuredCloneSafe(out as any);
}

/** El canal en vivo (como Socket.IO) para la réplica de la app. */
export function localSocket() {
  const s = localServer();
  const handlers = new Map<string, ((x: any) => void)[]>();
  const fire = (ev: string, data?: unknown) => { for (const fn of handlers.get(ev) ?? []) { try { fn(data); } catch { /* sigue */ } } };
  let off: (() => void) | undefined;
  const sock = {
    connected: false,
    on(ev: string, fn: (x: any) => void) { handlers.set(ev, [...(handlers.get(ev) ?? []), fn]); return sock; },
    connect() {
      if (sock.connected) return sock;
      void s.ready.then(() => {
        off?.();
        off = s.subscribe((type, data) => fire(type, data));
        sock.connected = true;
        fire('connect');
        fire('hello', { epoch: s.epoch, boot: s.boot, seq: s.seq, serverNow: Date.now() });
      });
      return sock;
    },
    close() { off?.(); off = undefined; sock.connected = false; },
  };
  return sock.connect();
}

/** Borra lo guardado en este celular (para empezar de cero). */
export async function wipeLocal() { await kvDel(STATE_KEY); }
