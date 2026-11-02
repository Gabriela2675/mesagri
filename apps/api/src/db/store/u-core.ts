/*
 * Unidades del núcleo: estado del motor, configuración, padrón de la SUNAT, usuarios,
 * organizaciones (con sus subtipos: agricultor, comprador, transportista y almacén),
 * chacras y expedientes de verificación.
 */
import { DEFAULT_SETTINGS, structuredCloneSafe, orgStats, carrierStats, monthPurchases, periodOf } from '@mesagri/shared';
import type { World, User, Org, Farm, VerifCase, Settings, LevelLimit, ShippingRoute, DocItem } from '@mesagri/shared';
import { exec, insertMany, rows, upsert, dt, js } from '../db';
import { encrypt, decrypt } from '../secure';
import { ROLES } from './reference';
import { Unit, changed, same, groupBy, indexBy, strip, tms, tm, ob, onum, ostr, bn, nv, cut } from './units';

const ROLE_ID: Record<string, number> = Object.fromEntries(ROLES.map(r => [r.code, r.id]));
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : '');

/* ============================== Estado del motor ============================== */

export const stateUnit: Unit = {
  name: 'state',
  tables: ['system_state'],
  entries: w => [['engine', { version: w.version, t0: w.t0, now: w.now, seq: w.seq, lastMonthClosed: w.lastMonthClosed, monthlyGmv: w.monthlyGmv, clockOffset: w.clockOffset }]],
  async save({ c }, key, v) {
    await upsert(c, 'system_state', { state_key: key, value: js(v) }, { keys: ['state_key'], hasId: false });
  },
  async load({ c, w }) {
    const r = (await rows(c, 'SELECT value FROM system_state WHERE state_key = ?', ['engine']))[0];
    if (!r) return;
    const v = r.value;
    w.version = v.version; w.t0 = v.t0; w.now = v.now; w.seq = v.seq ?? {}; w.lastMonthClosed = v.lastMonthClosed ?? '';
    w.monthlyGmv = v.monthlyGmv ?? {}; w.clockOffset = v.clockOffset ?? 0;
  },
};

/* ============================== Configuración ============================== */

/** Claves de platform_settings: todo lo de Settings menos lo que tiene tabla propia. */
const OWN_TABLE = new Set(['plans', 'farmerLimits', 'buyerLimits', 'routes']);
const SETTING_NOTES: Record<string, string> = {
  commission: 'Comisión del agricultor: ventas sin comisión, tasa, día de emisión y de vencimiento (RN-14)',
  cashThreshold: 'Pago en efectivo solo por debajo de este monto (RN-04)',
  orderResponseHours: 'Horas para aceptar un pedido (RN-08)',
  autoCompleteHours: 'Conforme automático después de entregado (RN-11)',
  claimHours: 'Horas para reclamar (RN-11, RN-60)',
  reviewPublishDays: 'Días para publicar calificaciones (RN-12)',
  priceDeviation: 'Desvío del precio sugerido que pide confirmación (RN-29)',
  plausibilityFactor: 'Factor de verosimilitud de la cosecha (RN-23)',
  membership: 'Prueba gratis, días de gracia y meses para bajar de plan (RN-35 a RN-38)',
  carrier: 'Transporte: comisión, plazos, tolerancias y topes (RN-52 a RN-65)',
  storage: 'Almacenes: comisión, plazos, tolerancias y mermas (RN-43 a RN-48)',
  languages: 'Idiomas habilitados en la interfaz',
};

export const settingsUnit: Unit = {
  name: 'settings',
  tables: ['platform_settings', 'plans', 'verification_level_limits', 'shipping_routes', 'shipping_rates'],
  entries: w => [['settings', w.settings]],
  async save({ c, ids }, _key, s: Settings, prev: Settings | undefined) {
    for (const k of Object.keys(s) as (keyof Settings)[]) {
      if (OWN_TABLE.has(k) || !changed(prev, s, x => x[k])) continue;
      await upsert(c, 'platform_settings', { setting_key: k, value: js(s[k]), description: SETTING_NOTES[k] ?? null }, { keys: ['setting_key'], hasId: false });
    }
    if (changed(prev, s, x => x.plans)) {
      for (const p of Object.values(s.plans)) {
        const id = await upsert(c, 'plans', {
          code: p.code, name: p.name, audience: 'BUYER', price_month: p.price, purchase_cap: p.purchaseCap,
          max_users: p.users, max_locations: p.locations, features: js(p.features),
        }, { keys: ['code'] });
        ids.set('plans', p.code, id);
      }
    }
    if (changed(prev, s, x => [x.farmerLimits, x.buyerLimits])) {
      const put = async (kind: 'FARMER' | 'BUYER', list: LevelLimit[]) => {
        for (const [level, l] of list.entries()) {
          await upsert(c, 'verification_level_limits', {
            org_kind: kind, level, max_listings: l.listings, max_order_total: l.perOrder, max_monthly_total: l.monthly,
            cash_allowed: !!l.cash, prepay_required: !!l.prepay,
          }, { keys: ['org_kind', 'level'], hasId: false });
        }
      };
      await put('FARMER', s.farmerLimits);
      await put('BUYER', s.buyerLimits);
    }
    if (changed(prev, s, x => x.routes)) {
      for (const r of s.routes) {
        const id = await upsert(c, 'shipping_routes', {
          code: r.id, name: r.name, scope: r.scope, origin: r.origin, destination: r.destination, distance_km: r.distanceKm,
          offer_minutes: r.offerMinutes, active: true,
        }, { keys: ['code'] });
        ids.set('shipping_routes', r.id, id);
        // V1 = moto (reparto en la ciudad), V2 = camioneta o furgón, V3 = camión ligero
        const rate = (vc: 'V1' | 'V2' | 'V3', perDelivery: number) => upsert(c, 'shipping_rates', {
          route_id: id, vehicle_class: vc, price_per_kg: r.pricePerKg, price_per_delivery: perDelivery, min_fee: r.minFee, valid_from: null,
        }, { keys: ['route_id', 'vehicle_class'] });
        await rate('V1', r.cityMoto);
        await rate('V2', r.cityVan);
        await rate('V3', r.cityVan);
      }
      const codes = s.routes.map(r => r.id);
      if (codes.length) await exec(c, 'UPDATE shipping_routes SET active = FALSE WHERE code NOT IN (?)', [codes]);
    }
  },
  async load({ c, w }) {
    const s: Settings = structuredCloneSafe(DEFAULT_SETTINGS);
    for (const r of await rows(c, 'SELECT setting_key, value FROM platform_settings')) (s as any)[r.setting_key] = r.value;
    for (const p of await rows(c, 'SELECT * FROM plans ORDER BY id')) {
      if (!(p.code in s.plans)) continue;
      (s.plans as any)[p.code] = { code: p.code, name: p.name, price: Number(p.price_month), purchaseCap: p.purchase_cap === null ? null : Number(p.purchase_cap), users: p.max_users, locations: p.max_locations, features: p.features };
    }
    for (const l of await rows(c, 'SELECT * FROM verification_level_limits ORDER BY org_kind, level')) {
      const list = l.org_kind === 'FARMER' ? s.farmerLimits : s.buyerLimits;
      list[l.level] = { listings: l.max_listings, perOrder: Number(l.max_order_total), monthly: l.max_monthly_total === null ? null : Number(l.max_monthly_total), cash: !!l.cash_allowed, prepay: !!l.prepay_required };
    }
    const routes = await rows(c, 'SELECT * FROM shipping_routes WHERE active = TRUE ORDER BY id');
    if (routes.length) {
      const rates = groupBy(await rows(c, 'SELECT * FROM shipping_rates'), 'route_id');
      s.routes = routes.map(r => {
        const by = indexBy(rates.get(r.id) ?? [], 'vehicle_class');
        const v1 = by.get('V1'), v2 = by.get('V2');
        const route: ShippingRoute = {
          id: r.code, scope: r.scope, name: r.name, origin: r.origin, destination: r.destination, distanceKm: Number(r.distance_km),
          pricePerKg: Number(v2?.price_per_kg ?? 0), minFee: Number(v2?.min_fee ?? 0), cityMoto: Number(v1?.price_per_delivery ?? 0),
          cityVan: Number(v2?.price_per_delivery ?? 0), offerMinutes: r.offer_minutes,
        };
        return route;
      });
    }
    w.settings = s;
  },
};

/* ============================== Padrón de la SUNAT ============================== */

export const padronUnit: Unit = {
  name: 'padron',
  tables: ['sunat_ruc_registry'],
  entries: w => Object.entries(w.padron),
  async save({ c }, ruc, p: World['padron'][string]) {
    await upsert(c, 'sunat_ruc_registry', { ruc, business_name: cut(p.name, 160), status: p.estado, ruc_condition: p.condicion, ubigeo: p.district }, { keys: ['ruc'], hasId: false });
  },
  async remove({ c }, ruc) { await exec(c, 'DELETE FROM sunat_ruc_registry WHERE ruc = ?', [ruc]); },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT * FROM sunat_ruc_registry ORDER BY imported_at, ruc')) {
      w.padron[r.ruc] = { name: r.business_name, estado: r.status, condicion: r.ruc_condition, district: r.ubigeo };
    }
  },
};

/* ============================== Usuarios ============================== */

export const usersUnit: Unit = {
  name: 'users',
  tables: ['users', 'user_profiles', 'user_preferences', 'user_roles', 'consents'],
  entries: w => Object.entries(w.users),
  async save({ c, ids }, _key, u: User, prev: User | undefined) {
    const id = await upsert(c, 'users', { uuid: u.id, phone_e164: '+51' + u.phone, email: nv(u.email), status: u.status, created_at: dt(u.createdAt) });
    ids.set('users', u.id, id);
    await upsert(c, 'user_profiles', {
      user_id: id, doc_type: u.dni ? 'DNI' : 'NINGUNO', doc_number: nv(u.dni), full_name: cut(u.name, 120), short_name: cut(u.shortName, 60),
      title: cut(u.title, 60), persona_code: cut(u.persona, 10),
    }, { keys: ['user_id'], hasId: false });
    await upsert(c, 'user_preferences', {
      user_id: id, ui_language: u.prefs.lang, bilingual_labels: !!u.prefs.bilingual, audio_guide: !!u.prefs.audioGuide,
      text_scale: u.prefs.textScale, data_saver: !!u.prefs.dataSaver, number_format: u.prefs.numFmt,
    }, { keys: ['user_id'], hasId: false });
    if (changed(prev, u, x => [x.role, x.adminRole])) {
      await exec(c, 'DELETE FROM user_roles WHERE user_id = ?', [id]);
      await exec(c, 'INSERT INTO user_roles (user_id, role_id, admin_role) VALUES (?, ?, ?)', [id, ROLE_ID[u.role], nv(u.adminRole)]);
    }
    if (changed(prev, u, x => x.consents)) {
      await exec(c, 'DELETE FROM consents WHERE user_id = ?', [id]);
      const k = u.consents;
      if (k) await insertMany(c, 'consents', Object.entries(k.items).map(([purpose, granted], i) => ({ user_id: id, purpose: purpose.slice(0, 40), granted: !!granted, version: String(k.version).slice(0, 10), decided_at: dt(k.at), position: i })));
    }
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT u.uuid, u.phone_e164, u.email, u.status, u.created_at, p.doc_number, p.full_name, p.short_name, p.title, p.persona_code,
             pr.ui_language, pr.bilingual_labels, pr.audio_guide, pr.text_scale, pr.data_saver, pr.number_format,
             r.code AS role, ur.admin_role, o.uuid AS org_uuid, u.id
        FROM users u
        JOIN user_profiles p ON p.user_id = u.id
        JOIN user_preferences pr ON pr.user_id = u.id
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        LEFT JOIN (SELECT user_id, MIN(id) AS mid FROM organization_members GROUP BY user_id) m ON m.user_id = u.id
        LEFT JOIN organization_members om ON om.id = m.mid
        LEFT JOIN organizations o ON o.id = om.organization_id
       ORDER BY u.id`);
    const consents = groupBy(await rows(c, 'SELECT * FROM consents ORDER BY user_id, position'), 'user_id');
    for (const r of list) {
      const ks = consents.get(r.id);
      const u: User = strip({
        id: r.uuid, name: r.full_name, shortName: r.short_name, phone: String(r.phone_e164).replace(/^\+51/, ''), role: r.role ?? 'FARMER',
        adminRole: ostr(r.admin_role) as User['adminRole'], orgId: r.org_uuid ?? '', dni: ostr(r.doc_number), email: ostr(r.email), createdAt: tm(r.created_at),
        prefs: { lang: r.ui_language, audioGuide: !!r.audio_guide, bilingual: !!r.bilingual_labels, textScale: Number(r.text_scale) as User['prefs']['textScale'], dataSaver: !!r.data_saver, numFmt: r.number_format },
        consents: ks?.length ? { version: ks[0].version, at: tm(ks[0].decided_at), items: Object.fromEntries(ks.map(k => [k.purpose, !!k.granted])) } : undefined,
        persona: ostr(r.persona_code), title: ostr(r.title), status: r.status,
      });
      w.users[u.id] = u;
    }
  },
};

/* ============================== Organizaciones ============================== */

interface OrgEntry {
  o: Org;
  /** integrantes: los de memberIds y, por si acaso, los usuarios que dicen pertenecer a la organización */
  m: string[];
  /** reputación calculada (organization_stats) */
  r: [number, number];
  /** indicadores del transportista (carrier_details) */
  cs?: ReturnType<typeof carrierStats>;
  /** uso del mes de la membresía (subscription_usage) */
  u?: [string, number];
}

function docExpiry(docs: DocItem[]): number | undefined {
  let m: number | undefined;
  for (const d of docs) if (d.expiresOn !== undefined && Number.isFinite(d.expiresOn) && (m === undefined || d.expiresOn < m)) m = d.expiresOn;
  return m;
}

export const orgsUnit: Unit = {
  name: 'orgs',
  tables: ['organizations', 'organization_members', 'farmer_details', 'buyer_details', 'tax_profiles', 'addresses', 'org_service_areas', 'payout_accounts',
    'subscriptions', 'subscription_usage', 'carrier_details', 'carrier_drivers', 'vehicles', 'vehicle_documents', 'vehicle_inspections', 'carrier_routes',
    'warehouse_details', 'storage_facilities', 'storage_rates', 'storage_inspections', 'organization_stats'],
  entries(w) {
    const byOrg = new Map<string, string[]>();
    for (const u of Object.values(w.users)) {
      let a = byOrg.get(u.orgId);
      if (!a) { a = []; byOrg.set(u.orgId, a); }
      a.push(u.id);
    }
    const period = periodOf(w.now);
    return Object.values(w.orgs).map(o => {
      const listed = o.memberIds.filter(id => !!w.users[id]);
      const extra = (byOrg.get(o.id) ?? []).filter(id => !listed.includes(id));
      const st = orgStats(w, o.id);
      const e: OrgEntry = { o, m: [...listed, ...extra], r: [st.rating, st.count] };
      if (o.carrier) e.cs = carrierStats(w, o.id);
      if (o.subscription) e.u = [period, monthPurchases(w, o.id, w.now)];
      return [o.id, e] as [string, OrgEntry];
    });
  },
  async save({ c, ids, w }, _key, v: OrgEntry, p: OrgEntry | undefined) {
    const o = v.o, po = p?.o;
    const id = await upsert(c, 'organizations', {
      uuid: o.id, kind: o.type, trade_name: cut(o.name, 120), legal_name: cut(o.legalName, 160), ruc: nv(o.ruc), dni: nv(o.dni),
      ubigeo: o.district, province_code: o.province, verification_level: o.level, status: o.status, suspended_reason: cut(o.suspendedReason, 500),
      accepts_cash: !!o.acceptsCash, delivery_days: js(o.deliveryDays ?? []), pickup_point: cut(o.pickupPoint, 160),
      avatar_initials: String(o.initials ?? '').slice(0, 3), avatar_color: o.color, created_at: dt(o.createdAt),
    });
    ids.set('organizations', o.id, id);

    if (changed(p, v, x => [x.m, x.o.members ?? null])) {
      await exec(c, 'DELETE FROM organization_members WHERE organization_id = ?', [id]);
      await insertMany(c, 'organization_members', v.m.map((uid, i) => {
        const mb = (o.members ?? []).find(x => x.userId === uid);
        return {
          organization_id: id, user_id: ids.need('users', uid), member_role: i === 0 ? 'TITULAR' : 'MIEMBRO', position: i,
          member_kind: mb ? mb.kind : null, permissions: mb ? js(mb.perms) : null, active: mb ? mb.active : true,
          added_at: mb ? dt(mb.addedAt) : null, added_by: mb ? ids.opt('users', mb.addedBy) ?? null : null, note: mb ? cut(mb.note, 40) : null,
        };
      }));
    }
    if (o.type === 'FARMER' && !po) {
      await exec(c, 'INSERT IGNORE INTO farmer_details (organization_id, primary_language) VALUES (?, ?)', [id, w.users[v.m[0]]?.prefs.lang ?? 'es']);
    }
    if (changed(po, o, x => [x.businessType, x.receiver])) {
      if (o.type === 'BUYER' || o.businessType || o.receiver !== undefined) {
        await upsert(c, 'buyer_details', { organization_id: id, business_type: nv(o.businessType), receiver_name: cut(o.receiver, 120) }, { keys: ['organization_id'], hasId: false });
      }
    }
    if (changed(po, o, x => [x.taxRegime, x.ruc])) {
      if (o.taxRegime) {
        const pad = o.ruc ? w.padron[o.ruc] : undefined;
        await upsert(c, 'tax_profiles', { organization_id: id, tax_regime: o.taxRegime, sunat_status: nv(pad?.estado), sunat_condition: nv(pad?.condicion) }, { keys: ['organization_id'], hasId: false });
      } else await exec(c, 'DELETE FROM tax_profiles WHERE organization_id = ?', [id]);
    }
    if (changed(po, o, x => [x.address, x.district, x.locales ?? null])) {
      await exec(c, 'DELETE FROM addresses WHERE organization_id = ?', [id]);
      if (o.locales?.length) {
        // locales de la MYPE (B-23): la dirección por defecto es la del local principal
        await insertMany(c, 'addresses', o.locales.map((l, i) => ({
          organization_id: id, ubigeo: l.district, address_line: cut(l.address, 200), is_default: !!l.isDefault, uuid: l.id, label: cut(l.name, 60),
          receiver_name: cut(l.receiver, 80), receiving_days: js(l.days), position: i,
        })));
      } else if (o.address !== undefined) await exec(c, 'INSERT INTO addresses (organization_id, ubigeo, address_line, is_default) VALUES (?, ?, ?, TRUE)', [id, o.district, cut(o.address, 200)]);
    }
    if (changed(po, o, x => x.serviceAreas)) {
      await exec(c, 'DELETE FROM org_service_areas WHERE organization_id = ?', [id]);
      await insertMany(c, 'org_service_areas', o.serviceAreas.map((a, i) => ({ organization_id: id, ubigeo: a.district, delivery_fee: a.fee, position: i })));
    }
    const payoutChanged = changed(po, o, x => x.payout);
    if (payoutChanged) {
      const keep: string[] = [];
      for (const [i, a] of o.payout.entries()) {
        const num = String(a.number);
        await upsert(c, 'payout_accounts', {
          uuid: a.id, organization_id: id, method: a.kind, account_enc: encrypt(num), account_last4: num.slice(-4).padStart(4, '0'),
          holder_name: cut(a.holder, 160) ?? '', holder_relation: a.relation, authorization_text: cut(a.authorization, 500),
          status: a.verified ? 'VERIFICADA' : 'SIN_VERIFICAR', position: i,
        }, { keys: ['organization_id', 'uuid'] });
        keep.push(a.id);
      }
      if (keep.length) await exec(c, 'DELETE FROM payout_accounts WHERE organization_id = ? AND uuid NOT IN (?)', [id, keep]);
      else await exec(c, 'DELETE FROM payout_accounts WHERE organization_id = ?', [id]);
    }

    // Membresía de la MYPE
    if (o.subscription) {
      const s = o.subscription;
      if (changed(po, o, x => x.subscription)) {
        const sid = await upsert(c, 'subscriptions', {
          organization_id: id, plan_id: ids.need('plans', s.plan), status: s.status, trial_ends_on: dt(s.trialEndsOn), paid_until: dt(s.paidUntil),
          grace_until: dt(s.graceUntil), months_below: Math.min(s.monthsBelow, 127), history: js(s.history),
        }, { keys: ['organization_id'] });
        ids.set('subscriptions', o.id, sid);
      }
      if (v.u && changed(p, v, x => [x.u, x.m.length])) {
        await upsert(c, 'subscription_usage', { subscription_id: ids.need('subscriptions', o.id), period: v.u[0], purchases_total: v.u[1], users_count: v.m.length || 1, locations_count: 1 }, { keys: ['subscription_id', 'period'] });
      }
    } else if (po?.subscription) {
      await exec(c, 'DELETE FROM subscriptions WHERE organization_id = ?', [id]);
      ids.delete('subscriptions', o.id);
    }

    // Transportista aliado
    if (o.carrier) {
      const k = o.carrier, pk = po?.carrier, cs = v.cs!;
      await upsert(c, 'carrier_details', {
        organization_id: id, level: k.level, available: !!k.available, rating_avg: cs.count ? cs.rating : null, shipments_done: cs.shipments,
        on_time_pct: cs.shipments ? round4(cs.onTimePct) : null, no_show_count: k.noShows, training_done: k.training.done, training_total: k.training.total,
        agreement_signed: !!k.agreementSigned, insurance: !!k.insurance, base_stats: js(o.seedCarrier),
      }, { keys: ['organization_id'], hasId: false });
      if (payoutChanged) await exec(c, 'UPDATE carrier_details SET payout_account_id = (SELECT id FROM payout_accounts WHERE organization_id = ? ORDER BY position LIMIT 1) WHERE organization_id = ?', [id, id]);
      if (!pk || !same(pk.driverLicense, k.driverLicense) || changed(p, v, x => x.m[0])) {
        await exec(c, 'DELETE FROM carrier_drivers WHERE carrier_org_id = ?', [id]);
        await exec(c, 'INSERT INTO carrier_drivers (carrier_org_id, user_id, license_class, license_expires_on) VALUES (?, ?, ?, ?)', [id, ids.opt('users', v.m[0]), k.driverLicense.cls, dt(k.driverLicense.expiresOn)]);
      }
      if (!pk || !same(pk.vehicle, k.vehicle) || !same(pk.inspection, k.inspection)) {
        const veh = k.vehicle;
        const row = { carrier_org_id: id, plate: veh.plate, vehicle_class: veh.vclass, category: veh.category, payload_kg: veh.payloadKg, body_type: cut(veh.body, 60) ?? '', model_year: veh.year, status: veh.docs.some(d => d.status === 'OBSERVED' || d.status === 'MISSING') ? 'OBSERVADO' : 'ACTIVO' };
        let vid = ids.get('vehicles', o.id);
        if (vid) await exec(c, 'UPDATE vehicles SET ? WHERE id = ?', [row, vid]);
        else { vid = Number((await exec(c, 'INSERT INTO vehicles SET ?', [row])).insertId); ids.set('vehicles', o.id, vid); }
        await exec(c, 'DELETE FROM vehicle_documents WHERE vehicle_id = ?', [vid]);
        await insertMany(c, 'vehicle_documents', veh.docs.map((d, i) => ({ vehicle_id: vid, kind: cut(d.kind, 20), label: cut(d.label, 120), number: cut(d.number, 40), expires_on: dt(d.expiresOn), status: d.status, note: cut(d.note, 200), position: i })));
        await exec(c, 'DELETE FROM vehicle_inspections WHERE vehicle_id = ?', [vid]);
        const ins = k.inspection;
        if (ins) await exec(c, 'INSERT INTO vehicle_inspections (vehicle_id, inspector_uuid, inspected_at, score, critical_fails, checklist) VALUES (?, ?, ?, ?, ?, ?)', [vid, ins.by, dt(ins.at), ins.score, ins.criticalFails, js(ins.checklist ?? {})]);
      }
      if (!pk || !same(pk.routes, k.routes)) {
        await exec(c, 'DELETE FROM carrier_routes WHERE carrier_org_id = ?', [id]);
        await insertMany(c, 'carrier_routes', k.routes.map((r, i) => ({ carrier_org_id: id, route_id: ids.need('shipping_routes', r.routeId), weekdays: js(r.days), departs_at: r.departs, arrives_at: r.arrives, position: i })));
      }
    }

    // Almacén aliado
    if (o.warehouse) {
      const h = o.warehouse, ph = po?.warehouse;
      if (!ph || !same(ph, h) || payoutChanged) {
        await upsert(c, 'warehouse_details', {
          organization_id: id, facility_type: h.facilityType, services: js(h.services), optional_services: js(h.optional), products: js(h.products),
          default_rate: h.defaultRate, docs: js(h.docs), agreement_signed: !!h.agreementSigned,
        }, { keys: ['organization_id'], hasId: false });
        await exec(c, 'UPDATE warehouse_details SET payout_account_id = (SELECT id FROM payout_accounts WHERE organization_id = ? ORDER BY position LIMIT 1) WHERE organization_id = ?', [id, id]);
        const fid = await upsert(c, 'storage_facilities', {
          organization_id: id, facility_type: h.facilityType, capacity_for_mesagri: h.capacitySacks, ubigeo: h.location, map_x: h.geo.x, map_y: h.geo.y,
          level: h.level, next_doc_expiry: dt(docExpiry(h.docs)), visit_scheduled_at: dt(h.visitScheduled),
        }, { keys: ['organization_id'] });
        ids.set('storage_facilities', o.id, fid);
        if (!ph || !same(ph.rates, h.rates)) {
          await exec(c, 'DELETE FROM storage_rates WHERE facility_id = ?', [fid]);
          await insertMany(c, 'storage_rates', h.rates.map((r, i) => ({ facility_id: fid, catalog_product_id: ids.need('catalog_products', r.productId), unit: 'saco', price_per_month: r.perSackMonth, position: i })));
        }
        if (!ph || !same(ph.visit, h.visit)) {
          await exec(c, 'DELETE FROM storage_inspections WHERE facility_id = ?', [fid]);
          const vs = h.visit;
          if (vs) await exec(c, 'INSERT INTO storage_inspections (facility_id, inspector_id, inspector_uuid, visited_at, score, critical_fails) VALUES (?, ?, ?, ?, ?, ?)', [fid, ids.opt('users', vs.by), vs.by, dt(vs.at), vs.score, vs.criticalFails]);
        }
      }
    }

    // Reputación y contadores
    const k = o.counters;
    await upsert(c, 'organization_stats', {
      organization_id: id, rating_avg: v.r[1] ? v.r[0] : null, ratings_count: v.r[1], orders_completed: o.type === 'BUYER' ? k.completedPurchases : k.completedSales,
      on_time_rate: k.deliveries ? round4(k.onTime / k.deliveries) : null, completed_sales: k.completedSales, free_sales_used: k.freeSalesUsed,
      completed_purchases: k.completedPurchases, late_cancels: k.lateCancels, seller_cancels: k.sellerCancels, expired_orders: k.expiredOrders,
      response_minutes_total: Math.round(k.responseMinutesTotal), responses: k.responses, on_time: k.onTime, deliveries: k.deliveries, disputes_lost: k.disputesLost,
      base_rating: js(o.seedRating),
    }, { keys: ['organization_id'], hasId: false });
  },
  async load({ c, w }) {
    const orgs = await rows(c, 'SELECT * FROM organizations WHERE deleted_at IS NULL ORDER BY id');
    const members = groupBy(await rows(c, 'SELECT om.*, u.uuid, ab.uuid AS added_by_uuid FROM organization_members om JOIN users u ON u.id = om.user_id LEFT JOIN users ab ON ab.id = om.added_by ORDER BY om.organization_id, om.position'), 'organization_id');
    const locales = groupBy(await rows(c, 'SELECT * FROM addresses WHERE uuid IS NOT NULL ORDER BY organization_id, position'), 'organization_id');
    const buyers = indexBy(await rows(c, 'SELECT * FROM buyer_details'), 'organization_id');
    const taxes = indexBy(await rows(c, 'SELECT * FROM tax_profiles'), 'organization_id');
    const addrs = indexBy(await rows(c, 'SELECT * FROM addresses WHERE is_default = TRUE ORDER BY id'), 'organization_id');
    const areas = groupBy(await rows(c, 'SELECT * FROM org_service_areas ORDER BY organization_id, position'), 'organization_id');
    const payouts = groupBy(await rows(c, 'SELECT * FROM payout_accounts ORDER BY organization_id, position'), 'organization_id');
    const subs = indexBy(await rows(c, 'SELECT s.*, p.code AS plan_code FROM subscriptions s JOIN plans p ON p.id = s.plan_id'), 'organization_id');
    const carriers = indexBy(await rows(c, 'SELECT * FROM carrier_details'), 'organization_id');
    const drivers = indexBy(await rows(c, 'SELECT * FROM carrier_drivers ORDER BY id'), 'carrier_org_id');
    const vehicles = indexBy(await rows(c, 'SELECT * FROM vehicles ORDER BY id'), 'carrier_org_id');
    const vdocs = groupBy(await rows(c, 'SELECT * FROM vehicle_documents ORDER BY vehicle_id, position'), 'vehicle_id');
    const vins = indexBy(await rows(c, 'SELECT * FROM vehicle_inspections ORDER BY id'), 'vehicle_id');
    const croutes = groupBy(await rows(c, 'SELECT cr.*, r.code AS route_code FROM carrier_routes cr JOIN shipping_routes r ON r.id = cr.route_id ORDER BY cr.carrier_org_id, cr.position'), 'carrier_org_id');
    const whs = indexBy(await rows(c, 'SELECT * FROM warehouse_details'), 'organization_id');
    const facs = indexBy(await rows(c, 'SELECT * FROM storage_facilities'), 'organization_id');
    const srates = groupBy(await rows(c, 'SELECT sr.*, p.code AS product_code FROM storage_rates sr JOIN catalog_products p ON p.id = sr.catalog_product_id ORDER BY sr.facility_id, sr.position'), 'facility_id');
    const sins = indexBy(await rows(c, 'SELECT * FROM storage_inspections ORDER BY id'), 'facility_id');
    const stats = indexBy(await rows(c, 'SELECT * FROM organization_stats'), 'organization_id');

    for (const r of orgs) {
      const bd = buyers.get(r.id), tp = taxes.get(r.id), ad = addrs.get(r.id), sb = subs.get(r.id), st = stats.get(r.id);
      const o: Org = strip({
        id: r.uuid, type: r.kind, name: r.trade_name, legalName: ostr(r.legal_name), ruc: ostr(r.ruc), dni: ostr(r.dni), district: r.ubigeo, province: r.province_code,
        address: ad ? ad.address_line : undefined, receiver: ostr(bd?.receiver_name), businessType: ostr(bd?.business_type) as Org['businessType'],
        level: r.verification_level, status: r.status, suspendedReason: ostr(r.suspended_reason), createdAt: tm(r.created_at), taxRegime: ostr(tp?.tax_regime) as Org['taxRegime'],
        payout: (payouts.get(r.id) ?? []).map(a => strip({
          id: a.uuid, kind: a.method, number: decrypt(a.account_enc), holder: a.holder_name, relation: a.holder_relation,
          authorization: ostr(a.authorization_text), verified: a.status === 'VERIFICADA',
        })),
        acceptsCash: !!r.accepts_cash, serviceAreas: (areas.get(r.id) ?? []).map(a => ({ district: a.ubigeo, fee: Number(a.delivery_fee) })),
        deliveryDays: r.delivery_days ?? [], pickupPoint: ostr(r.pickup_point), memberIds: (members.get(r.id) ?? []).map(m => m.uuid),
        members: (members.get(r.id) ?? []).some(m => m.member_kind) ? (members.get(r.id) ?? []).filter(m => m.member_kind).map(m => strip({
          userId: m.uuid, kind: m.member_kind, perms: m.permissions ?? [], active: !!m.active, addedAt: tm(m.added_at), addedBy: m.added_by_uuid ?? '', note: ostr(m.note),
        })) : undefined,
        locales: (locales.get(r.id) ?? []).length ? (locales.get(r.id) ?? []).map(l => ({
          id: l.uuid, name: l.label ?? '', district: l.ubigeo, address: l.address_line, receiver: l.receiver_name ?? '', days: l.receiving_days ?? [], isDefault: !!l.is_default,
        })) : undefined,
        subscription: sb ? strip({ plan: sb.plan_code, status: sb.status, trialEndsOn: tm(sb.trial_ends_on), paidUntil: tm(sb.paid_until), graceUntil: tms(sb.grace_until), monthsBelow: sb.months_below, history: sb.history ?? [] }) : undefined,
        counters: {
          completedSales: st?.completed_sales ?? 0, freeSalesUsed: st?.free_sales_used ?? 0, completedPurchases: st?.completed_purchases ?? 0, lateCancels: st?.late_cancels ?? 0,
          sellerCancels: st?.seller_cancels ?? 0, expiredOrders: st?.expired_orders ?? 0, responseMinutesTotal: st?.response_minutes_total ?? 0, responses: st?.responses ?? 0,
          onTime: st?.on_time ?? 0, deliveries: st?.deliveries ?? 0, disputesLost: st?.disputes_lost ?? 0,
        },
        initials: r.avatar_initials, color: r.avatar_color, seedRating: st?.base_rating ?? undefined,
      } as Org);
      const cd = carriers.get(r.id);
      if (cd) {
        const vh = vehicles.get(r.id), dv = drivers.get(r.id), ins = vh ? vins.get(vh.id) : undefined;
        o.carrier = strip({
          level: cd.level, available: !!cd.available,
          vehicle: {
            plate: vh?.plate ?? '', vclass: vh?.vehicle_class ?? 'V2', category: vh?.category ?? 'N1', body: vh?.body_type ?? '', payloadKg: vh?.payload_kg ?? 0, year: vh?.model_year ?? 0,
            docs: (vh ? vdocs.get(vh.id) ?? [] : []).map(d => strip({ kind: d.kind, label: d.label, number: ostr(d.number), expiresOn: tms(d.expires_on), status: d.status, note: ostr(d.note) }) as DocItem),
          },
          driverLicense: { cls: dv?.license_class ?? 'A-I', expiresOn: dv ? tm(dv.license_expires_on) : 0 },
          routes: (croutes.get(r.id) ?? []).map(x => ({ routeId: x.route_code, days: x.weekdays ?? [], departs: hhmm(x.departs_at), arrives: hhmm(x.arrives_at) })),
          training: { done: cd.training_done, total: cd.training_total },
          inspection: ins ? { at: tm(ins.inspected_at), score: ins.score, criticalFails: ins.critical_fails, by: ins.inspector_uuid ?? '', checklist: ins.checklist ?? {} } : undefined,
          agreementSigned: !!cd.agreement_signed, insurance: !!cd.insurance, noShows: cd.no_show_count,
        } as NonNullable<Org['carrier']>);
        if (cd.base_stats) o.seedCarrier = cd.base_stats;
      }
      const wd = whs.get(r.id), fc = facs.get(r.id);
      if (wd && fc) {
        const vs = sins.get(fc.id);
        o.warehouse = strip({
          level: fc.level === 'SUSPENDIDO' ? 'A0' : fc.level, facilityType: wd.facility_type, capacitySacks: fc.capacity_for_mesagri,
          rates: (srates.get(fc.id) ?? []).map(x => ({ productId: x.product_code, perSackMonth: Number(x.price_per_month) })),
          defaultRate: Number(wd.default_rate), products: wd.products ?? [], services: wd.services ?? [], optional: wd.optional_services ?? [], docs: wd.docs ?? [],
          visit: vs ? { at: tm(vs.visited_at), score: vs.score, criticalFails: vs.critical_fails, by: vs.inspector_uuid ?? '' } : undefined,
          visitScheduled: tms(fc.visit_scheduled_at), agreementSigned: !!wd.agreement_signed, location: fc.ubigeo, geo: { x: Number(fc.map_x), y: Number(fc.map_y) },
        } as NonNullable<Org['warehouse']>);
      }
      w.orgs[o.id] = o;
    }
  },
};

/* ============================== Chacras ============================== */

export const farmsUnit: Unit = {
  name: 'farms',
  tables: ['farms'],
  entries: w => Object.entries(w.farms),
  async save({ c, ids }, _key, f: Farm) {
    const id = await upsert(c, 'farms', {
      uuid: f.id, organization_id: ids.need('organizations', f.orgId), name: cut(f.name, 120), ubigeo: f.district, area_ha: f.areaHa, tenure: f.tenure,
      crops: js(f.crops ?? []), gps_source: f.gps, photos: js(f.photos ?? []), created_at: dt(f.createdAt),
    });
    ids.set('farms', f.id, id);
  },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT f.*, o.uuid AS org_uuid FROM farms f JOIN organizations o ON o.id = f.organization_id ORDER BY f.id')) {
      w.farms[r.uuid] = { id: r.uuid, orgId: r.org_uuid, name: r.name, district: r.ubigeo, areaHa: Number(r.area_ha), tenure: r.tenure, crops: r.crops ?? [], gps: r.gps_source, photos: r.photos ?? [], createdAt: tm(r.created_at) };
    }
  },
};

/* ============================== Expedientes de verificación ============================== */

export const casesUnit: Unit = {
  name: 'cases',
  tables: ['verification_cases', 'verification_checks', 'documents'],
  entries: w => Object.entries(w.cases),
  async save({ c, ids }, _key, k: VerifCase, prev: VerifCase | undefined) {
    const d = k.decision;
    const id = await upsert(c, 'verification_cases', {
      uuid: k.id, organization_id: ids.need('organizations', k.orgId), subject: k.kind, target_level: k.targetLevel, status: k.status,
      submitted_at: dt(k.submittedAt), assigned_to: ids.opt('users', k.assignedTo), decided_by: ids.opt('users', d?.by), decided_by_uuid: nv(d?.by),
      decision_result: nv(d?.result), decision_reason: d ? String(d.reason ?? '') : null, decided_at: dt(d?.at), appealed: bn(k.appealed), history: js(k.history),
    });
    ids.set('verification_cases', k.id, id);
    if (changed(prev, k, x => x.evidence)) {
      await exec(c, 'DELETE FROM documents WHERE case_id = ?', [id]);
      await insertMany(c, 'documents', k.evidence.map((e, i) => ({
        case_id: id, doc_type: cut(e.key, 40), label: cut(e.label, 160) ?? '', detail: cut(e.detail, 500), file_uuid: nv(e.photoId), reviewed_ok: bn(e.ok),
        status: e.ok === true ? 'APROBADO' : e.ok === false ? 'OBSERVADO' : 'RECIBIDO', position: i,
      })));
    }
    if (changed(prev, k, x => x.alerts)) {
      await exec(c, 'DELETE FROM verification_checks WHERE case_id = ?', [id]);
      await insertMany(c, 'verification_checks', k.alerts.map((a, i) => ({ case_id: id, check_type: cut(a, 160), result: 'ALERTA', evidence: null, position: i })));
    }
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT k.*, o.uuid AS org_uuid, ua.uuid AS assigned_uuid FROM verification_cases k
        JOIN organizations o ON o.id = k.organization_id LEFT JOIN users ua ON ua.id = k.assigned_to ORDER BY k.id`);
    const docs = groupBy(await rows(c, 'SELECT * FROM documents ORDER BY case_id, position'), 'case_id');
    const checks = groupBy(await rows(c, 'SELECT * FROM verification_checks ORDER BY case_id, position'), 'case_id');
    for (const r of list) {
      const k: VerifCase = strip({
        id: r.uuid, orgId: r.org_uuid, kind: r.subject, targetLevel: r.target_level, status: r.status, submittedAt: tm(r.submitted_at), assignedTo: ostr(r.assigned_uuid),
        evidence: (docs.get(r.id) ?? []).map(d => strip({ key: d.doc_type, label: d.label, detail: ostr(d.detail), photoId: ostr(d.file_uuid), ok: ob(d.reviewed_ok) })),
        alerts: (checks.get(r.id) ?? []).map(x => x.check_type), history: r.history ?? [],
        decision: r.decision_result ? { by: r.decided_by_uuid ?? '', at: tm(r.decided_at), result: r.decision_result, reason: r.decision_reason ?? '' } : undefined,
        appealed: ob(r.appealed),
      } as VerifCase);
      w.cases[k.id] = k;
    }
  },
};

void onum;
