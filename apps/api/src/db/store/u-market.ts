/*
 * Unidades del mercado: publicaciones e inventario, pedidos y sub-pedidos (con pago, comprobante
 * y entrega), calificaciones, disputas, chat, consultas, Libro de Reclamaciones, avisos y auditoría.
 */
import { NOTIF_CAP, AUDIT_CAP, MSG_CAP } from '@mesagri/shared';
import type { Listing, Order, SubOrder, SubStatus, Review, Dispute, Message, Ticket, Complaint, Notif, AuditEntry } from '@mesagri/shared';
import { exec, insertMany, rows, upsert, dt, js } from '../db';
import { encrypt, decrypt, sha256 } from '../secure';
import { Unit, changed, groupBy, strip, tms, tm, ob, onum, ostr, bn, nv, cut, same } from './units';

const FINAL: SubStatus[] = ['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_BUYER', 'CANCELLED_BY_SELLER'];

/* ============================== Publicaciones ============================== */

export const listingsUnit: Unit = {
  name: 'listings',
  tables: ['listings', 'listing_photos', 'listing_price_tiers'],
  entries: w => Object.values(w.listings).map(l => [l.id, { l, lot: l.fromLotId ? w.lots[l.fromLotId]?.code : undefined }]),
  async save({ c, ids }, _key, v: { l: Listing; lot?: string }, prev: { l: Listing } | undefined) {
    const l = v.l, p = prev?.l;
    const id = await upsert(c, 'listings', {
      uuid: l.id, organization_id: ids.need('organizations', l.orgId), catalog_product_id: ids.need('catalog_products', l.productId), farm_id: ids.opt('farms', l.farmId),
      variety: cut(l.variety, 60), unit: l.unit, unit_kg: l.unitKg, qty_total: l.qtyTotal, qty_available: l.available, qty_reserved: l.reserved, qty_sold: l.sold,
      min_qty: l.minQty, unit_price: l.price, harvest_date: dt(l.harvestDate), quality: l.quality, harvest_seal: !!l.harvestSeal, status: l.status,
      review_reason: cut(l.reviewReason, 500), review_flags: js(l.flags), lot_code: nv(v.lot), from_lot_uuid: nv(l.fromLotId), created_at: dt(l.createdAt),
      expires_at: dt(l.expiresAt), request_uuid: nv(l.requestId),
    });
    ids.set('listings', l.id, id);
    if (changed(p, l, x => x.photoIds)) {
      await exec(c, 'DELETE FROM listing_photos WHERE listing_id = ?', [id]);
      await insertMany(c, 'listing_photos', l.photoIds.map((f, i) => ({ listing_id: id, file_uuid: String(f).slice(0, 80), position: i })));
    }
    if (changed(p, l, x => x.tiers ?? null)) {
      await exec(c, 'DELETE FROM listing_price_tiers WHERE listing_id = ?', [id]);
      await insertMany(c, 'listing_price_tiers', (l.tiers ?? []).map((t, i) => ({ listing_id: id, min_kg: t.minKg, unit_price: t.price, position: i })));
    }
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT l.*, o.uuid AS org_uuid, p.code AS product_code, f.uuid AS farm_uuid FROM listings l
        JOIN organizations o ON o.id = l.organization_id JOIN catalog_products p ON p.id = l.catalog_product_id
        LEFT JOIN farms f ON f.id = l.farm_id WHERE l.deleted_at IS NULL ORDER BY l.id`);
    const photos = groupBy(await rows(c, 'SELECT listing_id, file_uuid FROM listing_photos ORDER BY listing_id, position'), 'listing_id');
    const tiers = groupBy(await rows(c, 'SELECT * FROM listing_price_tiers ORDER BY listing_id, position'), 'listing_id');
    for (const r of list) {
      const ts = tiers.get(r.id);
      const l: Listing = strip({
        id: r.uuid, orgId: r.org_uuid, productId: r.product_code, variety: ostr(r.variety), unit: r.unit, unitKg: Number(r.unit_kg), qtyTotal: Number(r.qty_total),
        available: Number(r.qty_available), reserved: Number(r.qty_reserved), sold: Number(r.qty_sold), price: Number(r.unit_price), harvestDate: tm(r.harvest_date),
        quality: r.quality, farmId: ostr(r.farm_uuid), photoIds: (photos.get(r.id) ?? []).map(x => x.file_uuid), harvestSeal: !!r.harvest_seal, status: r.status,
        reviewReason: ostr(r.review_reason), createdAt: tm(r.created_at), expiresAt: r.expires_at ? tm(r.expires_at) : Infinity, minQty: Number(r.min_qty),
        fromLotId: ostr(r.from_lot_uuid), tiers: ts?.length ? ts.map(t => ({ minKg: Number(t.min_kg), price: Number(t.unit_price) })) : undefined,
        flags: r.review_flags ?? undefined, requestId: ostr(r.request_uuid),
      } as Listing);
      w.listings[l.id] = l;
    }
  },
};

/* ============================== Movimientos de stock (solo se agregan) ============================== */

export const movementsUnit: Unit = {
  name: 'movements',
  tables: ['inventory_movements'],
  async append({ c, ids }, prev, cur) {
    const from = prev ? prev.movements.length : 0;
    const list = cur.movements.slice(from);
    if (!list.length) return;
    await insertMany(c, 'inventory_movements', list.map((m, i) => ({
      listing_id: ids.need('listings', m.listingId), movement_type: m.kind, delta_available: m.qty, ref: cut(m.ref, 120),
      sub_order_id: m.ref ? ids.opt('sub_orders', m.ref) : null, moved_at: dt(m.at), seq: from + i + 1,
    })));
  },
  async load({ c, w }) {
    const list = await rows(c, 'SELECT m.*, l.uuid AS listing_uuid FROM inventory_movements m JOIN listings l ON l.id = m.listing_id ORDER BY m.seq');
    w.movements = list.map(r => strip({ at: tm(r.moved_at), listingId: r.listing_uuid, kind: r.movement_type, qty: Number(r.delta_available), ref: ostr(r.ref) }));
  },
};

/* ============================== Pedidos ============================== */

export const ordersUnit: Unit = {
  name: 'orders',
  tables: ['orders'],
  entries: w => Object.values(w.orders).map(o => [o.id, { o, st: o.subOrderIds.every(id => !w.subOrders[id] || FINAL.includes(w.subOrders[id].status)) ? 'CERRADO' : 'EN_CURSO' }]),
  async save({ c, ids }, _key, v: { o: Order; st: string }) {
    const o = v.o;
    const id = await upsert(c, 'orders', {
      uuid: o.id, order_number: o.id.slice(0, 80), buyer_org_id: ids.need('organizations', o.buyerOrgId), buyer_user_id: ids.opt('users', o.buyerUserId),
      total: o.total, status: v.st, created_at: dt(o.createdAt),
    });
    ids.set('orders', o.id, id);
  },
  async load({ c, w }) {
    const list = await rows(c, 'SELECT o.*, b.uuid AS buyer_uuid, u.uuid AS user_uuid FROM orders o JOIN organizations b ON b.id = o.buyer_org_id LEFT JOIN users u ON u.id = o.buyer_user_id ORDER BY o.id');
    const subs = groupBy(await rows(c, 'SELECT order_id, uuid FROM sub_orders ORDER BY id'), 'order_id');
    for (const r of list) {
      w.orders[r.uuid] = { id: r.uuid, buyerOrgId: r.buyer_uuid, buyerUserId: r.user_uuid ?? '', createdAt: tm(r.created_at), subOrderIds: (subs.get(r.id) ?? []).map(s => s.uuid), total: Number(r.total) };
    }
  },
};

/* ============================== Sub-pedidos ============================== */

const DELIVERY_EVENT: Partial<Record<SubStatus, string>> = { READY: 'LISTO', IN_TRANSIT: 'EN_CAMINO', DELIVERED: 'ENTREGADO', COMPLETED: 'CONFORME' };

export const subOrdersUnit: Unit = {
  name: 'subOrders',
  tables: ['sub_orders', 'sub_order_items', 'sub_order_status_history', 'payments', 'tax_documents', 'deliveries', 'delivery_events'],
  entries: w => Object.entries(w.subOrders),
  async save({ c, ids }, _key, s: SubOrder, p: SubOrder | undefined) {
    const id = await upsert(c, 'sub_orders', {
      uuid: s.id, code: s.code, order_id: ids.need('orders', s.orderId), buyer_org_id: ids.need('organizations', s.buyerOrgId), seller_org_id: ids.need('organizations', s.sellerOrgId),
      buyer_user_id: ids.opt('users', s.buyerUserId), subtotal: s.subtotal, delivery_mode: s.deliveryMode, delivery_fee: s.deliveryFee, total: s.total,
      delivery_date: dt(s.deliveryDate), delivery_slot: cut(s.slot, 40) ?? '', address_snapshot: cut(s.address, 200) ?? '', ubigeo: s.district, prepay: !!s.prepay,
      status: s.status, created_at: dt(s.createdAt), confirm_by: dt(s.confirmBy), responded_at: dt(s.respondedAt), delivered_at: dt(s.deliveredAt), completed_at: dt(s.completedAt),
      commission_rate: s.commissionRate, free_slot_reserved: !!s.freeSlotReserved, sale_number: nv(s.saleNumber), commission: nv(s.commission), sale_amount: nv(s.saleAmount),
      free_sale_bonus: bn(s.freeSaleBonus), reject_reason: cut(s.rejectReason, 500), cancel_reason: cut(s.cancelReason, 500), late_cancel: bn(s.lateCancel),
      on_time: bn(s.onTime), from_lot: bn(s.fromLot), dispute_uuid: nv(s.disputeId), shipment_uuid: nv(s.shipmentId), review_buyer_uuid: nv(s.reviewBuyer), review_seller_uuid: nv(s.reviewSeller),
    });
    ids.set('sub_orders', s.id, id);
    if (changed(p, s, x => x.items)) {
      await exec(c, 'DELETE FROM sub_order_items WHERE sub_order_id = ?', [id]);
      await insertMany(c, 'sub_order_items', s.items.map((it, i) => ({
        sub_order_id: id, listing_id: ids.need('listings', it.listingId), catalog_product_id: ids.need('catalog_products', it.productId), product_name: cut(it.name, 80),
        unit: it.unit, unit_kg: it.unitKg, quantity: it.qty, unit_price: it.price, subtotal: it.subtotal, qty_accepted: nv(it.acceptedQty), quality_check: nv(it.quality), position: i,
      })));
    }
    const histChanged = changed(p, s, x => x.history);
    if (histChanged) {
      const old = p && same(p.history, s.history.slice(0, p.history.length)) ? p.history.length : 0;
      if (!old) await exec(c, 'DELETE FROM sub_order_status_history WHERE sub_order_id = ?', [id]);
      await insertMany(c, 'sub_order_status_history', s.history.slice(old).map((h, i) => ({
        sub_order_id: id, status: h.status, changed_at: dt(h.at), changed_by: cut(h.by, 80), note: cut(h.note, 500), position: old + i,
      })));
    }
    if (changed(p, s, x => x.payment)) {
      const pm = s.payment;
      await upsert(c, 'payments', {
        sub_order_id: id, method: pm.method, amount: nv(pm.amount), status: pm.status, operation_code: cut(pm.operation, 40), paid_at: dt(pm.paidAt),
        proof_file_uuid: nv(pm.photoId), uploaded_at: dt(pm.uploadedAt), confirmed_at: dt(pm.confirmedAt),
      }, { keys: ['sub_order_id'] });
    }
    if (changed(p, s, x => [x.taxDoc, x.taxDocNumber])) {
      await upsert(c, 'tax_documents', {
        sub_order_id: id, doc_kind: s.taxDoc, doc_number: cut(s.taxDocNumber, 30),
        issuer_org_id: ids.need('organizations', s.taxDoc === 'LIQUIDACION' ? s.buyerOrgId : s.sellerOrgId),
      }, { keys: ['sub_order_id'] });
    }
    if (changed(p, s, x => [x.deliveryCode, x.pickupCode, x.pickupQr, x.codeTries, x.deliveredAt, x.deliveryPhotoId, x.receiptPhotoIds, x.deliveryMode]) || histChanged) {
      const did = await upsert(c, 'deliveries', {
        sub_order_id: id, mode: s.deliveryMode, delivery_code_hash: sha256(s.deliveryCode), delivery_code_enc: encrypt(s.deliveryCode), pickup_code: nv(s.pickupCode),
        pickup_qr: s.pickupQr, code_tries: Math.min(s.codeTries, 20), delivered_at: dt(s.deliveredAt), delivery_photo_uuid: nv(s.deliveryPhotoId),
        receipt_photo_uuids: js(s.receiptPhotoIds),
      }, { keys: ['sub_order_id'] });
      if (histChanged) {
        await exec(c, 'DELETE FROM delivery_events WHERE delivery_id = ?', [did]);
        await insertMany(c, 'delivery_events', s.history.filter(h => DELIVERY_EVENT[h.status]).map(h => ({ delivery_id: did, kind: DELIVERY_EVENT[h.status], happened_at: dt(h.at), note: cut(h.note, 255) })));
      }
    }
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT s.*, o.uuid AS order_uuid, b.uuid AS buyer_uuid, se.uuid AS seller_uuid, u.uuid AS user_uuid,
             p.method AS pay_method, p.amount AS pay_amount, p.status AS pay_status, p.operation_code, p.paid_at, p.proof_file_uuid, p.uploaded_at, p.confirmed_at,
             t.doc_kind, t.doc_number, d.delivery_code_enc, d.pickup_code, d.pickup_qr, d.code_tries, d.delivery_photo_uuid, d.receipt_photo_uuids
        FROM sub_orders s
        JOIN orders o ON o.id = s.order_id
        JOIN organizations b ON b.id = s.buyer_org_id
        JOIN organizations se ON se.id = s.seller_org_id
        LEFT JOIN users u ON u.id = s.buyer_user_id
        LEFT JOIN payments p ON p.sub_order_id = s.id
        LEFT JOIN tax_documents t ON t.sub_order_id = s.id
        LEFT JOIN deliveries d ON d.sub_order_id = s.id
       ORDER BY s.id`);
    const items = groupBy(await rows(c, `
      SELECT i.*, l.uuid AS listing_uuid, cp.code AS product_code FROM sub_order_items i
        JOIN listings l ON l.id = i.listing_id JOIN catalog_products cp ON cp.id = i.catalog_product_id ORDER BY i.sub_order_id, i.position`), 'sub_order_id');
    const hist = groupBy(await rows(c, 'SELECT * FROM sub_order_status_history ORDER BY sub_order_id, position'), 'sub_order_id');
    for (const r of list) {
      const s: SubOrder = strip({
        id: r.uuid, code: r.code, orderId: r.order_uuid, buyerOrgId: r.buyer_uuid, sellerOrgId: r.seller_uuid, buyerUserId: r.user_uuid ?? '',
        items: (items.get(r.id) ?? []).map(i => strip({
          listingId: i.listing_uuid, productId: i.product_code, name: i.product_name, unit: i.unit, unitKg: Number(i.unit_kg), qty: Number(i.quantity),
          price: Number(i.unit_price), subtotal: Number(i.subtotal), acceptedQty: onum(i.qty_accepted), quality: ostr(i.quality_check),
        })),
        subtotal: Number(r.subtotal), deliveryMode: r.delivery_mode, deliveryFee: Number(r.delivery_fee), total: Number(r.total), deliveryDate: tm(r.delivery_date),
        slot: r.delivery_slot, address: r.address_snapshot, district: r.ubigeo, taxDoc: r.doc_kind ?? 'BOLETA', taxDocNumber: ostr(r.doc_number), prepay: !!r.prepay,
        status: r.status, history: (hist.get(r.id) ?? []).map(h => strip({ status: h.status, at: tm(h.changed_at), by: ostr(h.changed_by), note: ostr(h.note) })),
        createdAt: tm(r.created_at), confirmBy: tm(r.confirm_by), respondedAt: tms(r.responded_at), deliveredAt: tms(r.delivered_at), completedAt: tms(r.completed_at),
        deliveryCode: r.delivery_code_enc ? decrypt(r.delivery_code_enc) : '', pickupCode: ostr(r.pickup_code), pickupQr: r.pickup_qr ?? '', codeTries: r.code_tries ?? 0,
        payment: strip({
          status: r.pay_status ?? 'NONE', method: r.pay_method ?? 'YAPE', operation: ostr(r.operation_code), amount: onum(r.pay_amount), paidAt: tms(r.paid_at),
          photoId: ostr(r.proof_file_uuid), uploadedAt: tms(r.uploaded_at), confirmedAt: tms(r.confirmed_at),
        }),
        commissionRate: Number(r.commission_rate), freeSlotReserved: !!r.free_slot_reserved, saleNumber: onum(r.sale_number), commission: onum(r.commission),
        saleAmount: onum(r.sale_amount), freeSaleBonus: ob(r.free_sale_bonus), rejectReason: ostr(r.reject_reason), cancelReason: ostr(r.cancel_reason),
        lateCancel: ob(r.late_cancel), disputeId: ostr(r.dispute_uuid), shipmentId: ostr(r.shipment_uuid), reviewBuyer: ostr(r.review_buyer_uuid),
        reviewSeller: ostr(r.review_seller_uuid), onTime: ob(r.on_time), deliveryPhotoId: ostr(r.delivery_photo_uuid), receiptPhotoIds: r.receipt_photo_uuids ?? undefined,
        fromLot: ob(r.from_lot),
      } as SubOrder);
      w.subOrders[s.id] = s;
    }
  },
};

/* ============================== Calificaciones ============================== */

export const reviewsUnit: Unit = {
  name: 'reviews',
  tables: ['reviews'],
  entries: w => Object.entries(w.reviews),
  async save({ c, ids }, _key, r: Review) {
    const id = await upsert(c, 'reviews', {
      uuid: r.id, sub_order_id: ids.need('sub_orders', r.subOrderId), direction: r.side, reviewer_org_id: ids.need('organizations', r.fromOrg),
      reviewee_org_id: ids.need('organizations', r.toOrg), rating: r.stars, tags: js(r.tags ?? []), comment: nv(r.comment), status: r.published ? 'PUBLICADA' : 'OCULTA',
      reply: nv(r.reply), created_at: dt(r.at),
    });
    ids.set('reviews', r.id, id);
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT r.*, s.uuid AS sub_uuid, f.uuid AS from_uuid, t.uuid AS to_uuid FROM reviews r
        JOIN sub_orders s ON s.id = r.sub_order_id JOIN organizations f ON f.id = r.reviewer_org_id JOIN organizations t ON t.id = r.reviewee_org_id ORDER BY r.id`);
    for (const r of list) {
      w.reviews[r.uuid] = strip({
        id: r.uuid, subOrderId: r.sub_uuid, fromOrg: r.from_uuid, toOrg: r.to_uuid, side: r.direction, stars: r.rating, tags: r.tags ?? [], comment: ostr(r.comment),
        at: tm(r.created_at), published: r.status === 'PUBLICADA', reply: ostr(r.reply),
      } as Review);
    }
  },
};

/* ============================== Disputas ============================== */

export const disputesUnit: Unit = {
  name: 'disputes',
  tables: ['disputes', 'dispute_evidence'],
  entries: w => Object.entries(w.disputes),
  async save({ c, ids }, _key, d: Dispute, p: Dispute | undefined) {
    const rs = d.resolution;
    const id = await upsert(c, 'disputes', {
      uuid: d.id, code: d.code, sub_order_id: ids.need('sub_orders', d.subOrderId), opened_by_org_id: ids.need('organizations', d.openedBy), reason: d.kind,
      description: d.description, status: d.status, opened_at: dt(d.openedAt), assigned_to: ids.opt('users', d.assignedTo), proposal: js(d.proposal),
      resolution: nv(rs?.outcome), resolution_refund: nv(rs?.refund), resolution_note: nv(rs?.note), resolved_by: cut(rs?.by, 80), resolved_at: dt(rs?.at),
    });
    ids.set('disputes', d.id, id);
    if (changed(p, d, x => x.photoIds)) {
      await exec(c, 'DELETE FROM dispute_evidence WHERE dispute_id = ?', [id]);
      await insertMany(c, 'dispute_evidence', d.photoIds.map((f, i) => ({ dispute_id: id, file_uuid: String(f).slice(0, 80), position: i })));
    }
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT d.*, s.uuid AS sub_uuid, o.uuid AS org_uuid, u.uuid AS assigned_uuid FROM disputes d
        JOIN sub_orders s ON s.id = d.sub_order_id JOIN organizations o ON o.id = d.opened_by_org_id LEFT JOIN users u ON u.id = d.assigned_to ORDER BY d.id`);
    const ev = groupBy(await rows(c, 'SELECT * FROM dispute_evidence ORDER BY dispute_id, position'), 'dispute_id');
    for (const r of list) {
      w.disputes[r.uuid] = strip({
        id: r.uuid, code: r.code, subOrderId: r.sub_uuid, openedBy: r.org_uuid, kind: r.reason, description: r.description,
        photoIds: (ev.get(r.id) ?? []).map(x => x.file_uuid), status: r.status, openedAt: tm(r.opened_at), proposal: r.proposal ?? undefined,
        resolution: r.resolution ? { outcome: r.resolution, refund: Number(r.resolution_refund ?? 0), note: r.resolution_note ?? '', by: r.resolved_by ?? '', at: tm(r.resolved_at) } : undefined,
        assignedTo: ostr(r.assigned_uuid),
      } as Dispute);
    }
  },
};

/* ============================== Consultas a Soporte ============================== */

export const ticketsUnit: Unit = {
  name: 'tickets',
  tables: ['support_tickets', 'ticket_messages'],
  entries: w => Object.entries(w.tickets),
  async save({ c, ids }, _key, t: Ticket, p: Ticket | undefined) {
    const id = await upsert(c, 'support_tickets', {
      uuid: t.id, ticket_number: cut(t.code, 20), organization_id: ids.need('organizations', t.orgId), user_id: ids.opt('users', t.userId),
      category: cut(t.topic, 120) ?? '', body: t.text, status: t.status, created_at: dt(t.at),
    });
    ids.set('support_tickets', t.id, id);
    if (changed(p, t, x => x.replies)) {
      await exec(c, 'DELETE FROM ticket_messages WHERE ticket_id = ?', [id]);
      await insertMany(c, 'ticket_messages', t.replies.map((m, i) => ({ ticket_id: id, author_uuid: m.by, body: m.text, sent_at: dt(m.at), position: i })));
    }
  },
  async load({ c, w }) {
    const list = await rows(c, 'SELECT t.*, o.uuid AS org_uuid, u.uuid AS user_uuid FROM support_tickets t JOIN organizations o ON o.id = t.organization_id LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id');
    const msgs = groupBy(await rows(c, 'SELECT * FROM ticket_messages ORDER BY ticket_id, position'), 'ticket_id');
    for (const r of list) {
      w.tickets[r.uuid] = {
        id: r.uuid, code: r.ticket_number, orgId: r.org_uuid, userId: r.user_uuid ?? '', topic: r.category, text: r.body, at: tm(r.created_at), status: r.status,
        replies: (msgs.get(r.id) ?? []).map(m => ({ by: m.author_uuid, text: m.body, at: tm(m.sent_at) })),
      };
    }
  },
};

/* ============================== Chat ============================== */

export const messagesUnit: Unit = {
  name: 'messages',
  tables: ['conversations', 'messages'],
  entries: w => Object.entries(w.messages),
  async save({ c, ids, w }, conv, list: Message[], prev: Message[] | undefined) {
    const so = w.subOrders[conv];
    const isTicket = conv.startsWith('ticket:');
    const cid = await upsert(c, 'conversations', {
      uuid: conv, kind: isTicket ? 'CONSULTA' : 'PEDIDO', sub_order_id: so ? ids.opt('sub_orders', conv) : null,
      buyer_org_id: so ? ids.opt('organizations', so.buyerOrgId) : null, seller_org_id: so ? ids.opt('organizations', so.sellerOrgId) : null,
      ticket_uuid: isTicket ? conv.slice(7) : null,
    });
    ids.set('conversations', conv, cid);
    // los mensajes solo se agregan (el mundo guarda los últimos; la base, todos)
    const known = new Set((prev ?? []).map(m => m.id));
    const fresh = list.filter(m => !known.has(m.id));
    await insertMany(c, 'messages', fresh.map(m => ({
      uuid: m.id, conversation_id: cid, sender_user_id: ids.opt('users', m.from), sender_uuid: m.from, msg_type: m.quick ? 'RAPIDA' : 'TEXTO',
      template_key: cut(m.quick, 40), body: m.text, sent_at: dt(m.at), position: 0,
    })), { ignore: true });
  },
  async load({ c, w }) {
    for (const r of await rows(c, 'SELECT uuid FROM conversations ORDER BY id')) w.messages[r.uuid] = [];
    const list = await rows(c, `
      SELECT m.uuid, m.sender_uuid, m.template_key, m.body, m.sent_at, cv.uuid AS conv FROM (
        SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.conversation_id ORDER BY x.id DESC) AS rn FROM messages x WHERE x.deleted_at IS NULL
      ) m JOIN conversations cv ON cv.id = m.conversation_id WHERE m.rn <= ? ORDER BY m.conversation_id, m.id`, [MSG_CAP]);
    for (const r of list) {
      (w.messages[r.conv] ??= []).push(strip({ id: r.uuid, conv: r.conv, from: r.sender_uuid, text: r.body, quick: ostr(r.template_key), at: tm(r.sent_at) } as Message));
    }
  },
};

/* ============================== Libro de Reclamaciones ============================== */

export const complaintsUnit: Unit = {
  name: 'complaints',
  tables: ['complaint_book_entries'],
  entries: w => Object.entries(w.complaints),
  async save({ c, ids }, _key, k: Complaint) {
    const id = await upsert(c, 'complaint_book_entries', {
      uuid: k.id, complaint_number: cut(k.number, 10), kind: k.type, organization_id: ids.need('organizations', k.orgId), user_id: ids.opt('users', k.userId),
      related_service: cut(k.related, 300) ?? '', amount: nv(k.amount), detail: k.detail, consumer_request: k.request, submitted_at: dt(k.at), response_due_at: dt(k.dueAt),
      status: k.status, answer: nv(k.answer), answered_at: dt(k.answeredAt), answered_by: ids.opt('users', k.answeredBy),
    });
    ids.set('complaint_book_entries', k.id, id);
  },
  async load({ c, w }) {
    const list = await rows(c, `
      SELECT k.*, o.uuid AS org_uuid, u.uuid AS user_uuid, a.uuid AS answered_uuid FROM complaint_book_entries k
        JOIN organizations o ON o.id = k.organization_id LEFT JOIN users u ON u.id = k.user_id LEFT JOIN users a ON a.id = k.answered_by ORDER BY k.id`);
    for (const r of list) {
      w.complaints[r.uuid] = strip({
        id: r.uuid, number: r.complaint_number, type: r.kind, orgId: r.org_uuid, userId: r.user_uuid ?? '', related: r.related_service, amount: onum(r.amount),
        detail: r.detail, request: r.consumer_request, at: tm(r.submitted_at), dueAt: tm(r.response_due_at), status: r.status, answer: ostr(r.answer),
        answeredAt: tms(r.answered_at), answeredBy: ostr(r.answered_uuid),
      } as Complaint);
    }
  },
};

/* ============================== Avisos (solo se agregan) ============================== */

const lastSeq = (list: { seq?: number }[]) => (list.length ? list[list.length - 1].seq ?? 0 : 0);

export const notifsUnit: Unit = {
  name: 'notifs',
  tables: ['notifications'],
  async append({ c, ids }, prev, cur) {
    const from = prev ? lastSeq(prev.notifs) : 0;
    const list = cur.notifs.filter(n => (n.seq ?? 0) > from || (!prev && n.seq === undefined));
    if (!list.length) return;
    await insertMany(c, 'notifications', list.map(n => {
      const org = n.to === 'ADMIN' ? null : ids.opt('organizations', n.to);
      return {
        uuid: n.id, audience: org ? 'ORG' : 'EQUIPO', recipient: n.to, organization_id: org, kind: n.kind, title: cut(n.title, 255), body: n.body,
        link: js(n.link), created_at: dt(n.at), seq: n.seq ?? 0,
      };
    }), { ignore: true });
  },
  async load({ c, w }) {
    const list = await rows(c, 'SELECT * FROM (SELECT * FROM notifications ORDER BY seq DESC, id DESC LIMIT ?) t ORDER BY seq, id', [NOTIF_CAP]);
    w.notifs = list.map(r => strip({ id: r.uuid, to: r.recipient, at: tm(r.created_at), kind: r.kind, title: r.title, body: r.body, link: r.link ?? undefined, seq: r.seq } as Notif));
  },
};

/* ============================== Auditoría (solo se agrega) ============================== */

export const auditUnit: Unit = {
  name: 'audit',
  tables: ['audit_logs'],
  async append({ c, ids }, prev, cur) {
    const from = prev ? lastSeq(prev.audit) : 0;
    const list = cur.audit.filter(a => (a.seq ?? 0) > from || (!prev && a.seq === undefined));
    if (!list.length) return;
    await insertMany(c, 'audit_logs', list.map(a => ({
      uuid: a.id, actor_user_id: ids.opt('users', a.actor), actor_uuid: a.actor, action: cut(a.action, 60), entity_type: cut(a.entity, 160) ?? '',
      detail: a.detail, before_data: js(a.before), after_data: js(a.after), created_at: dt(a.at), seq: a.seq ?? 0,
    })), { ignore: true });
  },
  async load({ c, w }) {
    const list = await rows(c, 'SELECT * FROM (SELECT * FROM audit_logs ORDER BY seq DESC, id DESC LIMIT ?) t ORDER BY seq, id', [AUDIT_CAP]);
    w.audit = list.map(r => strip({
      id: r.uuid, at: tm(r.created_at), actor: r.actor_uuid, action: r.action, entity: r.entity_type, detail: r.detail,
      before: r.before_data ?? undefined, after: r.after_data ?? undefined, seq: r.seq,
    } as AuditEntry));
  },
};

