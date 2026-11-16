/*
 * Pagos que se pueden comprobar, cuentas que el equipo corrige o elimina, publicaciones que modera,
 * mensajes de ayuda y datos de Mesagri con doble aprobación.
 */
import { describe, it, expect } from 'vitest';
import { seedWorld, applySafe, structuredCloneSafe, tick } from '../src/engine/index';
import { deletionCheck } from '../src/engine/accounts';
import { paymentStrikes, ticketNeedsReply, mesagriData } from '../src/queries';
import { maskWorld } from '../src/privacy';
import type { MEvent, World } from '../src/types';
import { MIN, DAY } from '../src/time';

let n = 0;
const ev = (w: World, actor: string, type: string, p: any, dt = 1 * MIN): MEvent => ({ id: `adm-${++n}`, type, actor, t: w.now + dt, lamport: 0, p });
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any, dt?: number) => applySafe(w, ev(w, actor, type, p, dt));

describe('pago de un pedido: datos para comprobarlo en la cuenta de quien cobra', () => {
  it('guarda a nombre de quién sale y el código de seguridad de Yape, y se los dice al agricultor', () => {
    const w = fresh();
    const r = run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456', payerName: 'Elena  Quispe', securityCode: '472', photoId: 'ph-voucher-1' });
    expect(r.ok, r.error?.message).toBe(true);
    expect(w.subOrders['so-e01'].payment).toMatchObject({ status: 'UPLOADED', payerName: 'Elena Quispe', securityCode: '472', photoId: 'ph-voucher-1' });
    const notif = w.notifs.filter(x => x.to === 'org-wilber').at(-1)!;
    expect(notif.body).toMatch(/Elena Quispe/);
    expect(notif.body).toMatch(/472/);
    expect(notif.body).toMatch(/solo si ves el dinero/);
  });
  it('el código de seguridad tiene 3 números y es solo de Yape', () => {
    const w = fresh();
    expect(run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456', securityCode: '47' }).error?.code).toBe('BAD_CODE');
    expect(run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456', payerName: '<b>x' }).error?.code).toBe('BAD_PAYER');
    // sin titular ni código también se acepta (apps anteriores): el agricultor lo ve como «no lo indicó»
    expect(run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456' }).ok).toBe(true);
  });
  it('si Soporte confirma que el pago no llegó, la cuenta queda marcada y el equipo recibe el aviso', () => {
    const w = fresh();
    run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456', payerName: 'Elena Quispe' });
    expect(run(w, 'u-wilber', 'PAYMENT_NOT_RECEIVED', { subOrderId: 'so-e01', disputeId: 'dsp-pay' }).ok).toBe(true);
    expect(paymentStrikes(w, 'org-elena')).toBe(0);
    expect(run(w, 'u-diana', 'DISPUTE_RESOLVE', { disputeId: 'dsp-pay', outcome: 'FAVOR_AGRICULTOR', note: 'No aparece en los movimientos de Wilber' }).ok).toBe(true);
    expect(paymentStrikes(w, 'org-elena')).toBe(1);
    expect(w.subOrders['so-e01'].payment.status).toBe('NONE');
    expect(w.notifs.filter(x => x.to === 'ADMIN').at(-1)).toMatchObject({ title: 'Un pago no llegó', link: { screen: 'W-05', params: { id: 'org-elena' } } });
    // esa constancia no sirve otra vez
    expect(run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456' }).ok).toBe(true);
  });
  it('el agricultor (parte del pedido) recibe el titular y el código', () => {
    const w = fresh();
    run(w, 'u-elena', 'PAYMENT_UPLOAD', { subOrderId: 'so-e01', method: 'YAPE', operation: '05123456', payerName: 'Elena Quispe', securityCode: '472' });
    // las personas de ejemplo son públicas a propósito: se prueba con el pedido como si fuera de cuentas reales
    const own = maskWorld(w, { kind: 'user', userId: 'u-wilber', orgId: 'org-wilber' });
    expect(own.subOrders['so-e01'].payment.securityCode).toBe('472');
  });
});

describe('pagos a Mesagri: si no aparecen en el extracto, todo vuelve a como estaba', () => {
  it('membresía: «no aparece» devuelve la fecha pagada y libera el número', () => {
    const w = fresh();
    const before = structuredCloneSafe(w.orgs['org-elena'].subscription!);
    const r = run(w, 'u-elena', 'SUB_PAY', { method: 'YAPE', operation: '88776655', payerName: 'Elena Quispe', securityCode: '901' });
    expect(r.ok, r.error?.message).toBe(true);
    const inv = Object.values(w.invoices).find(i => i.orgId === 'org-elena' && i.status === 'PAID')!;
    expect(inv.payment).toMatchObject({ operation: '88776655', payerName: 'Elena Quispe', securityCode: '901', prev: { status: before.status, paidUntil: before.paidUntil } });
    expect(w.orgs['org-elena'].subscription!.paidUntil).toBeGreaterThan(before.paidUntil);
    expect(run(w, 'u-diana', 'BILLING_RECONCILE', { kind: 'INVOICE', id: inv.id, ok: false, note: 'No aparece' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-majo', 'BILLING_RECONCILE', { kind: 'INVOICE', id: inv.id, ok: false, note: 'no' }).error?.code).toBe('REASON_REQUIRED');
    expect(run(w, 'u-majo', 'BILLING_RECONCILE', { kind: 'INVOICE', id: inv.id, ok: false, note: 'No aparece en el extracto del BCP' }).ok).toBe(true);
    const s = w.orgs['org-elena'].subscription!;
    expect(s.paidUntil).toBe(before.paidUntil);
    expect(s.status).toBe(before.status);
    expect(w.invoices[inv.id]).toMatchObject({ status: 'ISSUED', reconcileNote: 'No aparece en el extracto del BCP' });
    expect(w.invoices[inv.id].payment).toBeUndefined();
    expect(w.usedOps['YAPE:88776655']).toBeUndefined();
    expect(w.audit.at(-1)).toMatchObject({ action: 'CONCILIACIÓN OBSERVADA' });
    // puede volver a pagar
    expect(run(w, 'u-elena', 'SUB_PAY', { method: 'YAPE', operation: '88776656' }).ok).toBe(true);
  });
  it('cambio de plan: si el pago de la diferencia no aparece, vuelve al plan anterior', () => {
    const w = fresh();
    expect(run(w, 'u-elena', 'SUB_UPGRADE', { plan: 'PRO', method: 'YAPE', operation: '55001122', payerName: 'Elena Quispe' }).ok).toBe(true);
    expect(w.orgs['org-elena'].subscription!.plan).toBe('PRO');
    const inv = Object.values(w.invoices).find(i => i.orgId === 'org-elena' && i.id.includes('-up-'))!;
    expect(run(w, 'u-majo', 'BILLING_RECONCILE', { kind: 'INVOICE', id: inv.id, ok: false, note: 'No aparece la diferencia' }).ok).toBe(true);
    expect(w.orgs['org-elena'].subscription!.plan).toBe('BASICO');
    expect(w.invoices[inv.id].status).toBe('VOID');
  });
  it('tarjeta: dos pagos no chocan, y deja de existir cuando el equipo pone sus cuentas reales', () => {
    const w = fresh();
    expect(run(w, 'u-elena', 'SUB_PAY', { method: 'CARD' }).ok).toBe(true);
    expect(run(w, 'u-gladys', 'SUB_PAY', { method: 'CARD' }).ok).toBe(true);
    const ops = Object.values(w.invoices).filter(i => i.payment?.method === 'CARD').map(i => i.payment!.operation);
    expect(new Set(ops).size).toBe(ops.length);
    expect(run(w, 'u-majo', 'MESAGRI_DATA_PROPOSE', { accounts: [{ kind: 'YAPE', number: '912345678', holder: 'Mesagri S.A.C.' }], reason: 'Cuenta real de Mesagri' }).ok).toBe(true);
    expect(run(w, 'u-gaby', 'MESAGRI_DATA_APPROVE', {}).ok).toBe(true);
    expect(run(w, 'u-martin', 'SUB_PAY', { method: 'CARD' }).error?.code).toBe('NO_CARD');
  });
  it('estado de cuenta: guarda titular, código y captura para buscarlo', () => {
    const w = fresh();
    const st = Object.values(w.statements).find(s => s.orgId === 'org-wilber' && ['ISSUED', 'OVERDUE'].includes(s.status))!;
    expect(run(w, 'u-wilber', 'STATEMENT_PAY', { statementId: st.id, method: 'YAPE', operation: '31415926', payerName: 'Wilber Huamaní', securityCode: '123', photoId: 'ph-st-1' }).ok).toBe(true);
    expect(w.statements[st.id].payment).toMatchObject({ payerName: 'Wilber Huamaní', securityCode: '123', photoId: 'ph-st-1' });
    expect(run(w, 'u-wilber', 'STATEMENT_PAY', { statementId: st.id, method: 'CASH', operation: '1234' }).error?.code).toBe('STATE');
  });
});

describe('cuentas donde le pagan a Mesagri: las aprueba otra persona', () => {
  it('quien propone no aprueba; otra persona sí; la gente ya no ve datos de ejemplo', () => {
    const w = fresh();
    expect(mesagriData(w).example).toBe(true);
    const accounts = [{ kind: 'YAPE', number: '912 345 678', holder: 'Mesagri S.A.C.' }, { kind: 'BANK', number: '1912345678001', holder: 'Mesagri S.A.C.', bank: 'BCP', cci: '00219100912345678001' }];
    expect(run(w, 'u-diana', 'MESAGRI_DATA_PROPOSE', { accounts, reason: 'Cuenta real' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-majo', 'MESAGRI_DATA_PROPOSE', { accounts: [{ kind: 'BANK', number: '123', holder: 'Mesagri S.A.C.', bank: 'BCP', cci: '1' }], reason: 'Cuenta real' }).ok).toBe(false);
    expect(run(w, 'u-majo', 'MESAGRI_DATA_PROPOSE', { accounts, whatsapp: '912345678', reason: 'Cuenta real' }).ok).toBe(true);
    expect(mesagriData(w).example).toBe(true);
    expect(mesagriData(w).pending?.by).toBe('u-majo');
    expect(run(w, 'u-majo', 'MESAGRI_DATA_APPROVE', {}).error?.code).toBe('SAME_PERSON');
    expect(run(w, 'u-gaby', 'MESAGRI_DATA_APPROVE', {}).ok).toBe(true);
    const d = mesagriData(w);
    expect(d).toMatchObject({ example: false, whatsapp: '912345678', updatedBy: 'u-gaby' });
    expect(d.accounts[0].number).toBe('912345678');
    expect(d.pending).toBeUndefined();
    expect(w.audit.at(-1)).toMatchObject({ action: 'CUENTAS DE MESAGRI', actor: 'u-gaby' });
  });
});

describe('el equipo corrige los datos de una cuenta', () => {
  it('nombre del DNI, DNI y celular: con motivo, sin repetidos y en auditoría (sin el dato completo)', () => {
    const w = fresh();
    const p = { orgId: 'org-geranios', users: [{ userId: 'u-charo', phone: '959300499', dni: '29337413', name: 'Rosario Valdivia Cárdenas de Ruiz' }], reason: 'Cambió de celular' };
    expect(run(w, 'u-charo', 'ACCOUNT_EDIT', p).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-lucia', 'ACCOUNT_EDIT', p).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-diana', 'ACCOUNT_EDIT', { ...p, reason: '' }).error?.code).toBe('REASON_REQUIRED');
    expect(run(w, 'u-diana', 'ACCOUNT_EDIT', { ...p, users: [{ userId: 'u-charo', phone: '987654321' }] }).error?.code).toBe('PHONE_TAKEN');
    expect(run(w, 'u-diana', 'ACCOUNT_EDIT', { ...p, users: [{ userId: 'u-charo', dni: '45218736' }] }).error?.code).toBe('DNI_TAKEN');
    expect(run(w, 'u-diana', 'ACCOUNT_EDIT', { ...p, users: [{ userId: 'u-wilber', phone: '959300499' }] }).error?.code).toBe('FORBIDDEN');
    const r = run(w, 'u-diana', 'ACCOUNT_EDIT', { ...p, org: { address: 'Calle Misti 214, Yanahuara' } });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.result).toMatchObject({ phoneChanged: ['u-charo'] });
    expect(w.users['u-charo']).toMatchObject({ phone: '959300499', dni: '29337413', name: 'Rosario Valdivia Cárdenas de Ruiz' });
    expect(w.orgs['org-geranios'].address).toBe('Calle Misti 214, Yanahuara');
    const a = w.audit.at(-1)!;
    expect(a).toMatchObject({ action: 'DATOS CORREGIDOS', actor: 'u-diana', entity: 'org-geranios' });
    expect(a.detail).toMatch(/···412 → ···499/);
    expect(a.detail).not.toMatch(/959300499/);
    expect(w.notifs.filter(x => x.to === 'org-geranios').at(-1)?.title).toBe('Actualizamos tus datos');
    expect(run(w, 'u-diana', 'ACCOUNT_EDIT', p).error?.code).toBe('SAME');
  });
});

describe('eliminar una cuenta (derecho de cancelación)', () => {
  it('no se puede con pedidos en curso: primero se terminan o se cancelan', () => {
    const w = fresh();
    const chk = deletionCheck(w, 'org-wilber');
    expect(chk.blockers.some(b => b.includes(w.subOrders['so-c03'].code))).toBe(true);
    expect(chk.cancel.map(s => s.id)).toContain('so-e01');
    expect(run(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-wilber', reason: 'Lo pidió por la app' }).error?.code).toBe('IN_PROGRESS');
  });
  it('borra los datos personales y las publicaciones; cancela lo que no empezó; quedan los pedidos sin nombre', () => {
    const w = fresh();
    // un pedido por aceptar a Lucio: se cancela solo
    const ord = { orderId: 'o-del', subs: [{ subOrderId: 'so-del', sellerOrgId: 'org-lucio', items: [{ listingId: 'l-l-frejol', qty: 10 }], deliveryMode: 'PICKUP', deliveryDate: w.now + DAY, taxDoc: 'BOLETA', payMethod: 'YAPE' }] };
    const placed = run(w, 'u-andres', 'ORDER_PLACE', ord);
    expect(placed.ok, placed.error?.message).toBe(true);
    const chk = deletionCheck(w, 'org-lucio');
    expect(chk.blockers).toEqual([]);
    expect(chk.cancel.map(s => s.id)).toEqual(['so-del']);
    expect(chk.warnings.some(x => /Debe/.test(x))).toBe(true);
    expect(run(w, 'u-diana', 'ACCOUNT_DELETE', { orgId: 'org-lucio', reason: 'Lo pidió por la app' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-lucio', reason: 'x' }).error?.code).toBe('REASON_REQUIRED');
    const r = run(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-lucio', reason: 'Lo pidió por la app (Ley 29733)' });
    expect(r.ok, r.error?.message).toBe(true);
    const o = w.orgs['org-lucio'];
    expect(o).toMatchObject({ status: 'DELETED', name: 'Cuenta eliminada', payout: [], deletedReason: 'Lo pidió por la app (Ley 29733)' });
    expect(o.dni).toBeUndefined();
    const u = w.users['u-lucio'];
    expect(u).toMatchObject({ status: 'DELETED', name: 'Cuenta eliminada', phone: '' });
    expect(u.dni).toBeUndefined();
    expect(Object.values(w.listings).filter(l => l.orgId === 'org-lucio').every(l => l.status === 'REMOVED' && l.photoIds.length === 0)).toBe(true);
    expect(w.subOrders['so-del'].status).toBe('CANCELLED_BY_SELLER');
    expect(w.listings['l-l-frejol'].reserved).toBe(0);
    expect(w.notifs.filter(x => x.to === 'org-hotel').at(-1)?.body).toMatch(/se eliminó/);
    for (const k of Object.values(w.cases).filter(k => k.orgId === 'org-lucio')) { expect(k.identity).toBeUndefined(); expect(k.evidence.every(e => !e.photoId)).toBe(true); }
    expect(w.audit.at(-1)).toMatchObject({ action: 'CUENTA ELIMINADA', actor: 'u-majo' });
    // sus ventas pasadas siguen (sin su nombre) para el comprador y la contabilidad
    expect(w.subOrders['so-l01'].status).toBe('COMPLETED');
    // ya no puede hacer nada, y su celular y su DNI quedan libres
    expect(run(w, 'u-lucio', 'PREFS_SET', { prefs: { textScale: 1.25 } }).error?.code).toBe('DELETED');
    expect(run(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-lucio', reason: 'otra vez' }).error?.code).toBe('ALREADY');
    expect(run(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-mesagri', reason: 'no se puede' }).error?.code).toBe('FORBIDDEN');
    const reg = run(w, 'u-nuevo-l', 'USER_REGISTER', { userId: 'u-nuevo-l', orgId: 'org-nuevo-l', role: 'FARMER', phone: '966209734', name: 'Lucio Nuevo', dni: '29845610', org: { district: '040201' } });
    expect(reg.ok, reg.error?.message).toBe(true);
    // las cuentas eliminadas no generan cobros nuevos
    const n0 = Object.values(w.statements).filter(s => s.orgId === 'org-lucio').length;
    tick(w, w.now + 40 * DAY);
    expect(Object.values(w.statements).filter(s => s.orgId === 'org-lucio').length).toBe(n0);
  });
  it('una MYPE eliminada queda sin membresía y sin solicitudes abiertas', () => {
    const w = fresh();
    expect(run(w, 'u-majo', 'ACCOUNT_DELETE', { orgId: 'org-tambo', reason: 'Cuenta de prueba' }).ok).toBe(true);
    expect(w.orgs['org-tambo'].subscription?.status).toBe('INACTIVE');
    const before = w.notifs.filter(x => x.to === 'org-tambo').length;
    tick(w, w.now + 60 * DAY);
    expect(w.notifs.filter(x => x.to === 'org-tambo').length).toBe(before);
  });
});

describe('publicaciones: el equipo pausa, oculta o elimina cualquiera', () => {
  it('eliminar borra las fotos y no vuelve; ocultar no rompe los pedidos en curso', () => {
    const w = fresh();
    const l = w.listings['l-l-frejol'];
    l.photoIds = ['ph-1', 'ph-2'];
    expect(run(w, 'u-diana', 'LISTING_MODERATE', { listingId: l.id, decision: 'REMOVE', reason: '' }).error?.code).toBe('REASON_REQUIRED');
    expect(run(w, 'u-ana', 'LISTING_MODERATE', { listingId: l.id, decision: 'REMOVE', reason: 'Foto que no es del producto' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-diana', 'LISTING_MODERATE', { listingId: l.id, decision: 'REMOVE', reason: 'Foto que no es del producto' }).ok).toBe(true);
    expect(w.listings[l.id]).toMatchObject({ status: 'REMOVED', photoIds: [], reviewReason: 'Foto que no es del producto' });
    expect(run(w, 'u-diana', 'LISTING_MODERATE', { listingId: l.id, decision: 'APPROVE' }).error?.code).toBe('ALREADY');
    const busy = Object.values(w.listings).find(x => x.reserved > 0)!;
    expect(run(w, 'u-majo', 'LISTING_MODERATE', { listingId: busy.id, decision: 'REJECT', reason: 'Precio engañoso' }).ok).toBe(true);
    expect(w.listings[busy.id].status).toBe('REJECTED');
  });
});

describe('opiniones: el equipo retira un comentario ofensivo', () => {
  it('quita el texto, quedan las estrellas, y queda en auditoría', () => {
    const w = fresh();
    const r = Object.values(w.reviews).find(x => x.comment)!;
    const stars = r.stars;
    expect(run(w, 'u-lucia', 'REVIEW_MODERATE', { reviewId: r.id, reason: 'Insulta al comprador' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-diana', 'REVIEW_MODERATE', { reviewId: r.id, reason: 'Insulta al comprador' }).ok).toBe(true);
    expect(w.reviews[r.id].comment).toBeUndefined();
    expect(w.reviews[r.id].stars).toBe(stars);
    expect(w.audit.at(-1)).toMatchObject({ action: 'COMENTARIO RETIRADO', actor: 'u-diana' });
    expect(run(w, 'u-diana', 'REVIEW_MODERATE', { reviewId: r.id, reason: 'Insulta al comprador' }).error?.code).toBe('EMPTY');
  });
});

describe('Soporte cancela un pedido que todavía no sale', () => {
  it('sin tocar la reputación; no si ya va en camino', () => {
    const w = fresh();
    const sellerCancels = w.orgs['org-hector'].counters.sellerCancels;
    expect(run(w, 'u-diana', 'SUBORDER_ADMIN_CANCEL', { subOrderId: 'so-a02', reason: '' }).error?.code).toBe('REASON_REQUIRED');
    expect(run(w, 'u-diana', 'SUBORDER_ADMIN_CANCEL', { subOrderId: 'so-a02', reason: 'Las dos partes lo pidieron', side: 'SELLER' }).ok).toBe(true);
    expect(w.subOrders['so-a02'].status).toBe('CANCELLED_BY_SELLER');
    expect(w.orgs['org-hector'].counters.sellerCancels).toBe(sellerCancels);
    expect(run(w, 'u-diana', 'SUBORDER_ADMIN_CANCEL', { subOrderId: 'so-c03', reason: 'Lo pidieron' }).error?.code).toBe('USE_DISPUTE');
  });
});

describe('mensajes de ayuda', () => {
  it('llegan al equipo con enlace; la respuesta llega a la persona; si responde vuelve a «por responder»', () => {
    const w = fresh();
    expect(run(w, 'u-charo', 'TICKET_OPEN', { ticketId: 'tk-x', topic: 'Pedidos', text: '¿Cómo cambio la hora de entrega?' }).ok).toBe(true);
    expect(w.notifs.at(-1)).toMatchObject({ to: 'ADMIN', link: { screen: 'W-21', params: { id: 'tk-x' } } });
    expect(ticketNeedsReply(w, w.tickets['tk-x'])).toBe(true);
    expect(run(w, 'u-lucia', 'TICKET_REPLY', { ticketId: 'tk-x', text: 'Hola' }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'u-diana', 'TICKET_REPLY', { ticketId: 'tk-x', text: 'Escríbele al agricultor por el chat del pedido.' }).ok).toBe(true);
    expect(w.notifs.at(-1)).toMatchObject({ to: 'org-geranios', link: { screen: 'TICKET', params: { id: 'tk-x' } } });
    expect(ticketNeedsReply(w, w.tickets['tk-x'])).toBe(false);
    expect(run(w, 'u-charo', 'TICKET_REPLY', { ticketId: 'tk-x', text: 'Gracias, ¿y si no responde?' }).ok).toBe(true);
    expect(ticketNeedsReply(w, w.tickets['tk-x'])).toBe(true);
    expect(w.notifs.at(-1)).toMatchObject({ to: 'ADMIN', link: { screen: 'W-21' } });
    expect(run(w, 'u-diana', 'TICKET_REPLY', { ticketId: 'tk-x', text: 'Te llamamos.', close: true }).ok).toBe(true);
    expect(w.tickets['tk-x'].status).toBe('CLOSED');
    // la persona escribe otra vez: se vuelve a abrir (no puede cerrarla ella)
    expect(run(w, 'u-charo', 'TICKET_REPLY', { ticketId: 'tk-x', text: 'Una cosa más', close: true }).ok).toBe(true);
    expect(w.tickets['tk-x'].status).toBe('OPEN');
    expect(run(w, 'u-charo', 'TICKET_OPEN', { ticketId: 'tk-x', topic: 'Pedidos', text: 'otra vez lo mismo' }).error?.code).toBe('DUPLICATE');
  });
});

describe('tamaño de letra', () => {
  it('chica, normal, grande y extra', () => {
    const w = fresh();
    expect(run(w, 'u-charo', 'PREFS_SET', { prefs: { textScale: 0.9 } }).ok).toBe(true);
    expect(w.users['u-charo'].prefs.textScale).toBe(0.9);
    expect(run(w, 'u-charo', 'PREFS_SET', { prefs: { textScale: 0.5 } }).error?.code).toBe('BAD_PREFS');
    // la MYPE de ejemplo empieza con la letra normal
    expect(seedWorld().users['u-charo'].prefs.textScale).toBe(1);
  });
});
