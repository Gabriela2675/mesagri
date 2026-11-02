/*
 * Membresía de la MYPE, estados de cuenta (agricultor 3 %, almacén 10 %, transportista 10 %),
 * conciliación, cambios de configuración con doble aprobación y traducciones.
 * 6.10, RF-ADM-04, RF-ADM-10, RF-ADM-11, RN-35 a RN-41, RN-48, RN-50, RN-63, RN-32.
 */
import type { World, Statement, StatementItem, Org, SubInvoice } from '../types';
import { on, fail, audit, notify, requireMember, requireAdmin, getOrg, must, nextSeq } from './core';
import { settingDef } from '../settings';
import { r2, sumBy, PLAN_ORDER } from '../rules';
import { periodOf, periodStart, nextPeriod, prevPeriod, limaTime, endOfDay, addMonths, DAY, HOUR, periodLabel, lima } from '../time';
import { money, dateShort, pct } from '../format';
import { pad } from '../ids';
import { applyUpgrade } from './orders';
import { CRITICAL_KEYS } from '../i18n-keys';

type C = { w: World; t: number; e?: any; n?: number };

/* ---------- Membresía (CU-81, RF-SUB-02 a RF-SUB-07) ---------- */
export function invoiceFor(w: World, org: Org, period: string): SubInvoice | undefined {
  return w.invoices[`inv-${org.id}-${period}`];
}

on('SUB_PAY', (c) => {
  const org = getOrg(c.w, c.a.orgId);
  const s = org.subscription;
  if (!s) fail('FORBIDDEN', 'Tu cuenta no tiene membresía.');
  const method = c.e.p.method;
  const op = String(c.e.p.operation ?? '').replace(/\s/g, '');
  if (method !== 'CARD' && !/^\d{4,14}$/.test(op)) fail('BAD_OP', 'Escribe el número de operación de tu Yape o transferencia.');
  const opKey = `${method}:${op || c.e.id}`;
  if (c.w.usedOps[opKey]) fail('OP_DUPLICATE', 'Ese número de operación ya se usó en otro pago.');
  const period = periodOf(s.paidUntil);
  const id = `inv-${org.id}-${period}`;
  let inv = c.w.invoices[id];
  if (inv && (inv.status === 'PAID' || inv.status === 'RECONCILED')) fail('ALREADY', 'Este mes ya está pagado.');
  const price = c.w.settings.plans[s.plan].price;
  if (!inv) inv = c.w.invoices[id] = { id, orgId: org.id, period, plan: s.plan, concept: `Membresía ${c.w.settings.plans[s.plan].name} · ${periodLabel(period)}`, amount: price, issuedAt: c.t, dueAt: s.paidUntil, status: 'ISSUED' };
  inv.status = 'PAID';
  inv.payment = { method, operation: op || 'tarjeta', at: c.t };
  c.w.usedOps[opKey] = id;
  const wasInactive = s.status === 'INACTIVE';
  s.paidUntil = wasInactive ? addMonths(c.t, 1) : addMonths(s.paidUntil, 1);
  s.status = 'ACTIVE';
  s.graceUntil = undefined;
  s.history.push({ at: c.t, text: `Pagó ${money(inv.amount)} (${method === 'CARD' ? 'tarjeta' : method === 'TRANSFER' ? 'transferencia' : 'Yape'}). Activa hasta el ${dateShort(s.paidUntil)}.` });
  notify(c, org.id, 'BILLING', 'Membresía pagada', `Tu plan ${c.w.settings.plans[s.plan].name} está activo hasta el ${dateShort(s.paidUntil)}. Te llegará la factura electrónica de Mesagri.`);
  notify(c, 'ADMIN', 'BILLING', 'Pago de membresía', `${org.name}: ${money(inv.amount)} · op. ${op || 'tarjeta'}`, { screen: 'W-14' });
});

on('SUB_UPGRADE', (c) => {
  const org = getOrg(c.w, c.a.orgId);
  const s = org.subscription;
  if (!s) fail('FORBIDDEN', 'Tu cuenta no tiene membresía.');
  const to = c.e.p.plan as 'PRO' | 'EMPRESA';
  if (PLAN_ORDER.indexOf(to) <= PLAN_ORDER.indexOf(s.plan)) fail('BAD_PLAN', 'Para bajar de plan no hagas nada: bajas solo tras 2 meses por debajo del límite (RN-38).');
  if (s.status !== 'TRIAL') {
    const op = String(c.e.p.operation ?? '').replace(/\s/g, '');
    if (!/^\d{4,14}$/.test(op)) fail('BAD_OP', 'Escribe el número de operación del pago de la diferencia.');
    if (c.w.usedOps[`${c.e.p.method}:${op}`]) fail('OP_DUPLICATE', 'Ese número de operación ya se usó en otro pago.');
  }
  applyUpgrade(c, org, to, { method: c.e.p.method ?? 'YAPE', operation: String(c.e.p.operation ?? '') });
});

/* ---------- Estados de cuenta (RF-CMS-03 a RF-CMS-06, RN-40, RN-41) ---------- */
function getSt(w: World, id: string): Statement { return must(w.statements[id], 'NOT_FOUND', 'No encontramos el estado de cuenta.'); }

on('STATEMENT_PAY', (c) => {
  const st = getSt(c.w, c.e.p.statementId);
  requireMember(c.a, st.orgId);
  if (!['ISSUED', 'OVERDUE'].includes(st.status)) fail('STATE', st.status === 'PAYMENT_REGISTERED' ? 'Ya registraste el pago: lo estamos conciliando.' : 'Este estado de cuenta no tiene saldo.');
  const method = c.e.p.method;
  const op = String(c.e.p.operation ?? '').replace(/\s/g, '');
  if (!/^\d{4,14}$/.test(op)) fail('BAD_OP', 'Escribe el número de operación que aparece en tu constancia.');
  if (c.w.usedOps[`${method}:${op}`]) fail('OP_DUPLICATE', 'Ese número de operación ya se usó en otro pago.');
  st.payment = { method, operation: op, at: c.t };
  st.status = 'PAYMENT_REGISTERED';
  c.w.usedOps[`${method}:${op}`] = st.id;
  notify(c, st.orgId, 'BILLING', 'Pago registrado', `${st.code}: ${money(st.total)}. Ya puedes ${st.kind === 'FARMER' ? 'publicar' : st.kind === 'CARRIER' ? 'recibir ofertas' : 'recibir reservas'} con normalidad.`);
  notify(c, 'ADMIN', 'BILLING', 'Pago por conciliar', `${c.w.orgs[st.orgId]?.name}: ${money(st.total)} · op. ${op}`, { screen: 'W-14' });
});

on('STATEMENT_CLAIM', (c) => {
  const st = getSt(c.w, c.e.p.statementId);
  requireMember(c.a, st.orgId);
  if (st.claim && st.claim.status === 'OPEN') fail('ALREADY', 'Ya hay un reclamo abierto en este estado de cuenta.');
  const it = st.items.find(i => i.id === c.e.p.itemId);
  if (!it) fail('NOT_FOUND', 'Elige el cargo que reclamas.');
  const reason = String(c.e.p.reason ?? '').trim();
  if (reason.length < 5) fail('REASON', 'Cuéntanos por qué el cargo no corresponde.');
  st.claim = { itemId: it.id, reason, at: c.t, status: 'OPEN' };
  notify(c, 'ADMIN', 'BILLING', 'Reclamo de un cargo', `${st.code} · ${it.label}: ${reason}`, { screen: 'W-14' });
});

function voidItem(c: C, st: Statement, itemId: string, reason: string, actor: string) {
  const it = st.items.find(i => i.id === itemId);
  if (!it) fail('NOT_FOUND', 'No encontramos ese cargo.');
  if (it.voided) fail('ALREADY', 'Ese cargo ya está anulado.');
  const before = money(st.total);
  it.voided = true; it.voidReason = reason;
  st.total = r2(sumBy(st.items.filter(i => !i.voided), i => i.amount));
  const nc = 'NC01-' + pad(nextSeq(c.w, 'creditNote', 40), 5);
  audit(c, actor, 'ANULACIÓN DE CARGO', st.id, `${st.code} · ${it.label} · nota de crédito ${nc} · ${reason}`, before, money(st.total));
  if (st.total === 0 && st.status !== 'PAID') st.status = 'PAID';
  notify(c, st.orgId, 'BILLING', 'Cargo anulado', `${it.label}: ${reason}. Nota de crédito ${nc}. Nuevo total: ${money(st.total)}.`);
}

on('STATEMENT_CLAIM_DECIDE', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const st = getSt(c.w, c.e.p.statementId);
  if (!st.claim || st.claim.status !== 'OPEN') fail('STATE', 'No hay un reclamo abierto.');
  const note = String(c.e.p.note ?? '').trim();
  if (note.length < 5) fail('REASON_REQUIRED', 'Anular o rechazar exige un motivo (RN-41).');
  if (c.e.p.accept) { voidItem(c, st, st.claim.itemId, note, c.a.id); st.claim.status = 'ACCEPTED'; }
  else { st.claim.status = 'REJECTED'; notify(c, st.orgId, 'BILLING', 'Reclamo revisado', `${st.code}: ${note}`); }
});

on('CHARGE_VOID', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const st = getSt(c.w, c.e.p.statementId);
  const reason = String(c.e.p.reason ?? '').trim();
  if (reason.length < 5) fail('REASON_REQUIRED', 'Anular un cargo exige un motivo (RN-41).');
  voidItem(c, st, String(c.e.p.itemId), reason, c.a.id);
});

on('BILLING_RECONCILE', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const p = c.e.p;
  if (p.kind === 'INVOICE') {
    const inv = must(c.w.invoices[p.id], 'NOT_FOUND', 'No encontramos el cobro.');
    if (inv.status !== 'PAID') fail('STATE', 'Este cobro no espera conciliación.');
    inv.status = 'RECONCILED';
    inv.receiptNumber = 'F001-' + pad(nextSeq(c.w, 'receiptF', 1018), 4);
    audit(c, c.a.id, 'CONCILIACIÓN', inv.id, `Membresía ${c.w.orgs[inv.orgId]?.name} · op. ${inv.payment?.operation} · ${inv.receiptNumber}`);
    notify(c, inv.orgId, 'BILLING', 'Factura de tu membresía', `${inv.receiptNumber} · ${money(inv.amount)}.`);
    return;
  }
  const st = getSt(c.w, p.id);
  if (st.status !== 'PAYMENT_REGISTERED') fail('STATE', 'Este estado de cuenta no espera conciliación.');
  if (p.ok) {
    st.status = 'PAID';
    const org = c.w.orgs[st.orgId];
    st.receiptNumber = org?.ruc ? 'F001-' + pad(nextSeq(c.w, 'receiptF', 1018), 4) : 'B001-' + pad(nextSeq(c.w, 'receiptB', 411), 4);
    audit(c, c.a.id, 'CONCILIACIÓN', st.id, `${st.code} · op. ${st.payment?.operation} · ${st.receiptNumber}`, 'PAGO REGISTRADO', 'PAGADO');
    notify(c, st.orgId, 'BILLING', 'Pago conciliado', `${st.code}: ${st.receiptNumber}.`);
  } else {
    const note = String(p.note ?? '').trim();
    if (note.length < 5) fail('REASON_REQUIRED', 'Explica por qué no coincide el pago.');
    st.status = c.t > st.dueAt ? 'OVERDUE' : 'ISSUED';
    st.reconcileNote = note;
    if (st.payment) delete c.w.usedOps[`${st.payment.method}:${st.payment.operation}`];
    st.payment = undefined;
    audit(c, c.a.id, 'CONCILIACIÓN OBSERVADA', st.id, `${st.code}: ${note}`);
    notify(c, st.orgId, 'BILLING', 'Revisa tu pago', `${st.code}: ${note}`);
  }
});

on('BILLING_REMIND', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const st = getSt(c.w, c.e.p.statementId);
  notify(c, st.orgId, 'BILLING', 'Recordatorio', `${st.code}: ${money(st.total)} vence el ${dateShort(st.dueAt)}.`);
  audit(c, c.a.id, 'RECORDATORIO', st.id, st.code);
});

/* ---------- Cierre de mes: estados de cuenta del día 1 (RN-40, RN-48, RN-63) ---------- */
function statementCode(w: World, kind: Statement['kind'], period: string): string {
  return `EC-${kind === 'FARMER' ? 'A' : kind === 'WAREHOUSE' ? 'C' : 'T'}-${period.replace('-', '')}-${pad(nextSeq(w, 'stmt', 0), 4)}`;
}

function addStatement(c: C, org: Org, kind: Statement['kind'], period: string, items: StatementItem[], base: number) {
  const id = `st-${kind}-${org.id}-${period}`;
  if (c.w.statements[id]) return;
  const total = r2(sumBy(items, i => i.amount));
  const [y, m] = nextPeriod(period).split('-').map(Number);
  const st: Statement = {
    id, code: statementCode(c.w, kind, period), orgId: org.id, kind, period, items, base: r2(base), total,
    issuedAt: c.t, dueAt: endOfDay(limaTime(y, m, c.w.settings.commission.dueDay)), status: total > 0 ? 'ISSUED' : 'PAID',
  };
  c.w.statements[id] = st;
  if (total > 0) notify(c as any, org.id, 'BILLING', `Estado de cuenta de ${periodLabel(period).split(' de ')[0]}`, `${money(total)} · vence el ${dateShort(st.dueAt)}. ${kind === 'FARMER' ? 'Si no se paga hasta el día 10, no podrás publicar.' : kind === 'CARRIER' ? 'Si no se paga hasta el día 10, dejas de recibir ofertas.' : 'Si no se paga hasta el día 10, no recibes reservas nuevas.'}`, { screen: kind === 'FARMER' ? 'A-26' : kind === 'CARRIER' ? 'T-17' : 'C-13' });
}

export function closeMonth(c: C, period: string) {
  const w = c.w;
  const start = periodStart(period), end = periodStart(nextPeriod(period));
  const inP = (t?: number) => t !== undefined && t >= start && t < end;
  for (const org of Object.values(w.orgs)) {
    if (org.type === 'FARMER') {
      const subs = Object.values(w.subOrders).filter(s => s.sellerOrgId === org.id && s.status === 'COMPLETED' && inP(s.completedAt)).sort((a, b) => (a.saleNumber ?? 0) - (b.saleNumber ?? 0));
      if (!subs.length) continue;
      const items: StatementItem[] = subs.map(s => ({
        id: s.id, ref: s.code, label: `Venta ${s.saleNumber} · ${w.orgs[s.buyerOrgId]?.name ?? ''}`, base: s.saleAmount ?? s.subtotal,
        rate: s.commission ? s.commissionRate : 0, amount: s.commission ?? 0, saleNumber: s.saleNumber,
      }));
      const cancelled = Object.values(w.subOrders).filter(s => s.sellerOrgId === org.id && s.respondedAt && ['CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(s.status) && inP(s.history[s.history.length - 1]?.at));
      for (const s of cancelled) items.push({ id: s.id, ref: s.code, label: `Pedido cancelado ${s.code}`, base: 0, rate: 0, amount: 0 });
      addStatement(c, org, 'FARMER', period, items, sumBy(subs, s => s.saleAmount ?? s.subtotal));
    } else if (org.type === 'WAREHOUSE') {
      const items: StatementItem[] = [];
      let base = 0;
      for (const lot of Object.values(w.lots).filter(l => l.facilityOrgId === org.id)) {
        const accrued = accruedRent(w, lot.id, start, end);
        if (accrued <= 0) continue;
        base += accrued;
        items.push({ id: lot.id, ref: lot.code, label: `${lot.code} · ${w.orgs[lot.farmerOrgId]?.name ?? ''}`, base: accrued, rate: w.settings.storage.commission, amount: r2(accrued * w.settings.storage.commission) });
      }
      if (items.length) addStatement(c, org, 'WAREHOUSE', period, items, base);
    } else if (org.type === 'CARRIER') {
      const ships = Object.values(w.shipments).filter(s => s.carrierOrgId === org.id && s.delivery?.collected && inP(s.delivery.at));
      if (!ships.length) continue;
      const items: StatementItem[] = ships.map(s => ({ id: s.id, ref: s.code, label: `${s.code} · ${w.orgs[s.buyerOrgId]?.name ?? ''}`, base: s.freight, rate: s.commissionRate, amount: r2(s.freight * s.commissionRate) }));
      addStatement(c, org, 'CARRIER', period, items, sumBy(ships, s => s.freight));
    } else if (org.type === 'BUYER' && org.subscription) {
      // RN-38: baja sola al plan inferior tras 2 meses seguidos por debajo del límite
      const s = org.subscription;
      if (s.plan === 'BASICO') { s.monthsBelow = 0; continue; }
      const lower = s.plan === 'EMPRESA' ? 'PRO' : 'BASICO';
      const cap = w.settings.plans[lower].purchaseCap ?? Infinity;
      const bought = sumBy(Object.values(w.subOrders).filter(x => x.buyerOrgId === org.id && inP(x.createdAt) && !['REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'].includes(x.status)), x => x.saleAmount ?? x.subtotal);
      s.monthsBelow = bought <= cap ? s.monthsBelow + 1 : 0;
      if (s.monthsBelow >= w.settings.membership.downgradeMonths) {
        const from = s.plan;
        s.plan = lower; s.monthsBelow = 0;
        s.history.push({ at: c.t, text: `Bajó a ${w.settings.plans[lower].name}: 2 meses por debajo de ${money(cap)} (RN-38).` });
        audit(c, 'system', 'BAJA DE PLAN', org.id, `${org.name}: ${from} → ${lower}`, from, lower);
        notify(c as any, org.id, 'BILLING', `Ahora tienes el plan ${w.settings.plans[lower].name}`, `Compraste menos de ${money(cap)} dos meses seguidos: pagas menos desde este mes.`);
      }
    }
  }
}

/** Alquiler devengado de un lote en un periodo, con los sacos que había cada día (RN-48). */
export function accruedRent(w: World, lotId: string, start: number, end: number): number {
  const lot = w.lots[lotId];
  if (!lot || lot.status === 'WAITING_FARMER' || lot.status === 'RETURNED') return 0;
  const exits = Object.values(w.releases).filter(r => r.lotId === lotId && r.status === 'USED' && r.usedAt).sort((a, b) => a.usedAt! - b.usedAt!);
  let sacks = lot.sacks, cursor = Math.max(lot.intakeAt, start), total = 0;
  const daysInMonth = (end - start) / DAY;
  const segments: { until: number; sacks: number }[] = [];
  for (const r of exits) { segments.push({ until: r.usedAt!, sacks }); sacks -= r.sacks; }
  segments.push({ until: Infinity, sacks });
  let from = lot.intakeAt;
  for (const seg of segments) {
    const a = Math.max(from, start), b = Math.min(seg.until, end);
    if (b > a && seg.sacks > 0) total += seg.sacks * lot.rate * ((b - a) / DAY) / daysInMonth;
    from = seg.until;
    if (from >= end) break;
  }
  void cursor;
  return r2(total);
}

/* ---------- Doble aprobación (RF-ADM-11, RN-50) ---------- */
on('SETTING_PROPOSE', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const p = c.e.p;
  const def = settingDef(String(p.key));
  if (!def) fail('BAD_KEY', 'Ese valor no se puede cambiar desde aquí.');
  const value = Number(p.value);
  if (!(value >= 0) || (def.unit === '%' && value > 1)) fail('BAD_VALUE', 'Escribe un valor válido.');
  if (Object.values(c.w.proposals).some(x => x.key === def.key && (x.status === 'PENDING' || x.status === 'APPROVED'))) fail('PENDING', 'Ya hay un cambio pendiente para ese valor.');
  const from = def.get(c.w.settings);
  if (value === from) fail('SAME', 'Es el mismo valor de hoy.');
  const eff = Number(p.effectiveFrom) || c.t;
  if (def.increaseNotice && value > from && eff < c.t + 30 * DAY - HOUR) fail('NOTICE_30', 'Si sube un precio o una comisión, el cambio rige 30 días después del aviso (RN-50). Elige una fecha de inicio posterior.');
  const reason = String(p.reason ?? '').trim();
  if (reason.length < 5) fail('REASON_REQUIRED', 'Explica por qué se propone el cambio.');
  c.w.proposals[p.proposalId] = { id: p.proposalId, key: def.key, label: def.label, from, to: value, reason, proposedBy: c.a.id, proposedAt: c.t, effectiveFrom: eff, status: 'PENDING' };
  audit(c, c.a.id, 'PROPUESTA DE CAMBIO', def.key, `${def.label}: ${fmtVal(def.unit, from)} → ${fmtVal(def.unit, value)} · ${reason}`);
  notify(c, 'ADMIN', 'SYSTEM', 'Cambio por aprobar', `${def.label}: ${fmtVal(def.unit, from)} → ${fmtVal(def.unit, value)}. Lo aprueba otra persona (RN-50).`, { screen: 'W-10' });
});

export function fmtVal(unit: string, v: number | string): string {
  const n = Number(v);
  if (unit === '%') return pct(n);
  if (unit === 'S/') return money(n);
  if (unit === 'S/ por kg') return `${money(n)} por kg`;
  if (unit === 'h') return `${n} h`;
  if (unit === 'días') return `${n} días`;
  return String(n);
}

export function applyProposal(c: C, id: string) {
  const pr = c.w.proposals[id];
  const def = settingDef(pr.key)!;
  const before = def.get(c.w.settings);
  def.set(c.w.settings, Number(pr.to));
  pr.status = 'APPLIED';
  audit(c, pr.approvedBy ?? 'system', 'CAMBIO APLICADO', pr.key, `${pr.label}: ${fmtVal(def.unit, before)} → ${fmtVal(def.unit, pr.to)}`, fmtVal(def.unit, before), fmtVal(def.unit, pr.to));
}

on('SETTING_APPROVE', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const pr = must(c.w.proposals[c.e.p.proposalId], 'NOT_FOUND', 'No encontramos la propuesta.');
  if (pr.status !== 'PENDING') fail('STATE', 'Esta propuesta ya se decidió.');
  if (pr.proposedBy === c.a.id) fail('SAME_PERSON', 'La segunda aprobación la da otra persona (RN-50).');
  pr.status = 'APPROVED'; pr.approvedBy = c.a.id; pr.decidedAt = c.t;
  const def = settingDef(pr.key)!;
  audit(c, c.a.id, 'SEGUNDA APROBACIÓN', pr.key, `${pr.label}: ${fmtVal(def.unit, pr.from)} → ${fmtVal(def.unit, pr.to)} desde el ${dateShort(pr.effectiveFrom)}`);
  const affected = def.group === 'MYPE' ? 'BUYER' : def.group === 'AGRICULTOR' ? 'FARMER' : def.group === 'ALMACEN' ? 'WAREHOUSE' : def.group === 'TRANSPORTE' ? 'CARRIER' : null;
  if (affected) for (const o of Object.values(c.w.orgs)) if (o.type === affected) notify(c, o.id, 'SYSTEM', 'Aviso de cambio', `${pr.label}: ${fmtVal(def.unit, pr.from)} → ${fmtVal(def.unit, pr.to)} desde el ${dateShort(pr.effectiveFrom)}.`);
  if (pr.effectiveFrom <= c.t) applyProposal(c, pr.id);
});

on('SETTING_REJECT', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const pr = must(c.w.proposals[c.e.p.proposalId], 'NOT_FOUND', 'No encontramos la propuesta.');
  if (pr.status !== 'PENDING') fail('STATE', 'Esta propuesta ya se decidió.');
  pr.status = 'REJECTED'; pr.rejectReason = String(c.e.p.reason ?? ''); pr.decidedAt = c.t; pr.approvedBy = c.a.id;
  audit(c, c.a.id, 'PROPUESTA RECHAZADA', pr.key, `${pr.label}: ${pr.rejectReason}`);
});

/* ---------- Traducciones (RF-IDI-09, RN-32) ---------- */
on('TRANSLATION_SET', (c) => {
  requireAdmin(c.a, 'GENERAL');
  const { key, lang, text, status } = c.e.p;
  if (!['qu', 'ay'].includes(lang)) fail('BAD_LANG', 'Solo se traducen quechua y aimara.');
  if (!['DRAFT', 'REVIEWED', 'APPROVED'].includes(status)) fail('BAD_STATUS', 'Estado no válido.');
  const tx = String(text ?? '').trim();
  if (status !== 'DRAFT' && !tx) fail('EMPTY', 'Escribe la traducción antes de aprobarla.');
  const row = c.w.translations[key] ?? (c.w.translations[key] = {});
  row[lang as 'qu'] = { text: tx, status, by: c.a.id, at: c.t };
  // RN-32: un idioma se activa solo cuando sus pantallas críticas están aprobadas
  const enabled = ['es'];
  for (const l of ['qu', 'ay'] as const) if (CRITICAL_KEYS.every(k => c.w.translations[k.key]?.[l]?.status === 'APPROVED')) enabled.push(l);
  const before = c.w.settings.languages.enabled.join(',');
  c.w.settings.languages.enabled = enabled;
  if (before !== enabled.join(',')) audit(c, c.a.id, 'IDIOMA ACTIVADO', lang, `Idiomas activos: ${enabled.join(', ')}`, before, enabled.join(','));
});

/* ---------- Temporizadores de membresía, estados de cuenta y propuestas ---------- */
export function billingDeadlines(w: World): { at: number; run: (t: number) => void }[] {
  const out: { at: number; run: (t: number) => void }[] = [];
  // cierre de mes (día 1)
  if (w.lastMonthClosed) {
    const q = nextPeriod(w.lastMonthClosed);
    out.push({ at: periodStart(nextPeriod(q)), run: (t) => { closeMonth({ w, t }, q); w.lastMonthClosed = q; } });
  }
  for (const id in w.statements) {
    const st = w.statements[id];
    if (st.status === 'ISSUED') out.push({ at: st.dueAt + 1, run: (t) => {
      st.status = 'OVERDUE';
      notify({ w, t }, st.orgId, 'BILLING', 'Estado de cuenta vencido', `${st.code}: ${money(st.total)}. ${st.kind === 'FARMER' ? 'No puedes publicar' : st.kind === 'CARRIER' ? 'No recibes ofertas nuevas' : 'No recibes reservas nuevas'} hasta ponerte al día. Lo que está en curso sigue (RN-40).`, { screen: st.kind === 'FARMER' ? 'A-26' : st.kind === 'CARRIER' ? 'T-17' : 'C-13' });
    } });
  }
  for (const id in w.orgs) {
    const o = w.orgs[id];
    const s = o.subscription;
    if (!s) continue;
    if (s.status === 'TRIAL' || s.status === 'ACTIVE') {
      const period = periodOf(s.paidUntil);
      const invId = `inv-${o.id}-${period}`;
      if (!w.invoices[invId]) out.push({ at: s.paidUntil - 5 * DAY, run: (t) => {
        w.invoices[invId] = { id: invId, orgId: o.id, period, plan: s.plan, concept: `Membresía ${w.settings.plans[s.plan].name} · ${periodLabel(period)}`, amount: w.settings.plans[s.plan].price, issuedAt: t, dueAt: s.paidUntil, status: 'ISSUED' };
        notify({ w, t }, o.id, 'BILLING', s.status === 'TRIAL' ? 'Tu mes gratis termina pronto' : 'Tu membresía vence pronto', `Paga ${money(w.settings.plans[s.plan].price)} antes del ${dateShort(s.paidUntil)} para seguir comprando.`, { screen: 'B-26' });
      } });
      out.push({ at: s.paidUntil, run: (t) => {
        s.status = 'GRACE';
        s.graceUntil = s.paidUntil + w.settings.membership.graceDays * DAY;
        s.history.push({ at: t, text: `Venció sin pago: ${w.settings.membership.graceDays} días de gracia.` });
        notify({ w, t }, o.id, 'BILLING', 'Tu membresía venció', `Tienes ${w.settings.membership.graceDays} días de gracia: paga antes del ${dateShort(s.graceUntil)} para seguir confirmando pedidos (RN-37).`, { screen: 'B-26' });
      } });
    }
    if (s.status === 'GRACE' && s.graceUntil) out.push({ at: s.graceUntil, run: (t) => {
      s.status = 'INACTIVE';
      s.history.push({ at: t, text: 'Sin membresía: no puede confirmar pedidos. Conserva su historial.' });
      notify({ w, t }, o.id, 'BILLING', 'Estás sin membresía', 'Puedes ver el catálogo y tu historial, pero no confirmar pedidos. Al pagar se reactiva de inmediato (RN-35).', { screen: 'B-26' });
    } });
  }
  for (const id in w.proposals) {
    const pr = w.proposals[id];
    if (pr.status === 'APPROVED') out.push({ at: pr.effectiveFrom, run: (t) => applyProposal({ w, t }, pr.id) });
  }
  return out;
}

void lima; void prevPeriod;
