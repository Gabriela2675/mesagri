/*
 * Privacidad por perfil: lo que cada celular recibe del servidor.
 *
 * El servidor tiene el mundo completo. A cada celular le manda una copia con lo que su perfil
 * puede ver:
 * - el equipo de la demo (con la clave del equipo) ve todo, para el escenario de varios celulares;
 * - el equipo de Mesagri (panel web) ve todo menos los códigos secretos; quien es analista ve
 *   indicadores sin datos personales (como el público, más los avisos del equipo);
 * - cada persona ve completo lo de su cuenta y lo de sus contrapartes (con quienes tiene pedidos,
 *   envíos, reservas o solicitudes); de las demás cuentas reales solo lo público: nombre,
 *   distrito, publicaciones y calificaciones. Sin celular, DNI, dirección, cuentas de cobro,
 *   mensajes ni reclamos;
 * - quien no ingresó ve solo lo público;
 * - los códigos de entrega, recojo y QR viajan sellados (solo su huella) a quien no debe
 *   conocerlos: el celular comprueba el código que le dictan, pero no puede leerlo.
 *
 * Las personas y la historia de ejemplo son públicas a propósito: cualquiera entra con ellas desde
 * «Ver cuentas de prueba». Ninguna entidad se quita del mundo, solo se ocultan campos: así los
 * totales y calificaciones que calcula cada celular salen iguales para todos.
 */
import type { World, User, Org, SubOrder, VerifCase, Dispute, Complaint, Ticket, PurchaseRequest, Schedule, Booking, Notif, AuditEntry, ReleaseOrder } from './types';
import { seedWorld } from './engine/index';
import { sealCode, CODE_SALT } from './ids';
import { maskPhone } from './rules';

export type Viewer =
  | { kind: 'team' }
  | { kind: 'admin'; userId: string; analyst?: boolean }
  | { kind: 'user'; userId: string; orgId: string }
  | { kind: 'anon' };

export const TEAM: Viewer = { kind: 'team' };
export const ANON: Viewer = { kind: 'anon' };
/** Perfil de quien mira, como lo informa el servidor (si cambia, el celular pide su copia otra vez). */
export const viewerKind = (v: Viewer): string => (v.kind === 'admin' && v.analyst ? 'analyst' : v.kind);
export const viewerKey = (v: Viewer): string => (v.kind === 'team' || v.kind === 'anon' ? v.kind : `${viewerKind(v)}:${v.userId}`);

/** Cuentas de la historia de ejemplo (públicas). */
export interface SeedSets { users: Set<string>; orgs: Set<string> }
let SEED: SeedSets | undefined;
export function seedSets(): SeedSets {
  if (!SEED) {
    const w = seedWorld();
    SEED = { users: new Set(Object.keys(w.users)), orgs: new Set(Object.keys(w.orgs)) };
  }
  return SEED;
}

export interface MaskCtx {
  v: Viewer;
  w: World;
  /** organización de quien mira (persona) */
  org?: string;
  uid?: string;
  /** organizaciones con las que tiene algo en común (contrapartes) */
  related: Set<string>;
  seed: SeedSets;
}

export function maskCtx(w: World, v: Viewer): MaskCtx {
  const org = v.kind === 'user' ? v.orgId : undefined;
  return { v, w, org, uid: v.kind === 'user' || v.kind === 'admin' ? v.userId : undefined, related: org ? relatedOrgs(w, org) : new Set(), seed: seedSets() };
}

/** Contrapartes de una organización: pedidos, envíos (también ofrecidos), reservas, lotes, solicitudes y pedidos programados. */
export function relatedOrgs(w: World, org: string): Set<string> {
  const r = new Set<string>();
  const add = (...ids: (string | undefined)[]) => { for (const x of ids) if (x && x !== org) r.add(x); };
  for (const id in w.subOrders) {
    const s = w.subOrders[id];
    if (s.buyerOrgId !== org && s.sellerOrgId !== org) continue;
    add(s.buyerOrgId, s.sellerOrgId);
    const sh = s.shipmentId ? w.shipments[s.shipmentId] : undefined;
    if (sh) add(sh.carrierOrgId);
  }
  for (const id in w.shipments) {
    const sh = w.shipments[id];
    if (sh.buyerOrgId === org || sh.sellerOrgId === org || sh.carrierOrgId === org || (sh.offers ?? []).some(o => o.carrierOrgId === org)) add(sh.buyerOrgId, sh.sellerOrgId, sh.carrierOrgId);
  }
  for (const id in w.bookings) { const b = w.bookings[id]; if (b.farmerOrgId === org || b.facilityOrgId === org) add(b.farmerOrgId, b.facilityOrgId); }
  for (const id in w.lots) { const l = w.lots[id]; if (l.farmerOrgId === org || l.facilityOrgId === org) add(l.farmerOrgId, l.facilityOrgId); }
  for (const id in w.requests) {
    const q = w.requests[id];
    if (q.buyerOrgId === org) add(...(q.offers ?? []).map(o => o.sellerOrgId));
    else if ((q.offers ?? []).some(o => o.sellerOrgId === org)) add(q.buyerOrgId);
  }
  for (const id in w.schedules) {
    const s = w.schedules[id];
    const sellers = [...(s.items ?? []).map(i => i.sellerOrgId), ...(s.draft?.lines ?? []).map(l => l.sellerOrgId)];
    if (s.buyerOrgId === org) add(...sellers);
    else if (sellers.includes(org)) add(s.buyerOrgId);
  }
  return r;
}

/* ---------------- Ayudas ---------------- */

const isTeam = (x: MaskCtx) => x.v.kind === 'team';
const isAdmin = (x: MaskCtx) => x.v.kind === 'admin' && !x.v.analyst;
const isAnalyst = (x: MaskCtx) => x.v.kind === 'admin' && !!x.v.analyst;
const realOrg = (x: MaskCtx, id?: string) => !!id && !x.seed.orgs.has(id);
const realUser = (x: MaskCtx, id?: string) => !!id && !x.seed.users.has(id);
const own = (x: MaskCtx, org?: string) => !!org && !!x.org && org === x.org;
const near = (x: MaskCtx, org?: string) => own(x, org) || (!!org && x.related.has(org));

const maskNum = (n: string | undefined) => { const s = String(n ?? ''); return s.length > 4 ? '•'.repeat(s.length - 3) + s.slice(-3) : '•••'; };
const initials = (name: string | undefined) => String(name ?? '').split(/\s+/).filter(Boolean).map(w => w[0] + '.').join(' ');
function without<T extends object>(o: T, ...keys: string[]): T {
  const c: any = { ...o };
  for (const k of keys) delete c[k];
  return c;
}

/** Partes de un pedido: comprador, agricultor y el transportista asignado. */
function subParties(w: World, s: SubOrder | undefined): string[] {
  if (!s) return [];
  const carrier = s.shipmentId ? w.shipments[s.shipmentId]?.carrierOrgId : undefined;
  return [s.buyerOrgId, s.sellerOrgId, ...(carrier ? [carrier] : [])];
}
function convParties(w: World, conv: string): string[] {
  if (conv.startsWith('ticket:')) { const t = w.tickets[conv.slice(7)]; return t ? [t.orgId] : []; }
  return subParties(w, w.subOrders[conv]);
}

/* ---------------- Qué ve cada perfil, por colección ---------------- */

type Masker = (val: any, id: string, x: MaskCtx) => any;

export const MASKS: Record<string, Masker> = {
  users: (u: User, id, x) => {
    if (isAdmin(x) || id === x.uid) return u;
    // el equipo de Mesagri: su correo y su celular no son públicos (cada persona los personaliza en «Mi cuenta»)
    if (u.role === 'ADMIN') return x.v.kind === 'admin' ? u : { ...without(u, 'email', 'dni', 'consents'), phone: maskPhone(u.phone) };
    if (!realUser(x, id) || own(x, u.orgId)) return u;
    const m = without(u, 'dni', 'email', 'consents');
    if (!near(x, u.orgId)) m.phone = maskPhone(u.phone);
    return m;
  },
  orgs: (o: Org, id, x) => {
    if (isAdmin(x) || !realOrg(x, id) || near(x, id)) return o;
    const m = without(o, 'dni', 'address', 'receiver');
    m.payout = (o.payout ?? []).map(p => without({ ...p, number: maskNum(p.number), holder: initials(p.holder) }, 'authorization'));
    if (o.locales) m.locales = o.locales.map(l => ({ ...l, address: '', receiver: '' }));
    return m;
  },
  cases: (c: VerifCase, _id, x) => {
    if (isAdmin(x) || !realOrg(x, c.orgId) || own(x, c.orgId)) return c;
    return { ...c, evidence: (c.evidence ?? []).map(e => ({ key: e.key, label: e.label, ...(e.ok !== undefined ? { ok: e.ok } : {}) })), history: [], alerts: [] };
  },
  subOrders: (s: SubOrder, id, x) => {
    let m = s;
    const edit = () => { if (m === s) m = { ...s }; return m; };
    // códigos: el de entrega y el de recojo los conoce el comprador; el QR, el agricultor
    if (!own(x, s.buyerOrgId)) {
      if (s.deliveryCode) edit().deliveryCode = sealCode(s.deliveryCode, CODE_SALT.delivery(id));
      if (s.pickupCode) edit().pickupCode = sealCode(s.pickupCode, CODE_SALT.pickup(id));
    }
    if (!own(x, s.sellerOrgId) && s.pickupQr) edit().pickupQr = sealCode(s.pickupQr, CODE_SALT.qr(id));
    if (isAdmin(x)) return m;
    const parties = subParties(x.w, s);
    if (!parties.some(o => realOrg(x, o)) || parties.some(o => own(x, o))) return m;
    const c = without(edit(), 'taxDocNumber');
    c.address = '';
    c.payment = without(s.payment, 'operation', 'photoId');
    return c;
  },
  messages: (list: unknown[], conv, x) => {
    if (isAdmin(x)) return list;
    const parties = convParties(x.w, conv);
    if (parties.length && !parties.some(o => realOrg(x, o))) return list;
    return parties.some(o => own(x, o)) ? list : [];
  },
  disputes: (d: Dispute, _id, x) => {
    if (isAdmin(x)) return d;
    const s = x.w.subOrders[d.subOrderId];
    const parties = s ? [s.buyerOrgId, s.sellerOrgId] : [];
    if (!parties.some(o => realOrg(x, o)) || parties.some(o => own(x, o))) return d;
    return { ...d, description: '', photoIds: [], ...(d.proposal ? { proposal: { ...d.proposal, note: '' } } : {}), ...(d.resolution ? { resolution: { ...d.resolution, note: '' } } : {}) };
  },
  complaints: (c: Complaint, _id, x) => (isAdmin(x) || !realOrg(x, c.orgId) || own(x, c.orgId) ? c : { ...c, detail: '', request: '', ...(c.answer ? { answer: '' } : {}) }),
  tickets: (t: Ticket, _id, x) => (isAdmin(x) || !realOrg(x, t.orgId) || own(x, t.orgId) ? t : { ...t, text: '', replies: [] }),
  favorites: (f: { listings: string[]; sellers: string[]; carriers: string[] }, key, x) => (isAdmin(x) || !realOrg(x, key) || own(x, key) ? f : { listings: [], sellers: [], carriers: [] }),
  requests: (q: PurchaseRequest, _id, x) => (isAdmin(x) || !realOrg(x, q.buyerOrgId) || own(x, q.buyerOrgId) ? q : without({ ...q, ...(q.note ? { note: '' } : {}) }, 'address')),
  schedules: (s: Schedule, _id, x) => (isAdmin(x) || !realOrg(x, s.buyerOrgId) || own(x, s.buyerOrgId) ? s : { ...s, history: [] }),
  bookings: (b: Booking, id, x) => (own(x, b.farmerOrgId) || !b.qr ? b : { ...b, qr: sealCode(b.qr, CODE_SALT.booking(id)) }),
  releases: (r: ReleaseOrder, _id, x) => {
    if (isAdmin(x)) return r;
    const lot = x.w.lots[r.lotId];
    const parties = lot ? [lot.farmerOrgId, lot.facilityOrgId, ...subParties(x.w, r.subOrderId ? x.w.subOrders[r.subOrderId] : undefined)] : [];
    if (!parties.some(o => realOrg(x, o)) || parties.some(o => own(x, o))) return r;
    return { ...r, pickerName: initials(r.pickerName) };
  },
  /** números de operación ya usados: solo los de pedidos y estados de cuenta propios (o de ejemplo) */
  usedOps: (target: string, _key, x) => {
    if (isAdmin(x)) return target;
    const s = x.w.subOrders[target];
    if (s) return [s.buyerOrgId, s.sellerOrgId].some(o => own(x, o)) || ![s.buyerOrgId, s.sellerOrgId].some(o => realOrg(x, o)) ? target : undefined;
    const st = x.w.statements[target] ?? x.w.invoices[target];
    if (st) return !realOrg(x, st.orgId) || own(x, st.orgId) ? target : undefined;
    return target;
  },
};

/** Avisos: cada cuenta recibe solo los suyos; el equipo, todos. */
export function notifVisible(n: Notif, x: MaskCtx): boolean {
  if (isTeam(x) || isAdmin(x)) return true;
  if (isAnalyst(x)) return n.to === 'ADMIN';
  return !!x.org && n.to === x.org;
}
/** Bitácora de auditoría: solo el equipo (no quien es analista: tiene nombres y detalles de cada caso). */
export function auditVisible(_a: AuditEntry, x: MaskCtx): boolean { return isTeam(x) || isAdmin(x); }

/** Lo que se le manda de una colección (o de una lista) a quien mira. `undefined` = no se manda. */
export function maskEntity(col: string, id: string, val: unknown, x: MaskCtx): unknown {
  if (isTeam(x)) return val;
  const f = MASKS[col];
  return f ? f(val, id, x) : val;
}
export function filterItems(col: string, list: unknown[], x: MaskCtx): unknown[] {
  if (isTeam(x)) return list;
  if (col === 'notifs') return (list as Notif[]).filter(n => notifVisible(n, x));
  if (col === 'audit') return (list as AuditEntry[]).filter(a => auditVisible(a, x));
  return list;
}

/** Copia del mundo con lo que este perfil puede ver (comparte lo que no cambia: no se modifica). */
export function maskWorld(w: World, v: Viewer): World {
  if (v.kind === 'team') return w;
  const x = maskCtx(w, v);
  const out: any = {};
  for (const k of Object.keys(w)) {
    const val = (w as any)[k];
    if (Array.isArray(val)) out[k] = filterItems(k, val, x);
    else if (MASKS[k] && val && typeof val === 'object') {
      const rec: any = {};
      for (const id of Object.keys(val)) { const m = MASKS[k](val[id], id, x); if (m !== undefined) rec[id] = m; }
      out[k] = rec;
    } else out[k] = val;
  }
  return out as World;
}
