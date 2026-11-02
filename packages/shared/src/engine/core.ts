/*
 * Núcleo del motor de reglas. El mundo se reconstruye aplicando eventos en orden.
 * Cada manejador VALIDA primero y MUTA después: si una regla falla, lanza DomainError
 * y el mundo queda igual (el evento se marca como rechazado).
 */
import type { World, MEvent, User, Org, SubOrder, SubStatus, Notif } from '../types';
import { DEFAULT_SETTINGS } from '../settings';

export class DomainError extends Error {
  code: string;
  data?: any;
  constructor(code: string, message: string, data?: any) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export function fail(code: string, message: string, data?: any): never {
  throw new DomainError(code, message, data);
}

export function must<T>(x: T | undefined | null, code: string, message: string): T {
  if (x === undefined || x === null) fail(code, message);
  return x as T;
}

export const SYSTEM_USER: User = {
  id: 'system', name: 'Mesagri', shortName: 'Mesagri', phone: '', role: 'ADMIN', adminRole: 'GENERAL', orgId: 'org-mesagri',
  createdAt: 0, prefs: { lang: 'es', audioGuide: false, bilingual: false, textScale: 1, dataSaver: false, numFmt: 'coma' }, status: 'ACTIVE',
};

export function emptyWorld(): World {
  return {
    version: 1, t0: 0, now: 0, seq: {}, settings: structuredCloneSafe(DEFAULT_SETTINGS), proposals: {}, users: {}, orgs: {}, farms: {},
    cases: {}, listings: {}, movements: [], orders: {}, subOrders: {}, usedOps: {}, messages: {}, reviews: {},
    disputes: {}, complaints: {}, tickets: {}, notifs: [], audit: [], statements: {}, invoices: {}, shipments: {},
    bookings: {}, lots: {}, releases: {}, stoIncidents: {}, translations: {}, favorites: {}, rejected: {},
    lastMonthClosed: '', monthlyGmv: {}, clockOffset: 0, padron: {}, requests: {}, schedules: {}, catalogExtra: {},
  };
}

export function structuredCloneSafe<T>(x: T): T {
  // structuredClone existe en navegadores modernos y en Node 17+
  const sc = (globalThis as any).structuredClone;
  if (sc) return sc(x);
  // navegadores antiguos: copia por JSON sin perder Infinity (los plazos «sin fin» lo usan)
  const INF = '\u0000inf', NINF = '\u0000-inf';
  return JSON.parse(JSON.stringify(x, (_k, v) => (v === Infinity ? INF : v === -Infinity ? NINF : v)), (_k, v) => (v === INF ? Infinity : v === NINF ? -Infinity : v));
}

/* ---------- Contexto de un evento ---------- */
export interface Ctx {
  w: World;
  e: MEvent;
  t: number;
  a: User;            // actor
  n: number;          // contador para ids derivados del evento
}

export function sub(ctx: Ctx, suffix?: string): string {
  ctx.n++;
  return `${ctx.e.id}:${suffix ?? ctx.n}`;
}

export function nextSeq(w: World, key: string, start: number): number {
  const v = (w.seq[key] ?? start) + 1;
  w.seq[key] = v;
  return v;
}

export function peekSeq(w: World, key: string, start: number): number { return (w.seq[key] ?? start) + 1; }

/** Cuántos avisos y registros de auditoría guarda el mundo en memoria (la base guarda todos). */
export const NOTIF_CAP = 900;
export const AUDIT_CAP = 1500;

export function notify(ctx: Ctx | { w: World; t: number; e?: MEvent; n?: number }, to: string, kind: Notif['kind'], title: string, body: string, link?: Notif['link']) {
  const w = ctx.w;
  const seq = nextSeq(w, 'notif', 0);
  const id = (ctx as Ctx).e ? `${(ctx as Ctx).e.id}:n${((ctx as Ctx).n = ((ctx as Ctx).n ?? 0) + 1)}` : `tick:${ctx.t}:${seq}`;
  w.notifs.push({ id, to, at: ctx.t, kind, title, body, link, seq });
  if (w.notifs.length > NOTIF_CAP) w.notifs.splice(0, w.notifs.length - NOTIF_CAP);
}

export function audit(ctx: { w: World; t: number; e?: MEvent; n?: number }, actor: string, action: string, entity: string, detail: string, before?: string, after?: string) {
  const w = ctx.w;
  const seq = nextSeq(w, 'audit', 0);
  const id = ctx.e ? `${ctx.e.id}:a${(ctx.n = (ctx.n ?? 0) + 1)}` : `tick:${ctx.t}:a${seq}`;
  w.audit.push({ id, at: ctx.t, actor, action, entity, detail, before, after, seq });
  if (w.audit.length > AUDIT_CAP) w.audit.splice(0, w.audit.length - AUDIT_CAP);
}

export function setStatus(s: SubOrder, status: SubStatus, at: number, by?: string, note?: string) {
  s.status = status;
  s.history.push({ status, at, by, note });
}

/* ---------- Búsquedas con validación ---------- */
export function getOrg(w: World, id: string): Org { return must(w.orgs[id], 'NOT_FOUND', 'No encontramos esa organización.'); }
export function getSub(w: World, id: string): SubOrder { return must(w.subOrders[id], 'NOT_FOUND', 'No encontramos ese pedido.'); }

export function isMember(a: User, orgId: string): boolean { return a.orgId === orgId; }
export function requireMember(a: User, orgId: string) {
  if (!isMember(a, orgId)) fail('FORBIDDEN', 'Esta acción le corresponde a otra cuenta.');
}
export function requireRole(a: User, ...roles: string[]) {
  if (!roles.includes(a.role)) fail('FORBIDDEN', 'Tu cuenta no puede hacer esta acción.');
}
export function requireAdmin(a: User, ...roles: string[]) {
  if (a.role !== 'ADMIN') fail('FORBIDDEN', 'Solo el equipo de Mesagri puede hacer esto.');
  if (roles.length && !roles.includes(a.adminRole ?? '')) fail('FORBIDDEN', 'Tu rol del panel no permite esta acción.');
}
export function requireActive(o: Org) {
  if (o.status === 'SUSPENDED') fail('SUSPENDED', `La cuenta de ${o.name} está suspendida. Escríbele a Soporte.`);
}

/* ---------- Registro de manejadores ---------- */
export type Handler = (ctx: Ctx) => any;
export const HANDLERS: Record<string, Handler> = {};
export function on(type: string, h: Handler) { HANDLERS[type] = h; }

export type TickFn = (w: World, t: number) => void;
