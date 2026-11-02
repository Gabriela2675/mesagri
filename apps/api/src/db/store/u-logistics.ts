/*
 * Unidades de almacenes y transporte: reservas, lotes con su constancia y movimientos,
 * órdenes de salida, incidentes del lote y envíos con transportista aliado.
 */
import type { Booking, Lot, ReleaseOrder, StoIncident, Shipment } from '@mesagri/shared';
import { exec, insertMany, rows, upsert, dt, js } from '../db';
import { sha256 } from '../secure';
import { Unit, changed, groupBy, indexBy, strip, tms, tm, ob, onum, ostr, bn, nv, cut, same } from './units';

/* ============================== Reservas de espacio ============================== */

export const bookingsUnit: Unit = {
  name: 'bookings',
  tables: ['storage_bookings'],
  entries: w => Object.entries(w.bookings),
  async save({ c, ids }, _key, b: Booking) {
    const id = await upsert(c, 'storage_bookings', {
      uuid: b.id, code: cut(b.code, 20), facility_id: ids.need('storage_facilities', b.facilityOrgId), farmer_org_id: ids.need('organizations', b.farmerOrgId),
      catalog_product_id: ids.need('catalog_products', b.productId), sacks: b.sacks, kg_per_sack: b.kgPerSack, months: b.months, arrival_date: dt(b.arrivalDate),
      rate_frozen: b.rate, status: b.status, created_at: dt(b.createdAt), responded_at: dt(b.respondedAt), reject_reason: cut(b.rejectReason, 500), qr_text: cut(b.qr, 120) ?? '',
    });
    ids.set('storage_bookings', b.id, id);
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT b.*, fo.uuid AS facility_uuid, o.uuid AS farmer_uuid, p.code AS product_code FROM storage_bookings b
        JOIN storage_facilities f ON f.id = b.facility_id JOIN organizations fo ON fo.id = f.organization_id
        JOIN organizations o ON o.id = b.farmer_org_id JOIN catalog_products p ON p.id = b.catalog_product_id ORDER BY b.id`);
    for (const r of list) {
      w.bookings[r.uuid] = strip({
        id: r.uuid, code: r.code, facilityOrgId: r.facility_uuid, farmerOrgId: r.farmer_uuid, productId: r.product_code, sacks: r.sacks, kgPerSack: Number(r.kg_per_sack),
        months: r.months, arrivalDate: tm(r.arrival_date), rate: Number(r.rate_frozen), status: r.status, createdAt: tm(r.created_at), respondedAt: tms(r.responded_at),
        rejectReason: ostr(r.reject_reason), qr: r.qr_text,
      } as Booking);
    }
  },
};

/* ============================== Lotes ============================== */

async function movement(c: any, lotId: number, kind: 'INGRESO' | 'SALIDA' | 'MERMA', ref: string, kg: number, at: number | undefined, sub: number | null) {
  await upsert(c, 'storage_movements', { lot_id: lotId, kind, ref: ref.slice(0, 80), kg, sub_order_id: sub, moved_at: dt(at) }, { keys: ['lot_id', 'kind', 'ref'] });
}

export const lotsUnit: Unit = {
  name: 'lots',
  tables: ['storage_lots', 'storage_receipts', 'storage_movements'],
  entries: w => Object.entries(w.lots),
  async save({ c, ids }, _key, l: Lot, p: Lot | undefined) {
    const id = await upsert(c, 'storage_lots', {
      uuid: l.id, code: cut(l.code, 30), booking_id: ids.need('storage_bookings', l.bookingId), facility_id: ids.need('storage_facilities', l.facilityOrgId),
      farmer_org_id: ids.need('organizations', l.farmerOrgId), catalog_product_id: ids.need('catalog_products', l.productId), declared_kg: l.declaredKg,
      weight_in_kg: l.weightKg, balance_kg: l.balanceKg, sacks: l.sacks, balance_sacks: l.balanceSacks, quality: l.quality, photo_uuids: js(l.photoIds ?? []),
      intake_at: dt(l.intakeAt), expires_on: dt(l.expiresOn), rate: l.rate, status: l.status, listing_id: ids.opt('listings', l.listingId), rated: bn(l.rated),
      rent_collected: nv(l.rentCollected),
    });
    ids.set('storage_lots', l.id, id);
    if (changed(p, l, x => x.receiptCode)) {
      await exec(c, 'DELETE FROM storage_receipts WHERE lot_id = ?', [id]);
      if (l.receiptCode) await exec(c, 'INSERT INTO storage_receipts (lot_id, code, qr_hash, issued_at) VALUES (?, ?, ?, ?)', [id, l.receiptCode.slice(0, 30), sha256(l.receiptCode), dt(l.intakeAt)]);
    }
    if (changed(p, l, x => [x.weightKg, x.intakeAt])) await movement(c, id, 'INGRESO', l.code, l.weightKg, l.intakeAt, null);
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT l.*, b.uuid AS booking_uuid, fo.uuid AS facility_uuid, o.uuid AS farmer_uuid, p.code AS product_code, li.uuid AS listing_uuid, r.code AS receipt_code
        FROM storage_lots l
        JOIN storage_bookings b ON b.id = l.booking_id
        JOIN storage_facilities f ON f.id = l.facility_id JOIN organizations fo ON fo.id = f.organization_id
        JOIN organizations o ON o.id = l.farmer_org_id JOIN catalog_products p ON p.id = l.catalog_product_id
        LEFT JOIN listings li ON li.id = l.listing_id LEFT JOIN storage_receipts r ON r.lot_id = l.id
       ORDER BY l.id`);
    for (const r of list) {
      w.lots[r.uuid] = strip({
        id: r.uuid, code: r.code, bookingId: r.booking_uuid, facilityOrgId: r.facility_uuid, farmerOrgId: r.farmer_uuid, productId: r.product_code,
        declaredKg: Number(r.declared_kg), weightKg: Number(r.weight_in_kg), balanceKg: Number(r.balance_kg), sacks: r.sacks, balanceSacks: r.balance_sacks,
        quality: r.quality, photoIds: r.photo_uuids ?? [], intakeAt: tm(r.intake_at), expiresOn: tm(r.expires_on), rate: Number(r.rate), status: r.status,
        listingId: ostr(r.listing_uuid), receiptCode: ostr(r.receipt_code), rated: ob(r.rated), rentCollected: onum(r.rent_collected),
      } as Lot);
    }
  },
};

/* ============================== Órdenes de salida ============================== */

export const releasesUnit: Unit = {
  name: 'releases',
  tables: ['storage_release_orders'],
  entries: w => Object.entries(w.releases),
  async save({ c, ids, w }, _key, r: ReleaseOrder, p: ReleaseOrder | undefined) {
    const lotId = ids.need('storage_lots', r.lotId);
    const sub = ids.opt('sub_orders', r.subOrderId);
    const id = await upsert(c, 'storage_release_orders', {
      uuid: r.id, code: cut(r.code, 20), lot_id: lotId, sacks: r.sacks, kg: r.kg, picker: r.picker, picker_name: cut(r.pickerName, 160) ?? '', sub_order_id: sub,
      rent_amount: r.rentAmount, rent_declared_at: dt(r.rentDeclaredAt), rent_paid_at: dt(r.rentPaidAt), expires_at: dt(r.expiresAt), status: r.status,
      used_at: dt(r.usedAt), kg_out: nv(r.kgOut), created_at: dt(r.createdAt),
    });
    ids.set('storage_release_orders', r.id, id);
    if (r.status === 'USED' && changed(p, r, x => [x.status, x.kgOut, x.usedAt])) await movement(c, lotId, 'SALIDA', r.code, r.kgOut ?? r.kg, r.usedAt ?? w.now, sub);
  },
  async load({ c, w }) {
    const list = await rows(c, 'SELECT r.*, l.uuid AS lot_uuid, s.uuid AS sub_uuid FROM storage_release_orders r JOIN storage_lots l ON l.id = r.lot_id LEFT JOIN sub_orders s ON s.id = r.sub_order_id ORDER BY r.id');
    for (const r of list) {
      w.releases[r.uuid] = strip({
        id: r.uuid, code: r.code, lotId: r.lot_uuid, sacks: r.sacks, kg: Number(r.kg), picker: r.picker, pickerName: r.picker_name, subOrderId: ostr(r.sub_uuid),
        rentAmount: Number(r.rent_amount), rentDeclaredAt: tms(r.rent_declared_at), rentPaidAt: tms(r.rent_paid_at), expiresAt: tms(r.expires_at), status: r.status,
        usedAt: tms(r.used_at), kgOut: onum(r.kg_out), createdAt: tm(r.created_at),
      } as ReleaseOrder);
    }
  },
};

/* ============================== Incidentes del lote ============================== */

export const stoIncidentsUnit: Unit = {
  name: 'stoIncidents',
  tables: ['storage_incidents'],
  entries: w => Object.entries(w.stoIncidents),
  async save({ c, ids }, _key, k: StoIncident, p: StoIncident | undefined) {
    const lotId = ids.need('storage_lots', k.lotId);
    const id = await upsert(c, 'storage_incidents', {
      uuid: k.id, code: cut(k.code, 20), lot_id: lotId, kind: cut(k.kind, 40) ?? '', kg_now: k.kgNow, kg_lost: k.diffKg, diff_pct: k.diffPct,
      tolerance_exceeded: !!k.overTolerance, happened_at: dt(k.at), status: k.status, resolution: cut(k.note, 500),
    });
    ids.set('storage_incidents', k.id, id);
    if (changed(p, k, x => [x.diffKg, x.at])) await movement(c, lotId, 'MERMA', k.code, k.diffKg, k.at, null);
  },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT i.*, l.uuid AS lot_uuid FROM storage_incidents i JOIN storage_lots l ON l.id = i.lot_id ORDER BY i.id')) {
      w.stoIncidents[r.uuid] = strip({
        id: r.uuid, code: r.code, lotId: r.lot_uuid, kind: r.kind, kgNow: Number(r.kg_now), diffKg: Number(r.kg_lost), diffPct: Number(r.diff_pct),
        overTolerance: !!r.tolerance_exceeded, at: tm(r.happened_at), status: r.status, note: ostr(r.resolution),
      } as StoIncident);
    }
  },
};

/* ============================== Envíos ============================== */

export const shipmentsUnit: Unit = {
  name: 'shipments',
  tables: ['shipments', 'shipment_offers', 'shipment_events', 'shipment_incidents', 'carrier_ratings'],
  entries: w => Object.values(w.shipments).map(s => [s.id, { s, code: w.subOrders[s.subOrderId]?.deliveryCode }]),
  async save({ c, ids }, _key, v: { s: Shipment; code?: string }, prev: { s: Shipment } | undefined) {
    const s = v.s, p = prev?.s;
    const id = await upsert(c, 'shipments', {
      uuid: s.id, code: cut(s.code, 20), sub_order_id: ids.need('sub_orders', s.subOrderId), buyer_org_id: ids.need('organizations', s.buyerOrgId),
      seller_org_id: ids.need('organizations', s.sellerOrgId), mode: 'ALIADO', route_id: ids.need('shipping_routes', s.routeId), scope: s.scope,
      origin_label: cut(s.originLabel, 160) ?? '', dest_label: cut(s.destLabel, 160) ?? '', distance_km: s.distanceKm, carrier_org_id: ids.opt('organizations', s.carrierOrgId),
      vehicle_id: s.carrierOrgId ? ids.opt('vehicles', s.carrierOrgId) : null, weight_kg: s.weightKg, sacks: s.sacks, cargo_value: s.cargoValue, freight: s.freight,
      commission_rate: s.commissionRate, preferred_carrier_uuid: nv(s.preferredCarrier), delivery_code_hash: v.code ? sha256(v.code) : null, status: s.status,
      requested_at: dt(s.requestedAt), offering_since: dt(s.offeringSince), pickup_at: dt(s.pickupAt), deliver_from: dt(s.deliverFrom), deliver_to: dt(s.deliverTo),
      pickup_evidence: js(s.pickup), delivery_evidence: js(s.delivery), buyer_paid: js(s.buyerPaid), false_freight: nv(s.falseFreight), cancel_reason: cut(s.cancelReason, 500),
      release_order_uuid: nv(s.releaseOrderId), on_time: bn(s.onTime), closed_at: dt(s.closedAt),
    });
    ids.set('shipments', s.id, id);
    if (changed(p, s, x => x.offers)) {
      await exec(c, 'DELETE FROM shipment_offers WHERE shipment_id = ?', [id]);
      await insertMany(c, 'shipment_offers', s.offers.map((o, i) => ({
        shipment_id: id, carrier_org_id: ids.need('organizations', o.carrierOrgId), rank: i + 1, sent_at: dt(o.sentAt), expires_at: dt(o.expiresAt),
        response: nv(o.response), responded_at: dt(o.respondedAt), reason: cut(o.reason, 500),
      })));
    }
    if (changed(p, s, x => x.events)) {
      const old = p && same(p.events, s.events.slice(0, p.events.length)) ? p.events.length : 0;
      if (!old) await exec(c, 'DELETE FROM shipment_events WHERE shipment_id = ?', [id]);
      await insertMany(c, 'shipment_events', s.events.slice(old).map((e, i) => ({
        shipment_id: id, kind: cut(e.kind, 30) ?? '', happened_at: dt(e.at), text: cut(e.text, 500) ?? '', by_uuid: cut(e.by, 80), position: old + i,
      })));
    }
    if (changed(p, s, x => [x.incidents, x.claim])) {
      await exec(c, 'DELETE FROM shipment_incidents WHERE shipment_id = ?', [id]);
      const list: any[] = s.incidents.map((k, i) => ({
        uuid: String(k.id).slice(0, 80), shipment_id: id, is_claim: false, kind: cut(k.kind, 40) ?? '', text: k.text, new_eta: cut(k.newEta, 40), location: cut(k.where, 200),
        photo_uuids: js(k.photoIds ?? []), kg_lost: null, compensation: null, response: null, resolution: null, status: 'INFORMADO', happened_at: dt(k.at), position: i,
      }));
      const cl = s.claim;
      if (cl) list.push({
        uuid: `${s.id}:reclamo`.slice(0, 80), shipment_id: id, is_claim: true, kind: cut(cl.kind, 40) ?? '', text: cl.text, new_eta: null, location: null, photo_uuids: js([]),
        kg_lost: cl.kgLost, compensation: nv(cl.compensation), response: nv(cl.response), resolution: cut(cl.resolution, 500), status: cl.status, happened_at: dt(cl.at), position: list.length,
      });
      await insertMany(c, 'shipment_incidents', list);
    }
    if (changed(p, s, x => x.rating ?? null)) {
      await exec(c, 'DELETE FROM carrier_ratings WHERE shipment_id = ?', [id]);
      const r = s.rating;
      if (r) await exec(c, 'INSERT INTO carrier_ratings SET ?', [{
        shipment_id: id, punctuality: r.punctuality, care: r.care, treatment: r.treatment, tags: js(r.tags ?? []), recommends: !!r.recommends,
        comment: nv(r.comment), reply: nv(r.reply), rated_at: dt(r.at),
      }]);
    }
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT s.*, so.uuid AS sub_uuid, b.uuid AS buyer_uuid, se.uuid AS seller_uuid, r.code AS route_code, ca.uuid AS carrier_uuid
        FROM shipments s
        JOIN sub_orders so ON so.id = s.sub_order_id
        JOIN organizations b ON b.id = s.buyer_org_id
        JOIN organizations se ON se.id = s.seller_org_id
        JOIN shipping_routes r ON r.id = s.route_id
        LEFT JOIN organizations ca ON ca.id = s.carrier_org_id
       ORDER BY s.id`);
    const offers = groupBy(await rows(c, 'SELECT o.*, k.uuid AS carrier_uuid FROM shipment_offers o JOIN organizations k ON k.id = o.carrier_org_id ORDER BY o.shipment_id, o.`rank`'), 'shipment_id');
    const events = groupBy(await rows(c, 'SELECT * FROM shipment_events ORDER BY shipment_id, position'), 'shipment_id');
    const incs = groupBy(await rows(c, 'SELECT * FROM shipment_incidents ORDER BY shipment_id, position'), 'shipment_id');
    const ratings = indexBy(await rows(c, 'SELECT * FROM carrier_ratings'), 'shipment_id');
    for (const r of list) {
      const all = incs.get(r.id) ?? [];
      const cl = all.find(k => k.is_claim);
      const rt = ratings.get(r.id);
      const s: Shipment = strip({
        id: r.uuid, code: r.code, subOrderId: r.sub_uuid, buyerOrgId: r.buyer_uuid, sellerOrgId: r.seller_uuid, routeId: r.route_code, scope: r.scope,
        originLabel: r.origin_label, destLabel: r.dest_label, distanceKm: Number(r.distance_km), weightKg: Number(r.weight_kg), sacks: r.sacks, cargoValue: Number(r.cargo_value),
        freight: Number(r.freight), commissionRate: Number(r.commission_rate), preferredCarrier: ostr(r.preferred_carrier_uuid), status: r.status, requestedAt: tm(r.requested_at),
        offeringSince: tms(r.offering_since),
        offers: (offers.get(r.id) ?? []).map(o => strip({ carrierOrgId: o.carrier_uuid, sentAt: tm(o.sent_at), expiresAt: tm(o.expires_at), response: ostr(o.response), respondedAt: tms(o.responded_at), reason: ostr(o.reason) })),
        carrierOrgId: ostr(r.carrier_uuid), pickupAt: tm(r.pickup_at), deliverFrom: tm(r.deliver_from), deliverTo: tm(r.deliver_to),
        events: (events.get(r.id) ?? []).map(e => strip({ kind: e.kind, at: tm(e.happened_at), text: e.text, by: ostr(e.by_uuid) })),
        pickup: r.pickup_evidence ?? undefined, delivery: r.delivery_evidence ?? undefined, buyerPaid: r.buyer_paid ?? undefined,
        incidents: all.filter(k => !k.is_claim).map(k => strip({ id: k.uuid, kind: k.kind, at: tm(k.happened_at), text: k.text, newEta: ostr(k.new_eta), where: ostr(k.location), photoIds: k.photo_uuids ?? [] })),
        claim: cl ? strip({ at: tm(cl.happened_at), kind: cl.kind, kgLost: Number(cl.kg_lost ?? 0), text: cl.text, status: cl.status, response: ostr(cl.response), compensation: onum(cl.compensation), resolution: ostr(cl.resolution) }) : undefined,
        rating: rt ? strip({ punctuality: rt.punctuality, care: rt.care, treatment: rt.treatment, tags: rt.tags ?? [], recommends: !!rt.recommends, comment: ostr(rt.comment), at: tm(rt.rated_at), reply: ostr(rt.reply) }) : undefined,
        falseFreight: onum(r.false_freight), cancelReason: ostr(r.cancel_reason), releaseOrderId: ostr(r.release_order_uuid), onTime: ob(r.on_time), closedAt: tms(r.closed_at),
      } as Shipment);
      w.shipments[s.id] = s;
    }
  },
};
