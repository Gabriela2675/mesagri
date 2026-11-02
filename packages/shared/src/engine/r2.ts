/*
 * Entrega R2 del documento de diseño, ya funcionando en el MVP:
 *  - Solicitudes de compra (RF-ORD-09): la MYPE pide producto, cantidad, fecha y precio máximo;
 *    los agricultores ofertan y, al aceptar una oferta, se genera el pedido con las reglas de siempre.
 *  - Pedidos programados del plan Pro (RF-ORD-10, RF-SUB-10): se arman solos antes de cada entrega
 *    y la MYPE los aprueba; no se piden si el precio sube más de lo que ella dijo o falta stock.
 *  - Equipo y locales de la MYPE (B-23) y quién publica por el agricultor (A-28, RF-IDI-12):
 *    otras personas actúan por la cuenta con permisos; lo delicado sigue siendo del titular.
 *  - Productos nuevos del catálogo maestro (W-09, RF-ADM-07).
 */
import type { World, User, Org, PurchaseRequest, RequestOffer, Schedule, ScheduleLine, ScheduleItem, Listing, OrgMember, MemberPerm, Local, Quality, DeliveryMode, PayMethod, TaxDocType } from '../types';
import { HANDLERS, on, fail, must, notify, audit, requireAdmin, requireActive, getOrg, nextSeq, Ctx } from './core';
import { farmerLimit, isPhoneValid, r2, sumBy } from '../rules';
import { overdueStatement, visibleListing, pricePerKg } from '../queries';
import { product, registerProducts, PRODUCT_BY_ID, type Product } from '../catalog';
import { pad } from '../ids';
import { DAY, HOUR, atHour, startOfDay, lima } from '../time';
import { money, kg as fkg, dateShort, pct } from '../format';
import { DISTRICT_BY_CODE, districtName } from '../ubigeo';
import { defaultPrefs } from './accounts';

/* ======================= Permisos de quienes no son titulares ======================= */

/** El titular es la primera persona de la cuenta; los demás actúan con los permisos que les dieron. */
export function isTitular(w: World, u: User): boolean {
  const o = w.orgs[u.orgId];
  return !o || !o.memberIds.length || o.memberIds[0] === u.id;
}
export function memberOf(w: World, u: User): OrgMember | undefined {
  return w.orgs[u.orgId]?.members?.find(m => m.userId === u.id);
}
/** ¿Puede esta persona hacer algo que pide `perm` en su cuenta? */
export function canDo(w: World, u: User | undefined, perm: MemberPerm | 'TITULAR'): boolean {
  if (!u) return false;
  if (u.role === 'ADMIN' || isTitular(w, u)) return true;
  const m = memberOf(w, u);
  if (!m || !m.active) return false;
  return perm !== 'TITULAR' && m.perms.includes(perm);
}

const PERM_LABEL: Record<MemberPerm | 'TITULAR', string> = {
  PEDIR: 'hacer pedidos', APROBAR: 'aprobar y recibir', PAGAR: 'pagar', PUBLICAR: 'publicar cosechas', PEDIDOS: 'responder pedidos', TITULAR: 'hacerlo',
};

/** Qué permiso pide cada acción cuando la hace alguien que no es el titular. */
export const MEMBER_PERM: Record<string, MemberPerm | 'TITULAR'> = {
  // MYPE
  ORDER_PLACE: 'PEDIR', REQUEST_CREATE: 'PEDIR', REQUEST_ACCEPT: 'PEDIR', REQUEST_CLOSE: 'PEDIR', SUBORDER_CANCEL: 'PEDIR',
  PAYMENT_UPLOAD: 'PAGAR', SHIP_BUYER_PAID: 'PAGAR', SUB_PAY: 'PAGAR', SUB_UPGRADE: 'PAGAR',
  RECEIPT_CONFIRM: 'APROBAR', DISPUTE_OPEN: 'APROBAR', SCHEDULE_CREATE: 'APROBAR', SCHEDULE_UPDATE: 'APROBAR', SCHEDULE_DELETE: 'APROBAR', SCHEDULE_APPROVE: 'APROBAR', SCHEDULE_SKIP: 'APROBAR',
  TEAM_ADD: 'TITULAR', TEAM_SET: 'TITULAR', TEAM_REMOVE: 'TITULAR', LOCAL_SAVE: 'TITULAR', LOCAL_REMOVE: 'TITULAR', ORG_UPDATE: 'TITULAR',
  // agricultor
  LISTING_PUBLISH: 'PUBLICAR', LISTING_EDIT: 'PUBLICAR', LISTING_PAUSE: 'PUBLICAR', LISTING_RESUME: 'PUBLICAR', LISTING_REMOVE: 'PUBLICAR',
  REQUEST_OFFER: 'PUBLICAR', REQUEST_OFFER_WITHDRAW: 'PUBLICAR',
  SUBORDER_ACCEPT: 'PEDIDOS', SUBORDER_REJECT: 'PEDIDOS', SUBORDER_SELLER_CANCEL: 'PEDIDOS', SUBORDER_PREPARE: 'PEDIDOS', SUBORDER_READY: 'PEDIDOS',
  SUBORDER_DISPATCH: 'PEDIDOS', SUBORDER_DELIVER: 'PEDIDOS', TAXDOC_REGISTER: 'PEDIDOS',
  PAYMENT_CONFIRM: 'TITULAR', PAYMENT_NOT_RECEIVED: 'TITULAR', PAYOUT_SET: 'TITULAR', ZONES_SET: 'TITULAR', STATEMENT_PAY: 'TITULAR', STATEMENT_CLAIM: 'TITULAR',
  VERIF_SUBMIT: 'TITULAR', VERIF_RESPOND: 'TITULAR', VERIF_APPEAL: 'TITULAR', FARM_ADD: 'TITULAR', DELEGATE_ADD: 'TITULAR', DELEGATE_SET: 'TITULAR', DELEGATE_REMOVE: 'TITULAR',
  STO_BOOK: 'TITULAR', STO_BOOK_CANCEL: 'TITULAR', STO_RELEASE_CREATE: 'TITULAR', STO_RENT_DECLARE: 'TITULAR',
  // transportista
  DRIVER_ADD: 'TITULAR', DRIVER_SET: 'TITULAR', DRIVER_REMOVE: 'TITULAR', VEHICLE_CHANGE: 'TITULAR', CARRIER_DOC_RENEW: 'TITULAR', CARRIER_AGREEMENT: 'TITULAR',
};

/** Se revisa antes de cada acción (engine/index.ts). */
export function checkMemberPerm(w: World, u: User, type: string) {
  const need = MEMBER_PERM[type];
  if (!need || u.role === 'ADMIN' || isTitular(w, u)) return;
  const m = memberOf(w, u);
  const o = w.orgs[u.orgId];
  if (!m) return; // cuentas antiguas sin registro de miembros: actúan como siempre
  if (!m.active) fail('MEMBER_PAUSED', `Tu acceso a la cuenta de ${o?.name ?? 'tu negocio'} está pausado. Habla con el titular.`);
  if (need === 'TITULAR') fail('TITULAR_ONLY', `Esto solo lo hace el titular de la cuenta (${titularName(w, o)}).`);
  if (!m.perms.includes(need)) fail('NO_PERMISSION', `No tienes permiso para ${PERM_LABEL[need]} en la cuenta de ${o?.name ?? 'tu negocio'}. Pídeselo al titular.`);
}
function titularName(w: World, o?: Org): string { return (o && w.users[o.memberIds[0]]?.name) || 'el titular'; }

/* ======================= Solicitudes de compra (RF-ORD-09) ======================= */

const OPEN_REQUESTS_MAX = 5;
const SOL = (n: number) => 'SOL-' + pad(n, 4);

function requireBuyerReady(w: World, o: Org) {
  if (o.type !== 'BUYER') fail('FORBIDDEN', 'Solo las MYPE publican solicitudes de compra.');
  requireActive(o);
  if (o.level < 1) fail('LEVEL0', 'Primero verificamos tu negocio (nivel 1): RUC activo y habido y el DNI del representante (RN-02).');
  const sub = o.subscription;
  if (!sub || sub.status === 'INACTIVE') fail('NO_MEMBERSHIP', 'Tu membresía no está activa: paga tu plan para comprar (RN-35).');
}

/** Agricultores a los que les puede interesar una solicitud: publican o publicaron ese producto. */
export function farmersFor(w: World, productId: string): Org[] {
  const ids = new Set(Object.values(w.listings).filter(l => l.productId === productId).map(l => l.orgId));
  return Object.values(w.orgs).filter(o => o.type === 'FARMER' && o.status === 'ACTIVE' && o.level >= 1 && ids.has(o.id));
}

export function localOf(o: Org, localId?: string): Local | undefined {
  const list = o.locales ?? [];
  return (localId ? list.find(l => l.id === localId) : undefined) ?? list.find(l => l.isDefault);
}

on('REQUEST_CREATE', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  requireBuyerReady(w, o);
  const id = String(p.requestId ?? '');
  if (!/^[A-Za-z0-9:_.-]{4,80}$/.test(id)) fail('BAD_ID', 'Identificador no válido.');
  if (w.requests[id]) fail('DUPLICATE', 'Esta solicitud ya se publicó.');
  const pid = String(p.productId ?? '');
  if (!PRODUCT_BY_ID[pid] && !w.catalogExtra[pid]) fail('BAD_PRODUCT', 'Elige un producto del catálogo.');
  const kgv = Number(p.kg);
  if (!(kgv >= 5) || kgv > 20_000) fail('BAD_QTY', 'La cantidad va de 5 kg a 20 000 kg.');
  const maxP = p.maxPricePerKg === undefined || p.maxPricePerKg === null || p.maxPricePerKg === '' ? undefined : Number(p.maxPricePerKg);
  if (maxP !== undefined && !(maxP > 0 && maxP < 1000)) fail('BAD_PRICE', 'Escribe un precio máximo por kilo válido o déjalo vacío.');
  const needed = startOfDay(Number(p.neededOn));
  if (!(needed > startOfDay(t))) fail('BAD_DATE', 'Elige una fecha desde mañana.');
  if (needed > startOfDay(t) + 30 * DAY) fail('BAD_DATE', 'Elige una fecha dentro de los próximos 30 días.');
  const closesAt = needed - 6 * HOUR; // 18:00 del día anterior
  if (closesAt < t + 2 * HOUR) fail('BAD_DATE', 'No queda tiempo para recibir ofertas: elige un día más adelante.');
  const open = Object.values(w.requests).filter(r => r.buyerOrgId === o.id && r.status === 'OPEN').length;
  if (open >= OPEN_REQUESTS_MAX) fail('TOO_MANY', `Puedes tener hasta ${OPEN_REQUESTS_MAX} solicitudes abiertas. Cierra una para publicar otra.`);
  const loc = localOf(o, p.localId);
  const district = loc?.district ?? o.district;
  const note = p.note ? String(p.note).trim().slice(0, 300) : undefined;
  const r: PurchaseRequest = {
    id, code: SOL(nextSeq(w, 'request', 0)), buyerOrgId: o.id, buyerUserId: c.a.id, productId: pid, kg: r2(kgv), maxPricePerKg: maxP !== undefined ? r2(maxP) : undefined,
    neededOn: needed, district, address: loc?.address ?? o.address, localId: loc?.id, note: note || undefined, createdAt: t, closesAt, status: 'OPEN', offers: [],
  };
  w.requests[id] = r;
  const name = product(pid).name;
  for (const f of farmersFor(w, pid)) {
    notify(c, f.id, 'ORDER', 'Solicitud de compra', `${o.name} pide ${fkg(r.kg)} de ${name.toLowerCase()} para el ${dateShort(needed)}${maxP ? ` · hasta ${money(maxP)} por kg` : ''}. Ofrece tu precio.`, { screen: 'A-27', params: { id } });
  }
  audit(c, c.a.id, 'REQUEST_CREATE', id, `${r.code}: ${fkg(r.kg)} de ${name} para el ${dateShort(needed)}`);
  return { requestId: id, code: r.code };
});

on('REQUEST_OFFER', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const r = must(w.requests[String(p.requestId)], 'NOT_FOUND', 'Esa solicitud ya no existe.');
  const o = getOrg(w, c.a.orgId);
  if (o.type !== 'FARMER') fail('FORBIDDEN', 'Solo los agricultores ofertan.');
  requireActive(o);
  if (o.level < 1) fail('LEVEL0', 'Cuando verifiquemos tu identidad (nivel 1) podrás ofertar.');
  if (overdueStatement(w, o.id)) fail('OVERDUE', 'Tienes un estado de cuenta vencido: págalo para ofertar y publicar de nuevo (RN-40).');
  if (r.status !== 'OPEN' || t >= r.closesAt) fail('CLOSED', 'Esa solicitud ya no recibe ofertas.');
  if (r.offers.some(x => x.sellerOrgId === o.id && x.status === 'SENT')) fail('ALREADY', 'Ya enviaste una oferta: retírala si quieres cambiarla.');
  const id = String(p.offerId ?? '');
  if (!/^[A-Za-z0-9:_.-]{4,80}$/.test(id) || r.offers.some(x => x.id === id)) fail('BAD_ID', 'Identificador de oferta no válido.');
  const price = Number(p.pricePerKg);
  if (!(price > 0 && price < 1000)) fail('BAD_PRICE', 'Escribe tu precio por kilo.');
  if (r.maxPricePerKg !== undefined && price > r.maxPricePerKg + 1e-9) fail('ABOVE_MAX', `${w.orgs[r.buyerOrgId]?.name ?? 'El negocio'} paga hasta ${money(r.maxPricePerKg)} por kilo.`);
  const kgv = Number(p.kg ?? r.kg);
  if (!(kgv > 0) || kgv > r.kg + 1e-9) fail('BAD_QTY', `Puedes ofrecer hasta ${fkg(r.kg)}.`);
  const lim = farmerLimit(w.settings, o.level);
  if (r2(kgv * price) > lim.perOrder) fail('SELLER_CAP', `Con tu nivel puedes vender hasta ${money(lim.perOrder)} por pedido. Ofrece menos kilos.`);
  const q = (['PRIMERA', 'SEGUNDA', 'TERCERA'].includes(p.quality) ? p.quality : 'PRIMERA') as Quality;
  const harvest = p.harvestDate ? Number(p.harvestDate) : undefined;
  const offer: RequestOffer = { id, sellerOrgId: o.id, userId: c.a.id, pricePerKg: r2(price), kg: r2(kgv), harvestDate: harvest && harvest > 0 ? harvest : undefined, quality: q, note: p.note ? String(p.note).trim().slice(0, 200) || undefined : undefined, at: t, status: 'SENT' };
  r.offers.push(offer);
  notify(c, r.buyerOrgId, 'ORDER', 'Nueva oferta', `${o.name} ofrece ${fkg(offer.kg)} de ${product(r.productId).name.toLowerCase()} a ${money(offer.pricePerKg)} por kg (${r.code}).`, { screen: 'B-17', params: { id: r.id } });
  audit(c, c.a.id, 'REQUEST_OFFER', r.id, `${o.name}: ${fkg(offer.kg)} a ${money(offer.pricePerKg)}/kg`);
  return { offerId: id };
});

on('REQUEST_OFFER_WITHDRAW', (c: Ctx) => {
  const { w } = c;
  const p = c.e.p ?? {};
  const r = must(w.requests[String(p.requestId)], 'NOT_FOUND', 'Esa solicitud ya no existe.');
  const offer = must(r.offers.find(x => x.id === p.offerId), 'NOT_FOUND', 'No encontramos esa oferta.');
  if (offer.sellerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Esa oferta es de otra cuenta.');
  if (offer.status !== 'SENT') fail('STATE', 'Esa oferta ya no se puede retirar.');
  offer.status = 'WITHDRAWN';
  audit(c, c.a.id, 'REQUEST_OFFER_WITHDRAW', r.id, `${w.orgs[offer.sellerOrgId]?.name}: retiró su oferta`);
});

/** Aceptar una oferta genera el pedido (ORDER_PLACE) con una publicación hecha a la medida de la oferta. */
on('REQUEST_ACCEPT', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const r = must(w.requests[String(p.requestId)], 'NOT_FOUND', 'Esa solicitud ya no existe.');
  if (r.buyerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Esa solicitud es de otro negocio.');
  if (r.status !== 'OPEN') fail('STATE', 'Esa solicitud ya está cerrada.');
  const offer = must(r.offers.find(x => x.id === p.offerId), 'NOT_FOUND', 'No encontramos esa oferta.');
  if (offer.status !== 'SENT') fail('STATE', 'Esa oferta ya no está vigente.');
  const subOrderId = String(p.subOrderId ?? '');
  const orderId = String(p.orderId ?? '');
  if (!/^[A-Za-z0-9:_.-]{4,80}$/.test(subOrderId) || !/^[A-Za-z0-9:_.-]{4,80}$/.test(orderId)) fail('BAD_ID', 'Identificador de pedido no válido.');
  const seller = getOrg(w, offer.sellerOrgId);
  const lid = `${offer.id}-l`;
  if (w.listings[lid]) fail('DUPLICATE', 'Esta oferta ya se aceptó.');
  const pr = product(r.productId);
  const listing: Listing = {
    id: lid, orgId: seller.id, productId: r.productId, unit: 'kg', unitKg: 1, qtyTotal: offer.kg, available: offer.kg, reserved: 0, sold: 0,
    price: offer.pricePerKg, harvestDate: offer.harvestDate ?? t, quality: offer.quality, photoIds: [], harvestSeal: false, status: 'ACTIVE',
    createdAt: t, expiresAt: Math.max(r.neededOn + DAY, t + pr.perishDays * DAY), minQty: 0, requestId: r.id,
  };
  w.listings[lid] = listing;
  const loc = (w.orgs[r.buyerOrgId]?.locales ?? []).find(l => l.id === r.localId);
  const orderEvent = {
    ...c.e,
    p: {
      orderId, address: loc?.address ?? r.address, district: r.district, secrets: p.secrets, upgrade: p.upgrade, fromRequest: r.id,
      subs: [{ subOrderId, sellerOrgId: seller.id, items: [{ listingId: lid, qty: offer.kg }], deliveryMode: p.deliveryMode, deliveryDate: r.neededOn, slot: p.slot ?? '7:00 a 9:00', taxDoc: p.taxDoc, payMethod: p.payMethod, preferredCarrier: p.preferredCarrier, shipmentId: p.deliveryMode === 'CARRIER' ? `${subOrderId}-env` : undefined }],
    },
  };
  let res: any;
  const inner: Ctx = { ...c, e: orderEvent };
  try {
    res = HANDLERS.ORDER_PLACE(inner);
  } catch (err) {
    delete w.listings[lid];
    throw err;
  }
  c.n = inner.n; // los avisos y la auditoría siguen numerándose después de los del pedido
  offer.status = 'ACCEPTED';
  offer.listingId = lid;
  r.status = 'AWARDED';
  r.awardedOfferId = offer.id;
  r.subOrderId = subOrderId;
  r.closedAt = t;
  for (const x of r.offers) {
    if (x.id !== offer.id && x.status === 'SENT') {
      x.status = 'REJECTED';
      notify(c, x.sellerOrgId, 'ORDER', 'Eligieron otra oferta', `${w.orgs[r.buyerOrgId]?.name ?? 'El negocio'} eligió otra oferta para ${r.code}. Gracias por ofertar.`, { screen: 'A-27', params: { id: r.id } });
    }
  }
  notify(c, seller.id, 'ORDER', '¡Aceptaron tu oferta!', `${w.orgs[r.buyerOrgId]?.name ?? 'El negocio'} aceptó tus ${fkg(offer.kg)} de ${pr.name.toLowerCase()} a ${money(offer.pricePerKg)} por kg. Confirma el pedido en ${w.settings.orderResponseHours} h.`, { screen: 'A-13', params: { id: subOrderId } });
  audit(c, c.a.id, 'REQUEST_ACCEPT', r.id, `${r.code}: aceptó la oferta de ${seller.name} (${money(offer.pricePerKg)}/kg)`);
  return { ...(res ?? {}), subOrderId, orderId };
});

on('REQUEST_CLOSE', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const r = must(w.requests[String(p.requestId)], 'NOT_FOUND', 'Esa solicitud ya no existe.');
  if (r.buyerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Esa solicitud es de otro negocio.');
  if (r.status !== 'OPEN') fail('STATE', 'Esa solicitud ya está cerrada.');
  r.status = 'CLOSED';
  r.closedAt = t;
  for (const x of r.offers) if (x.status === 'SENT') {
    x.status = 'REJECTED';
    notify(c, x.sellerOrgId, 'ORDER', 'Solicitud cerrada', `${w.orgs[r.buyerOrgId]?.name ?? 'El negocio'} cerró ${r.code} sin elegir una oferta.`, { screen: 'A-27', params: { id: r.id } });
  }
  audit(c, c.a.id, 'REQUEST_CLOSE', r.id, `${r.code} cerrada por el comprador`);
});

/* ======================= Pedidos programados (plan Pro) ======================= */

const PRG = (n: number) => 'PRG-' + pad(n, 4);
const FREQ_DAYS: Record<Schedule['frequency'], number> = { SEMANAL: 7, QUINCENAL: 14, MENSUAL: 28 };
export const FREQ_LABEL: Record<Schedule['frequency'], string> = { SEMANAL: 'Cada semana', QUINCENAL: 'Cada 15 días', MENSUAL: 'Cada 4 semanas' };

export function isPro(o?: Org): boolean { return !!o?.subscription && (o.subscription.plan === 'PRO' || o.subscription.plan === 'EMPRESA'); }

/** Primera fecha con ese día de la semana, con al menos `minDays` de anticipación. */
export function nextWeekday(t: number, weekday: number, minDays = 2): number {
  let d = startOfDay(t) + minDays * DAY;
  for (let i = 0; i < 8; i++) { if (lima(d + 12 * HOUR).dow === weekday) return d; d += DAY; }
  return startOfDay(t) + 7 * DAY;
}
/** El pedido se arma dos días antes de la entrega, a las 8:00. */
export const scheduleRunAt = (s: Schedule) => atHour(s.nextDelivery - 2 * DAY, 8);
/** Si nadie lo aprueba, el borrador vence la víspera a las 18:00. */
export const draftExpiresAt = (deliveryDate: number) => startOfDay(deliveryDate) - 6 * HOUR;

function cleanSchedulePatch(p: any) {
  const freq = ['SEMANAL', 'QUINCENAL', 'MENSUAL'].includes(p.frequency) ? p.frequency as Schedule['frequency'] : undefined;
  const weekday = p.weekday !== undefined ? Math.round(Number(p.weekday)) : undefined;
  if (weekday !== undefined && !(weekday >= 1 && weekday <= 7)) fail('BAD_DAY', 'Elige el día de entrega.');
  const maxInc = p.maxIncrease !== undefined ? Number(p.maxIncrease) : undefined;
  if (maxInc !== undefined && !(maxInc >= 0 && maxInc <= 0.5)) fail('BAD_RULE', 'El tope de alza va de 0 % a 50 %.');
  return { freq, weekday, maxInc };
}

on('SCHEDULE_CREATE', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  requireBuyerReady(w, o);
  if (!isPro(o)) fail('PRO_ONLY', 'Los pedidos programados son del plan Pro: pásate a Pro desde tu perfil.');
  const id = String(p.scheduleId ?? '');
  if (!/^[A-Za-z0-9:_.-]{4,80}$/.test(id) || w.schedules[id]) fail('BAD_ID', 'Identificador no válido.');
  if (Object.values(w.schedules).filter(s => s.buyerOrgId === o.id).length >= 10) fail('TOO_MANY', 'Puedes tener hasta 10 pedidos programados.');
  const { freq, weekday, maxInc } = cleanSchedulePatch(p);
  let items: ScheduleItem[] = [];
  let mode: DeliveryMode = 'FARMER', pay: PayMethod = 'YAPE', tax: TaxDocType = 'BOLETA', slot = '7:00 a 9:00';
  if (p.fromSubOrderId) {
    const s = must(w.subOrders[String(p.fromSubOrderId)], 'NOT_FOUND', 'No encontramos ese pedido.');
    if (s.buyerOrgId !== o.id) fail('FORBIDDEN', 'Ese pedido es de otro negocio.');
    items = s.items.map(it => ({ productId: it.productId, sellerOrgId: s.sellerOrgId, listingId: it.listingId, qty: it.qty, unit: it.unit, unitKg: it.unitKg, refPrice: it.price }));
    mode = s.deliveryMode; pay = s.payment.method; tax = s.taxDoc; slot = s.slot;
  } else {
    for (const it of (p.items ?? []) as any[]) {
      const l = must(w.listings[String(it.listingId)], 'NOT_FOUND', 'Un producto ya no está publicado.');
      const qty = Number(it.qty);
      if (!(qty > 0)) fail('BAD_QTY', 'Revisa las cantidades.');
      items.push({ productId: l.productId, sellerOrgId: l.orgId, listingId: l.id, qty, unit: l.unit, unitKg: l.unitKg, refPrice: l.price });
    }
    if (p.deliveryMode) mode = p.deliveryMode;
    if (p.payMethod) pay = p.payMethod;
    if (p.taxDoc) tax = p.taxDoc;
  }
  if (!items.length) fail('EMPTY', 'Elige qué productos se piden.');
  if (new Set(items.map(i => i.sellerOrgId)).size > 4) fail('TOO_MANY', 'Un pedido programado puede tener hasta 4 agricultores.');
  const wd = weekday ?? lima(t + 2 * DAY).dow;
  const s: Schedule = {
    id, code: PRG(nextSeq(w, 'schedule', 0)), buyerOrgId: o.id, createdBy: c.a.id,
    name: String(p.name ?? '').trim().slice(0, 60) || items.map(i => product(i.productId).name).join(', ').slice(0, 60),
    items, frequency: freq ?? 'SEMANAL', weekday: wd, deliveryMode: mode, payMethod: pay, taxDoc: tax, slot: String(p.slot ?? slot),
    localId: p.localId ? String(p.localId) : undefined, maxIncrease: maxInc ?? 0.1, nextDelivery: nextWeekday(t, wd, 3), active: true, createdAt: t,
    history: [{ at: t, text: 'Pedido programado creado' }],
  };
  w.schedules[id] = s;
  audit(c, c.a.id, 'SCHEDULE_CREATE', id, `${s.code}: ${s.name} · ${FREQ_LABEL[s.frequency].toLowerCase()}`);
  return { scheduleId: id, code: s.code, nextDelivery: s.nextDelivery };
});

on('SCHEDULE_UPDATE', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const s = must(w.schedules[String(p.scheduleId)], 'NOT_FOUND', 'No encontramos ese pedido programado.');
  if (s.buyerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Ese pedido programado es de otro negocio.');
  const { freq, weekday, maxInc } = cleanSchedulePatch(p);
  if (p.active === true && !isPro(w.orgs[s.buyerOrgId])) fail('PRO_ONLY', 'Para reactivarlo necesitas el plan Pro.');
  if (freq) s.frequency = freq;
  if (maxInc !== undefined) s.maxIncrease = maxInc;
  if (weekday !== undefined && weekday !== s.weekday) { s.weekday = weekday; s.nextDelivery = nextWeekday(t, weekday, 3); }
  if (Array.isArray(p.qty)) p.qty.forEach((q: any, i: number) => { const n = Number(q); if (s.items[i] && n > 0) s.items[i].qty = n; });
  if (typeof p.active === 'boolean' && p.active !== s.active) {
    s.active = p.active;
    if (s.active && s.nextDelivery < t + 2 * DAY) s.nextDelivery = nextWeekday(t, s.weekday, 3);
    s.history.push({ at: t, text: s.active ? 'Reactivado' : 'Pausado' });
  }
  if (p.name !== undefined && String(p.name).trim()) s.name = String(p.name).trim().slice(0, 60);
});

on('SCHEDULE_DELETE', (c: Ctx) => {
  const { w } = c;
  const s = must(w.schedules[String(c.e.p?.scheduleId)], 'NOT_FOUND', 'No encontramos ese pedido programado.');
  if (s.buyerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Ese pedido programado es de otro negocio.');
  delete w.schedules[s.id];
  audit(c, c.a.id, 'SCHEDULE_DELETE', s.id, `${s.code} eliminado`);
});

on('SCHEDULE_SKIP', (c: Ctx) => {
  const { w, t } = c;
  const s = must(w.schedules[String(c.e.p?.scheduleId)], 'NOT_FOUND', 'No encontramos ese pedido programado.');
  if (s.buyerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Ese pedido programado es de otro negocio.');
  if (!s.draft || s.draft.status !== 'PENDING') fail('STATE', 'No hay un pedido por aprobar.');
  s.draft.status = 'SKIPPED';
  s.history.push({ at: t, text: `No se pidió la entrega del ${dateShort(s.draft.deliveryDate)}` });
});

/** Arma el borrador de la próxima entrega con los precios y el stock de hoy. */
export function buildDraft(w: World, s: Schedule, t: number) {
  const lines: ScheduleLine[] = [];
  for (const it of s.items) {
    const fits = (l: Listing) => visibleListing(w, l, t) && l.productId === it.productId && l.unit === it.unit && l.available + 1e-9 >= it.qty && (!l.minQty || it.qty >= l.minQty);
    const own = (it.listingId && w.listings[it.listingId] && fits(w.listings[it.listingId]) && w.listings[it.listingId].orgId === it.sellerOrgId)
      ? w.listings[it.listingId]
      : Object.values(w.listings).filter(l => l.orgId === it.sellerOrgId && fits(l)).sort((a, b) => a.price - b.price)[0];
    const capPrice = it.refPrice * (1 + s.maxIncrease) + 1e-9;
    const alt = () => {
      const a = Object.values(w.listings).filter(l => l.orgId !== it.sellerOrgId && fits(l) && l.price <= capPrice).sort((a, b) => a.price - b.price)[0];
      return a ? { listingId: a.id, sellerOrgId: a.orgId, price: a.price } : undefined;
    };
    if (!own) { lines.push({ productId: it.productId, sellerOrgId: it.sellerOrgId, qty: it.qty, unit: it.unit, ok: false, reason: `${w.orgs[it.sellerOrgId]?.name ?? 'El agricultor'} no tiene stock`, alt: alt() }); continue; }
    if (own.price > capPrice) {
      const up = own.price / it.refPrice - 1;
      lines.push({ productId: it.productId, sellerOrgId: it.sellerOrgId, listingId: own.id, qty: it.qty, unit: it.unit, price: own.price, ok: false, reason: `El precio subió ${pct(up)} (tu tope es ${pct(s.maxIncrease)})`, alt: alt() });
      continue;
    }
    lines.push({ productId: it.productId, sellerOrgId: it.sellerOrgId, listingId: own.id, qty: it.qty, unit: it.unit, price: own.price, ok: true });
  }
  const total = r2(sumBy(lines.filter(l => l.ok), l => (l.price ?? 0) * l.qty));
  return { lines, total };
}

/** Plazos de los pedidos programados y de las solicitudes de compra (los usa tick). */
export function r2Deadlines(w: World): { at: number; run: (t: number) => void }[] {
  const out: { at: number; run: (t: number) => void }[] = [];
  for (const id in w.requests) {
    const r = w.requests[id];
    if (r.status === 'OPEN') out.push({ at: r.closesAt, run: (t) => {
      r.status = 'EXPIRED';
      r.closedAt = t;
      const sent = r.offers.filter(x => x.status === 'SENT');
      for (const x of sent) { x.status = 'REJECTED'; notify({ w, t }, x.sellerOrgId, 'ORDER', 'Solicitud vencida', `${r.code} venció sin que el negocio eligiera una oferta.`); }
      notify({ w, t }, r.buyerOrgId, 'ORDER', 'Tu solicitud venció', `${r.code} (${product(r.productId).name.toLowerCase()}) cerró ${sent.length ? `con ${sent.length} ${sent.length === 1 ? 'oferta' : 'ofertas'} sin elegir` : 'sin ofertas'}. Puedes publicar otra.`, { screen: 'B-17', params: { id: r.id } });
    } });
  }
  for (const id in w.schedules) {
    const s = w.schedules[id];
    if (s.draft && s.draft.status === 'PENDING') {
      const d = s.draft;
      out.push({ at: draftExpiresAt(d.deliveryDate), run: (t) => {
        d.status = 'EXPIRED';
        s.history.push({ at: t, text: `No se aprobó a tiempo la entrega del ${dateShort(d.deliveryDate)}` });
        notify({ w, t }, s.buyerOrgId, 'ORDER', 'Pedido programado sin aprobar', `${s.name}: la entrega del ${dateShort(d.deliveryDate)} no se pidió porque nadie la aprobó.`, { screen: 'B-22', params: { id: s.id } });
      } });
    } else if (s.active) {
      out.push({ at: scheduleRunAt(s), run: (t) => {
        const buyer = w.orgs[s.buyerOrgId];
        const delivery = s.nextDelivery;
        s.nextDelivery = delivery + FREQ_DAYS[s.frequency] * DAY;
        if (!isPro(buyer) || buyer?.status !== 'ACTIVE') {
          s.active = false;
          s.history.push({ at: t, text: 'Se pausó: los pedidos programados son del plan Pro' });
          return;
        }
        const { lines, total } = buildDraft(w, s, t);
        s.draft = { at: t, deliveryDate: delivery, lines, total, status: 'PENDING' };
        const okN = lines.filter(l => l.ok).length;
        notify({ w, t }, s.buyerOrgId, 'ORDER', 'Pedido programado por aprobar',
          okN === lines.length
            ? `${s.name} para el ${dateShort(delivery)}: ${money(total)} aprox. Apruébalo hasta la víspera a las 18:00.`
            : `${s.name} para el ${dateShort(delivery)}: ${lines.length - okN} de ${lines.length} productos no se pueden pedir solos (precio o stock). Revísalo.`,
          { screen: 'B-22', params: { id: s.id } });
      } });
    }
  }
  return out;
}

/** Aprobar el borrador lo convierte en pedido(s), uno por agricultor, con las reglas de siempre. */
on('SCHEDULE_APPROVE', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const s = must(w.schedules[String(p.scheduleId)], 'NOT_FOUND', 'No encontramos ese pedido programado.');
  if (s.buyerOrgId !== c.a.orgId) fail('FORBIDDEN', 'Ese pedido programado es de otro negocio.');
  const d = s.draft;
  if (!d || d.status !== 'PENDING') fail('STATE', 'No hay un pedido por aprobar.');
  const useAlt: Record<string, boolean> = p.useAlt ?? {};
  const chosen: { sellerOrgId: string; listingId: string; qty: number }[] = [];
  d.lines.forEach((l, i) => {
    if (l.ok && l.listingId) chosen.push({ sellerOrgId: l.sellerOrgId, listingId: l.listingId, qty: l.qty });
    else if (!l.ok && l.alt && useAlt[String(i)]) chosen.push({ sellerOrgId: l.alt.sellerOrgId, listingId: l.alt.listingId, qty: l.qty });
  });
  if (!chosen.length) fail('EMPTY', 'No hay productos que se puedan pedir: elige un reemplazo o salta esta entrega.');
  const sellers = [...new Set(chosen.map(x => x.sellerOrgId))];
  const ids: string[] = Array.isArray(p.subOrderIds) ? p.subOrderIds.map(String) : [];
  if (ids.length < sellers.length || ids.some(x => !/^[A-Za-z0-9:_.-]{4,80}$/.test(x))) fail('BAD_ID', 'Faltan identificadores para los pedidos.');
  const orderId = String(p.orderId ?? '');
  if (!/^[A-Za-z0-9:_.-]{4,80}$/.test(orderId)) fail('BAD_ID', 'Identificador de pedido no válido.');
  const buyer = getOrg(w, s.buyerOrgId);
  const loc = localOf(buyer, s.localId);
  const subs = sellers.map((sid, i) => ({
    subOrderId: ids[i], sellerOrgId: sid, items: chosen.filter(x => x.sellerOrgId === sid).map(x => ({ listingId: x.listingId, qty: x.qty })),
    deliveryMode: p.deliveryMode ?? s.deliveryMode, deliveryDate: d.deliveryDate, slot: s.slot, taxDoc: p.taxDoc?.[sid] ?? s.taxDoc, payMethod: p.payMethod?.[sid] ?? s.payMethod,
    shipmentId: (p.deliveryMode ?? s.deliveryMode) === 'CARRIER' ? `${ids[i]}-env` : undefined,
  }));
  const inner: Ctx = { ...c, e: { ...c.e, p: { orderId, address: loc?.address ?? buyer.address, district: loc?.district ?? buyer.district, secrets: p.secrets, upgrade: p.upgrade, subs } } };
  const res = HANDLERS.ORDER_PLACE(inner);
  c.n = inner.n;
  d.status = 'APPROVED';
  d.orderId = orderId;
  s.history.push({ at: t, text: `Aprobado para el ${dateShort(d.deliveryDate)} · ${subs.length} ${subs.length === 1 ? 'pedido' : 'pedidos'}`, orderId });
  audit(c, c.a.id, 'SCHEDULE_APPROVE', s.id, `${s.code}: aprobado para el ${dateShort(d.deliveryDate)}`);
  return { ...(res ?? {}), orderId, subOrderIds: subs.map(x => x.subOrderId) };
});

/* ======================= Equipo, locales y quién publica por mí ======================= */

function requirePlanSeats(w: World, o: Org) {
  const plan = o.subscription ? w.settings.plans[o.subscription.plan] : undefined;
  const max = plan?.users ?? null;
  const used = 1 + (o.members ?? []).length;
  if (max !== null && used >= (max ?? 1)) fail('PLAN_USERS', max === 1 ? 'Tu plan Básico es para 1 usuario. Con Pro invitas hasta 5 personas.' : `Tu plan permite ${max} usuarios y ya tienes ${used}.`);
}

function newMemberUser(c: Ctx, o: Org, p: any, role: User['role']): User {
  const { w, t } = c;
  const userId = String(p.userId ?? '');
  if (!/^[A-Za-z0-9:_.-]{4,80}$/.test(userId) || w.users[userId]) fail('BAD_ID', 'Identificador no válido.');
  const phone = String(p.phone ?? '').replace(/\s/g, '');
  if (!isPhoneValid(phone)) fail('BAD_PHONE', 'Ese número no parece correcto (9 dígitos, empieza con 9).');
  if (Object.values(w.users).some(u => u.phone === phone)) fail('PHONE_TAKEN', 'Ese celular ya tiene una cuenta en Mesagri.');
  const name = String(p.name ?? '').trim();
  if (name.length < 3) fail('BAD_NAME', 'Escribe el nombre completo.');
  const u: User = { id: userId, name: name.slice(0, 80), shortName: name.split(' ')[0], phone, role, orgId: o.id, createdAt: t, prefs: defaultPrefs(p.lang ?? 'es'), status: 'ACTIVE' };
  w.users[userId] = u;
  o.memberIds.push(userId);
  return u;
}

on('TEAM_ADD', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  if (o.type !== 'BUYER') fail('FORBIDDEN', 'El equipo es para las cuentas de MYPE.');
  requireActive(o);
  if (!isPro(o)) fail('PRO_ONLY', 'Con el plan Pro invitas hasta 5 personas (cocina, caja o compras).');
  requirePlanSeats(w, o);
  const perms = ((p.perms ?? []) as string[]).filter(x => ['PEDIR', 'APROBAR', 'PAGAR'].includes(x)) as MemberPerm[];
  if (!perms.length) fail('BAD_PERMS', 'Elige al menos un permiso.');
  const u = newMemberUser(c, o, p, 'BUYER');
  (o.members ??= []).push({ userId: u.id, kind: 'EQUIPO', perms, active: true, addedAt: t, addedBy: c.a.id, note: p.note ? String(p.note).trim().slice(0, 40) : undefined });
  notify(c, o.id, 'SYSTEM', 'Nueva persona en tu equipo', `${u.name} ya puede entrar a Mesagri con su celular (${perms.map(x => PERM_LABEL[x]).join(', ')}).`, { screen: 'B-23' });
  audit(c, c.a.id, 'TEAM_ADD', o.id, `Invitó a ${u.name} (${perms.join(', ')})`);
  return { userId: u.id };
});

function memberSet(c: Ctx, kinds: OrgMember['kind'][]) {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  const m = must((o.members ?? []).find(x => x.userId === p.userId && kinds.includes(x.kind)), 'NOT_FOUND', 'Esa persona no está en tu cuenta.');
  const u = w.users[m.userId];
  if (Array.isArray(p.perms) && !kinds.includes('CONDUCTOR')) {
    const allowed = kinds.includes('EQUIPO') ? ['PEDIR', 'APROBAR', 'PAGAR'] : ['PUBLICAR', 'PEDIDOS'];
    const perms = (p.perms as string[]).filter(x => allowed.includes(x)) as MemberPerm[];
    if (!perms.length) fail('BAD_PERMS', 'Deja al menos un permiso o quita a la persona.');
    m.perms = perms;
  }
  if (typeof p.active === 'boolean') {
    m.active = p.active;
    if (u) u.status = p.active ? 'ACTIVE' : 'SUSPENDED';
  }
  audit(c, c.a.id, c.e.type, o.id, `${u?.name ?? m.userId}: ${m.active ? 'activo' : 'pausado'} · ${m.perms.join(', ')}`);
  void t;
}
function memberRemove(c: Ctx, kinds: OrgMember['kind'][]) {
  const { w } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  const i = (o.members ?? []).findIndex(x => x.userId === p.userId && kinds.includes(x.kind));
  if (i < 0) fail('NOT_FOUND', 'Esa persona no está en tu cuenta.');
  const [m] = o.members!.splice(i, 1);
  // queda en el historial de la cuenta (memberIds), pero ya no puede entrar ni actuar
  const u = w.users[m.userId];
  if (u) u.status = 'SUSPENDED';
  audit(c, c.a.id, c.e.type, o.id, `Quitó a ${u?.name ?? m.userId}`);
}
on('TEAM_SET', (c) => memberSet(c, ['EQUIPO']));
on('TEAM_REMOVE', (c) => memberRemove(c, ['EQUIPO']));

on('DELEGATE_ADD', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  if (o.type !== 'FARMER') fail('FORBIDDEN', 'Esto es para las cuentas de agricultor.');
  requireActive(o);
  if ((o.members ?? []).filter(m => m.kind !== 'EQUIPO').length >= 3) fail('TOO_MANY', 'Puedes dar permiso hasta a 3 personas.');
  const kind = (p.kind === 'PROMOTOR' ? 'PROMOTOR' : 'FAMILIAR') as OrgMember['kind'];
  const perms = ((p.perms ?? []) as string[]).filter(x => ['PUBLICAR', 'PEDIDOS'].includes(x)) as MemberPerm[];
  if (!perms.length) fail('BAD_PERMS', 'Elige qué puede hacer: publicar, responder pedidos o las dos.');
  const u = newMemberUser(c, o, p, 'FARMER');
  (o.members ??= []).push({ userId: u.id, kind, perms, active: true, addedAt: t, addedBy: c.a.id, note: p.note ? String(p.note).trim().slice(0, 40) : undefined });
  notify(c, o.id, 'SYSTEM', 'Diste permiso a otra persona', `${u.name} (${kind === 'PROMOTOR' ? 'promotor' : 'familiar'}) puede ${perms.map(x => PERM_LABEL[x]).join(' y ')} por ti. Lo que haga queda a su nombre.`, { screen: 'A-28' });
  audit(c, c.a.id, 'DELEGATE_ADD', o.id, `Permiso a ${u.name} (${kind}: ${perms.join(', ')})`);
  return { userId: u.id };
});
on('DELEGATE_SET', (c) => memberSet(c, ['FAMILIAR', 'PROMOTOR']));
on('DELEGATE_REMOVE', (c) => memberRemove(c, ['FAMILIAR', 'PROMOTOR']));

/* ---------- Transportista: otro conductor y cambio de vehículo (T-19) ---------- */
on('DRIVER_ADD', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  if (o.type !== 'CARRIER' || !o.carrier) fail('FORBIDDEN', 'Esto es para las cuentas de transportista.');
  requireActive(o);
  if ((o.members ?? []).filter(m => m.kind === 'CONDUCTOR').length >= 2) fail('TOO_MANY', 'Puedes registrar hasta 2 conductores además de ti.');
  const cls = String(p.licenseCls ?? '');
  if (!['B-IIb', 'A-I', 'A-IIb'].includes(cls)) fail('BAD_LICENSE', 'Elige la clase de licencia del conductor.');
  const exp = Number(p.licenseExpires);
  if (!(exp > t + 30 * DAY)) fail('BAD_DATE', 'La licencia debe estar vigente por lo menos un mes más.');
  const u = newMemberUser(c, o, p, 'CARRIER');
  const d = lima(exp);
  (o.members ??= []).push({ userId: u.id, kind: 'CONDUCTOR', perms: [], active: true, addedAt: t, addedBy: c.a.id, note: `Licencia ${cls} · vence ${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}` });
  notify(c, 'ADMIN', 'VERIFICATION', 'Conductor nuevo por revisar', `${o.name}: ${u.name} (licencia ${cls}). Se verifica en la próxima revisión.`, { screen: 'W-16' });
  audit(c, c.a.id, 'DRIVER_ADD', o.id, `Conductor ${u.name} · licencia ${cls}`);
  return { userId: u.id };
});
on('DRIVER_SET', (c) => memberSet(c, ['CONDUCTOR']));
on('DRIVER_REMOVE', (c) => memberRemove(c, ['CONDUCTOR']));

/** Vehículo nuevo: vuelve a revisión (RN-52) y no recibe ofertas hasta pasarla. */
on('VEHICLE_CHANGE', (c: Ctx) => {
  const { w, t } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  const info = o.carrier;
  if (o.type !== 'CARRIER' || !info) fail('FORBIDDEN', 'Esto es para las cuentas de transportista.');
  const vclass = String(p.vclass ?? '') as 'V1' | 'V2' | 'V3';
  if (!['V1', 'V2', 'V3'].includes(vclass)) fail('BAD_VEHICLE', 'Mesagri solo admite moto con cajuela, camioneta o furgón y camión ligero (RN-53).');
  const plate = String(p.plate ?? '').toUpperCase();
  if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(plate)) fail('BAD_PLATE', 'Escribe la placa como V7K-812.');
  const norm = plate.replace('-', '');
  if (Object.values(w.orgs).some(x => x.id !== o.id && x.carrier && x.carrier.vehicle.plate.replace('-', '') === norm)) fail('PLATE_TAKEN', 'Esa placa ya está registrada en Mesagri (RN-18).');
  if (info.vehicle.plate.replace('-', '') === norm) fail('SAME', 'Es el mismo vehículo que ya tienes.');
  const payload = Math.round(Number(p.payloadKg));
  const max = vclass === 'V1' ? 250 : vclass === 'V2' ? 3500 : 6000;
  if (!(payload >= 50 && payload <= max)) fail('BAD_PAYLOAD', `La carga útil de esa clase va hasta ${max} kg.`);
  const year = Math.round(Number(p.year));
  const yNow = lima(t).y;
  if (!(year >= yNow - 25 && year <= yNow + 1)) fail('BAD_YEAR', 'Escribe el año del vehículo (hasta 25 años de antigüedad).');
  const prevPlate = info.vehicle.plate;
  info.vehicle = {
    plate: plate.includes('-') ? plate : `${plate.slice(0, 3)}-${plate.slice(3)}`, vclass, category: vclass === 'V1' ? 'L3' : vclass === 'V2' ? 'N1' : 'N2',
    body: String(p.body ?? '').trim().slice(0, 60) || (vclass === 'V1' ? 'Moto con cajuela' : vclass === 'V2' ? 'Furgón' : 'Camión ligero'),
    payloadKg: payload, year,
    docs: info.vehicle.docs.map(d => ({ ...d, status: d.kind === 'LICENCIA' ? d.status : 'PENDING', note: d.kind === 'LICENCIA' ? d.note : 'Por revisar con el vehículo nuevo' })),
  };
  info.inspection = undefined;
  info.available = false;
  if (info.level === 'T2' || info.level === 'T3') info.level = 'T1';
  const caseId = `${c.e.id}-case`;
  if (!w.cases[caseId]) {
    w.cases[caseId] = {
      id: caseId, orgId: o.id, kind: 'CARRIER', targetLevel: 2, status: 'SUBMITTED', submittedAt: t,
      evidence: [{ key: 'vehiculo', label: `Vehículo nuevo ${info.vehicle.plate} (${info.vehicle.body}, ${payload} kg, ${year})` }, { key: 'docs', label: 'SOAT, CITV y tarjeta de propiedad del vehículo nuevo' }],
      alerts: [`Cambió de vehículo: antes ${prevPlate}`], history: [{ at: t, by: c.a.id, text: 'Cambio de vehículo: pide revisión' }],
    };
  }
  notify(c, 'ADMIN', 'VERIFICATION', 'Cambio de vehículo', `${o.name}: ${prevPlate} → ${info.vehicle.plate}. Agenda la revisión (RN-52).`, { screen: 'W-16' });
  notify(c, o.id, 'VERIFICATION', 'Vehículo en revisión', `Registramos ${info.vehicle.plate}. Hasta la revisión no recibes ofertas de envío.`, { screen: 'T-19' });
  audit(c, c.a.id, 'VEHICLE_CHANGE', o.id, `${prevPlate} → ${info.vehicle.plate} (${vclass})`);
  return { caseId };
});

on('LOCAL_SAVE', (c: Ctx) => {
  const { w } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  if (o.type !== 'BUYER') fail('FORBIDDEN', 'Los locales son de las cuentas de MYPE.');
  const x = p.local ?? {};
  const id = String(x.id ?? '');
  if (!/^[A-Za-z0-9:_.-]{2,80}$/.test(id)) fail('BAD_ID', 'Identificador no válido.');
  const name = String(x.name ?? '').trim();
  if (name.length < 2) fail('BAD_NAME', 'Ponle un nombre al local.');
  const district = String(x.district ?? '');
  if (!DISTRICT_BY_CODE[district]) fail('BAD_DISTRICT', 'Elige el distrito del local.');
  const address = String(x.address ?? '').trim();
  if (address.length < 5) fail('BAD_ADDRESS', 'Escribe la dirección donde reciben.');
  const receiver = String(x.receiver ?? '').trim();
  if (receiver.length < 3) fail('BAD_RECEIVER', 'Escribe quién recibe.');
  const days = [...new Set(((x.days ?? []) as any[]).map(Number).filter(d => d >= 1 && d <= 7))].sort();
  const list = (o.locales ??= o.address ? [{ id: 'principal', name: 'Local principal', district: o.district, address: o.address, receiver: o.receiver ?? '', days: [1, 2, 3, 4, 5, 6], isDefault: true }] : []);
  const cur = list.find(l => l.id === id);
  if (!cur) {
    const plan = o.subscription ? w.settings.plans[o.subscription.plan] : undefined;
    const max = plan?.locations ?? null;
    if (max !== null && list.length >= (max ?? 1)) fail('PLAN_LOCALES', (max ?? 1) === 1 ? 'Tu plan Básico es para 1 local. Con Pro tienes hasta 3.' : `Tu plan permite ${max} locales.`);
  }
  const isDefault = !!x.isDefault || !list.length || (cur?.isDefault ?? false);
  const next: Local = { id, name: name.slice(0, 60), district, address: address.slice(0, 200), receiver: receiver.slice(0, 80), days: days.length ? days : [1, 2, 3, 4, 5, 6], isDefault };
  if (cur) Object.assign(cur, next); else list.push(next);
  if (isDefault) for (const l of list) l.isDefault = l.id === id;
  const def = list.find(l => l.isDefault)!;
  o.address = def.address;
  o.receiver = def.receiver;
  audit(c, c.a.id, 'LOCAL_SAVE', o.id, `${cur ? 'Editó' : 'Agregó'} el local «${next.name}» (${districtName(district)})`);
  return { localId: id };
});

on('LOCAL_REMOVE', (c: Ctx) => {
  const { w } = c;
  const p = c.e.p ?? {};
  const o = getOrg(w, c.a.orgId);
  const list = o.locales ?? [];
  const l = must(list.find(x => x.id === p.localId), 'NOT_FOUND', 'No encontramos ese local.');
  if (l.isDefault) fail('DEFAULT_LOCAL', 'Ese es tu local principal: elige otro como principal antes de quitarlo.');
  o.locales = list.filter(x => x.id !== l.id);
  for (const s of Object.values(w.schedules)) if (s.buyerOrgId === o.id && s.localId === l.id) s.localId = undefined;
  audit(c, c.a.id, 'LOCAL_REMOVE', o.id, `Quitó el local «${l.name}»`);
});

/* ======================= Panel: restablecer el acceso de una cuenta (W-05) ======================= */
on('ACCESS_RESET', (c: Ctx) => {
  const { w } = c;
  requireAdmin(c.a, 'GENERAL', 'SUPPORT');
  const o = getOrg(w, String(c.e.p?.orgId ?? ''));
  const reason = String(c.e.p?.reason ?? 'Pedido de la cuenta').trim().slice(0, 200);
  notify(c, o.id, 'SYSTEM', 'Cerramos tus sesiones', 'Por seguridad, el equipo de Mesagri cerró tus sesiones abiertas. Vuelve a entrar con tu celular y el código que te llega.');
  audit(c, c.a.id, 'RESTABLECER ACCESO', o.id, `${o.name}: ${reason}`);
});

/* ======================= Catálogo maestro: producto nuevo (W-09) ======================= */

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36);

on('CATALOG_ADD', (c: Ctx) => {
  const { w } = c;
  requireAdmin(c.a, 'GENERAL');
  const p = c.e.p ?? {};
  const name = String(p.name ?? '').trim();
  if (name.length < 3 || name.length > 60) fail('BAD_NAME', 'Escribe el nombre del producto (3 a 60 letras).');
  const id = slug(String(p.id ?? name));
  if (!id || PRODUCT_BY_ID[id] || w.catalogExtra[id]) fail('DUPLICATE', 'Ya existe un producto con ese nombre.');
  const cats = ['TUBERCULOS', 'HORTALIZAS', 'GRANOS', 'MENESTRAS', 'FRUTOS'];
  const category = String(p.category ?? '');
  if (!cats.includes(category)) fail('BAD_CATEGORY', 'Elige la categoría.');
  const units = ((p.units ?? ['kg']) as string[]).filter(u => ['kg', 'saco', 'arroba', 'jaba', 'atado'].includes(u));
  if (!units.length) units.push('kg');
  const chacra = Number(p.chacra), mayorista = Number(p.mayorista);
  if (!(chacra > 0 && mayorista >= chacra && mayorista < 500)) fail('BAD_PRICE', 'Los precios de referencia: chacra mayor que 0 y mayorista igual o mayor.');
  const perishDays = Math.round(Number(p.perishDays) || 15);
  if (perishDays < 2 || perishDays > 365) fail('BAD_DAYS', 'La vigencia de la publicación va de 2 a 365 días.');
  const synonyms = [...new Set([name.toLowerCase(), ...((p.synonyms ?? []) as string[]).map(x => String(x).trim().toLowerCase()).filter(Boolean)])].slice(0, 12);
  const color = /^#[0-9A-Fa-f]{6}$/.test(String(p.color)) ? String(p.color) : '#5B6B57';
  const prod: Product = {
    id, name, short: name, letter: name[0].toUpperCase(), color, category: category as Product['category'], units: units as Product['units'],
    sackKg: Math.max(1, Number(p.sackKg) || 50), perishDays, yieldHigh: Math.max(0.5, Number(p.yieldHigh) || 10),
    ref: { chacra: r2(chacra), mayorista: r2(mayorista), source: String(p.source ?? 'Referencia del equipo de Mesagri').slice(0, 120) },
    storable: !!p.storable, merma: p.storable ? 'GRANO' : 'NO', synonyms,
  };
  w.catalogExtra[id] = prod;
  registerProducts([prod]);
  audit(c, c.a.id, 'CATALOG_ADD', id, `Producto nuevo: ${name} (${category.toLowerCase()})`);
  return { productId: id };
});

void startOfDay; void HOUR;
