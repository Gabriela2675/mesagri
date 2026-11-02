/*
 * Conexión con el servidor de Mesagri (API REST /api/v1 y Socket.IO /sync).
 * - Sesiones por usuario (token de acceso de 15 min y de refresco rotativo), guardadas en este
 *   navegador. En el escenario de la demo, un mismo navegador maneja varias personas a la vez.
 * - Errores application/problem+json con el mismo código y mensaje que las reglas.
 */
import { io } from 'socket.io-client';
import { lsGet, lsSet, lsDel } from './persist';
import { LOCAL } from './routes';

export const API = '/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: unknown) { super(message); }
}

/** ¿El fallo es de red (sin señal, servidor apagado)? Entonces se reintenta más tarde. */
export const isNetwork = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 429;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
  // versión autónoma (APK y app instalable): el «servidor» corre dentro del celular
  if (LOCAL) { const m = await import('./local/server'); return (await m.localApi(path, opts)) as T; }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000) : undefined;
  let r: Response;
  try {
    r = await fetch(API + path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}), ...(opts.headers ?? {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctl?.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sin conexión con el servidor de Mesagri.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await r.text();
  let body: any;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!r.ok) throw new ApiError(r.status, body?.code ?? 'HTTP_' + r.status, body?.detail ?? body?.message ?? 'No pudimos completar la acción.', body?.data);
  return body as T;
}

/** Escenario de la demo (varios celulares simulados): los códigos se muestran en pantalla. */
let STAGE = false;
export const markStage = () => { STAGE = true; };

/* ---------------- Clave del equipo y celulares de confianza ---------------- */

const TEAM_KEY = 'mesagri.team';
/** Clave del equipo (TEAM_KEY del servidor): la escribe una vez quien presenta la demo. */
export const teamKey = (): string | undefined => lsGet(TEAM_KEY) ?? undefined;
export const setTeamKey = (k: string | undefined) => { if (k) lsSet(TEAM_KEY, k); else lsDel(TEAM_KEY); };
export const teamHeaders = (): Record<string, string> => ({ 'x-team-key': teamKey() ?? '' });

const DEV_KEY = 'mesagri.devices';
type DeviceEntry = { k: string; u?: string; at?: number };
function devices(): Record<string, DeviceEntry> {
  try {
    const raw = JSON.parse(lsGet(DEV_KEY) ?? '{}') ?? {};
    for (const k of Object.keys(raw)) if (typeof raw[k] === 'string') raw[k] = { k: raw[k] };
    return raw;
  } catch { return {}; }
}
const norm = (p: string) => String(p ?? '').replace(/\s/g, '');
/** Llave de este celular para una cuenta (la da el servidor al registrarse o ingresar). */
export const deviceKeyFor = (phone: string): string | undefined => devices()[norm(phone)]?.k;
export function saveDeviceKey(phone: string, key?: string, userId?: string) {
  if (!key) return;
  const all = devices();
  all[norm(phone)] = { k: key, u: userId ?? all[norm(phone)]?.u, at: Date.now() };
  lsSet(DEV_KEY, JSON.stringify(all));
}
/** Cuentas que ya ingresaron desde este celular (para entrar de nuevo con un toque). */
export const deviceAccounts = (): { phone: string; userId?: string }[] =>
  Object.entries(devices()).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).map(([phone, e]) => ({ phone, userId: e.u }));
const devHeaders = (phone: string): Record<string, string> => { const k = deviceKeyFor(phone); return k ? { 'x-device-key': k } : {}; };

/* ---------------- Sesiones ---------------- */

export interface Session { userId: string; accessToken: string; refreshToken: string; expiresAt: number }

const SESS_KEY = 'mesagri.v2.sessions';

export class Sessions {
  private map = new Map<string, Session>();
  private pending = new Map<string, Promise<Session | undefined>>();
  epoch = '';
  /** En el escenario de la demo se piden sesiones de las personas de ejemplo sin código. */
  allowDemo = true;

  /** Antes de conocer la época del servidor: las sesiones guardadas, para pedir la copia del mundo con la propia. */
  preload() {
    try {
      const raw = JSON.parse(lsGet(SESS_KEY) ?? 'null');
      if (raw?.list) { this.epoch = raw.epoch; for (const s of raw.list as Session[]) this.map.set(s.userId, s); }
    } catch { /* nada guardado */ }
  }

  load(epoch: string) {
    this.epoch = epoch;
    this.map.clear();
    try {
      const raw = JSON.parse(lsGet(SESS_KEY) ?? 'null');
      if (raw && raw.epoch === epoch && raw.list) for (const s of raw.list as Session[]) this.map.set(s.userId, s);
      else lsDel(SESS_KEY);
    } catch { lsDel(SESS_KEY); }
  }

  private save() { lsSet(SESS_KEY, JSON.stringify({ epoch: this.epoch, list: [...this.map.values()] })); }

  set(s: Session) { this.map.set(s.userId, s); this.save(); }
  has(userId: string) { return this.map.has(userId); }
  peek(userId: string): Session | undefined { return this.map.get(userId); }
  drop(userId: string) { this.map.delete(userId); this.save(); }
  clear() { this.map.clear(); lsDel(SESS_KEY); }
  any(): Session | undefined { const l = [...this.map.values()]; return l[l.length - 1]; }
  ids(): string[] { return [...this.map.keys()]; }

  /** Token vigente del usuario: renueva si está por vencer; en la demo, pide la sesión de la persona. */
  async token(userId: string): Promise<string | undefined> {
    const s = await this.session(userId);
    return s?.accessToken;
  }

  async session(userId: string): Promise<Session | undefined> {
    const cur = this.map.get(userId);
    if (cur && cur.expiresAt - Date.now() > 60_000) return cur;
    let p = this.pending.get(userId);
    if (!p) {
      p = this.renew(userId, cur).finally(() => this.pending.delete(userId));
      this.pending.set(userId, p);
    }
    return p;
  }

  private async renew(userId: string, cur?: Session): Promise<Session | undefined> {
    if (cur) {
      try {
        const s = await api<Session>('/auth/refresh', { body: { refreshToken: cur.refreshToken } });
        this.set(s);
        return s;
      } catch (e) {
        if (isNetwork(e)) throw e;
        this.drop(userId);
      }
    }
    if (!this.allowDemo) return undefined;
    try {
      const list = await api<Session[]>('/demo/sessions', { body: { userIds: [userId], device: 'escenario de la demo' }, headers: teamHeaders() });
      const s = list.find(x => x.userId === userId);
      if (s) this.set(s);
      return s;
    } catch (e) {
      if (isNetwork(e)) throw e;
      return undefined;
    }
  }

  /** Olvida un token que el servidor rechazó (vencido o de otra época). */
  invalidate(userId: string) {
    const s = this.map.get(userId);
    if (s) this.map.set(userId, { ...s, expiresAt: 0 });
  }
}

/* ---------------- Autenticación ---------------- */

export interface OtpSent {
  sent: boolean;
  channel: 'SMS' | 'WHATSAPP_IN' | 'WHATSAPP' | 'PANTALLA';
  expiresIn: number;
  demoCode?: string;
  deviceOnly?: boolean;
  demoAccount?: boolean;
  to?: string;
  notice?: string;
  wa?: { link: string; number: string };
}

/** Doble factor por activar: el secreto se escanea con Google Authenticator o Microsoft Authenticator. */
export interface TotpSetup { secret: string; uri: string }
/** Primer ingreso de una persona del equipo con su clave temporal. */
export interface AdminSetup { token: string; email: string; name?: string; adminRole?: string; totp: TotpSetup }

export const auth = {
  /**
   * channel SMS: el código llegó por SMS (to: número enmascarado).
   * channel WHATSAPP_IN: la persona pide su código escribiendo a Mesagri por WhatsApp (wa.link abre el mensaje listo).
   * channel WHATSAPP: Mesagri ya se lo mandó (to: número enmascarado). channel PANTALLA: versión de prueba, demoCode.
   * deviceOnly: cuenta de una persona real y este no es un celular donde ya ingresó (el código no se muestra).
   */
  otp: (phone: string, purpose: 'REGISTER' | 'LOGIN') => api<OtpSent>('/auth/otp', { body: { phone, purpose, ...(STAGE ? { escenario: true } : {}) }, headers: { ...devHeaders(phone), ...(teamKey() || STAGE ? { 'x-team-key': teamKey() ?? '' } : {}) } }),
  verify: (phone: string, code: string) => api<{ ticket: string; expiresIn: number }>('/auth/otp/verify', { body: { phone, code } }),
  login: async (phone: string, code: string, device?: string, role?: string) => {
    const r = await api<{ userId: string; role: string; session: Session; deviceKey?: string }>('/auth/login', { body: { phone, code, device, role }, headers: devHeaders(phone) });
    saveDeviceKey(phone, r.deviceKey, r.userId);
    return r;
  },
  /** Con una clave temporal (persona nueva del equipo) responde setup: crea su contraseña y activa su doble factor. */
  admin: (email: string, password: string, code: string) => api<{ userId: string; session?: Session; setup?: AdminSetup }>('/auth/admin/login', { body: { email, password, code, device: 'panel web' } }),
  adminSetup: (token: string, password: string, code: string) => api<{ userId: string; session: Session }>('/auth/admin/setup', { body: { token, password, code, device: 'panel web' } }),
  team: (key?: string) => api<{ userId: string; name: string; email: string; adminRole: string; password: string; code: string; validFor: number }[]>('/demo/team', { headers: { 'x-team-key': key ?? teamKey() ?? '' } }),
  logout: (refreshToken: string) => api('/auth/logout', { body: { refreshToken } }).catch(() => undefined),
};

/* ---------------- Canal en vivo ---------------- */

/** Lo mínimo que usa la réplica del canal en vivo (Socket.IO o, en la versión autónoma, el del celular). */
export interface LiveSocket { connected: boolean; on(ev: string, fn: (x: any) => void): unknown; connect(): unknown; disconnect?(): unknown; close(): unknown }

/** Credenciales del canal en vivo: se piden de nuevo en cada conexión (la sesión pudo cambiar o renovarse). */
export type SocketAuth = () => Promise<{ token?: string; team?: string }>;

export async function openSocket(credentials?: SocketAuth): Promise<LiveSocket> {
  if (LOCAL) { const m = await import('./local/server'); return m.localSocket(); }
  return io('/sync', {
    transports: ['websocket', 'polling'], reconnectionDelay: 800, reconnectionDelayMax: 5000,
    auth: (cb: (x: object) => void) => { (credentials ? credentials() : Promise.resolve({})).then(cb, () => cb({})); },
  }) as unknown as LiveSocket;
}
