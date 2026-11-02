/*
 * La base es la fuente de la verdad: lo que se guarda acción por acción y se vuelve a leer
 * tiene que ser el mismo mundo (prueba de ida y vuelta contra MySQL real).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { buildSeedWith, applySafe, tick, structuredCloneSafe, seedWorld, SEED_ANCHOR, HOUR, MIN, DAY } from '@mesagri/shared';
import type { World, MEvent } from '@mesagri/shared';
import { tx, rows } from '../src/db/db';
import { Persistence } from '../src/db/store/persistence';
import { freshDb, worldDiff } from './helpers';

const DB = 'mesagri_test_store';
let pool: Pool;
let store: Persistence;
let w: World;

async function save(next: World, prev: World | undefined) {
  await tx(pool, async c => {
    const r = await store.persist(c, prev, next);
    r.commit();
  });
}

let n = 0;
/** Acciones que el motor rechazó (para revisar que la prueba cubra lo que dice). */
export const skipped: string[] = [];
const ev = (actor: string, type: string, p: any, dt = 2 * MIN): MEvent => ({ id: `rt-${++n}`, type, actor, t: w.now + dt, lamport: 0, p });

/** Aplica una acción como lo hará el servidor: sobre una copia, y si pasa, guarda la diferencia. */
async function act(actor: string, type: string, p: any, dt?: number) {
  const next = structuredCloneSafe(w);
  const r = applySafe(next, ev(actor, type, p, dt));
  if (!r.ok) { skipped.push(`${type}: ${r.error?.code} ${r.error?.message}`); return r; }
  await save(next, w);
  w = next;
  return r;
}

beforeAll(async () => {
  pool = await freshDb(DB);
  store = new Persistence(pool);
  await store.init();
});

afterAll(async () => {
  await pool?.end();
});

describe('Mundo ↔ MySQL', () => {
  it('la historia de la demo, guardada acción por acción, vuelve igual desde la base', async () => {
    type Op = { e?: MEvent; t?: number };
    let base: World | undefined;
    const ops: Op[] = [];
    const final = buildSeedWith(
      (x, e) => { base ??= structuredCloneSafe(x); ops.push({ e: structuredCloneSafe(e) }); return applySafe(x, e); },
      (x, t) => { base ??= structuredCloneSafe(x); ops.push({ t }); tick(x, t); },
    );
    expect(base).toBeTruthy();
    const t0 = Date.now();
    w = structuredCloneSafe(base!);
    await save(w, undefined);
    for (const op of ops) {
      const next = structuredCloneSafe(w);
      if (op.e) applySafe(next, op.e); else tick(next, op.t!);
      await save(next, w);
      w = next;
    }
    const last = structuredCloneSafe(w);
    last.now = SEED_ANCHOR;
    last.rejected = {};
    await save(last, w);
    w = last;
    console.log(`historia: ${ops.length} pasos guardados en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    expect(worldDiff(w, final)).toEqual([]);
    expect(worldDiff(w, seedWorld())).toEqual([]);

    const again = await new Persistence(pool).load();
    expect(worldDiff(again, w)).toEqual([]);
  });

  it('las tablas quedan como dice el documento (conteos y vistas)', async () => {
    const one = async (sql: string) => Number(Object.values((await rows(pool, sql))[0])[0]);
    expect(await one('SELECT COUNT(*) FROM organizations')).toBe(Object.keys(w.orgs).length);
    expect(await one('SELECT COUNT(*) FROM sub_orders')).toBe(Object.keys(w.subOrders).length);
    expect(await one('SELECT COUNT(*) FROM sub_order_items')).toBe(Object.values(w.subOrders).reduce((s, x) => s + x.items.length, 0));
    expect(await one('SELECT COUNT(*) FROM shipments')).toBe(Object.keys(w.shipments).length);
    expect(await one('SELECT COUNT(*) FROM inventory_movements')).toBe(w.movements.length);
    expect(await one("SELECT COUNT(*) FROM payout_accounts WHERE account_enc IS NOT NULL")).toBe(Object.values(w.orgs).reduce((s, o) => s + o.payout.length, 0));
    expect(await one('SELECT COUNT(*) FROM v_active_listings')).toBeGreaterThan(5);
    expect(await one('SELECT COUNT(*) FROM v_verification_queue')).toBeGreaterThan(3);
    expect(await one('SELECT COUNT(*) FROM v_seller_inbox')).toBeGreaterThan(0);
    // los códigos de entrega no se guardan en claro (14.9)
    const code = w.subOrders['so-a02'].deliveryCode;
    expect(await one(`SELECT COUNT(*) FROM deliveries WHERE delivery_code_enc = '${code}'`)).toBe(0);
  });

  it('acciones nuevas (pedidos, envíos, almacén, cobros y configuración) se guardan y vuelven iguales', async () => {
    const ok = async (actor: string, type: string, p: any, dt?: number) => {
      const r = await act(actor, type, p, dt);
      if (!r.ok) throw new Error(`${type}: ${r.error?.code} ${r.error?.message}`);
      return r;
    };
    // flujo 10: oferta al transportista, recojo con QR y entrega con código
    await ok('u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-a02' });
    const sh = w.shipments['sh-so-a02'];
    await ok('u-julio', 'SHIP_OFFER_RESPOND', { shipmentId: sh.id, accept: true });
    await ok('u-andres', 'PAYMENT_UPLOAD', { subOrderId: 'so-a02', method: 'TRANSFER', operation: '99887766' });
    await ok('u-hector', 'PAYMENT_CONFIRM', { subOrderId: 'so-a02' });
    await ok('u-hector', 'SUBORDER_PREPARE', { subOrderId: 'so-a02' });
    await ok('u-hector', 'SUBORDER_READY', { subOrderId: 'so-a02' });
    await ok('u-julio', 'SHIP_PICKUP', { shipmentId: sh.id, qr: w.subOrders['so-a02'].pickupQr, sacks: 1, kg: 20, waybillSender: 'T1', waybillCarrier: 'V001-1' });
    await ok('u-julio', 'SHIP_DELIVER', { shipmentId: sh.id, code: w.subOrders['so-a02'].deliveryCode, collected: true, kg: 20 });
    await ok('u-andres', 'MSG_SEND', { msgId: 'm-rt-1', conv: 'so-a02', text: 'Llegó bien, gracias.' });
    // pedido nuevo y comisión desde la 6.ª venta
    await ok('u-elena', 'ORDER_PLACE', { orderId: 'o-rt-6', subs: [{ subOrderId: 'so-rt-6', sellerOrgId: 'org-hector', items: [{ listingId: 'l-h-cebolla', qty: 100 }], deliveryMode: 'FARMER', deliveryDate: SEED_ANCHOR + DAY, taxDoc: 'BOLETA', payMethod: 'CASH' }] });
    await ok('u-hector', 'SUBORDER_ACCEPT', { subOrderId: 'so-rt-6' });
    await ok('u-hector', 'SUBORDER_PREPARE', { subOrderId: 'so-rt-6' });
    await ok('u-hector', 'SUBORDER_READY', { subOrderId: 'so-rt-6' });
    await ok('u-hector', 'SUBORDER_DISPATCH', { subOrderId: 'so-rt-6' });
    await ok('u-hector', 'SUBORDER_DELIVER', { subOrderId: 'so-rt-6', code: w.subOrders['so-rt-6'].deliveryCode, cashCollected: true });
    await ok('u-elena', 'RECEIPT_CONFIRM', { subOrderId: 'so-rt-6', lines: [{ listingId: 'l-h-cebolla', acceptedQty: 100, quality: 'OK' }] });
    // un usuario nuevo, su cobro, zonas y chacra
    await ok('u-rt-farmer', 'USER_REGISTER', { userId: 'u-rt-farmer', orgId: 'org-rt-farmer', role: 'FARMER', phone: '987650001', name: 'Prueba Ida Vuelta', dni: '41234567', org: { district: '040519' } }, MIN);
    await ok('u-rt-farmer', 'CONSENTS_ACCEPT', { version: '1.0', items: { distrito: true, dni: true, whatsapp: true } });
    await ok('u-rt-farmer', 'PAYOUT_SET', { orgId: 'org-rt-farmer', accounts: [{ id: 'pa-rt', kind: 'YAPE', number: '987650001', holder: 'Prueba Ida Vuelta', relation: 'PROPIA' }], acceptsCash: true });
    await ok('u-rt-farmer', 'ZONES_SET', { orgId: 'org-rt-farmer', areas: [{ district: '040519', fee: 0 }, { district: '040101', fee: 15 }], days: [2, 5] });
    await ok('u-rt-farmer', 'FARM_ADD', { farmId: 'farm-rt', orgId: 'org-rt-farmer', name: 'Chacra de prueba', district: '040519', areaHa: 1.5, tenure: 'COMUNAL', crops: ['papa_nativa'] });
    await ok('u-rt-farmer', 'PREFS_SET', { prefs: { lang: 'qu', textScale: 1.25 } });
    // almacén: responder una reserva y recibir el lote
    await ok('u-ernesto', 'STO_BOOK_RESPOND', { bookingId: 'bk-p2', accept: true });
    // disputa, reclamo, consulta, calificación
    await ok('u-diana', 'DISPUTE_RESOLVE', { disputeId: 'dsp-j01', outcome: 'ACUERDO', refund: 10, note: 'Se acordó devolver 5 kg.' });
    await act('u-diana', 'COMPLAINT_ANSWER', { complaintId: 'cmp-2', answer: 'Ampliamos el horario de Soporte desde las 7:00.' });
    await ok('u-elena', 'TICKET_OPEN', { ticketId: 'tk-rt', topic: 'Pedidos', text: '¿Puedo cambiar la hora de entrega?' });
    await ok('u-diana', 'TICKET_REPLY', { ticketId: 'tk-rt', text: 'Sí, escríbele al agricultor por el chat del pedido.' });
    await ok('u-elena', 'REVIEW_SUBMIT', { subOrderId: 'so-rt-6', side: 'BUYER', reviewId: 'rv-rt', stars: 5, tags: ['Puntual'], comment: 'Muy buena cebolla.' });
    await act('u-andres', 'FAVORITE_TOGGLE', { orgId: 'org-hotel', kind: 'sellers', id: 'org-wilber' });
    // configuración con doble aprobación y traducción
    await act('u-majo', 'SETTING_PROPOSE', { proposalId: 'prop-rt', key: 'orderResponseHours', value: 10, reason: 'Pedidos de hoteles más rápidos', effectiveFrom: w.now + DAY });
    await act('u-gaby', 'SETTING_APPROVE', { proposalId: 'prop-rt' });
    await act('u-majo', 'TRANSLATION_SET', { key: 'product.papa_amarilla', lang: 'qu', text: "Q'illu papa", status: 'REVIEWED' });
    // pagos del estado de cuenta: uno observado (libera el número) y uno conciliado
    const due = Object.values(w.statements).filter(s => s.status === 'ISSUED' || s.status === 'OVERDUE');
    if (due[0]) {
      const st = due[0];
      const owner = Object.values(w.users).find(u => u.orgId === st.orgId)!;
      await act(owner.id, 'STATEMENT_PAY', { statementId: st.id, method: 'YAPE', operation: '77001122' });
      await act('u-majo', 'BILLING_RECONCILE', { kind: 'STATEMENT', id: st.id, ok: false, note: 'El número no aparece en el banco.' });
      await act(owner.id, 'STATEMENT_PAY', { statementId: st.id, method: 'YAPE', operation: '77001123' });
      await act('u-majo', 'BILLING_RECONCILE', { kind: 'STATEMENT', id: st.id, ok: true });
    }
    // entrega R2: solicitud de compra con oferta aceptada (genera el pedido), pedido programado aprobado,
    // equipo y locales de la MYPE, quién publica por el agricultor y un producto nuevo del catálogo
    await ok('u-andres', 'REQUEST_ACCEPT', { requestId: 'req-a01', offerId: 'ofr-a01-w', orderId: 'o-rt-req', subOrderId: 'so-rt-req', deliveryMode: 'FARMER', payMethod: 'YAPE', taxDoc: 'LIQUIDACION' });
    expect(w.subOrders['so-rt-req'].status).toBe('PENDING_CONFIRMATION');
    expect(w.requests['req-a01'].status).toBe('AWARDED');
    await ok('u-wilber', 'REQUEST_OFFER', { requestId: 'req-c01', offerId: 'ofr-rt-c', pricePerKg: 2.2, kg: 80, quality: 'PRIMERA', note: 'Cebolla de Yanque' });
    await ok('u-charo', 'REQUEST_CLOSE', { requestId: 'req-c01' });
    await ok('u-andres', 'REQUEST_CREATE', { requestId: 'req-rt', productId: 'quinua', kg: 50, neededOn: SEED_ANCHOR + 4 * DAY });
    const prg = w.schedules['prg-a02'];
    expect(prg.draft?.status).toBe('PENDING');
    await ok('u-dario', 'SCHEDULE_APPROVE', { scheduleId: 'prg-a02', orderId: 'o-rt-prg', subOrderIds: ['so-rt-prg'] });
    expect(w.schedules['prg-a02'].draft?.status).toBe('APPROVED');
    await ok('u-andres', 'SCHEDULE_UPDATE', { scheduleId: 'prg-a01', active: false });
    // la cocina puede pedir pero no pagar
    const denied = applySafe(structuredCloneSafe(w), ev('u-rosaq', 'PAYMENT_UPLOAD', { subOrderId: 'so-rt-prg', method: 'YAPE', operation: '55443322' }));
    expect(denied.error?.code).toBe('NO_PERMISSION');
    await ok('u-andres', 'TEAM_SET', { userId: 'u-rosaq', perms: ['PEDIR', 'APROBAR'] });
    await ok('u-andres', 'TEAM_ADD', { userId: 'u-rt-caja', name: 'Caja del Hotel', phone: '987650002', perms: ['PAGAR'] });
    await ok('u-andres', 'TEAM_REMOVE', { userId: 'u-rt-caja' });
    await ok('u-andres', 'LOCAL_SAVE', { local: { id: 'loc-rt', name: 'Cafetería', district: '040103', address: 'Calle Cayma 120', receiver: 'Darío Flores', days: [1, 3, 5] } });
    await ok('u-andres', 'LOCAL_REMOVE', { localId: 'loc-rt' });
    await ok('u-justina', 'DELEGATE_SET', { userId: 'u-ruben', perms: ['PUBLICAR', 'PEDIDOS'] });
    await ok('u-wilber', 'DELEGATE_SET', { userId: 'u-nayeli', active: false });
    expect(w.users['u-nayeli'].status).toBe('SUSPENDED');
    await ok('u-majo', 'CATALOG_ADD', { name: 'Kiwicha', category: 'GRANOS', units: ['kg', 'saco'], chacra: 4.5, mayorista: 6.8, perishDays: 180, storable: true, synonyms: ['amaranto'] });
    expect(w.catalogExtra['kiwicha']).toBeTruthy();
    // pasan 40 días: vencimientos, cierre de mes, membresías y publicaciones vencidas
    await ok('system', 'CLOCK_TICK', {}, 40 * DAY);
    await ok('system', 'CLOCK_TICK', {}, 2 * HOUR);

    expect(skipped).toEqual([]);
    const again = await new Persistence(pool).load();
    const d = worldDiff(again, w);
    expect(d).toEqual([]);
  });

  it('un cambio pequeño escribe poco (solo lo que cambió)', async () => {
    const next = structuredCloneSafe(w);
    const r = applySafe(next, ev('u-wilber', 'MSG_SEND', { msgId: 'm-rt-2', conv: 'so-e01', text: 'Mañana temprano.' }));
    expect(r.ok).toBe(true);
    let stats: any;
    await tx(pool, async c => { const x = await store.persist(c, w, next); stats = x.stats; x.commit(); });
    w = next;
    expect(stats.units).toEqual(expect.arrayContaining(['messages']));
    expect(stats.saved).toBeLessThan(8);
  });
});
