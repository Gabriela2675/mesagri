/*
 * Almacenes aliados (4.4, RF-STO-01 a RF-STO-20, CU-66 a CU-79, RN-42 a RN-49).
 * El depositario es el almacén aliado; Mesagri ordena, guarda evidencias y cobra el 10 % del alquiler.
 */
import type { World, Booking, Lot, ReleaseOrder } from '../types';
import { on, fail, audit, notify, requireMember, getOrg, getSub, must, nextSeq, setStatus } from './core';
import { warehouseBlockers, warehouseOccupancy, rateFor, overdueStatement } from '../queries';
import { product } from '../catalog';
import { r2 } from '../rules';
import { HOUR, DAY, endOfDay, addMonths, lima } from '../time';
import { money, kg as fkg, dateShort } from '../format';
import { codeFrom, pad, secretOr, codeMatches, CODE_SALT } from '../ids';
import { checkoutRelease, pickupShipment } from './shipping';
import { deliverSub } from './orders';

function getBooking(w: World, id: string): Booking { return must(w.bookings[id], 'NOT_FOUND', 'No encontramos la reserva.'); }
function getLot(w: World, id: string): Lot { return must(w.lots[id], 'NOT_FOUND', 'No encontramos el lote.'); }
function getRelease(w: World, id: string): ReleaseOrder { return must(w.releases[id], 'NOT_FOUND', 'No encontramos la orden de salida.'); }

/* ---------- Reserva con tarifa congelada (CU-75, CU-76, RF-STO-08, RN-43) ---------- */
on('STO_BOOK', (c) => {
  const p = c.e.p;
  const farmer = getOrg(c.w, c.a.orgId);
  if (farmer.type !== 'FARMER') fail('FORBIDDEN', 'Las reservas las hacen los agricultores.');
  if (farmer.level < 1) fail('LEVEL0', 'Primero verificamos tu identidad (nivel 1).');
  const wh = getOrg(c.w, p.facilityOrgId);
  if (!wh.warehouse) fail('NOT_WAREHOUSE', 'Ese no es un almacén aliado.');
  const blockers = warehouseBlockers(c.w, wh, c.t);
  if (blockers.length) fail('WAREHOUSE_UNAVAILABLE', `Este almacén no recibe reservas ahora: ${blockers[0].toLowerCase()} (RN-42).`);
  const prod = product(p.productId);
  if (!wh.warehouse.products.includes(prod.id)) fail('PRODUCT', `${wh.name} no recibe ${prod.name.toLowerCase()}.`);
  const sacks = Number(p.sacks), months = Number(p.months), kgPerSack = Number(p.kgPerSack) || 50;
  if (!(Number.isInteger(sacks) && sacks > 0)) fail('BAD_QTY', 'Escribe los sacos en números enteros.');
  if (!(Number.isInteger(months) && months >= 1 && months <= 12)) fail('BAD_MONTHS', 'Elige de 1 a 12 meses.');
  const occ = warehouseOccupancy(c.w, wh.id);
  if (sacks > occ.free) fail('NO_SPACE', `Ahora quedan ${occ.free} sacos libres en ${wh.name}.`);
  const arrival = Number(p.arrivalDate);
  if (!(arrival > 0) || endOfDay(arrival) < c.t) fail('BAD_DATE', 'Elige una fecha de ingreso desde hoy.');
  if (c.w.bookings[p.bookingId]) fail('DUPLICATE', 'Esta reserva ya se envió.');
  const b: Booking = {
    id: p.bookingId, code: 'R-' + pad(nextSeq(c.w, 'booking', 200), 4), facilityOrgId: wh.id, farmerOrgId: farmer.id, productId: prod.id, sacks, kgPerSack,
    months, arrivalDate: arrival, rate: rateFor(wh, prod.id), status: 'PENDING', createdAt: c.t, qr: 'QR-' + secretOr(p.secrets?.qr, /^[A-Z0-9]{8}$/, () => codeFrom(p.bookingId + ':qr', 8)),
  };
  c.w.bookings[b.id] = b;
  notify(c, wh.id, 'STORAGE', 'Reserva por confirmar', `${farmer.name} · ${prod.name} · ${sacks} sacos · ${months} ${months === 1 ? 'mes' : 'meses'}. Responde en 24 h.`, { screen: 'C-07' });
  return { bookingId: b.id, code: b.code };
});

on('STO_BOOK_RESPOND', (c) => {
  const b = getBooking(c.w, c.e.p.bookingId);
  requireMember(c.a, b.facilityOrgId);
  if (b.status !== 'PENDING') fail('STATE', b.status === 'EXPIRED' ? 'La reserva venció: pasaron 24 horas (RN-43).' : 'Esta reserva ya tiene respuesta.');
  const wh = getOrg(c.w, b.facilityOrgId);
  if (c.e.p.accept) {
    b.status = 'ACCEPTED';
    b.respondedAt = c.t;
    notify(c, b.farmerOrgId, 'STORAGE', `${wh.name} aceptó tu reserva`, `${b.code}: lleva tu cosecha el ${dateShort(b.arrivalDate)} y muestra el QR. Tarifa congelada: ${money(b.rate)} por saco al mes.`, { screen: 'A-23' });
  } else {
    const reason = String(c.e.p.reason ?? '').trim();
    if (reason.length < 3) fail('REASON_REQUIRED', 'Rechazar exige un motivo: el agricultor lo verá.');
    b.status = 'REJECTED'; b.rejectReason = reason; b.respondedAt = c.t;
    notify(c, b.farmerOrgId, 'STORAGE', `${wh.name} no pudo aceptar`, `${b.code}: ${reason}. Te sugerimos otro almacén cercano.`, { screen: 'A-21' });
  }
});

on('STO_BOOK_CANCEL', (c) => {
  const b = getBooking(c.w, c.e.p.bookingId);
  requireMember(c.a, b.farmerOrgId);
  if (!['PENDING', 'ACCEPTED'].includes(b.status)) fail('STATE', 'Esta reserva ya no se puede cancelar.');
  b.status = 'CANCELLED';
  notify(c, b.facilityOrgId, 'STORAGE', 'Reserva cancelada', `${b.code} fue cancelada por el agricultor.`);
});

/* ---------- Recepción con peso, calidad y fotos (CU-66, CU-67, RN-44, RN-45) ---------- */
function issueReceipt(c: { w: World; t: number; e?: any; n?: number }, lot: Lot) {
  lot.status = 'IN_DEPOSIT';
  lot.receiptCode = lot.code;
  notify(c as any, lot.farmerOrgId, 'STORAGE', 'Tu cosecha está guardada', `Constancia ${lot.code} · ${fkg(lot.weightKg)} · calidad ${lot.quality}. Vence el ${dateShort(lot.expiresOn)}.`, { screen: 'A-23' });
}

on('STO_INTAKE', (c) => {
  const p = c.e.p;
  const b = getBooking(c.w, p.bookingId);
  requireMember(c.a, b.facilityOrgId);
  if (b.status !== 'ACCEPTED') fail('STATE', 'Solo se recibe una reserva aceptada.');
  if (!p.scaleOk) fail('SCALE', 'Confirma que la balanza tiene calibración vigente.');
  const weight = Number(p.weightKg);
  if (!(weight > 0)) fail('BAD_WEIGHT', 'Escribe el peso de la balanza.');
  const quality = p.quality as Lot['quality'];
  if (!['A', 'B', 'C'].includes(quality)) fail('BAD_QUALITY', 'Elige la calidad A, B o C.');
  const sacks = Number(p.sacks) || b.sacks;
  const declared = b.sacks * b.kgPerSack;
  const diff = Math.abs(weight - declared) / declared;
  const n = nextSeq(c.w, 'lot', 40);
  const y = lima(c.t).y;
  const lot: Lot = {
    id: String(p.lotId), code: `ALM-${y}-${pad(n, 4)}`, bookingId: b.id, facilityOrgId: b.facilityOrgId, farmerOrgId: b.farmerOrgId, productId: b.productId,
    declaredKg: declared, weightKg: weight, balanceKg: weight, sacks, balanceSacks: sacks, quality, photoIds: p.photoIds ?? [], intakeAt: c.t,
    expiresOn: addMonths(c.t, b.months), rate: b.rate, status: 'WAITING_FARMER',
  };
  c.w.lots[lot.id] = lot;
  b.status = 'RECEIVED';
  if (diff > c.w.settings.storage.intakeTolerance) {
    notify(c, b.farmerOrgId, 'STORAGE', 'Revisa el peso de tu lote', `Declaraste ${fkg(declared)} y la balanza marcó ${fkg(weight)} (${(diff * 100).toFixed(1)} %). Acepta lo medido o llévate tu cosecha (RN-44).`, { screen: 'A-23' });
  } else issueReceipt(c, lot);
  audit(c, c.a.id, 'INGRESO DE LOTE', lot.id, `${lot.code} · ${fkg(weight)} · calidad ${quality}`);
  return { lotId: lot.id, code: lot.code, waiting: lot.status === 'WAITING_FARMER' };
});

on('STO_INTAKE_DECIDE', (c) => {
  const lot = getLot(c.w, c.e.p.lotId);
  requireMember(c.a, lot.farmerOrgId);
  if (lot.status !== 'WAITING_FARMER') fail('STATE', 'Este lote no espera tu decisión.');
  if (c.e.p.accept) issueReceipt(c, lot);
  else {
    lot.status = 'RETURNED'; lot.balanceKg = 0; lot.balanceSacks = 0;
    notify(c, lot.facilityOrgId, 'STORAGE', 'El agricultor se lleva su cosecha', `${lot.code}: no aceptó el peso medido.`);
  }
});

/* ---------- Orden de salida (CU-78, CU-79, CU-68, RN-46) ---------- */
on('STO_RELEASE_CREATE', (c) => {
  const p = c.e.p;
  const lot = getLot(c.w, p.lotId);
  requireMember(c.a, lot.farmerOrgId);
  if (!['IN_DEPOSIT', 'FOR_SALE'].includes(lot.status)) fail('STATE', 'Este lote no tiene saldo disponible.');
  const sacks = Number(p.sacks);
  if (!(Number.isInteger(sacks) && sacks > 0 && sacks <= lot.balanceSacks)) fail('BAD_QTY', `Elige de 1 a ${lot.balanceSacks} sacos.`);
  if (c.w.releases[p.releaseId]) fail('DUPLICATE', 'Esta orden ya se creó.');
  let subOrderId: string | undefined;
  if (p.subOrderId) {
    const s = getSub(c.w, p.subOrderId);
    if (s.sellerOrgId !== lot.farmerOrgId) fail('FORBIDDEN', 'Ese pedido es de otro agricultor.');
    if (!['CONFIRMED', 'PREPARING', 'READY'].includes(s.status)) fail('STATE', 'Ese pedido no está por entregar.');
    if (Object.values(c.w.releases).some(r => r.subOrderId === s.id && r.status !== 'EXPIRED')) fail('ALREADY', 'Ese pedido ya tiene una orden de salida.');
    subOrderId = s.id;
  }
  const b = c.w.bookings[lot.bookingId];
  const elapsedMonths = Math.max(1, Math.ceil((c.t - lot.intakeAt) / (30 * DAY)));
  const months = Math.max(b?.months ?? 1, elapsedMonths);
  const kgEach = lot.balanceSacks ? lot.balanceKg / lot.balanceSacks : 50;
  const r: ReleaseOrder = {
    id: p.releaseId, code: 'OS-' + pad(nextSeq(c.w, 'release', 200), 4), lotId: lot.id, sacks, kg: r2(sacks * kgEach), picker: p.picker ?? 'FARMER',
    pickerName: String(p.pickerName ?? c.a.name), subOrderId, rentAmount: r2(sacks * lot.rate * months), status: 'WAITING_RENT', createdAt: c.t,
  };
  c.w.releases[r.id] = r;
  notify(c, lot.facilityOrgId, 'STORAGE', 'Orden de salida por activar', `${r.code} · ${sacks} sacos de ${lot.code}. Se activa cuando confirmes el alquiler (${money(r.rentAmount)}).`, { screen: 'C-11' });
  return { releaseId: r.id, code: r.code };
});

on('STO_RENT_DECLARE', (c) => {
  const r = getRelease(c.w, c.e.p.releaseId);
  const lot = getLot(c.w, r.lotId);
  requireMember(c.a, lot.farmerOrgId);
  if (r.status !== 'WAITING_RENT') fail('STATE', 'Esta orden no espera el pago del alquiler.');
  r.rentDeclaredAt = c.t;
  notify(c, lot.facilityOrgId, 'STORAGE', 'El agricultor pagó el alquiler', `${r.code}: ${money(r.rentAmount)} por ${c.e.p.method === 'CASH' ? 'efectivo' : 'Yape o transferencia'}. Confírmalo para activar la orden.`, { screen: 'C-11' });
});

on('STO_RENT_CONFIRM', (c) => {
  const r = getRelease(c.w, c.e.p.releaseId);
  const lot = getLot(c.w, r.lotId);
  requireMember(c.a, lot.facilityOrgId);
  if (r.status !== 'WAITING_RENT') fail('STATE', 'Esta orden ya está activa o cerrada.');
  r.rentPaidAt = c.t;
  r.expiresAt = c.t + c.w.settings.storage.releaseDays * DAY;
  r.status = 'ACTIVE';
  lot.rentCollected = r2((lot.rentCollected ?? 0) + r.rentAmount);
  if (r.subOrderId) {
    const s = c.w.subOrders[r.subOrderId];
    if (s && ['CONFIRMED', 'PREPARING'].includes(s.status) && !(s.prepay && s.payment.status !== 'CONFIRMED')) setStatus(s, 'READY', c.t, c.a.id, 'Orden de salida activa en el almacén');
  }
  notify(c, lot.farmerOrgId, 'STORAGE', 'Orden de salida activa', `${r.code}: vale ${c.w.settings.storage.releaseDays} días.`, { screen: 'A-24' });
});

on('STO_RELEASE_CHECKOUT', (c) => {
  const r = getRelease(c.w, c.e.p.releaseId);
  const lot = getLot(c.w, r.lotId);
  requireMember(c.a, lot.facilityOrgId);
  if (r.status === 'WAITING_RENT') fail('INACTIVE', 'La orden está inactiva: sin alquiler pagado no sale nada del almacén (RN-46).');
  if (r.status !== 'ACTIVE') fail('STATE', r.status === 'EXPIRED' ? 'La orden venció: el agricultor debe generar otra.' : 'Esta orden ya se usó.');
  if (!c.e.p.pickerOk) fail('PICKER', 'Comprueba que quien recoge es la persona autorizada.');
  const kgOut = Number(c.e.p.kgOut) || r.kg;
  const s = r.subOrderId ? c.w.subOrders[r.subOrderId] : undefined;
  const sh = s?.shipmentId ? c.w.shipments[s.shipmentId] : undefined;
  if (s && s.deliveryMode === 'PICKUP') {
    if (!codeMatches(s.pickupCode, c.e.p.code, CODE_SALT.pickup(s.id))) fail('BAD_CODE', 'Pide el código de recojo al comprador: sin código no se entrega (RN-58).');
  }
  if (sh && !['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status)) fail('STATE', 'El transportista todavía no está asignado a este envío.');
  checkoutRelease(c, r, kgOut, c.a.id);
  if (s && s.deliveryMode === 'PICKUP') {
    if (s.status !== 'READY') setStatus(s, 'READY', c.t, c.a.id);
    setStatus(s, 'IN_TRANSIT', c.t, c.a.id, 'Recogido en el almacén');
    deliverSub(c, s, c.a.id);
  } else if (s && sh) {
    if (s.status !== 'READY') setStatus(s, 'READY', c.t, c.a.id);
    pickupShipment(c, sh, s, { sacks: r.sacks, kg: kgOut, photoIds: [], waybillSender: String(c.e.p.waybillSender ?? ''), waybillCarrier: String(c.e.p.waybillCarrier ?? ''), qrOk: true }, c.a.id);
  }
  audit(c, c.a.id, 'SALIDA DE ALMACÉN', r.id, `${r.code} · ${fkg(kgOut)} · ${lot.code}`);
});

/* ---------- Incidentes y merma (RF-STO-16, RN-44) ---------- */
on('STO_INCIDENT', (c) => {
  const p = c.e.p;
  const lot = getLot(c.w, p.lotId);
  requireMember(c.a, lot.facilityOrgId);
  if (!['IN_DEPOSIT', 'FOR_SALE', 'DISPUTE'].includes(lot.status)) fail('STATE', 'Este lote no está en depósito.');
  const kgNow = Number(p.kgNow);
  if (!(kgNow >= 0 && kgNow <= lot.balanceKg * 1.05)) fail('BAD_WEIGHT', 'Revisa el peso de hoy.');
  const months = Math.max(0.25, (c.t - lot.intakeAt) / (30 * DAY));
  const mermaType = product(lot.productId).merma;
  const tolPerMonth = mermaType === 'TUBERCULO' ? c.w.settings.storage.mermaPapa : c.w.settings.storage.mermaGranos;
  const diffKg = r2(lot.balanceKg - kgNow);
  const diffPct = lot.balanceKg ? diffKg / lot.balanceKg : 0;
  const over = String(p.kind) !== 'Merma de peso' || diffPct > tolPerMonth * months;
  const n = nextSeq(c.w, 'incident', 11);
  c.w.stoIncidents[p.incidentId] = { id: p.incidentId, code: 'INC-' + pad(n, 4), lotId: lot.id, kind: String(p.kind), kgNow, diffKg, diffPct, overTolerance: over, at: c.t, status: over ? 'OPEN' : 'CLOSED', note: String(p.note ?? '') };
  lot.balanceKg = kgNow;
  if (over) lot.status = 'DISPUTE';
  notify(c, lot.farmerOrgId, 'STORAGE', over ? 'Incidente en tu lote' : 'Merma dentro de la tolerancia', `${lot.code}: ${p.kind} · ${fkg(diffKg)} (${(diffPct * 100).toFixed(1)} %).${over ? ' Pasa la tolerancia del convenio: el almacén compensa al precio del día. Tienen 5 días hábiles para acordar.' : ''}`, { screen: 'A-23' });
  if (over) notify(c, 'ADMIN', 'STORAGE', 'Incidente de almacén', `${lot.code} · ${p.kind} · ${(diffPct * 100).toFixed(1)} %`, { screen: 'W-15' });
});

on('STO_INCIDENT_CLOSE', (c) => {
  const inc = must(c.w.stoIncidents[c.e.p.incidentId], 'NOT_FOUND', 'No encontramos el incidente.');
  const lot = getLot(c.w, inc.lotId);
  if (c.a.role !== 'ADMIN') requireMember(c.a, lot.farmerOrgId);
  inc.status = 'CLOSED';
  inc.note = String(c.e.p.note ?? inc.note ?? '');
  if (lot.status === 'DISPUTE') lot.status = lot.listingId ? 'FOR_SALE' : 'IN_DEPOSIT';
});

/* ---------- Temporizadores (RN-43, RN-46) ---------- */
export function storageDeadlines(w: World): { at: number; run: (t: number) => void }[] {
  const out: { at: number; run: (t: number) => void }[] = [];
  for (const id in w.bookings) {
    const b = w.bookings[id];
    if (b.status === 'PENDING') out.push({ at: b.createdAt + w.settings.storage.bookingHours * HOUR, run: (t) => {
      b.status = 'EXPIRED';
      notify({ w, t }, b.farmerOrgId, 'STORAGE', 'La reserva venció', `${b.code}: el almacén no respondió en 24 h. Te sugerimos otro almacén (RF-STO-09).`, { screen: 'A-21' });
    } });
    if (b.status === 'ACCEPTED') out.push({ at: endOfDay(b.arrivalDate) + w.settings.storage.lotArrivalDays * DAY, run: (t) => {
      b.status = 'LAPSED';
      notify({ w, t }, b.farmerOrgId, 'STORAGE', 'Se liberó tu reserva', `${b.code}: el lote no llegó 3 días después de la fecha acordada (RN-43).`);
      notify({ w, t }, b.facilityOrgId, 'STORAGE', 'Reserva liberada', `${b.code}: el lote no llegó.`);
    } });
  }
  for (const id in w.releases) {
    const r = w.releases[id];
    if (r.status === 'ACTIVE' && r.expiresAt) out.push({ at: r.expiresAt, run: (t) => {
      r.status = 'EXPIRED';
      const lot = w.lots[r.lotId];
      if (lot) notify({ w, t }, lot.farmerOrgId, 'STORAGE', 'La orden de salida venció', `${r.code}: pasaron 3 días. Genera otra si aún la necesitas (RN-46).`);
    } });
  }
  return out;
}
