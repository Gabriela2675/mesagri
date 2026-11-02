/*
 * Envíos con transportistas aliados (4.5, 6.11, CU-95 a CU-109, RN-51 a RN-66).
 * Mesagri no transporta ni cobra el flete: ofrece, asigna, guarda evidencias y media.
 */
import type { Shipment, SubOrder, World, ReleaseOrder } from '../types';
import { on, fail, audit, notify, requireMember, requireAdmin, getOrg, getSub, must, setStatus, Ctx } from './core';
import { eligibleCarriers, currentOffer } from '../queries';
import { r2 } from '../rules';
import { MIN, HOUR, atHour, endOfDay, DAY } from '../time';
import { money, hhmm, kg as fkg } from '../format';
import { deliverSub } from './orders';
import { districtName } from '../ubigeo';
import { digitsFrom, secretOr, codeMatches, CODE_SALT } from '../ids';

type C = { w: World; t: number; e?: any; n?: number };

/** Ofrece el envío al siguiente transportista apto (RN-56): favoritos primero, luego por calificación. */
export function offerNext(c: C, sh: Shipment, t: number) {
  const w = c.w;
  const route = w.settings.routes.find(r => r.id === sh.routeId)!;
  let cands = eligibleCarriers(w, sh, t);
  if (sh.preferredCarrier) {
    const i = cands.findIndex(o => o.id === sh.preferredCarrier);
    if (i > 0) cands = [cands[i], ...cands.slice(0, i), ...cands.slice(i + 1)];
  }
  const deadline = (sh.offeringSince ?? t) + w.settings.carrier.noCarrierHours * HOUR;
  if (!cands.length || t >= deadline) {
    sh.status = 'NO_CARRIER';
    sh.events.push({ kind: 'NO_CARRIER', at: t, text: cands.length ? `Nadie aceptó en ${w.settings.carrier.noCarrierHours} horas` : 'No hay más transportistas aptos para esa ruta y ese día' });
    notify(c as any, sh.buyerOrgId, 'SHIPMENT', 'Sin transportista por ahora', `${sh.code}: elige otra opción u otra fecha. No pagas nada por el intento (RN-56).`, { screen: 'B-31', params: { id: sh.id } });
    return;
  }
  const o = cands[0];
  const expiresAt = Math.min(t + route.offerMinutes * MIN, deadline);
  sh.offers.push({ carrierOrgId: o.id, sentAt: t, expiresAt });
  const net = r2(sh.freight * (1 - sh.commissionRate));
  notify(c as any, o.id, 'SHIPMENT', 'Oferta nueva', `${sh.code} · ${fkg(sh.weightKg)} · ${districtName(w.orgs[sh.sellerOrgId]?.district)} → ${districtName(sh.destLabel)} · recibes ${money(net)}. Responde antes de las ${hhmm(expiresAt)}.`, { screen: 'T-09', params: { id: sh.id } });
}

function carrierRouteTimes(w: World, sh: Shipment, carrierOrgId: string) {
  const c = w.orgs[carrierOrgId]?.carrier;
  const r = c?.routes.find(x => x.routeId === sh.routeId);
  if (!r || sh.scope === 'CIUDAD') return;
  const [dh, dm] = r.departs.split(':').map(Number);
  const [ah, am] = r.arrives.split(':').map(Number);
  const dep = atHour(sh.pickupAt, dh, dm);
  sh.pickupAt = dep - 40 * MIN;
  sh.deliverFrom = atHour(sh.pickupAt, ah, am) - 30 * MIN;
  sh.deliverTo = atHour(sh.pickupAt, ah, am) + 60 * MIN;
}

function getShip(w: World, id: string): Shipment { return must(w.shipments[id], 'NOT_FOUND', 'No encontramos ese envío.'); }

/* ---------- Oferta y asignación (CU-95, RF-TRA-10, RF-TRA-11) ---------- */
on('SHIP_OFFER_RESPOND', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  if (c.a.role !== 'CARRIER') fail('FORBIDDEN', 'Las ofertas de envío son para transportistas.');
  const offer = currentOffer(sh);
  if (sh.status !== 'OFFERING' || !offer) fail('GONE', sh.status === 'ASSIGNED' ? 'Otro transportista ya aceptó este envío.' : 'Esta oferta ya no está disponible.');
  if (offer.carrierOrgId !== c.a.orgId) fail('NOT_YOURS', 'Esta oferta es para otro transportista.');
  if (c.t > offer.expiresAt) fail('EXPIRED', 'La oferta venció y pasó al siguiente transportista.');
  const carrier = getOrg(c.w, c.a.orgId);
  if (c.e.p.accept) {
    offer.response = 'ACCEPTED';
    offer.respondedAt = c.t;
    sh.carrierOrgId = carrier.id;
    sh.status = 'ASSIGNED';
    carrierRouteTimes(c.w, sh, carrier.id);
    sh.events.push({ kind: 'ASSIGNED', at: c.t, text: `${carrier.name} aceptó el envío`, by: c.a.id });
    const s = c.w.subOrders[sh.subOrderId];
    notify(c, sh.buyerOrgId, 'SHIPMENT', `${c.a.shortName} lleva tu pedido`, `${sh.code} · ${carrier.carrier!.vehicle.plate} · llega entre ${hhmm(sh.deliverFrom)} y ${hhmm(sh.deliverTo)}. Pagas el flete (${money(sh.freight)}) al recibir.`, { screen: 'B-31', params: { id: sh.id } });
    notify(c, sh.sellerOrgId, 'SHIPMENT', 'Transportista asignado', `${carrier.name} (${carrier.carrier!.vehicle.plate}) recoge ${s?.code ?? ''} a las ${hhmm(sh.pickupAt)}. Comprueba la placa y a la persona.`, { screen: 'A-30', params: { id: sh.id } });
  } else {
    offer.response = 'REJECTED';
    offer.respondedAt = c.t;
    offer.reason = String(c.e.p.reason ?? '');
    sh.events.push({ kind: 'REJECTED', at: c.t, text: `${carrier.name} no pudo tomarlo` });
    offerNext(c, sh, c.t);
  }
});

on('SHIP_DEPART', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.carrierOrgId ?? '');
  if (sh.status !== 'ASSIGNED') fail('STATE', 'Este envío no espera salida.');
  sh.status = 'GOING_TO_PICKUP';
  sh.events.push({ kind: 'DEPART', at: c.t, text: 'Salió a recoger', by: c.a.id });
  notify(c, sh.sellerOrgId, 'SHIPMENT', `${c.a.shortName} salió a recoger`, `${sh.code}: llega a las ${hhmm(sh.pickupAt)}. Ten la carga contada y pesada.`);
  notify(c, sh.buyerOrgId, 'SHIPMENT', 'Tu transportista salió a recoger', `${sh.code}. Si cancelas ahora pagas el 30 % del flete (RN-61).`);
});

/** Recojo con QR, conteo, peso, fotos y guías (CU-96, RN-58). */
export function pickupShipment(c: C, sh: Shipment, s: SubOrder, data: { sacks: number; kg: number; photoIds: string[]; waybillSender: string; waybillCarrier: string; qrOk: boolean }, by: string) {
  sh.pickup = { at: c.t, ...data };
  sh.status = 'PICKED_UP';
  sh.events.push({ kind: 'PICKED_UP', at: c.t, text: `Recogió ${data.sacks} sacos · ${fkg(data.kg)}`, by });
  setStatus(s, 'IN_TRANSIT', c.t, by, 'Recogido por el transportista aliado');
  const diff = sh.weightKg ? (data.kg - sh.weightKg) / sh.weightKg : 0;
  notify(c as any, sh.buyerOrgId, 'SHIPMENT', 'Tu pedido va en camino', `${sh.code}: llega entre ${hhmm(sh.deliverFrom)} y ${hhmm(sh.deliverTo)}.${Math.abs(diff) > c.w.settings.carrier.weightTolerance ? ` Ojo: se pesaron ${fkg(data.kg)} (pediste ${fkg(sh.weightKg)}).` : ''}`, { screen: 'B-31', params: { id: sh.id } });
  notify(c as any, sh.sellerOrgId, 'SHIPMENT', 'Carga recogida', `${sh.code}: desde ahora la carga está a cargo del transportista (RN-59).`);
}

export function findRelease(w: World, subOrderId: string): ReleaseOrder | undefined {
  return Object.values(w.releases).find(r => r.subOrderId === subOrderId && r.status !== 'EXPIRED');
}

on('SHIP_PICKUP', (c) => {
  const p = c.e.p;
  const sh = getShip(c.w, p.shipmentId);
  requireMember(c.a, sh.carrierOrgId ?? '');
  if (!['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status)) fail('STATE', 'Este envío no espera recojo.');
  const s = getSub(c.w, sh.subOrderId);
  const rel = s.fromLot ? findRelease(c.w, s.id) : undefined;
  if (s.fromLot) {
    if (!rel || rel.status === 'WAITING_RENT') fail('RELEASE_INACTIVE', 'La orden de salida del almacén no está activa: falta que el almacén confirme el pago del alquiler (RN-46).');
  } else if (s.status !== 'READY') fail('NOT_READY', 'El agricultor todavía no marca la carga como lista.');
  const qr = String(p.qr ?? '').trim().toUpperCase();
  const okQr = rel ? qr === rel.code.toUpperCase() : codeMatches(s.pickupQr, qr, CODE_SALT.qr(s.id));
  if (!okQr) fail('BAD_QR', rel ? 'Ese código no es la orden de salida de este pedido.' : 'Ese QR no corresponde a este pedido. Pide al agricultor que te muestre el QR de Mesagri.');
  const sacks = Number(p.sacks), kgv = Number(p.kg);
  if (!(sacks > 0) || !(kgv > 0)) fail('COUNT', 'Escribe los sacos contados y el peso de la balanza.');
  const vclass = c.w.orgs[sh.carrierOrgId!]?.carrier?.vehicle.vclass;
  if (vclass !== 'V1' && !String(p.waybillCarrier ?? '').trim()) fail('WAYBILL', 'En camioneta, furgón o camión la guía de remisión del transportista es obligatoria.');
  if (rel && rel.status === 'ACTIVE') checkoutRelease(c, rel, kgv, c.a.id);
  if (s.status === 'PREPARING' || s.status === 'CONFIRMED') setStatus(s, 'READY', c.t, c.a.id, 'Carga entregada desde el almacén');
  pickupShipment(c, sh, s, { sacks, kg: kgv, photoIds: p.photoIds ?? [], waybillSender: String(p.waybillSender ?? ''), waybillCarrier: String(p.waybillCarrier ?? ''), qrOk: true }, c.a.id);
});

/** Registrar la salida de una orden activa (RF-STO-14). */
export function checkoutRelease(c: C, rel: ReleaseOrder, kgOut: number, by: string) {
  const lot = c.w.lots[rel.lotId];
  rel.status = 'USED';
  rel.usedAt = c.t;
  rel.kgOut = kgOut;
  if (lot) {
    lot.balanceKg = Math.max(0, Math.round((lot.balanceKg - kgOut) * 10) / 10);
    lot.balanceSacks = Math.max(0, lot.balanceSacks - rel.sacks);
    if (lot.balanceSacks <= 0 || lot.balanceKg <= 0.5) lot.status = 'CLOSED';
    notify(c as any, lot.farmerOrgId, 'STORAGE', 'Salida registrada', `${rel.code}: salieron ${rel.sacks} sacos (${fkg(kgOut)}) del lote ${lot.code}. Quedan ${lot.balanceSacks} sacos.`);
  }
}

on('SHIP_ARRIVE', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.carrierOrgId ?? '');
  if (sh.status !== 'PICKED_UP') fail('STATE', 'Primero registra el recojo.');
  sh.status = 'ARRIVED';
  sh.events.push({ kind: 'ARRIVED', at: c.t, text: 'Llegó a la entrega', by: c.a.id });
  notify(c, sh.buyerOrgId, 'SHIPMENT', `${c.a.shortName} llegó`, `${sh.code}: cuenten y pesen juntos. Paga el flete (${money(sh.freight)}) y dicta tu código.`, { screen: 'B-32', params: { id: sh.id } });
});

on('SHIP_BUYER_PAID', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.buyerOrgId);
  if (!['PICKED_UP', 'ARRIVED'].includes(sh.status)) fail('STATE', 'El flete se paga al recibir.');
  sh.buyerPaid = { method: c.e.p.method ?? 'YAPE', at: c.t };
  sh.events.push({ kind: 'FREIGHT_PAID', at: c.t, text: `La MYPE pagó el flete por ${c.e.p.method === 'CASH' ? 'efectivo' : c.e.p.method === 'PLIN' ? 'Plin' : c.e.p.method === 'TRANSFER' ? 'transferencia' : 'Yape'}` });
  if (sh.carrierOrgId) notify(c, sh.carrierOrgId, 'SHIPMENT', 'Te pagaron el flete', `${sh.code}: ${money(sh.freight)}. Revisa y pide el código de entrega.`);
});

/** Entrega con código (CU-97, RN-58): sin código no hay entrega; el flete figura cobrado solo cuando el transportista lo confirma. */
on('SHIP_DELIVER', (c) => {
  const p = c.e.p;
  const sh = getShip(c.w, p.shipmentId);
  requireMember(c.a, sh.carrierOrgId ?? '');
  if (!['PICKED_UP', 'ARRIVED'].includes(sh.status)) fail('STATE', 'Este envío no está en camino.');
  const s = getSub(c.w, sh.subOrderId);
  if (!codeMatches(s.deliveryCode, p.code, CODE_SALT.delivery(s.id))) fail('BAD_CODE', 'El código no es correcto. Sin código no hay entrega: pídelo otra vez al negocio (RN-58).');
  if (!p.collected) fail('COLLECT', `Confirma que cobraste el flete (${money(sh.freight)}). Mesagri no lo cobra por ti (RN-55).`);
  const kgv = Number(p.kg) || sh.pickup?.kg || sh.weightKg;
  sh.delivery = { at: c.t, sacks: Number(p.sacks) || sh.sacks, kg: kgv, photoIds: p.photoIds ?? [], method: p.method ?? sh.buyerPaid?.method ?? 'YAPE', collected: true };
  sh.status = 'DELIVERED';
  sh.onTime = c.t <= sh.deliverTo + 15 * MIN;
  sh.events.push({ kind: 'DELIVERED', at: c.t, text: `Entregado con código · flete cobrado (${money(sh.freight)})`, by: c.a.id });
  if (s.status === 'READY') setStatus(s, 'IN_TRANSIT', c.t, c.a.id);
  deliverSub(c, s, c.a.id, (p.photoIds ?? [])[0]);
  const base = sh.pickup?.kg ?? sh.weightKg;
  const diff = base ? Math.abs(kgv - base) / base : 0;
  if (diff > c.w.settings.carrier.weightTolerance) {
    sh.events.push({ kind: 'WEIGHT', at: c.t, text: `Diferencia de peso de ${(diff * 100).toFixed(1)} % (más de 1 %, RN-60)` });
    notify(c, sh.buyerOrgId, 'SHIPMENT', 'Diferencia de peso', `${sh.code}: llegó ${fkg(kgv)} y se recogió ${fkg(base)}. Puedes reclamar en 24 h con fotos.`, { screen: 'B-32', params: { id: sh.id } });
  }
  notify(c, sh.buyerOrgId, 'SHIPMENT', 'Envío entregado', `${sh.code}: califica a ${c.a.shortName}.`, { screen: 'B-33', params: { id: sh.id } });
  notify(c, sh.sellerOrgId, 'SHIPMENT', 'Tu pedido llegó', `${s.code} fue entregado por el transportista.`);
});

on('SHIP_INCIDENT', (c) => {
  const p = c.e.p;
  const sh = getShip(c.w, p.shipmentId);
  const isCarrier = c.a.orgId === sh.carrierOrgId;
  if (!isCarrier && c.a.orgId !== sh.buyerOrgId && c.a.orgId !== sh.sellerOrgId) fail('FORBIDDEN', 'No participas en este envío.');
  if (!['ASSIGNED', 'GOING_TO_PICKUP', 'PICKED_UP', 'ARRIVED'].includes(sh.status)) fail('STATE', 'Este envío no está en curso.');
  const kind = String(p.kind ?? 'Demora');
  const text = String(p.text ?? '').trim();
  sh.incidents.push({ id: String(p.incidentId ?? c.e.id), kind, at: c.t, text, newEta: p.newEta ? String(p.newEta).slice(0, 40) : undefined, where: p.where ? String(p.where).slice(0, 200) : undefined, photoIds: Array.isArray(p.photoIds) ? p.photoIds.map(String) : [] });
  sh.events.push({ kind: 'INCIDENT', at: c.t, text: `${kind}${p.newEta ? ` · nueva hora ${p.newEta}` : ''}${text ? ` · ${text}` : ''}`, by: c.a.id });
  const msg = `${sh.code}: ${kind.toLowerCase()}${p.newEta ? `, llega a las ${p.newEta}` : ''}. ${text}`.trim();
  for (const to of [sh.buyerOrgId, sh.sellerOrgId, sh.carrierOrgId].filter(x => x && x !== c.a.orgId)) notify(c, to!, 'SHIPMENT', 'Aviso en ruta', msg, { screen: 'B-31', params: { id: sh.id } });
  if (['Carga dañada o mojada', 'Accidente', 'Robo'].includes(kind)) notify(c, 'ADMIN', 'SHIPMENT', 'Incidente en ruta', msg, { screen: 'W-17' });
});

on('SHIP_NO_SHOW', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.sellerOrgId);
  if (!['ASSIGNED', 'GOING_TO_PICKUP'].includes(sh.status)) fail('STATE', 'Este envío no espera recojo.');
  if (c.t < sh.pickupAt + HOUR) fail('TOO_SOON', `Espera hasta las ${hhmm(sh.pickupAt + HOUR)}: una hora después de la hora de recojo.`);
  const carrier = getOrg(c.w, sh.carrierOrgId!);
  carrier.carrier!.noShows++;
  sh.events.push({ kind: 'NO_SHOW', at: c.t, text: `${carrier.name} no llegó al recojo (inasistencia ${carrier.carrier!.noShows} de 3)` });
  if (carrier.carrier!.noShows >= 3) { carrier.carrier!.available = false; notify(c, 'ADMIN', 'SHIPMENT', 'Tercera inasistencia', `${carrier.name} queda suspendido para ofertas (RN-52).`); }
  notify(c, carrier.id, 'SHIPMENT', 'Inasistencia registrada', `${sh.code}: no llegaste al recojo. Con 3 inasistencias la cuenta deja de recibir ofertas (RN-52).`);
  sh.carrierOrgId = undefined;
  sh.status = 'OFFERING';
  sh.offeringSince = c.t;
  offerNext(c, sh, c.t);
});

/* ---------- Reclamos (RF-TRA-19, RN-59, RN-60) ---------- */
on('SHIP_CLAIM', (c) => {
  const p = c.e.p;
  const sh = getShip(c.w, p.shipmentId);
  requireMember(c.a, sh.buyerOrgId);
  if (!['DELIVERED', 'CLOSED'].includes(sh.status) || !sh.delivery) fail('STATE', 'Se reclama después de recibir.');
  if (c.t > sh.delivery.at + c.w.settings.claimHours * HOUR) fail('CLAIM_WINDOW', 'Pasaron las 24 horas para reclamar (RN-60).');
  if (sh.claim) fail('ALREADY', 'Ya hay un reclamo para este envío.');
  const text = String(p.text ?? '').trim();
  if (text.length < 5) fail('TEXT', 'Cuéntanos qué pasó.');
  sh.claim = { at: c.t, kind: String(p.kind ?? 'Pérdida'), kgLost: Number(p.kgLost) || 0, text, status: 'OPEN' };
  sh.events.push({ kind: 'CLAIM', at: c.t, text: `Reclamo: ${sh.claim.kind} · ${text}` });
  if (sh.carrierOrgId) notify(c, sh.carrierOrgId, 'SHIPMENT', 'Reclamo por el envío', `${sh.code}: ${text}. Envía tu descargo.`, { screen: 'T-10' });
  notify(c, 'ADMIN', 'SHIPMENT', 'Reclamo de envío', `${sh.code}: ${text}`, { screen: 'W-17' });
});

on('SHIP_CLAIM_RESPOND', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.carrierOrgId ?? '');
  if (!sh.claim || sh.claim.status !== 'OPEN') fail('STATE', 'No hay un reclamo por responder.');
  sh.claim.response = String(c.e.p.text ?? '').slice(0, 400);
  sh.claim.status = 'RESPONDED';
  notify(c, sh.buyerOrgId, 'SHIPMENT', 'Descargo del transportista', `${sh.code}: ${sh.claim.response}`);
});

on('SHIP_CLAIM_RESOLVE', (c) => {
  requireAdmin(c.a, 'SUPPORT', 'GENERAL');
  const sh = getShip(c.w, c.e.p.shipmentId);
  if (!sh.claim || sh.claim.status === 'RESOLVED') fail('STATE', 'No hay un reclamo abierto.');
  const comp = r2(Number(c.e.p.compensation) || 0);
  if (comp < 0 || comp > sh.cargoValue) fail('BAD_AMOUNT', 'La compensación no puede pasar el valor de la carga.');
  const res = String(c.e.p.resolution ?? '').trim();
  if (res.length < 5) fail('REASON_REQUIRED', 'Anota la resolución.');
  sh.claim.status = 'RESOLVED'; sh.claim.compensation = comp; sh.claim.resolution = res;
  audit(c, c.a.id, 'RECLAMO DE ENVÍO', sh.id, `${sh.code}: ${res} · compensación ${money(comp)}`);
  for (const to of [sh.buyerOrgId, sh.carrierOrgId].filter(Boolean)) notify(c, to!, 'SHIPMENT', 'Reclamo resuelto', `${sh.code}: ${res}${comp ? ` · compensación ${money(comp)} al precio del pedido` : ''}.`);
});

/* ---------- Cambiar de opción, volver a ofrecer, cancelar (RF-TRA-12, RF-TRA-20) ---------- */
on('SHIP_SWITCH_MODE', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.buyerOrgId);
  if (!['WAITING_FARMER', 'OFFERING', 'ASSIGNED', 'GOING_TO_PICKUP', 'NO_CARRIER'].includes(sh.status)) fail('STATE', 'El envío ya no se puede cambiar.');
  const s = getSub(c.w, sh.subOrderId);
  const mode = c.e.p.mode as 'PICKUP' | 'FARMER';
  const seller = getOrg(c.w, s.sellerOrgId);
  let fee = 0;
  if (mode === 'FARMER') {
    const a = seller.serviceAreas.find(x => x.district === s.district);
    if (!a) fail('ZONE', `${seller.name} no reparte en tu distrito (RN-27).`);
    fee = a.fee;
  } else if (mode !== 'PICKUP') fail('BAD_MODE', 'Elige recojo o envío del agricultor.');
  let ff = 0;
  if (sh.status === 'GOING_TO_PICKUP') ff = r2(sh.freight * c.w.settings.carrier.falseFreight);
  sh.status = 'CANCELLED';
  sh.falseFreight = ff || undefined;
  sh.cancelReason = mode === 'PICKUP' ? 'La MYPE prefirió recoger' : 'La MYPE prefirió el envío del agricultor';
  sh.events.push({ kind: 'CANCELLED', at: c.t, text: `${sh.cancelReason}${ff ? ` · falso flete ${money(ff)}` : ' · sin costo'}` });
  if (sh.carrierOrgId) notify(c, sh.carrierOrgId, 'SHIPMENT', 'Envío cancelado', `${sh.code}: ${sh.cancelReason}.${ff ? ` Te corresponde ${money(ff)} (RN-61).` : ''}`);
  s.deliveryMode = mode;
  s.deliveryFee = fee;
  s.total = r2(s.subtotal + fee);
  s.shipmentId = undefined;
  if (mode === 'PICKUP') s.pickupCode = secretOr(c.e.p.secrets?.pickup, /^\d{4}$/, () => digitsFrom(s.id + ':recojo'));
  s.history.push({ status: s.status, at: c.t, by: c.a.id, note: mode === 'PICKUP' ? 'Cambió a recojo por su cuenta' : 'Cambió a envío del agricultor' });
  notify(c, s.sellerOrgId, 'ORDER', 'Cambio de entrega', `${s.code}: ${mode === 'PICKUP' ? 'el comprador recogerá en tu punto' : `lo llevas tú${fee ? ` (envío ${money(fee)})` : ''}`}.`);
});

on('SHIP_REOFFER', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.buyerOrgId);
  if (sh.status !== 'NO_CARRIER') fail('STATE', 'Este envío no está esperando otra fecha.');
  const day = Number(c.e.p.date);
  if (!(day > 0) || endOfDay(day) < c.t) fail('BAD_DATE', 'Elige una fecha futura.');
  const city = sh.scope === 'CIUDAD';
  sh.pickupAt = atHour(day, city ? 9 : 14, city ? 0 : 20);
  sh.deliverFrom = atHour(day, city ? 10 : 18);
  sh.deliverTo = atHour(day, city ? 12 : 19, city ? 0 : 30);
  sh.offers = [];
  sh.status = 'OFFERING';
  sh.offeringSince = c.t;
  const s = c.w.subOrders[sh.subOrderId];
  if (s) s.deliveryDate = atHour(day, 0);
  sh.events.push({ kind: 'REOFFER', at: c.t, text: 'Se buscó transportista para otra fecha' });
  offerNext(c, sh, c.t);
});

/* ---------- Calificación con recomendación (RF-TRA-21, RN-64) ---------- */
on('SHIP_RATE', (c) => {
  const p = c.e.p;
  const sh = getShip(c.w, p.shipmentId);
  requireMember(c.a, sh.buyerOrgId);
  if (!['DELIVERED', 'CLOSED'].includes(sh.status)) fail('STATE', 'Solo califica quien recibió el envío (RN-64).');
  if (sh.rating) fail('ALREADY', 'Ya calificaste este envío.');
  const v = [p.punctuality, p.care, p.treatment].map(Number);
  if (v.some(x => !(x >= 1 && x <= 5))) fail('BAD_STARS', 'Califica los tres aspectos de 1 a 5.');
  sh.rating = { punctuality: v[0], care: v[1], treatment: v[2], tags: (p.tags ?? []).slice(0, 6), recommends: !!p.recommends, comment: String(p.comment ?? '').slice(0, 300) || undefined, at: c.t };
  if (p.favorite && sh.carrierOrgId) {
    const f = c.w.favorites[sh.buyerOrgId] ?? (c.w.favorites[sh.buyerOrgId] = { listings: [], sellers: [], carriers: [] });
    if (!f.carriers.includes(sh.carrierOrgId)) f.carriers.push(sh.carrierOrgId);
  }
  if (sh.carrierOrgId) notify(c, sh.carrierOrgId, 'REVIEW', `Te calificaron con ${Math.round((v[0] + v[1] + v[2]) / 3 * 10) / 10} estrellas`, `${c.w.orgs[sh.buyerOrgId].name}${sh.rating.recommends ? ' te recomienda' : ''}.`);
});

on('SHIP_RATING_REPLY', (c) => {
  const sh = getShip(c.w, c.e.p.shipmentId);
  requireMember(c.a, sh.carrierOrgId ?? '');
  if (!sh.rating) fail('STATE', 'Este envío no tiene calificación.');
  if (sh.rating.reply) fail('ALREADY', 'Ya respondiste.');
  sh.rating.reply = String(c.e.p.text ?? '').slice(0, 300);
});

/* ---------- Temporizadores de envíos ---------- */
export function shippingDeadlines(w: World): { at: number; run: (t: number) => void }[] {
  const out: { at: number; run: (t: number) => void }[] = [];
  for (const id in w.shipments) {
    const sh = w.shipments[id];
    if (sh.status === 'OFFERING') {
      const cur = currentOffer(sh);
      const deadline = (sh.offeringSince ?? sh.requestedAt) + w.settings.carrier.noCarrierHours * HOUR;
      if (cur) out.push({ at: cur.expiresAt, run: (t) => { cur.response = 'EXPIRED'; cur.respondedAt = t; sh.events.push({ kind: 'OFFER_EXPIRED', at: t, text: `${w.orgs[cur.carrierOrgId]?.name ?? 'Transportista'} no respondió a tiempo` }); offerNext({ w, t }, sh, t); } });
      else out.push({ at: deadline, run: (t) => offerNext({ w, t }, sh, t) });
    }
    if (sh.status === 'DELIVERED' && sh.delivery && !(sh.claim && sh.claim.status !== 'RESOLVED')) {
      const at = sh.delivery.at + w.settings.claimHours * HOUR;
      out.push({ at, run: (t) => { sh.status = 'CLOSED'; sh.closedAt = t; sh.events.push({ kind: 'CLOSED', at: t, text: sh.claim ? 'Cerrado con el reclamo resuelto' : 'Cerrado sin reclamo (24 h)' }); } });
    }
  }
  return out;
}
