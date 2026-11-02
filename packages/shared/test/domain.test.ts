import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, replay, tick, structuredCloneSafe, eventOrder } from '../src/engine/index';
import { LAST_SEED_REPORT, SEED_ANCHOR } from '../src/seed';
import type { MEvent, World } from '../src/types';
import { cashCheck, commissionPreview, priceDeviation, freightFor, isRucValid, rucWithCheck, storageQuote } from '../src/rules';
import { reservedFreeSlots, monthPurchases, activeListings } from '../src/queries';
import { product } from '../src/catalog';
import { HOUR, MIN, DAY, limaTime } from '../src/time';
import { DEFAULT_SETTINGS } from '../src/settings';
import { interpret, wordsToNumbers } from '../src/voice';

let n = 0;
const ev = (w: World, actor: string, type: string, p: any, dt = 1 * MIN): MEvent => ({ id: `t-${++n}`, type, actor, t: w.now + dt, lamport: 0, p });
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any, dt?: number) => applySafe(w, ev(w, actor, type, p, dt));

function order(buyerUser: string, sub: string, seller: string, listingId: string, qty: number, mode: 'FARMER' | 'PICKUP' | 'CARRIER', pay: string, taxDoc: string, extra: any = {}) {
  return { orderId: `o-${sub}`, subs: [{ subOrderId: sub, sellerOrgId: seller, items: [{ listingId, qty }], deliveryMode: mode, deliveryDate: SEED_ANCHOR + DAY, taxDoc, payMethod: pay, shipmentId: mode === 'CARRIER' ? `sh-${sub}` : undefined }], ...extra };
}

describe('mundo de ejemplo', () => {
  it('se construye sin rechazos y con los datos de las maquetas', () => {
    const w = seedWorld();
    expect(LAST_SEED_REPORT.rejected).toEqual([]);
    expect(w.now).toBe(SEED_ANCHOR);
    expect(w.statements['st-FARMER-org-wilber-2026-10'].total).toBeCloseTo(41.4, 2); // A-26
    expect(w.statements['st-FARMER-org-lucio-2026-09'].status).toBe('OVERDUE');
    expect(w.subOrders['so-a02'].status).toBe('PENDING_CONFIRMATION');
    expect(w.subOrders['so-c03'].status).toBe('IN_TRANSIT');
    expect(w.disputes['dsp-j01'].code).toBe('DSP-0031');
    expect(w.orgs['org-hector'].counters.freeSalesUsed).toBe(3);
    expect(reservedFreeSlots(w, 'org-hector')).toBe(1);
  });
  it('reconstruir con los mismos eventos da el mismo mundo (determinista)', () => {
    const init: MEvent = { id: 'init', type: 'WORLD_INIT', actor: 'system', t: SEED_ANCHOR, lamport: 0, p: { realAt: SEED_ANCHOR } };
    const w = fresh();
    const evs: MEvent[] = [init];
    const add = (actor: string, type: string, p: any, dt = MIN) => { const e = { ...ev(w, actor, type, p, dt), lamport: evs.length }; evs.push(e); const r = applySafe(w, e); return r; };
    add('u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-a02' });
    add('u-charo', 'ORDER_PLACE', order('u-charo', 'so-x1', 'org-wilber', 'l-w-papa', 20, 'FARMER', 'YAPE', 'LIQUIDACION'));
    add('u-wilber', 'SUBORDER_ACCEPT', { subOrderId: 'so-x1' });
    const again = replay(evs);
    expect(again.subOrders['so-x1'].status).toBe('CONFIRMED');
    expect(again.subOrders['so-a02'].status).toBe(w.subOrders['so-a02'].status);
    expect(again.listings['l-w-papa'].available).toBe(w.listings['l-w-papa'].available);
    expect([...evs].sort(eventOrder)[0].type).toBe('WORLD_INIT');
  });
});

describe('CU-26 · stock en pedidos simultáneos', () => {
  it('el segundo comprador no puede llevarse lo que ya se reservó', () => {
    const w = fresh();
    const l = w.listings['l-j-papa']; // Justina: 120 kg de papa nativa
    const r1 = run(w, 'u-charo', 'ORDER_PLACE', order('u-charo', 'so-c1', 'org-justina', 'l-j-papa', l.available - 10, 'PICKUP', 'YAPE', 'LIQUIDACION'));
    expect(r1.ok).toBe(true);
    const r2 = run(w, 'u-andres', 'ORDER_PLACE', order('u-andres', 'so-c2', 'org-justina', 'l-j-papa', 20, 'PICKUP', 'YAPE', 'LIQUIDACION'));
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe('STOCK');
    expect(w.listings['l-j-papa'].available).toBe(10);
  });
});

describe('RF-SUB-05 · límite del plan Básico', () => {
  it('pide pasar a Pro cuando el mes pasaría de S/ 2 500 y en el mes gratis sube sin cobrar', () => {
    const w = fresh();
    const before = monthPurchases(w, 'org-geranios', w.now);
    expect(before).toBeCloseTo(1346, 2);
    const p = order('u-charo', 'so-plan', 'org-hector', 'l-h-frejol', 150, 'FARMER', 'YAPE', 'BOLETA');
    const r = run(w, 'u-charo', 'ORDER_PLACE', p);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('PLAN_LIMIT');
    expect(r.error?.data.next).toBe('PRO');
    expect(r.error?.data.diff).toBe(50);
    const r2 = run(w, 'u-charo', 'ORDER_PLACE', { ...p, upgrade: { plan: 'PRO' } });
    expect(r2.ok).toBe(true);
    expect(w.orgs['org-geranios'].subscription?.plan).toBe('PRO');
  });
});

describe('RF-CMS-01/02 · 5 ventas sin comisión y 3 % desde la 6.ª (corrige D-01)', () => {
  it('lo que se ve al aceptar es lo que se cobra, aunque se completen en otro orden', () => {
    const w = fresh();
    // so-a02 (frejol 20 kg × 8 = 160) usa el cupo 5; un pedido nuevo sería la venta 6 con 3 %
    const seller = w.orgs['org-hector'];
    const prevA02 = commissionPreview(w.settings, seller, reservedFreeSlots(w, seller.id), 160, 0.03);
    expect(prevA02.isFree).toBe(true);
    expect(run(w, 'u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-a02' }).ok).toBe(true);
    expect(w.subOrders['so-a02'].freeSlotReserved).toBe(true);
    expect(run(w, 'u-elena', 'ORDER_PLACE', order('u-elena', 'so-6', 'org-hector', 'l-h-cebolla', 100, 'FARMER', 'CASH', 'BOLETA')).ok).toBe(true);
    const prev6 = commissionPreview(w.settings, w.orgs['org-hector'], reservedFreeSlots(w, 'org-hector'), 150, 0.03);
    expect(prev6.isFree).toBe(false);
    expect(prev6.amount).toBeCloseTo(4.5, 2);
    expect(run(w, 'u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-6' }).ok).toBe(true);
    // la venta 6 se completa ANTES que las de los cupos 4 y 5: igual paga 3 %
    run(w, 'u-hector', 'SUBORDER_PREPARE', { subOrderId: 'so-6' });
    run(w, 'u-hector', 'SUBORDER_READY', { subOrderId: 'so-6' });
    run(w, 'u-hector', 'SUBORDER_DISPATCH', { subOrderId: 'so-6' });
    const s6 = w.subOrders['so-6'];
    expect(run(w, 'u-hector', 'SUBORDER_DELIVER', { subOrderId: 'so-6', code: s6.deliveryCode, cashCollected: true }).ok).toBe(true);
    expect(run(w, 'u-elena', 'RECEIPT_CONFIRM', { subOrderId: 'so-6', lines: [{ listingId: 'l-h-cebolla', acceptedQty: 100, quality: 'OK' }] }).ok).toBe(true);
    expect(w.subOrders['so-6'].commission).toBeCloseTo(4.5, 2);
  });
  it('vista previa: 6.ª venta de S/ 400 → S/ 12,00', () => {
    const s = DEFAULT_SETTINGS;
    const org: any = { counters: { completedSales: 5, freeSalesUsed: 5 } };
    expect(commissionPreview(s, org, 0, 400, 0.03)).toMatchObject({ isFree: false, saleNumber: 6, amount: 12 });
  });
});

describe('Reglas de dinero', () => {
  it('RF-TRA-08 · flete Camaná–Arequipa: 200 kg → S/ 40 y 60 kg → S/ 20 (mínimo)', () => {
    const r = DEFAULT_SETTINGS.routes.find(x => x.id === 'camana-aqp')!;
    expect(freightFor(r, 200).freight).toBe(40);
    expect(freightFor(r, 60).freight).toBe(20);
    const city = DEFAULT_SETTINGS.routes.find(x => x.id === 'aqp-ciudad')!;
    expect(freightFor(city, 15).freight).toBe(8);
    expect(freightFor(city, 100).freight).toBe(35);
  });
  it('D-02 · el efectivo se mide con el envío incluido', () => {
    const buyer: any = { level: 2 }, seller: any = { level: 2, acceptsCash: true, name: 'X' };
    expect(cashCheck(DEFAULT_SETTINGS, 1994, buyer, seller).ok).toBe(true);
    expect(cashCheck(DEFAULT_SETTINGS, 1994 + 10, buyer, seller).ok).toBe(false);
  });
  it('D-03 · con +50 % exacto no pide confirmar; con más, sí', () => {
    expect(priceDeviation(3, 2, 0.5).ask).toBe(false);
    expect(priceDeviation(3.01, 2, 0.5).ask).toBe(true);
    expect(priceDeviation(0.99, 2, 0.5).ask).toBe(true);
  });
  it('RUC con dígito verificador', () => {
    const r = rucWithCheck('2060123456');
    expect(isRucValid(r)).toBe(true);
    expect(isRucValid(r.slice(0, 10) + ((Number(r[10]) + 1) % 10))).toBe(false);
  });
  it('¿te conviene guardar? (RF-STO-07)', () => {
    const q = storageQuote({ sacks: 10, kgPerSack: 50, pricePerKg: 1, rise: 0.3, months: 2, rate: 1.5, freight: 0, lossFarm: 0.14, lossStore: 0.02 });
    expect(q.sellToday).toBe(500);
    expect(q.rent).toBe(30);
    expect(q.storeRise).toBeCloseTo(607, 0);
    expect(q.best).toBe('ALMACEN');
  });
});

describe('G-01 · el pedido vence a las 12 horas', () => {
  it('pasa a vencido, libera el stock y avisa', () => {
    const w = fresh();
    const s = w.subOrders['so-a02'];
    const avail = w.listings['l-h-frejol'].available;
    tick(w, s.confirmBy - MIN);
    expect(w.subOrders['so-a02'].status).toBe('PENDING_CONFIRMATION');
    tick(w, s.confirmBy + MIN);
    expect(w.subOrders['so-a02'].status).toBe('EXPIRED');
    expect(w.listings['l-h-frejol'].available).toBe(avail + 20);
    expect(w.shipments['sh-so-a02'].status).toBe('CANCELLED');
    const r = run(w, 'u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-a02' });
    expect(r.ok).toBe(false);
  });
  it('RN-11 · conforme automático a las 48 h de entregado', () => {
    const w = fresh();
    run(w, 'u-wilber', 'SUBORDER_DELIVER', { subOrderId: 'so-c03', code: w.subOrders['so-c03'].deliveryCode });
    expect(w.subOrders['so-c03'].status).toBe('DELIVERED');
    tick(w, w.now + 48 * HOUR + MIN);
    expect(w.subOrders['so-c03'].status).toBe('COMPLETED');
  });
  it('RN-58 · sin el código correcto no hay entrega', () => {
    const w = fresh();
    const r = run(w, 'u-wilber', 'SUBORDER_DELIVER', { subOrderId: 'so-c03', code: '0000' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('BAD_CODE');
  });
  it('RF-PAY-05 · un número de operación no sirve para dos pagos', () => {
    const w = fresh();
    expect(run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456' }).ok).toBe(true);
    run(w, 'u-charo', 'ORDER_PLACE', order('u-charo', 'so-op', 'org-wilber', 'l-w-papa', 10, 'FARMER', 'YAPE', 'LIQUIDACION'));
    run(w, 'u-wilber', 'SUBORDER_ACCEPT', { subOrderId: 'so-op' });
    const r = run(w, 'u-charo', 'PAYMENT_UPLOAD', { subOrderId: 'so-op', method: 'YAPE', operation: '05123456' });
    expect(r.error?.code).toBe('OP_DUPLICATE');
  });
});

describe('Envío con transportista aliado (flujo 10)', () => {
  it('oferta a Julio, recojo con QR, entrega con código y flete cobrado', () => {
    const w = fresh();
    expect(run(w, 'u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-a02' }).ok).toBe(true);
    const sh = w.shipments['sh-so-a02'];
    expect(sh.freight).toBe(20); // 20 kg → mínimo S/ 20
    expect(sh.status).toBe('OFFERING');
    expect(sh.offers[0].carrierOrgId).toBe('org-julio'); // favorito del hotel
    expect(run(w, 'u-julio', 'SHIP_OFFER_RESPOND', { shipmentId: sh.id, accept: true }).ok).toBe(true);
    const s = w.subOrders['so-a02'];
    run(w, 'u-andres', 'PAYMENT_UPLOAD', { subOrderId: s.id, method: 'TRANSFER', operation: '99887766' });
    run(w, 'u-hector', 'PAYMENT_CONFIRM', { subOrderId: s.id });
    run(w, 'u-hector', 'SUBORDER_PREPARE', { subOrderId: s.id });
    run(w, 'u-hector', 'SUBORDER_READY', { subOrderId: s.id });
    expect(run(w, 'u-julio', 'SHIP_PICKUP', { shipmentId: sh.id, qr: 'X', sacks: 1, kg: 20, waybillCarrier: 'V1' }).error?.code).toBe('BAD_QR');
    expect(run(w, 'u-julio', 'SHIP_PICKUP', { shipmentId: sh.id, qr: s.pickupQr, sacks: 1, kg: 20, waybillSender: 'T1', waybillCarrier: 'V001-1' }).ok).toBe(true);
    expect(run(w, 'u-julio', 'SHIP_DELIVER', { shipmentId: sh.id, code: s.deliveryCode, collected: true, kg: 20 }).ok).toBe(true);
    expect(w.subOrders[s.id].status).toBe('DELIVERED');
    expect(w.shipments[sh.id].status).toBe('DELIVERED');
  });
});

describe('Intérprete de voz · 6 reglas nuevas (H2)', () => {
  const now = limaTime(2026, 11, 3, 9, 0);
  const I = (t: string) => interpret(t, { now });
  it('números en palabras', () => {
    expect(wordsToNumbers(['uno', 'cincuenta'])).toEqual(['1', '50']);
    expect(wordsToNumbers(['ciento', 'treinta', 'y', 'cinco'])).toEqual(['135']);
    expect(wordsToNumbers(['dos', 'mil', 'quinientos'])).toEqual(['2500']);
  });
  it('1 · precio sin «soles»', () => {
    const r = I('Tengo 50 kilos de cebolla roja, cosechada hoy, a uno cincuenta el kilo');
    expect(r).toMatchObject({ productId: 'cebolla_roja', qty: 50, unit: 'kg', pricePerKg: 1.5, harvestDaysAgo: 0, complete: true });
  });
  it('2 · diminutivos', () => {
    const r = I('Papitas amarillas, dos sacos, a dos setenta el kilo');
    expect(r).toMatchObject({ productId: 'papa_amarilla', qty: 2, unit: 'saco', pricePerKg: 2.7 });
    expect(I('unas cebollitas, veinte kilitos a un sol').productId).toBe('cebolla_roja');
  });
  it('3 · «y medio»', () => {
    expect(I('Vendo dos kilos y medio de habas a tres soles')).toMatchObject({ productId: 'haba_verde', qty: 2.5, unit: 'kg', pricePerKg: 3 });
    expect(I('saco y medio de quinua').qtyKg).toBe(75);
  });
  it('4 · «medio saco»', () => {
    expect(I('Medio saco de papa blanca a sesenta el saco')).toMatchObject({ productId: 'papa_blanca', qty: 25, unit: 'kg', pricePerKg: 1.2 });
  });
  it('5 · precio por saco', () => {
    expect(I('Papa amarilla, diez sacos a ciento treinta y cinco el saco, de primera')).toMatchObject({ qty: 10, unit: 'saco', pricePerKg: 2.7, quality: 'PRIMERA' });
  });
  it('6 · «hace una semana»', () => {
    expect(I('Cebolla roja doscientos kilos, cosechada hace una semana, a 1.40')).toMatchObject({ qty: 200, pricePerKg: 1.4, harvestDaysAgo: 7 });
    expect(I('papa cosechada hace dos semanas').harvestDaysAgo).toBe(14);
    expect(I('cebolla de la semana pasada').harvestDaysAgo).toBe(7);
  });
  it('sin producto no se completa (pasa al formulario)', () => {
    expect(I('tengo cincuenta kilos').complete).toBe(false);
  });
});

describe('RN-28 · cuenta de cobro de un tercero', () => {
  it('cambiar el cobro con un expediente abierto actualiza su evidencia y sus alertas', () => {
    const w = fresh();
    const k = Object.values(w.cases).find(c => c.orgId === 'org-rosa' && ['SUBMITTED', 'IN_REVIEW'].includes(c.status))!;
    expect(k.alerts).toContain('SELFIE BORROSA');
    expect(k.alerts).not.toContain('CUENTA DE TERCERO');
    const third = run(w, 'u-rosa', 'PAYOUT_SET', { orgId: 'org-rosa', accounts: [{ id: 'pa-x', kind: 'YAPE', number: '958441299', holder: 'Nely Ccalla', relation: 'FAMILIAR', authorization: 'Autorización firmada (foto)' }], acceptsCash: true });
    expect(third.ok).toBe(true);
    expect(w.cases[k.id].alerts).toEqual(expect.arrayContaining(['SELFIE BORROSA', 'CUENTA DE TERCERO']));
    expect(w.cases[k.id].evidence.filter(e => e.key === 'cobro').map(e => e.label)).toEqual(['Yape de un familiar con autorización firmada']);
    const own = run(w, 'u-rosa', 'PAYOUT_SET', { orgId: 'org-rosa', accounts: [{ id: 'pa-y', kind: 'YAPE', number: '958441207', holder: 'Rosa Ccalla Huamán', relation: 'PROPIA' }], acceptsCash: true });
    expect(own.ok).toBe(true);
    expect(w.cases[k.id].alerts).not.toContain('CUENTA DE TERCERO');
    expect(w.cases[k.id].evidence.find(e => e.key === 'cobro')?.label).toBe('Yape propio');
  });
  it('sin autorización firmada no se acepta la cuenta de un familiar', () => {
    const w = fresh();
    const r = run(w, 'u-rosa', 'PAYOUT_SET', { orgId: 'org-rosa', accounts: [{ id: 'pa-z', kind: 'YAPE', number: '958441299', holder: 'Nely Ccalla', relation: 'FAMILIAR' }], acceptsCash: false });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NEEDS_AUTH');
  });
});

describe('Antes de la versión 2, ya en el MVP · solicitudes, programados, equipo y catálogo', () => {
  const offer = (extra: any) => ({ requestId: 'req-c01', harvestDate: SEED_ANCHOR, quality: 'PRIMERA', ...extra });

  it('RF-ORD-09 · solicitud: respeta el tope, la oferta aceptada es un pedido y esa venta no sale en el catálogo', () => {
    const w = fresh();
    expect(run(w, 'u-wilber', 'REQUEST_OFFER', offer({ offerId: 'ofr-t1', pricePerKg: 2.6, kg: 80 })).error?.code).toBe('ABOVE_MAX');
    expect(run(w, 'u-wilber', 'REQUEST_OFFER', offer({ offerId: 'ofr-t1', pricePerKg: 2.3, kg: 80 })).ok).toBe(true);
    expect(run(w, 'u-wilber', 'REQUEST_OFFER', offer({ offerId: 'ofr-t2', pricePerKg: 2.2, kg: 80 })).error?.code).toBe('ALREADY');
    const acc = run(w, 'u-charo', 'REQUEST_ACCEPT', { requestId: 'req-c01', offerId: 'ofr-t1', orderId: 'o-rq1', subOrderId: 'so-rq1', deliveryMode: 'PICKUP', payMethod: 'YAPE', taxDoc: 'LIQUIDACION' });
    expect(acc.ok).toBe(true);
    const so = w.subOrders['so-rq1'];
    expect(so.sellerOrgId).toBe('org-wilber');
    expect(so.status).toBe('PENDING_CONFIRMATION');
    expect(so.total).toBeCloseTo(184, 2);
    expect(w.requests['req-c01'].status).toBe('AWARDED');
    const lid = so.items[0].listingId;
    expect(w.listings[lid].requestId).toBe('req-c01');
    expect(activeListings(w, 'org-wilber').some(l => l.id === lid)).toBe(false);
    expect(run(w, 'u-elena', 'ORDER_PLACE', order('u-elena', 'so-rq2', 'org-wilber', lid, 1, 'PICKUP', 'YAPE', 'LIQUIDACION')).ok).toBe(false);
  });

  it('RF-ORD-10 · programado: se arma 2 días antes a las 8:00 y, sin aprobar, vence el día anterior a las 18:00', () => {
    const w = fresh();
    expect(w.schedules['prg-a02'].draft?.status).toBe('PENDING');
    expect(w.schedules['prg-a01'].draft?.status).not.toBe('PENDING');
    tick(w, SEED_ANCHOR + 23 * HOUR);                 // miércoles 7:30
    expect(w.schedules['prg-a01'].draft?.status).not.toBe('PENDING');
    tick(w, SEED_ANCHOR + 24 * HOUR);                 // miércoles 8:30
    const d = w.schedules['prg-a01'].draft!;
    expect(d.status).toBe('PENDING');
    expect(d.at).toBe(SEED_ANCHOR + 23 * HOUR + 30 * MIN);
    tick(w, SEED_ANCHOR + 34 * HOUR);                 // miércoles 18:30: el del jueves no se aprobó
    expect(w.schedules['prg-a02'].draft?.status).toBe('EXPIRED');
    expect(w.schedules['prg-a01'].draft?.status).toBe('PENDING');
    tick(w, SEED_ANCHOR + 58 * HOUR);                 // jueves 18:30
    expect(w.schedules['prg-a01'].draft?.status).toBe('EXPIRED');
  });

  it('B-23 · permisos del equipo: quien solo pide no aprueba, en pausa no hace nada y el equipo lo cambia el titular', () => {
    const w = fresh();
    const ap = { scheduleId: 'prg-a02', orderId: 'o-prg', subOrderIds: ['so-prg1', 'so-prg2'], useAlt: {} };
    expect(run(w, 'u-rosaq', 'SCHEDULE_APPROVE', ap).error?.code).toBe('NO_PERMISSION');
    expect(run(w, 'u-rosaq', 'TEAM_ADD', { userId: 'u-kevin', name: 'Kevin Torres', phone: '951357246', perms: ['PEDIR'] }).error?.code).toBe('TITULAR_ONLY');
    expect(run(w, 'u-dario', 'SCHEDULE_APPROVE', ap).ok).toBe(true);
    expect(w.subOrders['so-prg1'].sellerOrgId).toBe('org-wilber');
    expect(w.schedules['prg-a02'].draft?.status).toBe('APPROVED');
    expect(run(w, 'u-dario', 'SCHEDULE_APPROVE', { ...ap, orderId: 'o-prg2', subOrderIds: ['so-prg3'] }).error?.code).toBe('STATE');
    expect(run(w, 'u-andres', 'TEAM_SET', { userId: 'u-rosaq', active: false }).ok).toBe(true);
    expect(run(w, 'u-rosaq', 'ORDER_PLACE', order('u-rosaq', 'so-rq9', 'org-wilber', 'l-w-papa', 10, 'PICKUP', 'YAPE', 'LIQUIDACION')).error?.code).toBe('MEMBER_PAUSED');
  });

  it('A-28 · Nayeli oferta por Wilber a su nombre, pero la cuenta de cobro es solo del titular', () => {
    const w = fresh();
    expect(run(w, 'u-nayeli', 'REQUEST_OFFER', offer({ offerId: 'ofr-n1', pricePerKg: 2.2, kg: 40 })).ok).toBe(true);
    const o = w.requests['req-c01'].offers.find(x => x.id === 'ofr-n1')!;
    expect(o.sellerOrgId).toBe('org-wilber');
    expect(o.userId).toBe('u-nayeli');
    expect(run(w, 'u-nayeli', 'PAYOUT_SET', { orgId: 'org-wilber', accounts: [], acceptsCash: true }).error?.code).toBe('TITULAR_ONLY');
  });

  it('W-09 y W-05 · producto nuevo del catálogo y restablecer acceso, según el rol del equipo', () => {
    const w = fresh();
    const maca = { name: 'Maca', category: 'TUBERCULOS', units: ['kg', 'saco'], chacra: 7, mayorista: 9.5, perishDays: 120, storable: true, synonyms: [] };
    expect(run(w, 'u-ana', 'CATALOG_ADD', maca).ok).toBe(false);
    expect(run(w, 'u-carlos', 'CATALOG_ADD', maca).ok).toBe(true);
    expect(Object.values(w.catalogExtra).some(x => x.name === 'Maca')).toBe(true);
    expect(product(Object.keys(w.catalogExtra)[0]).name).toBe('Maca');
    expect(run(w, 'u-lucia', 'ACCESS_RESET', { orgId: 'org-wilber' }).ok).toBe(false);
    expect(run(w, 'u-diana', 'ACCESS_RESET', { orgId: 'org-wilber', reason: 'Perdió el celular' }).ok).toBe(true);
    expect(w.audit.some(a => a.action === 'RESTABLECER ACCESO')).toBe(true);
  });
});
