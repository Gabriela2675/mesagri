/*
 * Consultas sobre el mundo (13.5). Las usan el motor (para imponer reglas)
 * y la interfaz (para mostrar y explicar antes de confirmar).
 */
import type { World, Org, SubOrder, Listing, Shipment, Statement, Review, User } from './types';
import { periodOf, lima, DAY } from './time';
import { product } from './catalog';
import { carrierCap, VCLASS_INFO, sumBy, r2 } from './rules';
import { provinceOf } from './ubigeo';

export const OPEN_STATUSES: SubOrder['status'][] = ['PENDING_CONFIRMATION', 'CONFIRMED', 'AWAITING_HARVEST', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED'];
export const DEAD_STATUSES: SubOrder['status'][] = ['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'];
export const isDead = (s: SubOrder) => DEAD_STATUSES.includes(s.status);
export const isOpen = (s: SubOrder) => OPEN_STATUSES.includes(s.status);

export function subOrdersOf(w: World, f: (s: SubOrder) => boolean): SubOrder[] {
  const out: SubOrder[] = [];
  for (const id in w.subOrders) { const s = w.subOrders[id]; if (f(s)) out.push(s); }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Compras del mes de una MYPE (cuentan para el límite del plan, sin flete: RN-51). */
export function monthPurchases(w: World, buyerOrgId: string, t: number): number {
  const p = periodOf(t);
  let s = 0;
  for (const id in w.subOrders) {
    const so = w.subOrders[id];
    if (so.buyerOrgId === buyerOrgId && !isDead(so) && periodOf(so.createdAt) === p) s += so.saleAmount ?? so.subtotal;
  }
  return r2(s);
}

export function monthSales(w: World, sellerOrgId: string, t: number): number {
  const p = periodOf(t);
  let s = 0;
  for (const id in w.subOrders) {
    const so = w.subOrders[id];
    if (so.sellerOrgId === sellerOrgId && !isDead(so) && periodOf(so.createdAt) === p) s += so.subtotal;
  }
  return r2(s);
}

export function activeListings(w: World, orgId: string): Listing[] {
  return Object.values(w.listings).filter(l => l.orgId === orgId && !l.fromLotId && !l.requestId && (l.status === 'ACTIVE' || l.status === 'IN_REVIEW' || (l.status === 'SOLD_OUT' && l.reserved > 0)));
}

/** Publicaciones que ve el comprador en el catálogo (no incluye las ventas hechas a la medida de una solicitud). */
export function catalogListing(w: World, l: Listing, t: number): boolean { return !l.requestId && visibleListing(w, l, t); }

/** Cupos sin comisión reservados por pedidos aceptados que aún no se completan (D-01). */
export function reservedFreeSlots(w: World, sellerOrgId: string): number {
  let n = 0;
  for (const id in w.subOrders) {
    const s = w.subOrders[id];
    if (s.sellerOrgId === sellerOrgId && s.freeSlotReserved && s.status !== 'COMPLETED' && !isDead(s)) n++;
  }
  return n;
}

/** Estado de cuenta vencido sin pago: bloquea publicar, recibir reservas u ofertas (RN-40). */
export function overdueStatement(w: World, orgId: string): Statement | undefined {
  for (const id in w.statements) { const s = w.statements[id]; if (s.orgId === orgId && s.status === 'OVERDUE') return s; }
  return undefined;
}

export function openStatements(w: World, orgId: string): Statement[] {
  return Object.values(w.statements).filter(s => s.orgId === orgId).sort((a, b) => b.period.localeCompare(a.period));
}

/* ---------- Reputación ---------- */
export interface OrgStats { rating: number; count: number; dist: number[]; onTimePct: number; responseMin: number; completed: number; disputesLost: number; recommends?: number }

export function reviewsTo(w: World, orgId: string, onlyPublished = true): Review[] {
  return Object.values(w.reviews).filter(r => r.toOrg === orgId && (!onlyPublished || r.published)).sort((a, b) => b.at - a.at);
}

export function orgStats(w: World, orgId: string): OrgStats {
  const o = w.orgs[orgId];
  const revs = reviewsTo(w, orgId);
  const dist = [0, 0, 0, 0, 0];
  for (const r of revs) dist[r.stars - 1]++;
  const base = o?.seedRating;
  let count = revs.length, sum = sumBy(revs, r => r.stars);
  if (base) { sum += base.avg * base.count; count += base.count; }
  const c = o?.counters;
  return {
    rating: count ? Math.round((sum / count) * 10) / 10 : 0,
    count,
    dist,
    onTimePct: c && c.deliveries ? c.onTime / c.deliveries : 0,
    responseMin: c && c.responses ? Math.round(c.responseMinutesTotal / c.responses) : 0,
    completed: o?.type === 'BUYER' ? c?.completedPurchases ?? 0 : c?.completedSales ?? 0,
    disputesLost: c?.disputesLost ?? 0,
  };
}

export interface CarrierStats { rating: number; count: number; punctuality: number; care: number; treatment: number; onTimePct: number; shipments: number; recommends: number }
export function carrierStats(w: World, orgId: string): CarrierStats {
  const ships = Object.values(w.shipments).filter(s => s.carrierOrgId === orgId);
  const done = ships.filter(s => s.status === 'DELIVERED' || s.status === 'CLOSED');
  const rated = done.filter(s => s.rating);
  const base: CarrierStats | undefined = w.orgs[orgId]?.seedCarrier;
  const n = rated.length + (base?.count ?? 0);
  const avg = (k: 'punctuality' | 'care' | 'treatment') => n ? (sumBy(rated, s => s.rating![k]) + (base ? base[k] * base.count : 0)) / n : 0;
  const p = avg('punctuality'), c = avg('care'), tr = avg('treatment');
  const shipments = done.length + (base?.shipments ?? 0);
  const onTime = done.filter(s => s.onTime).length + (base ? Math.round(base.onTimePct * base.shipments) : 0);
  return {
    rating: n ? Math.round(((p + c + tr) / 3) * 10) / 10 : 0,
    count: n,
    punctuality: Math.round(p * 10) / 10,
    care: Math.round(c * 10) / 10,
    treatment: Math.round(tr * 10) / 10,
    onTimePct: shipments ? onTime / shipments : 0,
    shipments,
    recommends: rated.filter(s => s.rating!.recommends).length + (base?.recommends ?? 0),
  };
}

/* ---------- Documentos y vigencia ---------- */
export function expiredDocs<T extends { expiresOn?: number; label: string; status: string }>(docs: T[], t: number): T[] {
  return docs.filter(d => d.status !== 'MISSING' && d.expiresOn !== undefined && d.expiresOn < t);
}
export function expiringDocs<T extends { expiresOn?: number; label: string; status: string }>(docs: T[], t: number, days = 30): T[] {
  return docs.filter(d => d.expiresOn !== undefined && d.expiresOn >= t && d.expiresOn < t + days * DAY);
}

export function carrierBlockers(w: World, org: Org, t: number): string[] {
  const c = org.carrier;
  if (!c) return ['No es transportista'];
  const out: string[] = [];
  if (org.status === 'SUSPENDED') out.push('Cuenta suspendida');
  if (c.level !== 'T2' && c.level !== 'T3') out.push('Aún no está en el nivel T2');
  const exp = expiredDocs(c.vehicle.docs, t);
  if (exp.length) out.push(`Documento vencido: ${exp.map(d => d.label).join(', ')}`);
  if (c.driverLicense.expiresOn < t) out.push('Licencia vencida');
  if (c.noShows >= 3) out.push('Tres inasistencias');
  if (overdueStatement(w, org.id)) out.push('Estado de cuenta vencido');
  return out;
}

export function warehouseBlockers(w: World, org: Org, t: number): string[] {
  const h = org.warehouse;
  if (!h) return ['No es almacén'];
  const out: string[] = [];
  if (org.status === 'SUSPENDED') out.push('Cuenta suspendida');
  if (h.level !== 'A2' && h.level !== 'A3') out.push('Aún no está en el nivel A2');
  const exp = expiredDocs(h.docs, t);
  if (exp.length) out.push(`Documento vencido: ${exp.map(d => d.label).join(', ')}`);
  if (overdueStatement(w, org.id)) out.push('Estado de cuenta vencido');
  return out;
}

/* ---------- Almacenes ---------- */
export function warehouseOccupancy(w: World, orgId: string) {
  let occupied = 0, pending = 0;
  for (const id in w.lots) { const l = w.lots[id]; if (l.facilityOrgId === orgId && (l.status === 'IN_DEPOSIT' || l.status === 'FOR_SALE' || l.status === 'DISPUTE' || l.status === 'WAITING_FARMER')) occupied += l.balanceSacks; }
  for (const id in w.bookings) { const b = w.bookings[id]; if (b.facilityOrgId === orgId && (b.status === 'ACCEPTED' || b.status === 'PENDING')) pending += b.sacks; }
  const cap = w.orgs[orgId]?.warehouse?.capacitySacks ?? 0;
  return { occupied, pending, capacity: cap, free: Math.max(0, cap - occupied - pending) };
}

export function rateFor(org: Org, productId: string): number {
  const h = org.warehouse!;
  return h.rates.find(r => r.productId === productId)?.perSackMonth ?? h.defaultRate;
}

/* ---------- Envíos ---------- */
export function kgAssignedOnDay(w: World, carrierOrgId: string, day: number): number {
  return sumBy(Object.values(w.shipments).filter(s => s.carrierOrgId === carrierOrgId && ['ASSIGNED', 'GOING_TO_PICKUP', 'PICKED_UP', 'ARRIVED'].includes(s.status) && sameDay(s.pickupAt, day)), s => s.weightKg);
}
export function sameDay(a: number, b: number) { const x = lima(a), y = lima(b); return x.y === y.y && x.m === y.m && x.d === y.d; }

/** Transportistas aptos para un envío (RN-52, RN-53, RN-56, RN-57), en el orden en que se les ofrece. */
export function eligibleCarriers(w: World, sh: Shipment, t: number, ignoreDay = false): Org[] {
  const route = w.settings.routes.find(r => r.id === sh.routeId);
  if (!route) return [];
  const dow = lima(sh.pickupAt).dow;
  const fav = w.favorites[sh.buyerOrgId]?.carriers ?? [];
  const offered = new Set(sh.offers.map(o => o.carrierOrgId));
  const list = Object.values(w.orgs).filter(o => {
    if (o.type !== 'CARRIER' || !o.carrier) return false;
    const c = o.carrier;
    if (offered.has(o.id)) return false;
    if (!c.available) return false;
    if (carrierBlockers(w, o, t).length) return false;
    if (sh.cargoValue > carrierCap(w.settings, c)) return false;
    const r = c.routes.find(r => r.routeId === sh.routeId);
    if (!r) return false;
    if (!ignoreDay && !r.days.includes(dow)) return false;
    if (route.scope === 'CIUDAD') {
      if (sh.weightKg <= 20 ? !['V1', 'V2'].includes(c.vehicle.vclass) : c.vehicle.vclass === 'V1') return false;
    } else if (c.vehicle.vclass === 'V1') return false;
    const maxKg = Math.min(c.vehicle.payloadKg, VCLASS_INFO[c.vehicle.vclass].maxKg);
    if (kgAssignedOnDay(w, o.id, sh.pickupAt) + sh.weightKg > maxKg) return false;
    return true;
  });
  return list.sort((a, b) => {
    const fa = fav.indexOf(a.id), fb = fav.indexOf(b.id);
    if (fa !== fb) { if (fa === -1) return 1; if (fb === -1) return -1; return fa - fb; }
    const ra = carrierStats(w, a.id).rating, rb = carrierStats(w, b.id).rating;
    if (rb !== ra) return rb - ra;
    return a.id.localeCompare(b.id);
  });
}

export function currentOffer(sh: Shipment) { const o = sh.offers[sh.offers.length - 1]; return o && !o.response ? o : undefined; }

/** Días de la semana en que hay transportistas aptos para una ruta (para elegir la fecha en B-30). */
export function routeDays(w: World, routeId: string, t: number): number[] {
  const days = new Set<number>();
  for (const o of Object.values(w.orgs)) {
    if (o.type !== 'CARRIER' || !o.carrier || !o.carrier.available) continue;
    if (carrierBlockers(w, o, t).length) continue;
    const r = o.carrier.routes.find(r => r.routeId === routeId);
    if (r) r.days.forEach(d => days.add(d));
  }
  return [...days].sort();
}

/* ---------- Catálogo (RN-05, RN-13) ---------- */
export function visibleListing(w: World, l: Listing, t: number): boolean {
  const o = w.orgs[l.orgId];
  return l.status === 'ACTIVE' && l.available > 0 && l.expiresAt > t && !!o && o.status === 'ACTIVE' && o.level >= 1;
}

export function pricePerKg(l: Listing): number { return l.unitKg ? l.price / l.unitKg : l.price; }

export function farmerServes(o: Org, district: string): boolean { return o.serviceAreas.some(a => a.district === district); }
export function farmerFee(o: Org, district: string): number { return o.serviceAreas.find(a => a.district === district)?.fee ?? 0; }

export function sellerProvince(w: World, orgId: string): string { return provinceOf(w.orgs[orgId]?.district) ?? 'AREQUIPA'; }

export function userOf(w: World, orgId: string): User | undefined {
  return Object.values(w.users).find(u => u.orgId === orgId);
}

export function productName(id: string) { return product(id).name; }
