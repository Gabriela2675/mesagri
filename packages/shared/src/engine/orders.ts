/*
 * Pedidos, pagos directos con constancia, entrega con código, conformidad, disputas,
 * calificaciones, chat y Libro de Reclamaciones.
 * 6.5, 6.6, 6.7 · CU-26, CU-08, CU-27, CU-29 · RN-04, RN-07 a RN-12, RN-14, RN-15, RN-17, RN-20, RN-24, RN-27, RN-28, RN-34 a RN-36.
 */
import type { SubOrder, SubItem, Order, Shipment, Dispute, Review, World, Org } from '../types';
import { on, fail, audit, notify, requireMember, requireAdmin, requireActive, getOrg, getSub, must, setStatus, nextSeq, Ctx } from './core';
import { buyerLimit, farmerLimit, cashCheck, digitalMethods, taxDocsFor, TAXDOC_LABEL, commissionPreview, freightFor, routeFor, r2, sumBy, PLAN_ORDER } from '../rules';
import { monthPurchases, monthSales, reservedFreeSlots, farmerServes, farmerFee, visibleListing, isDead, sellerProvince } from '../queries';
import { product } from '../catalog';
import { codeFrom, digitsFrom, pad, secretOr, codeMatches, CODE_SALT } from '../ids';
import { HOUR, MIN, DAY, atHour, startOfDay, endOfDay, addBusinessDays, periodOf } from '../time';
import { money, kg as fkg, dateShort } from '../format';
import { provinceOf } from '../ubigeo';
import { validQty } from './listings';
import { offerNext } from './shipping';

/* ---------- Ayudas de stock ---------- */
export function releaseStock(w: World, s: SubOrder, t: number, ref: string) {
  for (const it of s.items) {
    const l = w.listings[it.listingId];
    if (!l) continue;
    l.reserved = Math.max(0, r3(l.reserved - it.qty));
    l.available = r3(l.available + it.qty);
    w.movements.push({ at: t, listingId: l.id, kind: 'RELEASE', qty: it.qty, ref });
    if (l.status === 'SOLD_OUT' && l.available > 0 && l.expiresAt > t) l.status = 'ACTIVE';
    // una venta por solicitud de compra no vuelve al catálogo si el pedido no sigue
    if (l.requestId) { l.status = 'REMOVED'; l.available = 0; }
  }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function consumeStock(w: World, s: SubOrder, t: number, ref: string) {
  for (const it of s.items) {
    const l = w.listings[it.listingId];
    if (!l) continue;
    l.reserved = Math.max(0, r3(l.reserved - it.qty));
    l.sold = r3(l.sold + it.qty);
    w.movements.push({ at: t, listingId: l.id, kind: 'CONSUME', qty: it.qty, ref });
  }
}

export function itemsLabel(s: { items: SubItem[] }): string {
  return s.items.map(i => `${product(i.productId).name.toLowerCase()} ${fkg(i.qty * i.unitKg)}`).join(', ');
}

/** Pasa el sub-pedido a «entregado» (RN-07: el stock se consume al entregar). */
export function deliverSub(c: { w: World; t: number; e?: any; n?: number }, s: SubOrder, by: string, photoId?: string) {
  setStatus(s, 'DELIVERED', c.t, by);
  s.deliveredAt = c.t;
  s.deliveryPhotoId = photoId ?? s.deliveryPhotoId;
  consumeStock(c.w, s, c.t, `deliver:${s.id}`);
  s.onTime = c.t <= endOfDay(s.deliveryDate);
  const seller = c.w.orgs[s.sellerOrgId];
  if (seller && s.deliveryMode !== 'CARRIER') { seller.counters.deliveries++; if (s.onTime) seller.counters.onTime++; }
  notify(c as any, s.buyerOrgId, 'DELIVERY', 'Tu pedido llegó', `${s.code}: revisa y confirma en 48 h. Si no respondes, se da por conforme (RN-11).`, { screen: 'B-15', params: { id: s.id } });
  notify(c as any, s.sellerOrgId, 'DELIVERY', 'Entrega registrada', `${s.code} entregado. Esperamos la conformidad del comprador.`);
}

/** Completa la venta y calcula la comisión con las 5 ventas sin comisión (RN-14, corrige D-01). */
export function completeSub(c: { w: World; t: number; e?: any; n?: number }, s: SubOrder, saleAmount: number, by: string, note?: string) {
  const w = c.w;
  const seller = w.orgs[s.sellerOrgId];
  const buyer = w.orgs[s.buyerOrgId];
  const free = w.settings.commission.freeSales;
  let isFree = false, bonus = false;
  if (s.freeSlotReserved) isFree = true;
  else if (seller.counters.freeSalesUsed + reservedFreeSlots(w, seller.id) < free) { isFree = true; bonus = true; }
  seller.counters.completedSales++;
  if (isFree) seller.counters.freeSalesUsed++;
  s.saleNumber = seller.counters.completedSales;
  s.freeSlotReserved = false;
  s.saleAmount = r2(saleAmount);
  s.commission = isFree ? 0 : r2(s.saleAmount * s.commissionRate);
  s.freeSaleBonus = bonus;
  s.completedAt = c.t;
  setStatus(s, 'COMPLETED', c.t, by, note);
  if (buyer) buyer.counters.completedPurchases++;
  const p = periodOf(c.t);
  w.monthlyGmv[p] = r2((w.monthlyGmv[p] ?? 0) + s.saleAmount);
  const left = Math.max(0, free - seller.counters.freeSalesUsed);
  notify(c as any, seller.id, 'ORDER', 'Venta conforme', isFree
    ? `${s.code}: venta ${s.saleNumber}, sin comisión${bonus ? ' (se liberó un cupo)' : ''}. Te quedan ${left} ventas sin comisión.`
    : `${s.code}: venta ${s.saleNumber}. Comisión de ${Math.round(s.commissionRate * 100)} %: ${money(s.commission)} en tu estado de cuenta.`, { screen: 'A-13', params: { id: s.id } });
  notify(c as any, s.buyerOrgId, 'REVIEW', 'Califica tu compra', `¿Cómo te fue con ${seller.name}? Tu opinión se publica junto con la suya.`, { screen: 'B-16', params: { id: s.id } });
  notify(c as any, s.sellerOrgId, 'REVIEW', 'Califica al comprador', `¿Cómo te fue con ${buyer?.name}?`, { screen: 'A-13', params: { id: s.id } });
}

function cancelShipment(c: Ctx, s: SubOrder, byBuyer: boolean): number {
  const sh = s.shipmentId ? c.w.shipments[s.shipmentId] : undefined;
  if (!sh || ['DELIVERED', 'CLOSED', 'CANCELLED'].includes(sh.status)) return 0;
  let ff = 0;
  if (sh.status === 'GOING_TO_PICKUP' && byBuyer) ff = r2(sh.freight * c.w.settings.carrier.falseFreight);
  sh.status = 'CANCELLED';
  sh.falseFreight = ff || undefined;
  sh.cancelReason = byBuyer ? 'El comprador canceló el pedido' : 'El pedido se canceló';
  sh.events.push({ kind: 'CANCELLED', at: c.t, text: ff ? `Cancelado después de salir a recoger: falso flete ${money(ff)} (RN-61)` : 'Envío cancelado sin costo' });
  if (sh.carrierOrgId) notify(c, sh.carrierOrgId, 'SHIPMENT', 'Envío cancelado', `${sh.code}: ${sh.cancelReason}.${ff ? ` Te corresponde ${money(ff)} de falso flete.` : ''}`);
  return ff;
}

/* ---------- Checkout transaccional (RF-ORD-03, CU-26) ---------- */
on('ORDER_PLACE', (c) => {
  const { w, t } = c;
  const p = c.e.p;
  const buyer = getOrg(w, c.a.orgId);
  if (buyer.type !== 'BUYER') fail('FORBIDDEN', 'Solo los compradores hacen pedidos.');
  requireActive(buyer);
  if (buyer.level < 1) fail('LEVEL0', buyer.ruc && w.padron[buyer.ruc]?.condicion === 'NO HABIDO'
    ? 'Tu RUC figura como no habido en la SUNAT: no puedes hacer pedidos nuevos hasta regularizarlo (RN-19). Tus pedidos en curso continúan.'
    : 'Primero verificamos tu negocio (nivel 1): RUC activo y habido y el DNI del representante (RN-02).');
  const sub0 = buyer.subscription;
  if (!sub0 || sub0.status === 'INACTIVE') fail('NO_MEMBERSHIP', 'Tu membresía no está activa: paga tu plan para confirmar pedidos. Tu historial y tus datos siguen guardados (RN-35).');
  if (w.orders[p.orderId]) fail('DUPLICATE', 'Este pedido ya se envió.');
  const subsIn = (p.subs ?? []) as any[];
  if (!subsIn.length) fail('EMPTY', 'Tu carrito está vacío.');
  const district = String(p.district ?? buyer.district);
  const buyerProv = provinceOf(district) ?? 'AREQUIPA';
  const blim = buyerLimit(w.settings, buyer.level);

  // 1) validar todo sin tocar nada
  const plan: { so: SubOrder; sh?: Shipment; lines: { l: any; qty: number }[] }[] = [];
  const usedListing = new Set<string>();
  for (const si of subsIn) {
    const sec = (p.secrets ?? {})[String(si.subOrderId)] ?? {};
    const seller = getOrg(w, si.sellerOrgId);
    if (seller.type !== 'FARMER') fail('BAD_SELLER', 'Ese vendedor no es agricultor.');
    if (seller.status !== 'ACTIVE' || seller.level < 1) fail('SELLER_UNAVAILABLE', `${seller.name} no puede recibir pedidos ahora.`);
    const items: SubItem[] = [];
    const lines: { l: any; qty: number }[] = [];
    for (const it of si.items ?? []) {
      const l = must(w.listings[it.listingId], 'NOT_FOUND', 'Un producto ya no está publicado.');
      if (l.orgId !== seller.id) fail('BAD_ITEM', 'Un producto no corresponde a ese agricultor.');
      if (usedListing.has(l.id)) fail('BAD_ITEM', 'Un producto aparece dos veces.');
      usedListing.add(l.id);
      const name = product(l.productId).name + (l.variety ? ` ${l.variety}` : '');
      if (!visibleListing(w, l, t)) fail('UNAVAILABLE', `${name} ya no está disponible.`, { listingId: l.id });
      if (l.requestId && p.fromRequest !== l.requestId) fail('UNAVAILABLE', `${name} es parte de una solicitud de compra de otro negocio.`, { listingId: l.id });
      const qty = Number(it.qty);
      if (!validQty(l.unit, qty)) fail('BAD_QTY', `Revisa la cantidad de ${name}.`, { listingId: l.id });
      if (l.minQty && qty < l.minQty) fail('MIN_QTY', `El mínimo de ${name} es ${l.minQty} ${l.unit}.`, { listingId: l.id });
      if (qty > l.available + 1e-9) fail('STOCK', `Solo quedan ${l.available} ${l.unit === 'kg' ? 'kg' : l.unit} de ${name}.`, { listingId: l.id, available: l.available });
      const subtotal = r2(qty * l.price);
      items.push({ listingId: l.id, productId: l.productId, name, unit: l.unit, unitKg: l.unitKg, qty, price: l.price, subtotal });
      lines.push({ l, qty });
    }
    if (!items.length) fail('EMPTY', `El pedido a ${seller.name} no tiene productos.`);
    const subtotal = r2(sumBy(items, i => i.subtotal));
    const mode = si.deliveryMode as SubOrder['deliveryMode'];
    let fee = 0;
    if (mode === 'FARMER') {
      if (!farmerServes(seller, district)) fail('ZONE', `${seller.name} no entrega en tu distrito (RN-27). Elige recojo o transportista aliado.`, { sellerOrgId: seller.id });
      fee = farmerFee(seller, district);
    } else if (mode !== 'PICKUP' && mode !== 'CARRIER') fail('BAD_MODE', 'Elige cómo recibes el pedido.');
    const total = r2(subtotal + fee);
    const allowedDocs = taxDocsFor(seller);
    if (!allowedDocs.includes(si.taxDoc)) {
      fail('TAXDOC', seller.taxRegime === 'NRUS'
        ? `${seller.name} está en el Nuevo RUS: solo puede darte boleta (RN-34). Elige boleta u otro agricultor.`
        : `${seller.name} todavía no tiene RUC: el comprobante es la liquidación de compra que emites tú en la SUNAT (RN-34).`, { sellerOrgId: seller.id });
    }
    const pm = si.payMethod as SubOrder['payment']['method'];
    if (pm === 'CASH') {
      const cc = cashCheck(w.settings, total, buyer, seller);
      if (!cc.ok) fail('CASH', cc.reason!, { sellerOrgId: seller.id });
    } else if (!digitalMethods(seller).includes(pm as any)) {
      fail('PAY_METHOD', `${seller.name} no recibe ${pm === 'TRANSFER' ? 'transferencias' : pm === 'YAPE' ? 'Yape' : 'Plin'}. ${seller.acceptsCash ? 'Acepta efectivo al entregar.' : ''}`, { sellerOrgId: seller.id });
    }
    const slim = farmerLimit(w.settings, seller.level);
    if (subtotal > slim.perOrder) fail('SELLER_CAP', `${seller.name} puede recibir pedidos de hasta ${money(slim.perOrder)} por su nivel. Divide el pedido.`, { sellerOrgId: seller.id });
    if (slim.monthly !== null && monthSales(w, seller.id, t) + subtotal > slim.monthly) fail('SELLER_MONTH', `${seller.name} llegó a su tope de ventas del mes por su nivel.`, { sellerOrgId: seller.id });
    const ddate = Number(si.deliveryDate) || t + DAY;
    if (endOfDay(ddate) < t) fail('BAD_DATE', 'La fecha de entrega ya pasó.');
    let sh: Shipment | undefined;
    if (mode === 'CARRIER') {
      const route = routeFor(w.settings, sellerProvince(w, seller.id), buyerProv);
      if (!route) fail('NO_ROUTE', 'Todavía no hay transportistas aliados en esa ruta. Elige recojo o envío del agricultor.');
      const kgTotal = r2(sumBy(items, i => i.qty * i.unitKg));
      const fr = freightFor(route, kgTotal);
      const sacks = Math.max(1, Math.round(sumBy(items, i => (i.unit === 'saco' ? i.qty : (i.qty * i.unitKg) / 50))));
      const city = route.scope === 'CIUDAD';
      sh = {
        id: String(si.shipmentId || `${si.subOrderId}-env`), code: '', subOrderId: String(si.subOrderId), buyerOrgId: buyer.id, sellerOrgId: seller.id, routeId: route.id,
        scope: route.scope, originLabel: seller.pickupPoint || seller.district, destLabel: district, distanceKm: route.distanceKm,
        weightKg: kgTotal, sacks, cargoValue: subtotal, freight: fr.freight, commissionRate: w.settings.carrier.commission,
        preferredCarrier: si.preferredCarrier || undefined, status: 'WAITING_FARMER', requestedAt: t, offers: [],
        pickupAt: atHour(ddate, city ? 9 : 14, city ? 0 : 20), deliverFrom: atHour(ddate, city ? 10 : 18), deliverTo: atHour(ddate, city ? 12 : 19, city ? 0 : 30),
        events: [{ kind: 'REQUESTED', at: t, text: `Envío pedido · flete congelado en ${money(fr.freight)} (RN-54)` }], incidents: [],
      };
    }
    const so: SubOrder = {
      id: String(si.subOrderId), code: 'CAMP-' + codeFrom(String(si.subOrderId), 6), orderId: p.orderId, buyerOrgId: buyer.id, sellerOrgId: seller.id,
      buyerUserId: c.a.id, items, subtotal, deliveryMode: mode, deliveryFee: fee, total, deliveryDate: startOfDay(ddate), slot: String(si.slot ?? '7:00 a 9:00'),
      address: String(p.address ?? buyer.address ?? ''), district, taxDoc: si.taxDoc, prepay: blim.prepay, status: 'PENDING_CONFIRMATION',
      history: [], createdAt: t, confirmBy: t + w.settings.orderResponseHours * HOUR,
      deliveryCode: secretOr(sec.delivery, /^\d{4}$/, () => digitsFrom(String(si.subOrderId) + ':entrega')),
      pickupCode: mode === 'PICKUP' ? secretOr(sec.pickup, /^\d{4}$/, () => digitsFrom(String(si.subOrderId) + ':recojo')) : undefined,
      pickupQr: 'QR-' + secretOr(sec.qr, /^[A-Z0-9]{8}$/, () => codeFrom(String(si.subOrderId) + ':qr', 8)),
      codeTries: 0, payment: { status: 'NONE', method: pm }, commissionRate: w.settings.commission.rate, freeSlotReserved: false,
      shipmentId: sh?.id, fromLot: items.some(i => !!w.listings[i.listingId]?.fromLotId),
    };
    if (w.subOrders[so.id]) fail('DUPLICATE', 'Este pedido ya se envió.');
    plan.push({ so, sh, lines });
  }
  const orderTotal = r2(sumBy(plan, x => x.so.subtotal));
  if (orderTotal > blim.perOrder) fail('BUYER_CAP_ORDER', `Con el nivel ${buyer.level} tu tope por pedido es ${money(blim.perOrder)}. ${buyer.level < 2 ? 'Con la licencia y la foto del local pasas al nivel 2: hasta S/ 8 000.' : ''}`);
  const month = monthPurchases(w, buyer.id, t);
  if (blim.monthly !== null && month + orderTotal > blim.monthly) fail('BUYER_CAP_MONTH', `Con el nivel ${buyer.level} puedes comprar hasta ${money(blim.monthly)} al mes. Llevas ${money(month)}.`);
  // límite del plan (RN-36, RF-SUB-05)
  const planDef = w.settings.plans[sub0.plan];
  const would = r2(month + orderTotal);
  let upgradeTo: 'PRO' | 'EMPRESA' | undefined;
  if (planDef.purchaseCap !== null && would > planDef.purchaseCap) {
    const next = (would <= (w.settings.plans.PRO.purchaseCap ?? Infinity) ? 'PRO' : 'EMPRESA') as 'PRO' | 'EMPRESA';
    const diff = r2(w.settings.plans[next].price - planDef.price);
    const up = p.upgrade;
    if (!up || PLAN_ORDER.indexOf(up.plan) < PLAN_ORDER.indexOf(next)) {
      fail('PLAN_LIMIT', `Este pedido pasa el límite de tu plan ${planDef.name}.`, { month, order: orderTotal, would, cap: planDef.purchaseCap, plan: sub0.plan, next, diff, trial: sub0.status === 'TRIAL' });
    }
    upgradeTo = up.plan;
    if (sub0.status !== 'TRIAL') {
      const op = String(up.operation ?? '').trim();
      if (!/^\d{4,14}$/.test(op)) fail('BAD_OP', 'Escribe el número de operación del pago de la diferencia.');
      if (w.usedOps[`${up.method}:${op}`]) fail('OP_DUPLICATE', 'Ese número de operación ya se usó en otro pago (RF-PAY-05).');
    }
  }

  // 2) aplicar
  if (upgradeTo) applyUpgrade(c, buyer, upgradeTo, p.upgrade);
  const order: Order = { id: p.orderId, buyerOrgId: buyer.id, buyerUserId: c.a.id, createdAt: t, subOrderIds: [], total: orderTotal };
  for (const { so, sh, lines } of plan) {
    for (const { l, qty } of lines) {
      l.available = r3(l.available - qty);
      l.reserved = r3(l.reserved + qty);
      w.movements.push({ at: t, listingId: l.id, kind: 'RESERVE', qty, ref: so.id });
      if (l.available <= 0) l.status = 'SOLD_OUT';
    }
    setStatus(so, 'PENDING_CONFIRMATION', t, c.a.id);
    w.subOrders[so.id] = so;
    order.subOrderIds.push(so.id);
    if (sh) {
      sh.code = 'ENV-' + pad(nextSeq(w, 'shipment', 30), 4);
      w.shipments[sh.id] = sh;
    }
    const seller = w.orgs[so.sellerOrgId];
    notify(c, seller.id, 'ORDER', 'Nuevo pedido', `${buyer.name} · ${itemsLabel(so)} · ${money(so.total)}. Responde en ${w.settings.orderResponseHours} h.`, { screen: 'A-13', params: { id: so.id } });
    w.messages[so.id] = w.messages[so.id] ?? [];
  }
  w.orders[order.id] = order;
  return { orderId: order.id, subOrderIds: order.subOrderIds };
});

export function applyUpgrade(c: Ctx, buyer: Org, to: 'PRO' | 'EMPRESA', pay?: { method: string; operation: string }) {
  const s = buyer.subscription!;
  const from = s.plan;
  const diff = r2(c.w.settings.plans[to].price - c.w.settings.plans[from].price);
  s.plan = to;
  s.monthsBelow = 0;
  s.history.push({ at: c.t, text: `Subió de ${c.w.settings.plans[from].name} a ${c.w.settings.plans[to].name}${s.status === 'TRIAL' ? ' (en el mes gratis)' : ` pagando la diferencia del mes: ${money(diff)}`}` });
  if (s.status !== 'TRIAL' && pay) {
    const id = `inv-${buyer.id}-${periodOf(c.t)}-up-${c.e.id}`;
    c.w.invoices[id] = {
      id, orgId: buyer.id, period: periodOf(c.t), plan: to, concept: `Diferencia ${c.w.settings.plans[from].name} → ${c.w.settings.plans[to].name}`, amount: diff,
      issuedAt: c.t, dueAt: c.t, status: 'PAID', payment: { method: pay.method as any, operation: String(pay.operation), at: c.t },
    };
    c.w.usedOps[`${pay.method}:${pay.operation}`] = id;
  }
  audit(c, c.a.id, 'CAMBIO DE PLAN', buyer.id, `${buyer.name}: ${from} → ${to}`, from, to);
  notify(c, buyer.id, 'BILLING', `Ya tienes el plan ${c.w.settings.plans[to].name}`, `Puedes comprar hasta ${c.w.settings.plans[to].purchaseCap ? money(c.w.settings.plans[to].purchaseCap!) : 'sin tope'} al mes.`);
}

/* ---------- Respuesta del agricultor (CU-08, RF-ORD-04, RN-08) ---------- */
on('SUBORDER_ACCEPT', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  const seller = getOrg(c.w, s.sellerOrgId);
  requireActive(seller);
  if (s.status !== 'PENDING_CONFIRMATION') fail('STATE', s.status === 'EXPIRED' ? 'Este pedido venció: pasaron las 12 horas para responder (RN-08).' : 'Este pedido ya no espera respuesta.');
  const prev = commissionPreview(c.w.settings, seller, reservedFreeSlots(c.w, seller.id), s.subtotal, s.commissionRate);
  s.freeSlotReserved = prev.isFree;
  s.respondedAt = c.t;
  seller.counters.responses++;
  seller.counters.responseMinutesTotal += Math.round((c.t - s.createdAt) / MIN);
  setStatus(s, 'CONFIRMED', c.t, c.a.id);
  const pay = s.payment.method === 'CASH' ? 'Pagas en efectivo al recibir.' : s.prepay ? `Paga ${money(s.total)} por ${s.payment.method === 'TRANSFER' ? 'transferencia' : s.payment.method === 'PLIN' ? 'Plin' : 'Yape'} y sube la constancia: con tu nivel se paga antes de preparar.` : 'Paga directo al agricultor y sube la constancia.';
  notify(c, s.buyerOrgId, 'ORDER', `${seller.name} aceptó tu pedido`, `${s.code} · ${pay}`, { screen: 'B-14', params: { id: s.id } });
  const sh = s.shipmentId ? c.w.shipments[s.shipmentId] : undefined;
  if (sh && sh.status === 'WAITING_FARMER') {
    sh.status = 'OFFERING';
    sh.offeringSince = c.t;
    sh.events.push({ kind: 'OFFERING', at: c.t, text: 'Buscando transportista aliado' });
    offerNext(c, sh, c.t);
  }
});

on('SUBORDER_REJECT', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (s.status !== 'PENDING_CONFIRMATION') fail('STATE', 'Este pedido ya no espera respuesta.');
  const reason = String(c.e.p.reason ?? '').trim();
  if (reason.length < 3) fail('REASON_REQUIRED', 'Elige o escribe el motivo: el comprador lo verá.');
  const seller = getOrg(c.w, s.sellerOrgId);
  s.rejectReason = reason;
  s.respondedAt = c.t;
  seller.counters.responses++;
  seller.counters.responseMinutesTotal += Math.round((c.t - s.createdAt) / MIN);
  setStatus(s, 'REJECTED', c.t, c.a.id, reason);
  releaseStock(c.w, s, c.t, c.e.id);
  cancelShipment(c, s, false);
  notify(c, s.buyerOrgId, 'ORDER', `${seller.name} no pudo aceptar`, `${s.code}: ${reason}. No pagas nada.`, { screen: 'B-14', params: { id: s.id } });
});

/* ---------- Cancelaciones (RN-09, RN-10, RN-61) ---------- */
on('SUBORDER_CANCEL', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.buyerOrgId);
  const reason = String(c.e.p.reason ?? 'Cancelado por el comprador').trim();
  if (['IN_TRANSIT', 'DELIVERED', 'DISPUTED'].includes(s.status)) fail('USE_DISPUTE', 'El pedido ya salió: si hay un problema, repórtalo y Soporte media (RN-09).');
  if (!['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'].includes(s.status)) fail('STATE', 'Este pedido ya no se puede cancelar.');
  const sh = s.shipmentId ? c.w.shipments[s.shipmentId] : undefined;
  if (sh && ['PICKED_UP', 'ARRIVED'].includes(sh.status)) fail('USE_DISPUTE', 'El transportista ya recogió la carga.');
  const late = s.status !== 'PENDING_CONFIRMATION';
  s.cancelReason = reason;
  s.lateCancel = late;
  if (late) c.w.orgs[s.buyerOrgId].counters.lateCancels++;
  setStatus(s, 'CANCELLED_BY_BUYER', c.t, c.a.id, reason);
  releaseStock(c.w, s, c.t, c.e.id);
  const ff = cancelShipment(c, s, true);
  notify(c, s.sellerOrgId, 'ORDER', 'Pedido cancelado', `${c.w.orgs[s.buyerOrgId].name} canceló ${s.code}${late ? ' después de que lo aceptaste: se anota en su reputación' : ''}.${s.payment.status === 'CONFIRMED' ? ' Coordinen la devolución: Mesagri no guarda el dinero.' : ''}`);
  return { falseFreight: ff };
});

on('SUBORDER_SELLER_CANCEL', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (!['CONFIRMED', 'PREPARING', 'READY'].includes(s.status)) fail('STATE', 'Este pedido ya no se puede cancelar.');
  const reason = String(c.e.p.reason ?? '').trim();
  if (reason.length < 3) fail('REASON_REQUIRED', 'Escribe el motivo.');
  const seller = getOrg(c.w, s.sellerOrgId);
  seller.counters.sellerCancels++;
  s.cancelReason = reason;
  setStatus(s, 'CANCELLED_BY_SELLER', c.t, c.a.id, reason);
  releaseStock(c.w, s, c.t, c.e.id);
  cancelShipment(c, s, false);
  notify(c, s.buyerOrgId, 'ORDER', `${seller.name} canceló tu pedido`, `${s.code}: ${reason}.${s.payment.status === 'CONFIRMED' ? ' Coordina la devolución con el agricultor.' : ''}`);
  if (seller.counters.sellerCancels >= 3) notify(c, 'ADMIN', 'SYSTEM', 'Cancelaciones repetidas', `${seller.name} canceló ${seller.counters.sellerCancels} pedidos aceptados (RN-10).`);
});

/* ---------- Preparar y entregar (RF-DEL-03) ---------- */
on('SUBORDER_PREPARE', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (s.status !== 'CONFIRMED') fail('STATE', 'Este pedido no está por preparar.');
  if (s.prepay && s.payment.status !== 'CONFIRMED') fail('PREPAY_PENDING', 'Este comprador paga antes de que prepares (nivel 1). Espera su constancia y confírmala.');
  setStatus(s, 'PREPARING', c.t, c.a.id);
});

on('SUBORDER_READY', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (s.status !== 'PREPARING' && s.status !== 'CONFIRMED') fail('STATE', 'Este pedido no está en preparación.');
  if (s.status === 'CONFIRMED' && s.prepay && s.payment.status !== 'CONFIRMED') fail('PREPAY_PENDING', 'Espera la constancia de pago y confírmala.');
  setStatus(s, 'READY', c.t, c.a.id);
  const sh = s.shipmentId ? c.w.shipments[s.shipmentId] : undefined;
  if (sh?.carrierOrgId) notify(c, sh.carrierOrgId, 'SHIPMENT', 'Carga lista', `${sh.code}: ${c.w.orgs[s.sellerOrgId].name} ya tiene la carga lista.`);
  notify(c, s.buyerOrgId, 'DELIVERY', 'Tu pedido está listo', `${s.code}${s.deliveryMode === 'PICKUP' ? ': ya puedes recogerlo. Lleva tu código de recojo.' : ' sale pronto.'}`);
});

on('SUBORDER_DISPATCH', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (s.deliveryMode !== 'FARMER') fail('STATE', 'Este pedido no lo entregas tú.');
  if (s.status !== 'READY' && s.status !== 'PREPARING') fail('STATE', 'Marca el pedido como listo antes de salir.');
  if (s.prepay && s.payment.status !== 'CONFIRMED') fail('PREPAY_PENDING', 'Espera la constancia de pago y confírmala.');
  setStatus(s, 'IN_TRANSIT', c.t, c.a.id);
  notify(c, s.buyerOrgId, 'DELIVERY', 'Tu pedido va en camino', `${s.code}: dicta tu código de entrega solo cuando tengas el producto.`, { screen: 'B-14', params: { id: s.id } });
});

on('SUBORDER_DELIVER', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  const code = String(c.e.p.code ?? '').trim();
  if (s.deliveryMode === 'CARRIER') fail('USE_CARRIER', 'Este pedido lo entrega el transportista aliado.');
  if (s.deliveryMode === 'FARMER' && !['IN_TRANSIT', 'READY'].includes(s.status)) fail('STATE', 'Este pedido no está en camino.');
  if (s.deliveryMode === 'PICKUP' && s.status !== 'READY') fail('STATE', 'Marca el pedido como listo antes de entregarlo.');
  if (s.prepay && s.payment.status !== 'CONFIRMED') fail('PREPAY_PENDING', 'Este pedido se paga antes de la entrega.');
  const expected = s.deliveryMode === 'PICKUP' ? s.pickupCode : s.deliveryCode;
  if (!codeMatches(expected, code, s.deliveryMode === 'PICKUP' ? CODE_SALT.pickup(s.id) : CODE_SALT.delivery(s.id))) fail('BAD_CODE', 'El código no es correcto. Pídeselo otra vez al comprador: sin código no hay entrega (RN-58).');
  if (s.payment.method === 'CASH' && c.e.p.cashCollected) s.payment = { ...s.payment, status: 'CONFIRMED', amount: s.total, confirmedAt: c.t, paidAt: c.t };
  if (s.status === 'READY') setStatus(s, 'IN_TRANSIT', c.t, c.a.id);
  deliverSub(c, s, c.a.id, c.e.p.photoId);
});

/* ---------- Pago directo con constancia (CU-27, RF-PAY-01 a RF-PAY-05) ---------- */
on('PAYMENT_UPLOAD', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.buyerOrgId);
  if (!['CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED'].includes(s.status)) fail('STATE', s.status === 'PENDING_CONFIRMATION' ? 'Paga cuando el agricultor acepte: ahí ves sus datos de cobro.' : 'Este pedido ya no recibe pagos.');
  if (s.payment.status === 'CONFIRMED') fail('ALREADY', 'Este pago ya está confirmado.');
  if (s.payment.status === 'UPLOADED') fail('ALREADY', 'Ya enviaste una constancia: espera que el agricultor la confirme.');
  const method = c.e.p.method as SubOrder['payment']['method'];
  const seller = getOrg(c.w, s.sellerOrgId);
  if (method === 'CASH') fail('CASH', 'El efectivo se registra al entregar.');
  if (!digitalMethods(seller).includes(method as any)) fail('PAY_METHOD', `${seller.name} no recibe ese medio.`);
  const op = String(c.e.p.operation ?? '').replace(/\s/g, '');
  if (!/^\d{4,14}$/.test(op)) fail('BAD_OP', 'Escribe el número de operación que aparece en tu constancia (solo números).');
  const key = `${method}:${op}`;
  if (c.w.usedOps[key] && c.w.usedOps[key] !== s.id) fail('OP_DUPLICATE', 'Ese número de operación ya se usó en otro pago: no sirve para dos pedidos (RF-PAY-05).');
  const amount = r2(Number(c.e.p.amount) || s.total);
  s.payment = { status: 'UPLOADED', method, operation: op, amount, paidAt: Number(c.e.p.paidAt) || c.t, photoId: c.e.p.photoId, uploadedAt: c.t };
  c.w.usedOps[key] = s.id;
  notify(c, s.sellerOrgId, 'PAYMENT', 'Constancia recibida', `${c.w.orgs[s.buyerOrgId].name} dice que pagó ${money(amount)}${Math.abs(amount - s.total) > 0.01 ? ` (el pedido es de ${money(s.total)})` : ''}. Revisa tu ${method === 'TRANSFER' ? 'cuenta' : method === 'PLIN' ? 'Plin' : 'Yape'} y confírmalo.`, { screen: 'A-14', params: { id: s.id } });
});

on('PAYMENT_CONFIRM', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (s.payment.status !== 'UPLOADED') fail('STATE', 'No hay una constancia por confirmar.');
  s.payment.status = 'CONFIRMED';
  s.payment.confirmedAt = c.t;
  notify(c, s.buyerOrgId, 'PAYMENT', `${c.w.orgs[s.sellerOrgId].name} confirmó tu pago`, `${s.code} · ${money(s.payment.amount ?? s.total)}.`, { screen: 'B-14', params: { id: s.id } });
});

on('PAYMENT_NOT_RECEIVED', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.sellerOrgId);
  if (s.payment.status !== 'UPLOADED') fail('STATE', 'No hay una constancia por revisar.');
  s.payment.status = 'NOT_RECEIVED';
  const d = openDispute(c, s, 'PAGO_NO_RECIBIDO', `${c.w.orgs[s.sellerOrgId].name} dice que no le llegó el pago de ${money(s.payment.amount ?? s.total)} (operación ${s.payment.operation}).`, [], s.sellerOrgId, String(c.e.p.disputeId));
  notify(c, s.buyerOrgId, 'PAYMENT', 'El agricultor no ve tu pago', `${s.code}: Soporte revisa ambas versiones (${d.code}). Ten a la mano tu constancia.`, { screen: 'B-14', params: { id: s.id } });
});

/* ---------- Recepción y conformidad (CU-29, RF-ORD-06, RN-11) ---------- */
on('RECEIPT_CONFIRM', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.buyerOrgId);
  if (s.status !== 'DELIVERED') fail('STATE', 'Este pedido no espera tu conformidad.');
  const lines = (c.e.p.lines ?? []) as { listingId: string; acceptedQty: number; quality: 'OK' | 'FAIL' }[];
  let allOk = true;
  const issues: string[] = [];
  for (const it of s.items) {
    const ln = lines.find(x => x.listingId === it.listingId);
    const acc = ln ? Number(ln.acceptedQty) : it.qty;
    const q = ln?.quality ?? 'OK';
    if (!(acc >= 0) || acc > it.qty * 1.05) fail('BAD_QTY', `Revisa lo recibido de ${it.name}.`);
    if (acc < it.qty - 1e-9 || q === 'FAIL') {
      allOk = false;
      if (acc < it.qty - 1e-9) issues.push(`${it.name}: recibió ${fkg(acc * it.unitKg)} de ${fkg(it.qty * it.unitKg)}`);
      if (q === 'FAIL') issues.push(`${it.name}: calidad con fallas`);
    }
  }
  if (!allOk && c.t > (s.deliveredAt ?? c.t) + c.w.settings.claimHours * HOUR) fail('CLAIM_WINDOW', `Los problemas se reportan dentro de ${c.w.settings.claimHours} h desde la entrega (RN-11).`);
  for (const it of s.items) {
    const ln = lines.find(x => x.listingId === it.listingId);
    it.acceptedQty = ln ? Number(ln.acceptedQty) : it.qty;
    it.quality = ln?.quality ?? 'OK';
  }
  s.receiptPhotoIds = c.e.p.photoIds ?? [];
  if (allOk) {
    completeSub(c, s, s.subtotal, c.a.id, 'Conforme');
  } else {
    const anyQty = s.items.some(i => (i.acceptedQty ?? i.qty) < i.qty);
    const desc = issues.join('. ') + (c.e.p.note ? `. ${String(c.e.p.note).slice(0, 300)}` : '');
    const d = openDispute(c, s, anyQty ? 'CANTIDAD' : 'CALIDAD', desc, c.e.p.photoIds ?? [], s.buyerOrgId, String(c.e.p.disputeId));
    setStatus(s, 'DISPUTED', c.t, c.a.id, desc);
    notify(c, s.sellerOrgId, 'ORDER', 'El comprador reportó un problema', `${s.code}: ${desc}. Soporte media (${d.code}).`, { screen: 'A-13', params: { id: s.id } });
  }
});

function openDispute(c: Ctx, s: SubOrder, kind: Dispute['kind'], description: string, photoIds: string[], openedBy: string, id?: string): Dispute {
  const did = id && id !== 'undefined' ? id : `${c.e.id}:dsp`;
  if (c.w.disputes[did]) return c.w.disputes[did];
  const d: Dispute = { id: did, code: 'DSP-' + pad(nextSeq(c.w, 'dispute', 30), 4), subOrderId: s.id, openedBy, kind, description, photoIds, status: 'OPEN', openedAt: c.t };
  c.w.disputes[d.id] = d;
  s.disputeId = d.id;
  notify(c, 'ADMIN', 'ORDER', 'Disputa nueva', `${d.code} · ${s.code} · ${description}`, { screen: 'W-07', params: { id: d.id } });
  return d;
}

on('DISPUTE_OPEN', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  requireMember(c.a, s.buyerOrgId);
  const kind = c.e.p.kind as Dispute['kind'];
  if (s.status === 'IN_TRANSIT') {
    if (kind !== 'NO_LLEGO') fail('STATE', 'Mientras el pedido va en camino solo puedes reportar que no llegó.');
    if (c.t < endOfDay(s.deliveryDate)) fail('TOO_SOON', 'Todavía está dentro del día de entrega. Escríbele al agricultor por el chat.');
  } else if (s.status === 'DELIVERED') {
    if (c.t > (s.deliveredAt ?? c.t) + c.w.settings.claimHours * HOUR) fail('CLAIM_WINDOW', `Los problemas se reportan dentro de ${c.w.settings.claimHours} h (RN-11).`);
  } else fail('STATE', 'En este estado no se abre una disputa.');
  const desc = String(c.e.p.description ?? '').trim();
  if (desc.length < 5) fail('DESC', 'Cuéntanos qué pasó.');
  const d = openDispute(c, s, kind, desc, c.e.p.photoIds ?? [], s.buyerOrgId, String(c.e.p.disputeId));
  setStatus(s, 'DISPUTED', c.t, c.a.id, desc);
  notify(c, s.sellerOrgId, 'ORDER', 'Disputa abierta', `${s.code}: ${desc}. Soporte media (${d.code}).`);
});

on('DISPUTE_PROPOSE', (c) => {
  requireAdmin(c.a, 'SUPPORT', 'GENERAL');
  const d = must(c.w.disputes[c.e.p.disputeId], 'NOT_FOUND', 'No encontramos la disputa.');
  if (d.status === 'RESOLVED') fail('CLOSED', 'La disputa ya está resuelta.');
  const s = getSub(c.w, d.subOrderId);
  const refund = r2(Number(c.e.p.refund) || 0);
  if (refund < 0 || refund > s.total) fail('BAD_AMOUNT', 'La devolución no puede pasar el total del pedido.');
  d.proposal = { refund, note: String(c.e.p.note ?? ''), by: c.a.id, at: c.t };
  d.status = 'PROPOSED';
  d.assignedTo = c.a.id;
  const txt = `Propuesta de Soporte para ${s.code}: ${refund ? `devolver ${money(refund)} directo (Yape o transferencia)` : 'sin devolución'}. ${d.proposal.note}`;
  notify(c, s.buyerOrgId, 'ORDER', 'Propuesta de Soporte', txt);
  notify(c, s.sellerOrgId, 'ORDER', 'Propuesta de Soporte', txt);
});

on('DISPUTE_RESOLVE', (c) => {
  requireAdmin(c.a, 'SUPPORT', 'GENERAL');
  const d = must(c.w.disputes[c.e.p.disputeId], 'NOT_FOUND', 'No encontramos la disputa.');
  if (d.status === 'RESOLVED') fail('CLOSED', 'La disputa ya está resuelta.');
  const s = getSub(c.w, d.subOrderId);
  const outcome = c.e.p.outcome as NonNullable<Dispute['resolution']>['outcome'];
  const refund = r2(Number(c.e.p.refund) || 0);
  const note = String(c.e.p.note ?? '').trim();
  if (note.length < 5) fail('REASON_REQUIRED', 'Anota la razón de la resolución: queda en auditoría.');
  if (refund < 0 || refund > s.subtotal) fail('BAD_AMOUNT', 'La devolución no puede pasar el valor de los productos.');
  if (d.kind === 'PAGO_NO_RECIBIDO') {
    if (outcome === 'FAVOR_COMPRADOR') { s.payment.status = 'CONFIRMED'; s.payment.confirmedAt = c.t; }
    else { s.payment = { status: 'NONE', method: s.payment.method }; }
  } else {
    if (s.status !== 'DISPUTED') fail('STATE', 'El pedido no está en disputa.');
    if (outcome === 'FAVOR_COMPRADOR') c.w.orgs[s.sellerOrgId].counters.disputesLost++;
    completeSub(c, s, r2(s.subtotal - refund), c.a.id, `Resuelto por Soporte: ${note}`);
  }
  d.resolution = { outcome, refund, note, by: c.a.id, at: c.t };
  d.status = 'RESOLVED';
  audit(c, c.a.id, 'RESOLUCIÓN DE DISPUTA', d.id, `${d.code} · ${s.code} · ${outcome} · devolución ${money(refund)} · ${note}`);
  const txt = `${d.code}: ${note}${refund ? ` · devolución de ${money(refund)} directo entre las partes` : ''}.`;
  notify(c, s.buyerOrgId, 'ORDER', 'Disputa resuelta', txt);
  notify(c, s.sellerOrgId, 'ORDER', 'Disputa resuelta', txt);
});

/* ---------- Calificaciones en doble ciego (RF-REP-01, RN-12) ---------- */
on('REVIEW_SUBMIT', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  const side = c.e.p.side as Review['side'];
  if (s.status !== 'COMPLETED') fail('STATE', 'Se califica cuando el pedido está completo (RN-12).');
  if (side === 'BUYER') { requireMember(c.a, s.buyerOrgId); if (s.reviewBuyer) fail('ALREADY', 'Ya calificaste este pedido.'); }
  else { requireMember(c.a, s.sellerOrgId); if (s.reviewSeller) fail('ALREADY', 'Ya calificaste este pedido.'); }
  const stars = Number(c.e.p.stars);
  if (!(stars >= 1 && stars <= 5 && Number.isInteger(stars))) fail('BAD_STARS', 'Elige de 1 a 5 estrellas.');
  const r: Review = {
    id: String(c.e.p.reviewId), subOrderId: s.id, fromOrg: c.a.orgId, toOrg: side === 'BUYER' ? s.sellerOrgId : s.buyerOrgId, side, stars,
    tags: (c.e.p.tags ?? []).slice(0, 6), comment: String(c.e.p.comment ?? '').slice(0, 400) || undefined, at: c.t, published: false,
  };
  c.w.reviews[r.id] = r;
  if (side === 'BUYER') s.reviewBuyer = r.id; else s.reviewSeller = r.id;
  const other = side === 'BUYER' ? s.reviewSeller : s.reviewBuyer;
  if (other && c.w.reviews[other]) {
    r.published = true; c.w.reviews[other].published = true;
    notify(c, r.toOrg, 'REVIEW', `Te calificaron con ${r.stars} estrellas`, `${c.w.orgs[r.fromOrg].name}${r.comment ? `: «${r.comment}»` : ''}`);
    notify(c, c.w.reviews[other].toOrg, 'REVIEW', `Te calificaron con ${c.w.reviews[other].stars} estrellas`, `${c.w.orgs[c.w.reviews[other].fromOrg].name}`);
  }
});

on('REVIEW_REPLY', (c) => {
  const r = must(c.w.reviews[c.e.p.reviewId], 'NOT_FOUND', 'No encontramos la opinión.');
  requireMember(c.a, r.toOrg);
  if (!r.published) fail('STATE', 'La opinión aún no se publica.');
  if (r.reply) fail('ALREADY', 'Ya respondiste esta opinión.');
  const text = String(c.e.p.text ?? '').trim();
  if (text.length < 3) fail('TEXT', 'Escribe tu respuesta.');
  r.reply = text.slice(0, 300);
});

/* ---------- Chat (RF-COM-01) ---------- */
/** Mensajes por conversación que guarda el mundo en memoria (la base guarda todos). */
export const MSG_CAP = 200;
on('MSG_SEND', (c) => {
  const conv = String(c.e.p.conv);
  const text = String(c.e.p.text ?? '').trim();
  if (!text) fail('EMPTY', 'Escribe un mensaje.');
  const list = c.w.messages[conv] ?? (c.w.messages[conv] = []);
  if (list.some(m => m.id === c.e.p.msgId)) return; // reintento sin duplicar
  if (conv.startsWith('ticket:')) {
    const tk = must(c.w.tickets[conv.slice(7)], 'NOT_FOUND', 'No encontramos la consulta.');
    if (c.a.role !== 'ADMIN') requireMember(c.a, tk.orgId);
  } else {
    const s = getSub(c.w, conv);
    const sh = s.shipmentId ? c.w.shipments[s.shipmentId] : undefined;
    const allowed = [s.buyerOrgId, s.sellerOrgId, sh?.carrierOrgId].filter(Boolean);
    if (c.a.role !== 'ADMIN' && !allowed.includes(c.a.orgId)) fail('FORBIDDEN', 'No participas en este pedido.');
    const to = c.a.orgId === s.buyerOrgId ? s.sellerOrgId : s.buyerOrgId;
    notify(c, to, 'ORDER', `Mensaje de ${c.w.orgs[c.a.orgId]?.name ?? 'Mesagri'}`, text.slice(0, 120), { screen: 'CHAT', params: { id: s.id } });
  }
  list.push({ id: String(c.e.p.msgId), conv, from: c.a.id, text: text.slice(0, 500), quick: c.e.p.quick, at: c.t });
  if (list.length > MSG_CAP) list.splice(0, list.length - MSG_CAP);
});

/* ---------- Comprobante del pedido (RF-PAY-04) ---------- */
on('TAXDOC_REGISTER', (c) => {
  const s = getSub(c.w, c.e.p.subOrderId);
  if (s.taxDoc === 'LIQUIDACION') requireMember(c.a, s.buyerOrgId); else requireMember(c.a, s.sellerOrgId);
  const num = String(c.e.p.number ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-\d{1,8}$/.test(num)) fail('BAD_NUMBER', 'Escribe la serie y el número, por ejemplo E001-245.');
  s.taxDocNumber = num;
  notify(c, s.taxDoc === 'LIQUIDACION' ? s.sellerOrgId : s.buyerOrgId, 'ORDER', `${TAXDOC_LABEL[s.taxDoc]} registrada`, `${s.code}: ${num}`);
});

/* ---------- Libro de Reclamaciones y consultas (RF-SUP-01, RF-SUP-02, RN-20) ---------- */
on('COMPLAINT_FILE', (c) => {
  const p = c.e.p;
  const detail = String(p.detail ?? '').trim();
  const request = String(p.request ?? '').trim();
  if (detail.length < 10) fail('DETAIL', 'Cuéntanos con más detalle qué pasó.');
  if (request.length < 3) fail('REQUEST', 'Escribe qué pides.');
  if (c.w.complaints[p.complaintId]) fail('DUPLICATE', 'Esta hoja ya se envió.');
  const n = nextSeq(c.w, 'complaint', 230);
  c.w.complaints[p.complaintId] = {
    id: p.complaintId, number: pad(n, 6), type: p.type === 'QUEJA' ? 'QUEJA' : 'RECLAMO', orgId: c.a.orgId, userId: c.a.id, related: String(p.related ?? ''),
    amount: p.amount ? r2(Number(p.amount)) : undefined, detail, request, at: c.t, dueAt: addBusinessDays(c.t, 15), status: 'OPEN',
  };
  notify(c, 'ADMIN', 'SYSTEM', `Hoja de reclamación N.º ${pad(n, 6)}`, `${c.w.orgs[c.a.orgId]?.name}: ${detail.slice(0, 80)}`, { screen: 'W-08' });
  notify(c, c.a.orgId, 'SYSTEM', `Hoja N.º ${pad(n, 6)} registrada`, 'Te enviamos una copia. Respondemos en 15 días hábiles como máximo (RN-20).');
  return { number: pad(n, 6) };
});

on('COMPLAINT_ANSWER', (c) => {
  requireAdmin(c.a, 'SUPPORT', 'GENERAL');
  const k = must(c.w.complaints[c.e.p.complaintId], 'NOT_FOUND', 'No encontramos la hoja.');
  if (k.status === 'ANSWERED') fail('CLOSED', 'Esta hoja ya tiene respuesta.');
  const answer = String(c.e.p.answer ?? '').trim();
  if (answer.length < 10) fail('ANSWER', 'Escribe una respuesta completa.');
  k.status = 'ANSWERED'; k.answer = answer; k.answeredAt = c.t; k.answeredBy = c.a.id;
  audit(c, c.a.id, 'RESPUESTA A RECLAMO', k.id, `Hoja ${k.number}`);
  notify(c, k.orgId, 'SYSTEM', `Respuesta a tu hoja N.º ${k.number}`, answer.slice(0, 140));
});

on('TICKET_OPEN', (c) => {
  const text = String(c.e.p.text ?? '').trim();
  if (text.length < 5) fail('TEXT', 'Cuéntanos en qué te ayudamos.');
  const n = nextSeq(c.w, 'ticket', 117);
  c.w.tickets[c.e.p.ticketId] = { id: c.e.p.ticketId, code: '#' + n, orgId: c.a.orgId, userId: c.a.id, topic: String(c.e.p.topic ?? 'General'), text, at: c.t, status: 'OPEN', replies: [] };
  notify(c, 'ADMIN', 'SYSTEM', `Consulta #${n}`, `${c.w.orgs[c.a.orgId]?.name}: ${text.slice(0, 80)}`, { screen: 'W-08' });
  return { code: '#' + n };
});

on('TICKET_REPLY', (c) => {
  const tk = must(c.w.tickets[c.e.p.ticketId], 'NOT_FOUND', 'No encontramos la consulta.');
  if (c.a.role !== 'ADMIN') requireMember(c.a, tk.orgId);
  const text = String(c.e.p.text ?? '').trim();
  if (!text) fail('TEXT', 'Escribe tu respuesta.');
  tk.replies.push({ by: c.a.id, text: text.slice(0, 500), at: c.t });
  if (c.e.p.close) tk.status = 'CLOSED';
  if (c.a.role === 'ADMIN') notify(c, tk.orgId, 'SYSTEM', `Respuesta a tu consulta ${tk.code}`, text.slice(0, 120));
});
