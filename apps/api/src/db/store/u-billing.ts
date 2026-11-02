/*
 * Unidades de cobros y configuración: estados de cuenta (agricultor, almacén y transportista),
 * cobros de membresía, pagos que recibe Mesagri, números de operación usados, cambios de
 * configuración con doble aprobación, traducciones y favoritos.
 */
import type { Statement, SubInvoice, SettingProposal, TranslationEntry, World } from '@mesagri/shared';
import { exec, insertMany, rows, upsert, dt, js } from '../db';
import { Unit, changed, groupBy, strip, tms, tm, ob, onum, ostr, bn, nv, cut, same } from './units';

const STATEMENT_TABLE = { FARMER: 'commission_statements', WAREHOUSE: 'storage_statements', CARRIER: 'carrier_statements' } as const;
const CONCEPT = { FARMER: 'COMISION', WAREHOUSE: 'ALMACEN', CARRIER: 'TRANSPORTE' } as const;

/* ============================== Estados de cuenta ============================== */

export const statementsUnit: Unit = {
  name: 'statements',
  tables: ['commission_statements', 'commission_statement_items', 'storage_statements', 'carrier_statements', 'billing_payments'],
  entries: w => Object.entries(w.statements),
  async save({ c, ids, w }, _key, st: Statement, p: Statement | undefined) {
    const org = ids.need('organizations', st.orgId);
    const common = {
      uuid: st.id, code: cut(st.code, 40), period: st.period, issued_at: dt(st.issuedAt), due_on: dt(st.dueAt), status: st.status,
      receipt_number: cut(st.receiptNumber, 30), claim: js(st.claim), reconcile_note: cut(st.reconcileNote, 500),
    };
    if (st.kind === 'FARMER') {
      const id = await upsert(c, 'commission_statements', { ...common, organization_id: org, sales_total: st.base, commission: st.total });
      ids.set('commission_statements', st.id, id);
      if (changed(p, st, x => x.items)) {
        await exec(c, 'DELETE FROM commission_statement_items WHERE statement_id = ?', [id]);
        await insertMany(c, 'commission_statement_items', st.items.map((it, i) => ({
          statement_id: id, item_uuid: it.id, sub_order_id: ids.opt('sub_orders', it.id), ref: cut(it.ref, 40) ?? '', label: cut(it.label, 200) ?? '',
          sale_number: nv(it.saleNumber), sale_amount: it.base, rate: it.rate, commission: it.amount, voided: bn(it.voided), void_reason: cut(it.voidReason, 500), position: i,
        })));
      }
    } else if (st.kind === 'WAREHOUSE') {
      const id = await upsert(c, 'storage_statements', { ...common, facility_id: ids.opt('storage_facilities', st.orgId), organization_id: org, rent_total: st.base, commission: st.total, items: js(st.items) });
      ids.set('storage_statements', st.id, id);
    } else {
      const id = await upsert(c, 'carrier_statements', { ...common, carrier_org_id: org, freight_total: st.base, commission: st.total, items: js(st.items) });
      ids.set('carrier_statements', st.id, id);
    }
    if (!p || !same(p.payment, st.payment) || p.status !== st.status) {
      await exec(c, 'DELETE FROM billing_payments WHERE ref_uuid = ?', [st.id]);
      const pay = st.payment;
      if (pay) {
        await exec(c, 'INSERT INTO billing_payments SET ?', [{
          uuid: `${st.id}:pago`.slice(0, 80), organization_id: org, concept: CONCEPT[st.kind], ref_uuid: st.id, amount: st.total, method: pay.method,
          operation_number: String(pay.operation).slice(0, 40), paid_at: dt(pay.at), reconciled_at: st.status === 'PAID' ? dt(w.now) : null,
        }]);
      }
    }
  },
  async load({ c, w }) {
    const pays = new Map((await rows(c, 'SELECT * FROM billing_payments')).map(r => [r.ref_uuid, r]));
    const items = groupBy(await rows(c, 'SELECT * FROM commission_statement_items ORDER BY statement_id, position'), 'statement_id');
    const all: { st: Statement; order: number }[] = [];
    const kinds: Statement['kind'][] = ['FARMER', 'WAREHOUSE', 'CARRIER'];
    for (const [ki, kind] of kinds.entries()) {
      const t = STATEMENT_TABLE[kind];
      const orgCol = kind === 'CARRIER' ? 'carrier_org_id' : 'organization_id';
      for (const r of await rows(c, `SELECT s.*, o.uuid AS org_uuid FROM ${t} s JOIN organizations o ON o.id = s.${orgCol} ORDER BY s.id`)) {
        const pay = pays.get(r.uuid);
        const st: Statement = strip({
          id: r.uuid, code: r.code, orgId: r.org_uuid, kind, period: r.period,
          items: kind === 'FARMER'
            ? (items.get(r.id) ?? []).map(i => strip({ id: i.item_uuid, ref: i.ref, label: i.label, base: Number(i.sale_amount), rate: Number(i.rate), amount: Number(i.commission), voided: ob(i.voided), voidReason: ostr(i.void_reason), saleNumber: onum(i.sale_number) }))
            : r.items ?? [],
          base: Number(kind === 'FARMER' ? r.sales_total : kind === 'WAREHOUSE' ? r.rent_total : r.freight_total), total: Number(r.commission),
          issuedAt: tm(r.issued_at), dueAt: tm(r.due_on), status: r.status, payment: pay ? { method: pay.method, operation: pay.operation_number, at: tm(pay.paid_at) } : undefined,
          receiptNumber: ostr(r.receipt_number), claim: r.claim ?? undefined, reconcileNote: ostr(r.reconcile_note),
        } as Statement);
        all.push({ st, order: ki });
      }
    }
    // mismo orden en que el motor los crea: por fecha de emisión y, el mismo día, agricultor → almacén → transportista
    all.sort((a, b) => a.st.issuedAt - b.st.issuedAt || a.order - b.order);
    for (const x of all) w.statements[x.st.id] = x.st;
  },
};

/* ============================== Cobros de membresía ============================== */

export const invoicesUnit: Unit = {
  name: 'invoices',
  tables: ['subscription_invoices'],
  entries: w => Object.entries(w.invoices),
  async save({ c, ids, w }, _key, inv: SubInvoice, p: SubInvoice | undefined) {
    const org = ids.need('organizations', inv.orgId);
    const id = await upsert(c, 'subscription_invoices', {
      uuid: inv.id, subscription_id: ids.opt('subscriptions', inv.orgId), organization_id: org, period: inv.period, plan_code: inv.plan, concept: cut(inv.concept, 160) ?? '',
      amount: inv.amount, tax_document: cut(inv.receiptNumber, 30), issued_at: dt(inv.issuedAt), due_at: dt(inv.dueAt), status: inv.status,
    });
    ids.set('subscription_invoices', inv.id, id);
    if (!p || !same(p.payment, inv.payment) || p.status !== inv.status) {
      await exec(c, 'DELETE FROM billing_payments WHERE ref_uuid = ?', [inv.id]);
      const pay = inv.payment;
      if (pay) {
        await exec(c, 'INSERT INTO billing_payments SET ?', [{
          uuid: `${inv.id}:pago`.slice(0, 80), organization_id: org, concept: 'MEMBRESIA', ref_uuid: inv.id, amount: inv.amount, method: pay.method,
          operation_number: String(pay.operation).slice(0, 40), paid_at: dt(pay.at), reconciled_at: inv.status === 'RECONCILED' ? dt(w.now) : null,
        }]);
      }
    }
  },
  async load({ c, w }) {
    const pays = new Map((await rows(c, "SELECT * FROM billing_payments WHERE concept = 'MEMBRESIA'")).map(r => [r.ref_uuid, r]));
    for (const r of await rows(c, 'SELECT i.*, o.uuid AS org_uuid FROM subscription_invoices i JOIN organizations o ON o.id = i.organization_id ORDER BY i.id')) {
      const pay = pays.get(r.uuid);
      w.invoices[r.uuid] = strip({
        id: r.uuid, orgId: r.org_uuid, period: r.period, plan: r.plan_code, concept: r.concept, amount: Number(r.amount), issuedAt: tm(r.issued_at), dueAt: tm(r.due_at),
        status: r.status, payment: pay ? { method: pay.method, operation: pay.operation_number, at: tm(pay.paid_at) } : undefined, receiptNumber: ostr(r.tax_document),
      } as SubInvoice);
    }
  },
};

/* ============================== Números de operación usados (RF-PAY-05) ============================== */

const splitOp = (key: string) => { const i = key.indexOf(':'); return { method: key.slice(0, i), operation: key.slice(i + 1) }; };

export const usedOpsUnit: Unit = {
  name: 'usedOps',
  tables: ['operation_numbers'],
  entries: w => Object.entries(w.usedOps),
  async save({ c }, key, ref: string) {
    const { method, operation } = splitOp(key);
    await upsert(c, 'operation_numbers', { method: method.slice(0, 12), operation: operation.slice(0, 40), ref_uuid: String(ref).slice(0, 80) }, { keys: ['method', 'operation'], hasId: false });
  },
  async remove({ c }, key) {
    const { method, operation } = splitOp(key);
    await exec(c, 'DELETE FROM operation_numbers WHERE method = ? AND operation = ?', [method, operation]);
  },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT * FROM operation_numbers')) w.usedOps[`${r.method}:${r.operation}`] = r.ref_uuid;
  },
};

/* ============================== Cambios de configuración (RN-50) ============================== */

export const proposalsUnit: Unit = {
  name: 'proposals',
  tables: ['setting_change_requests'],
  entries: w => Object.entries(w.proposals),
  async save({ c }, _key, p: SettingProposal) {
    await upsert(c, 'setting_change_requests', {
      uuid: p.id, setting_key: cut(p.key, 60), label: cut(p.label, 160) ?? '', value_from: js(p.from), value_to: js(p.to), reason: p.reason, proposed_by: p.proposedBy,
      proposed_at: dt(p.proposedAt), effective_from: dt(p.effectiveFrom), status: p.status, approved_by: nv(p.approvedBy), decided_at: dt(p.decidedAt), reject_reason: cut(p.rejectReason, 500),
    });
  },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT * FROM setting_change_requests ORDER BY id')) {
      w.proposals[r.uuid] = strip({
        id: r.uuid, key: r.setting_key, label: r.label, from: r.value_from, to: r.value_to, reason: r.reason, proposedBy: r.proposed_by, proposedAt: tm(r.proposed_at),
        effectiveFrom: tm(r.effective_from), status: r.status, approvedBy: ostr(r.approved_by), decidedAt: tms(r.decided_at), rejectReason: ostr(r.reject_reason),
      } as SettingProposal);
    }
  },
};

/* ============================== Traducciones (16.4) ============================== */

const entityType = (key: string) => key.startsWith('product.') ? 'CATALOG' : key.startsWith('q.') ? 'QUICK_REPLY' : key.startsWith('help.') ? 'HELP' : key.startsWith('audio.') ? 'AUDIO' : 'UI';

export const translationsUnit: Unit = {
  name: 'translations',
  tables: ['translations'],
  entries(w) {
    const out: [string, unknown][] = [];
    for (const [key, langs] of Object.entries(w.translations)) for (const [lang, e] of Object.entries(langs)) out.push([`${key}|${lang}`, { key, lang, e }]);
    return out;
  },
  async save({ c }, _k, v: { key: string; lang: string; e: TranslationEntry }) {
    await upsert(c, 'translations', {
      entity_type: entityType(v.key), entity_key: v.key.slice(0, 80), language: v.lang, text: v.e.text, status: v.e.status, reviewed_by: cut(v.e.by, 80), reviewed_at: dt(v.e.at),
    }, { keys: ['entity_type', 'entity_key', 'language'] });
  },
  async remove({ c }, k) {
    const i = k.lastIndexOf('|');
    const key = k.slice(0, i), lang = k.slice(i + 1);
    await exec(c, 'DELETE FROM translations WHERE entity_type = ? AND entity_key = ? AND language = ?', [entityType(key), key, lang]);
  },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT * FROM translations ORDER BY id')) {
      (w.translations[r.entity_key] ??= {})[r.language as 'qu'] = strip({ text: r.text, status: r.status, by: ostr(r.reviewed_by), at: tms(r.reviewed_at) } as TranslationEntry);
    }
  },
};

/* ============================== Favoritos ============================== */

export const favoritesUnit: Unit = {
  name: 'favorites',
  tables: ['favorites', 'carrier_favorites'],
  entries: w => Object.entries(w.favorites),
  async save({ c, ids }, orgId, f: World['favorites'][string]) {
    const org = ids.get('organizations', orgId);
    if (!org) return;
    await exec(c, 'DELETE FROM favorites WHERE organization_id = ?', [org]);
    await exec(c, 'DELETE FROM carrier_favorites WHERE buyer_org_id = ?', [org]);
    const list: any[] = [];
    const add = (type: 'LISTING' | 'SELLER', arr: string[]) => [...new Set(arr ?? [])].forEach((id, i) => list.push({ organization_id: org, target_type: type, target_uuid: String(id).slice(0, 80), position: i }));
    add('LISTING', f.listings);
    add('SELLER', f.sellers);
    await insertMany(c, 'favorites', list);
    const carriers = [...new Set(f.carriers ?? [])].map(id => ids.get('organizations', id)).filter((x): x is number => !!x);
    await insertMany(c, 'carrier_favorites', carriers.map((cid, i) => ({ buyer_org_id: org, carrier_org_id: cid, position: i })));
  },
  async remove({ c, ids }, orgId) {
    const org = ids.get('organizations', orgId);
    if (!org) return;
    await exec(c, 'DELETE FROM favorites WHERE organization_id = ?', [org]);
    await exec(c, 'DELETE FROM carrier_favorites WHERE buyer_org_id = ?', [org]);
  },
  async load({ c, w }) {
    const favs = await rows(c, 'SELECT f.*, o.uuid AS org_uuid FROM favorites f JOIN organizations o ON o.id = f.organization_id ORDER BY f.organization_id, f.target_type, f.position');
    const cars = await rows(c, 'SELECT cf.*, b.uuid AS org_uuid, k.uuid AS carrier_uuid FROM carrier_favorites cf JOIN organizations b ON b.id = cf.buyer_org_id JOIN organizations k ON k.id = cf.carrier_org_id ORDER BY cf.buyer_org_id, cf.position');
    const get = (org: string) => (w.favorites[org] ??= { listings: [], sellers: [], carriers: [] });
    for (const r of favs) (r.target_type === 'LISTING' ? get(r.org_uuid).listings : get(r.org_uuid).sellers).push(r.target_uuid);
    for (const r of cars) get(r.org_uuid).carriers.push(r.carrier_uuid);
  },
};


