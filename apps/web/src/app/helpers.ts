/* Textos y cálculos que comparten las pantallas. */
import type { World, SubOrder, Org, Listing, SubStatus, PayMethod, Shipment, Notif, User } from '@mesagri/shared/types';
import { checkMemberPerm } from '@mesagri/shared/engine/r2';
import { product, UNIT_LABEL } from '@mesagri/shared/catalog';
import { TAXDOC_LABEL, LEVEL_NAME } from '@mesagri/shared/rules';
import { kg as fkg, numTrim, dateShort, hhmm, relDay } from '@mesagri/shared/format';
import { districtName, placeLabel } from '@mesagri/shared/ubigeo';
import { startOfDay, DAY } from '@mesagri/shared/time';

/** Subtítulo de una persona según el estado actual: nivel tras verificarse, plan tras subir o bajar de plan. */
export function liveSub(w: World, x: { userId: string; sub: string }) {
  const u = w.users[x.userId];
  const org = u ? w.orgs[u.orgId] : undefined;
  let sub = x.sub;
  if (org?.subscription) sub = sub.replace(/plan \S+/, `plan ${w.settings.plans[org.subscription.plan].name}`);
  if (org && u!.role === 'FARMER') sub = sub.replace(/nivel \d/, `nivel ${org.level}`);
  return sub;
}

export const orgName = (w: World, id?: string) => (id && w.orgs[id]?.name) || '—';

/** Si quien usa el celular no puede hacer esa acción en su cuenta (equipo o ayudante sin ese permiso), el motivo. */
export function permWhy(w: World, u: User | undefined, type: string): string | undefined {
  if (!u) return undefined;
  try { checkMemberPerm(w, u, type); return undefined; } catch (e: any) { return e?.message ?? 'No tienes permiso para esto.'; }
}

/** Dirección con su distrito, sin repetirlo si la dirección ya lo nombra («…, Cercado, Cercado»). */
export function withDistrict(address: string | undefined, district: string): string {
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!address) return district;
  if (!district || norm(address).endsWith(norm(district)) || norm(address).includes(', ' + norm(district))) return address;
  return `${address}, ${district}`;
}

/** De dónde salió un pedido: de una solicitud de compra (oferta aceptada) o de un pedido programado del plan Pro. */
export function originOf(w: World, s: SubOrder): { kind: 'REQUEST' | 'SCHEDULE'; id: string; code: string; label: string } | undefined {
  const rid = s.items.map(it => w.listings[it.listingId]?.requestId).find(Boolean);
  const r = rid ? w.requests?.[rid] : undefined;
  if (r) return { kind: 'REQUEST', id: r.id, code: r.code, label: `Por solicitud de compra ${r.code}` };
  const sc = Object.values(w.schedules ?? {}).find(x => x.buyerOrgId === s.buyerOrgId && (x.draft?.orderId === s.orderId || x.history.some(h => h.orderId === s.orderId)));
  if (sc) return { kind: 'SCHEDULE', id: sc.id, code: sc.code, label: `Pedido programado ${sc.code}` };
  return undefined;
}
export const userOfOrg = (w: World, orgId?: string): User | undefined => orgId ? Object.values(w.users).find(u => u.orgId === orgId) : undefined;

export function qtyText(qty: number, unit: Listing['unit'], unitKg: number): string {
  if (unit === 'kg') return fkg(qty);
  const u = UNIT_LABEL[unit];
  return `${numTrim(qty)} ${qty === 1 ? u.one : u.many}${unitKg && unitKg !== 1 ? ` (${fkg(qty * unitKg)})` : ''}`;
}
export function itemsText(s: { items: SubOrder['items'] }): string {
  return s.items.map(i => `${product(i.productId).name.toLowerCase()} ${i.unit === 'kg' ? fkg(i.qty) : qtyText(i.qty, i.unit, i.unitKg)}`).join(', ');
}
export function itemsShort(s: { items: SubOrder['items'] }): string {
  const i = s.items[0];
  if (!i) return '';
  const first = `${product(i.productId).name} · ${i.unit === 'kg' ? fkg(i.qty) : qtyText(i.qty, i.unit, i.unitKg)}`;
  return s.items.length > 1 ? `${first} y ${s.items.length - 1} más` : first;
}
export const kgOf = (s: SubOrder) => s.items.reduce((a, i) => a + i.qty * i.unitKg, 0);

export const PAY_LABEL: Record<PayMethod, string> = { YAPE: 'Yape', PLIN: 'Plin', TRANSFER: 'Transferencia', CASH: 'Efectivo', CARD: 'Tarjeta' };
export const taxLabel = (t: SubOrder['taxDoc']) => TAXDOC_LABEL[t];

export interface StatusInfo { label: string; tone: string; icon: string }
export function statusInfo(s: SubOrder, side: 'seller' | 'buyer'): StatusInfo {
  const st: SubStatus = s.status;
  const paid = s.payment.status === 'CONFIRMED';
  switch (st) {
    case 'PENDING_CONFIRMATION': return side === 'seller' ? { label: 'Nuevo', tone: 'warn', icon: 'bell' } : { label: 'Esperando que acepte', tone: 'warn', icon: 'clock' };
    case 'CONFIRMED': return side === 'buyer' && !paid && s.payment.method !== 'CASH' ? { label: s.payment.status === 'UPLOADED' ? 'Pago por confirmar' : 'Por pagar', tone: 'terra', icon: 'banknote' } : { label: side === 'seller' && s.payment.status === 'UPLOADED' ? 'Confirma el pago' : 'Aceptado', tone: side === 'seller' && s.payment.status === 'UPLOADED' ? 'terra' : '', icon: 'check' };
    case 'AWAITING_HARVEST': return { label: 'Por cosechar', tone: '', icon: 'sprout' };
    case 'PREPARING': return { label: 'Preparando', tone: '', icon: 'package' };
    case 'READY': return { label: s.deliveryMode === 'PICKUP' ? 'Listo para recoger' : 'Listo', tone: 'field', icon: 'package' };
    case 'IN_TRANSIT': return { label: 'En camino', tone: 'field', icon: 'truck' };
    case 'DELIVERED': return side === 'buyer' ? { label: 'Revisa y confirma', tone: 'terra', icon: 'clipboard-check' } : { label: 'Entregado', tone: 'leaf', icon: 'check' };
    case 'COMPLETED': return { label: paid || s.payment.method === 'CASH' ? 'Conforme' : 'Conforme', tone: 'leaf', icon: 'circle-check' };
    case 'DISPUTED': return { label: 'En disputa', tone: 'danger', icon: 'triangle-alert' };
    case 'REJECTED': return { label: 'No aceptado', tone: 'danger', icon: 'x' };
    case 'EXPIRED': return { label: 'Vencido', tone: 'danger', icon: 'clock' };
    case 'CANCELLED_BY_BUYER': return { label: 'Cancelado', tone: 'danger', icon: 'ban' };
    case 'CANCELLED_BY_SELLER': return { label: 'Cancelado por el agricultor', tone: 'danger', icon: 'ban' };
  }
  return { label: st, tone: '', icon: 'circle' };
}

export function deliveryText(s: SubOrder): string {
  if (s.deliveryMode === 'PICKUP') return 'Recojo por su cuenta';
  if (s.deliveryMode === 'CARRIER') return 'Transportista aliado';
  return s.deliveryFee ? 'Envío del agricultor' : 'Envío del agricultor (incluido)';
}

export function levelChip(o?: Org): { label: string; tone: string } {
  if (!o) return { label: '', tone: '' };
  if (o.carrier) return { label: `${o.carrier.level} · ${({ T0: 'Registrado', T1: 'Documentos', T2: 'Verificado', T3: 'Destacado' } as any)[o.carrier.level]}`, tone: o.carrier.level >= 'T2' ? 'leaf' : '' };
  if (o.warehouse) return { label: `${o.warehouse.level} · ${({ A0: 'Registrado', A1: 'Documentos', A2: 'Verificado', A3: 'Destacado' } as any)[o.warehouse.level]}`, tone: o.warehouse.level >= 'A2' ? 'leaf' : '' };
  return { label: `Nivel ${o.level} · ${LEVEL_NAME[o.level]}`, tone: o.level >= 2 ? 'leaf' : o.level === 1 ? '' : 'warn' };
}

export const where = (o?: Org) => (o ? placeLabel(o.district) : '');
export { districtName, placeLabel };

export function shipStatusText(sh: Shipment): { label: string; tone: string } {
  switch (sh.status) {
    case 'WAITING_FARMER': return { label: 'Espera que el agricultor acepte', tone: 'warn' };
    case 'OFFERING': return { label: 'Buscando transportista', tone: 'warn' };
    case 'ASSIGNED': return { label: 'Asignado', tone: '' };
    case 'GOING_TO_PICKUP': return { label: 'Va a recoger', tone: 'field' };
    case 'PICKED_UP': return { label: 'En camino', tone: 'field' };
    case 'ARRIVED': return { label: 'Llegó a la entrega', tone: 'terra' };
    case 'DELIVERED': return { label: 'Entregado', tone: 'leaf' };
    case 'CLOSED': return { label: 'Cerrado', tone: 'leaf' };
    case 'NO_CARRIER': return { label: 'Sin transportista', tone: 'danger' };
    case 'CANCELLED': return { label: 'Cancelado', tone: 'danger' };
  }
}

/** Avance aproximado en el mapa según el estado y la hora. */
export function shipProgress(sh: Shipment, now: number): number {
  if (['DELIVERED', 'CLOSED', 'ARRIVED'].includes(sh.status)) return 1;
  if (sh.status === 'PICKED_UP' && sh.pickup) {
    const span = Math.max(1, sh.deliverFrom - sh.pickup.at);
    return Math.max(0.08, Math.min(0.95, (now - sh.pickup.at) / span));
  }
  return 0;
}

export function groupByDay<T extends { at: number }>(items: T[], now: number): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  const today = startOfDay(now);
  for (const it of items) {
    const d = startOfDay(it.at);
    const label = d === today ? 'Hoy' : d === today - DAY ? 'Ayer' : d > today - 7 * DAY ? 'Esta semana' : 'Antes';
    const g = out.find(x => x.label === label);
    if (g) g.items.push(it); else out.push({ label, items: [it] });
  }
  return out;
}

export function notifsFor(w: World, orgId: string, isAdmin = false): Notif[] {
  return w.notifs.filter(n => n.to === orgId || (isAdmin && n.to === 'ADMIN')).sort((a, b) => b.at - a.at);
}
export const NOTIF_ICON: Record<Notif['kind'], string> = { ORDER: 'shopping-bag', PAYMENT: 'banknote', DELIVERY: 'truck', VERIFICATION: 'shield-check', BILLING: 'receipt', STORAGE: 'warehouse', SHIPMENT: 'truck', REVIEW: 'star', SYSTEM: 'bell', PRICE: 'trending-up' };

export const when = (t: number, now: number) => `${relDay(t, now)} · ${hhmm(t)}`;
export const dayTime = (t: number) => `${dateShort(t)} · ${hhmm(t)}`;

/** Conversaciones del usuario (por pedido), la más reciente primero. */
export function conversations(w: World, orgId: string) {
  const out: { id: string; so: SubOrder; other: string; last?: { text: string; at: number; from: string }; count: number }[] = [];
  for (const id in w.subOrders) {
    const so = w.subOrders[id];
    const sh = so.shipmentId ? w.shipments[so.shipmentId] : undefined;
    if (so.buyerOrgId !== orgId && so.sellerOrgId !== orgId && sh?.carrierOrgId !== orgId) continue;
    const msgs = w.messages[id] ?? [];
    if (!msgs.length && !['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED'].includes(so.status)) continue;
    const other = so.buyerOrgId === orgId ? so.sellerOrgId : so.buyerOrgId;
    const last = msgs[msgs.length - 1];
    out.push({ id, so, other, last: last ? { text: last.text, at: last.at, from: last.from } : undefined, count: msgs.length });
  }
  return out.sort((a, b) => (b.last?.at ?? b.so.createdAt) - (a.last?.at ?? a.so.createdAt));
}

export function pctOf(a: number, b: number) { return b ? a / b : 0; }
export { districtName as dn };

export const sacos = (n: number) => `${n} ${n === 1 ? 'saco' : 'sacos'}`;

/** Franja de entrega: la del transportista si el pedido va con envío aliado. */
export function slotOf(w: World, s: SubOrder): string {
  const sh = s.shipmentId ? w.shipments[s.shipmentId] : undefined;
  return sh && sh.status !== 'CANCELLED' ? `${hhmm(sh.deliverFrom)} a ${hhmm(sh.deliverTo)}` : s.slot;
}
