/*
 * Unidades de la entrega R2: solicitudes de compra y sus ofertas, pedidos programados del plan Pro
 * y productos que el equipo agrega al catálogo (W-09).
 */
import type { PurchaseRequest, RequestOffer, Schedule, Product } from '@mesagri/shared';
import { registerProducts, lima } from '@mesagri/shared';
import { exec, insertMany, rows, upsert, dt, js } from '../db';
import { Unit, changed, groupBy, strip, tms, tm, onum, ostr, nv, cut } from './units';

const REQ_STATUS = { OPEN: 'ABIERTA', AWARDED: 'ADJUDICADA', CLOSED: 'CERRADA', EXPIRED: 'VENCIDA' } as const;
const REQ_BACK: Record<string, PurchaseRequest['status']> = { ABIERTA: 'OPEN', ADJUDICADA: 'AWARDED', CERRADA: 'CLOSED', VENCIDA: 'EXPIRED' };
const OFF_STATUS = { SENT: 'ENVIADA', ACCEPTED: 'ACEPTADA', REJECTED: 'RECHAZADA', WITHDRAWN: 'RETIRADA' } as const;
const OFF_BACK: Record<string, RequestOffer['status']> = { ENVIADA: 'SENT', ACEPTADA: 'ACCEPTED', RECHAZADA: 'REJECTED', RETIRADA: 'WITHDRAWN' };

/* ============================== Solicitudes de compra ============================== */

export const requestsUnit: Unit = {
  name: 'requests',
  tables: ['requests', 'request_offers'],
  entries: w => Object.entries(w.requests ?? {}),
  async save({ c, ids }, _key, r: PurchaseRequest, p: PurchaseRequest | undefined) {
    const id = await upsert(c, 'requests', {
      uuid: r.id, code: cut(r.code, 20) ?? '', buyer_org_id: ids.need('organizations', r.buyerOrgId), buyer_user_id: ids.opt('users', r.buyerUserId),
      catalog_product_id: ids.need('catalog_products', r.productId), quantity: r.kg, max_price_per_kg: r.maxPricePerKg ?? null, needed_on: dt(r.neededOn),
      status: REQ_STATUS[r.status], created_at: dt(r.createdAt), ubigeo: nv(r.district), address: cut(r.address, 200), local_uuid: nv(r.localId), note: cut(r.note, 300),
      closes_at: dt(r.closesAt), awarded_offer_uuid: nv(r.awardedOfferId), sub_order_uuid: nv(r.subOrderId), closed_at: dt(r.closedAt),
    });
    if (changed(p, r, x => x.offers)) {
      await exec(c, 'DELETE FROM request_offers WHERE request_id = ?', [id]);
      await insertMany(c, 'request_offers', r.offers.map((o, i) => ({
        uuid: o.id, request_id: id, seller_org_id: ids.need('organizations', o.sellerOrgId), user_id: ids.opt('users', o.userId), unit_price: o.pricePerKg,
        status: OFF_STATUS[o.status], created_at: dt(o.at), quantity: o.kg, harvest_date: dt(o.harvestDate), quality: o.quality, note: cut(o.note, 200),
        listing_uuid: nv(o.listingId), position: i,
      })));
    }
  },
  async load({ c, w }) {
    w.requests = {};
    const list = await rows(c, `
      SELECT r.*, o.uuid AS org_uuid, u.uuid AS user_uuid, p.code AS product_code FROM requests r
        JOIN organizations o ON o.id = r.buyer_org_id JOIN catalog_products p ON p.id = r.catalog_product_id
        LEFT JOIN users u ON u.id = r.buyer_user_id ORDER BY r.id`);
    const offers = groupBy(await rows(c, `
      SELECT ro.*, o.uuid AS org_uuid, u.uuid AS user_uuid FROM request_offers ro JOIN organizations o ON o.id = ro.seller_org_id
        LEFT JOIN users u ON u.id = ro.user_id ORDER BY ro.request_id, ro.position`), 'request_id');
    for (const r of list) {
      w.requests[r.uuid] = strip({
        id: r.uuid, code: r.code, buyerOrgId: r.org_uuid, buyerUserId: r.user_uuid ?? '', productId: r.product_code, kg: Number(r.quantity),
        maxPricePerKg: onum(r.max_price_per_kg), neededOn: tm(r.needed_on), district: r.ubigeo, address: ostr(r.address), localId: ostr(r.local_uuid),
        note: ostr(r.note), createdAt: tm(r.created_at), closesAt: tm(r.closes_at), status: REQ_BACK[r.status],
        offers: (offers.get(r.id) ?? []).map(o => strip({
          id: o.uuid, sellerOrgId: o.org_uuid, userId: o.user_uuid ?? '', pricePerKg: Number(o.unit_price), kg: Number(o.quantity), harvestDate: tms(o.harvest_date),
          quality: o.quality, note: ostr(o.note), at: tm(o.created_at), status: OFF_BACK[o.status], listingId: ostr(o.listing_uuid),
        } as RequestOffer)),
        awardedOfferId: ostr(r.awarded_offer_uuid), subOrderId: ostr(r.sub_order_uuid), closedAt: tms(r.closed_at),
      } as PurchaseRequest);
    }
  },
};

/* ============================== Pedidos programados ============================== */

const dayStr = (t: number) => { const x = lima(t); return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; };

export const schedulesUnit: Unit = {
  name: 'schedules',
  tables: ['order_schedules', 'order_schedule_items'],
  entries: w => Object.entries(w.schedules ?? {}),
  async save({ c, ids }, _key, s: Schedule, p: Schedule | undefined) {
    const id = await upsert(c, 'order_schedules', {
      uuid: s.id, code: cut(s.code, 20) ?? '', buyer_org_id: ids.need('organizations', s.buyerOrgId), frequency: s.frequency, weekday: s.weekday,
      next_run_on: dayStr(s.nextDelivery - 2 * 86_400_000), max_price_increase: s.maxIncrease, active: s.active, name: cut(s.name, 60) ?? '',
      created_by: ids.opt('users', s.createdBy), delivery_mode: s.deliveryMode, pay_method: s.payMethod, tax_doc: s.taxDoc, delivery_slot: cut(s.slot, 40) ?? '',
      local_uuid: nv(s.localId), next_delivery_at: dt(s.nextDelivery), draft: js(s.draft), history: js(s.history), created_at: dt(s.createdAt),
    });
    if (changed(p, s, x => x.items)) {
      await exec(c, 'DELETE FROM order_schedule_items WHERE schedule_id = ?', [id]);
      await insertMany(c, 'order_schedule_items', s.items.map((it, i) => ({
        schedule_id: id, catalog_product_id: ids.need('catalog_products', it.productId), seller_org_id: ids.opt('organizations', it.sellerOrgId), quantity: it.qty,
        listing_uuid: nv(it.listingId), unit: it.unit, unit_kg: it.unitKg, ref_price: it.refPrice, position: i,
      })));
    }
  },
  async remove({ c }, key) {
    await exec(c, 'DELETE FROM order_schedules WHERE uuid = ?', [key]);
  },
  async load({ c, w }) {
    w.schedules = {};
    const list = await rows(c, 'SELECT s.*, o.uuid AS org_uuid, u.uuid AS user_uuid FROM order_schedules s JOIN organizations o ON o.id = s.buyer_org_id LEFT JOIN users u ON u.id = s.created_by ORDER BY s.id');
    const items = groupBy(await rows(c, `
      SELECT i.*, p.code AS product_code, o.uuid AS org_uuid FROM order_schedule_items i JOIN catalog_products p ON p.id = i.catalog_product_id
        LEFT JOIN organizations o ON o.id = i.seller_org_id ORDER BY i.schedule_id, i.position`), 'schedule_id');
    for (const r of list) {
      w.schedules[r.uuid] = strip({
        id: r.uuid, code: r.code, buyerOrgId: r.org_uuid, createdBy: r.user_uuid ?? '', name: r.name,
        items: (items.get(r.id) ?? []).map(i => strip({ productId: i.product_code, sellerOrgId: i.org_uuid ?? '', listingId: ostr(i.listing_uuid), qty: Number(i.quantity), unit: i.unit, unitKg: Number(i.unit_kg), refPrice: Number(i.ref_price) })),
        frequency: r.frequency, weekday: r.weekday, deliveryMode: r.delivery_mode, payMethod: r.pay_method, taxDoc: r.tax_doc, slot: r.delivery_slot,
        localId: ostr(r.local_uuid), maxIncrease: Number(r.max_price_increase ?? 0.1), nextDelivery: tm(r.next_delivery_at), active: !!r.active,
        createdAt: tm(r.created_at), draft: r.draft ?? undefined, history: r.history ?? [],
      } as Schedule);
    }
  },
};

/* ============================== Catálogo: productos del equipo ============================== */

const perish = (days: number) => (days <= 12 ? 'ALTA' : days <= 60 ? 'MEDIA' : 'BAJA');

export const catalogUnit: Unit = {
  name: 'catalog',
  // las filas viven en catalog_products (datos de referencia); al reiniciar la demo se borran aparte
  tables: [],
  entries: w => Object.entries(w.catalogExtra ?? {}),
  async save({ c, ids }, _key, prod: Product) {
    const cat = (await rows(c, 'SELECT id FROM product_categories WHERE code = ?', [prod.category]))[0];
    const id = await upsert(c, 'catalog_products', {
      code: prod.id, category_id: cat?.id ?? 1, name: cut(prod.name, 80), short_name: cut(prod.short, 60), letter: prod.letter.slice(0, 1), color: prod.color,
      default_unit: prod.units[0] ?? 'kg', allowed_units: js(prod.units), sack_kg: prod.sackKg, jaba_kg: prod.jabaKg ?? null, perishability: perish(prod.perishDays),
      perish_days: prod.perishDays, storable: !!prod.storable, shrink_class: prod.merma, igv_treatment_default: 'EXONERADO', varieties: js(prod.varieties ?? []),
      active: true, custom_definition: js(prod),
    }, { keys: ['code'] });
    ids.set('catalog_products', prod.id, id);
  },
  async load({ c, w }) {
    w.catalogExtra = {};
    for (const r of await rows(c, 'SELECT code, custom_definition FROM catalog_products WHERE custom_definition IS NOT NULL ORDER BY id')) {
      if (r.custom_definition) w.catalogExtra[r.code] = r.custom_definition as Product;
    }
    registerProducts(w.catalogExtra);
  },
};
