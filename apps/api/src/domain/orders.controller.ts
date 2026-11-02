/* Pedidos, pagos, entrega, chat, calificaciones, disputas, soporte y avisos (14.6). */
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { uid } from '@mesagri/shared';
import { rows } from '../db/db';
import { EngineService } from '../core/engine.service';
import { Commands } from '../core/commands';
import { Auth, Me } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';
import { Body$, canSeeSub, limitOf, page, readCursor, subView, must } from './helpers';

const TRANSITIONS: Record<string, string> = {
  accept: 'SUBORDER_ACCEPT', reject: 'SUBORDER_REJECT', prepare: 'SUBORDER_PREPARE', ready: 'SUBORDER_READY', dispatch: 'SUBORDER_DISPATCH',
  deliver: 'SUBORDER_DELIVER', cancel: 'SUBORDER_CANCEL', 'seller-cancel': 'SUBORDER_SELLER_CANCEL',
};

@ApiTags('Pedidos')
@Controller()
export class OrdersController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Post('orders') @Auth('BUYER')
  @ApiOperation({ summary: 'Checkout transaccional: valida stock, topes por nivel, límite del plan y efectivo; crea un sub-pedido por agricultor' })
  @Body$({ subs: [{ sellerOrgId: 'org-wilber', items: [{ listingId: 'l-w-papa', qty: 20 }], deliveryMode: 'FARMER', deliveryDate: 1793797200000, slot: '7:00 a 9:00', taxDoc: 'LIQUIDACION', payMethod: 'YAPE' }] }, ['subs'])
  place(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const orderId = b?.orderId ?? 'o-' + uid();
    const subs = (Array.isArray(b?.subs) ? b.subs : []).map((s: any) => ({ ...s, subOrderId: s?.subOrderId ?? 'so-' + uid(), shipmentId: s?.deliveryMode === 'CARRIER' ? s?.shipmentId ?? 'sh-' + uid() : undefined }));
    return this.cmd.run(u, 'ORDER_PLACE', { ...b, orderId, subs }, k);
  }

  @Get('orders') @Auth('BUYER')
  @ApiOperation({ summary: 'Pedidos de mi negocio, con el estado de cada agricultor' })
  @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'cursor', required: false })
  async orders(@Me() u: AuthUser, @Query('limit') limitQ?: string, @Query('cursor') cursor?: string) {
    const limit = limitOf(limitQ);
    const cur = readCursor<[number, string]>(cursor);
    const args: any[] = [this.engine.store.ids.need('organizations', u.orgId)];
    let extra = '';
    if (cur) { extra = 'AND (o.created_at < ? OR (o.created_at = ? AND o.uuid < ?))'; args.push(new Date(cur[0]), new Date(cur[0]), cur[1]); }
    const list = await rows(this.engine.pool, `
      SELECT o.uuid, o.total, o.status, o.created_at,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', s.uuid, 'code', s.code, 'status', s.status, 'total', s.total, 'seller', se.trade_name))
                FROM sub_orders s JOIN organizations se ON se.id = s.seller_org_id WHERE s.order_id = o.id) AS subOrders
        FROM orders o WHERE o.buyer_org_id = ? ${extra} ORDER BY o.created_at DESC, o.uuid DESC LIMIT ?`, [...args, limit + 1]);
    return page(list, limit, r => [r.created_at.getTime(), r.uuid]);
  }

  @Get('sub-orders') @Auth('FARMER', 'BUYER')
  @ApiOperation({ summary: 'Sub-pedidos propios: el agricultor ve su bandeja (vista v_seller_inbox); la MYPE, sus compras' })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'cursor', required: false })
  async subOrders(@Me() u: AuthUser, @Query('status') status?: string, @Query('limit') limitQ?: string, @Query('cursor') cursor?: string) {
    const limit = limitOf(limitQ);
    const where = [u.role === 'FARMER' ? 'v.seller_uuid = ?' : 'v.buyer_uuid = ?'];
    const args: any[] = [u.orgId];
    if (status) { where.push('v.status = ?'); args.push(status); }
    const cur = readCursor<[number, string]>(cursor);
    if (cur) { where.push('(v.created_at < ? OR (v.created_at = ? AND v.sub_order_uuid < ?))'); args.push(new Date(cur[0]), new Date(cur[0]), cur[1]); }
    const list = await rows(this.engine.pool, `SELECT v.* FROM v_seller_inbox v WHERE ${where.join(' AND ')} ORDER BY v.created_at DESC, v.sub_order_uuid DESC LIMIT ?`, [...args, limit + 1]);
    return page(list, limit, r => [r.created_at.getTime(), r.sub_order_uuid]);
  }

  @Get('sub-orders/:id') @Auth()
  @ApiOperation({ summary: 'Detalle del sub-pedido (el código de entrega solo lo ve la MYPE que compró)' })
  subOrder(@Me() u: AuthUser, @Param('id') id: string) {
    const w = this.engine.world;
    const s = must(w.subOrders[id], 'el pedido');
    if (!canSeeSub(w, u, s)) throw new DomainHttpError(403, 'FORBIDDEN', 'No participas en este pedido.');
    return subView(w, u, s);
  }

  @Post('sub-orders/:id/transition') @Auth('FARMER', 'BUYER')
  @ApiOperation({ summary: 'Acepta, rechaza, prepara, marca listo, despacha, entrega (con código) o cancela según las reglas (12.3)' })
  @Body$({ action: 'accept', reason: 'Sin stock suficiente', code: '1234', cashCollected: true }, ['action'], 'action: accept, reject, prepare, ready, dispatch, deliver, cancel o seller-cancel')
  transition(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const type = TRANSITIONS[String(b?.action ?? '')];
    if (!type) throw new DomainHttpError(422, 'BAD_ACTION', 'Acción no válida. Usa: ' + Object.keys(TRANSITIONS).join(', '));
    const { action: _a, ...rest } = b;
    return this.cmd.run(u, type, { ...rest, subOrderId: id }, k);
  }

  @Post('sub-orders/:id/receipt') @Auth('BUYER')
  @ApiOperation({ summary: 'Conformidad (total o parcial, por producto); si falta algo se abre la disputa' })
  @Body$({ lines: [{ listingId: 'l-w-papa', acceptedQty: 20, quality: 'OK' }], note: '' }, ['lines'])
  receipt(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    return this.cmd.run(u, 'RECEIPT_CONFIRM', { ...b, subOrderId: id, disputeId: b?.disputeId ?? 'dsp-' + uid() }, k);
  }

  @Post('sub-orders/:id/payments') @Auth('BUYER')
  @ApiOperation({ summary: 'Constancia del pago directo al agricultor (número de operación único, RF-PAY-05)' })
  @Body$({ method: 'YAPE', operation: '05123456', amount: 150, photoId: 'ph-123' }, ['method'])
  pay(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'PAYMENT_UPLOAD', { ...b, subOrderId: id }, k); }

  @Post('payments/:subOrderId/confirm') @Auth('FARMER')
  @ApiOperation({ summary: 'El agricultor confirma que recibió el pago' })
  confirm(@Me() u: AuthUser, @Param('subOrderId') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'PAYMENT_CONFIRM', { subOrderId: id }, k); }

  @Post('payments/:subOrderId/not-received') @Auth('FARMER')
  @ApiOperation({ summary: 'El agricultor avisa que el pago no llegó (abre una disputa)' })
  notReceived(@Me() u: AuthUser, @Param('subOrderId') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'PAYMENT_NOT_RECEIVED', { subOrderId: id, disputeId: 'dsp-' + uid() }, k); }

  @Post('sub-orders/:id/tax-documents') @Auth('FARMER', 'BUYER')
  @ApiOperation({ summary: 'Registra el comprobante emitido (boleta, factura o liquidación de compra, RN-34)' })
  @Body$({ number: 'E001-123' }, ['number'])
  taxDoc(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'TAXDOC_REGISTER', { subOrderId: id, number: b?.number }, k); }

  @Post('sub-orders/:id/reviews') @Auth('FARMER', 'BUYER')
  @ApiOperation({ summary: 'Calificación doble ciego (se publican juntas o a los 7 días, RN-12)' })
  @Body$({ stars: 5, tags: ['Puntual'], comment: 'Muy buena papa' }, ['stars'])
  review(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const s = must(this.engine.world.subOrders[id], 'el pedido');
    return this.cmd.run(u, 'REVIEW_SUBMIT', { ...b, subOrderId: id, side: u.orgId === s.buyerOrgId ? 'BUYER' : 'SELLER', reviewId: b?.reviewId ?? 'rv-' + uid() }, k);
  }

  @Get('conversations/:id/messages') @Auth()
  @ApiOperation({ summary: 'Mensajes del chat del pedido (también por WebSocket: message.new)' })
  async messages(@Me() u: AuthUser, @Param('id') id: string, @Query('limit') limitQ?: string) {
    const w = this.engine.world;
    const s = w.subOrders[id];
    if (s && !canSeeSub(w, u, s)) throw new DomainHttpError(403, 'FORBIDDEN', 'No participas en este pedido.');
    if (!s && id.startsWith('ticket:')) { const t = w.tickets[id.slice(7)]; if (!t || (u.role !== 'ADMIN' && t.orgId !== u.orgId)) throw new DomainHttpError(403, 'FORBIDDEN', 'No puedes ver esta consulta.'); }
    const list = await rows(this.engine.pool, `
      SELECT m.uuid AS id, m.sender_uuid AS \`from\`, m.msg_type, m.template_key AS quick, m.body AS text, m.sent_at AS at
        FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.uuid = ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT ?`, [id, limitOf(limitQ, 50)]);
    return { items: list.reverse().map(m => ({ ...m, at: m.at.getTime() })) };
  }

  @Post('conversations/:id/messages') @Auth()
  @ApiOperation({ summary: 'Envía un mensaje (texto o respuesta rápida traducida)' })
  @Body$({ text: '¿A qué hora puedes entregar?', quick: 'q.hora' }, ['text'])
  send(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'MSG_SEND', { conv: id, text: b?.text, quick: b?.quick, msgId: b?.msgId ?? 'm-' + uid() }, k); }

  @Post('disputes') @Auth('FARMER', 'BUYER')
  @ApiOperation({ summary: 'Abre una disputa sobre un pedido (12.6)' })
  @Body$({ subOrderId: 'so-j01', kind: 'CANTIDAD', description: 'Llegaron 45 kg, no 50', photoIds: [] }, ['subOrderId', 'kind', 'description'])
  dispute(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'DISPUTE_OPEN', { ...b, disputeId: b?.disputeId ?? 'dsp-' + uid() }, k); }

  @Post('disputes/:id/proposal') @Auth('FARMER', 'BUYER')
  @ApiOperation({ summary: 'Propuesta de acuerdo entre las partes' })
  @Body$({ refund: 10, note: 'Devuelvo 5 kg' }, ['refund'])
  propose(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'DISPUTE_PROPOSE', { ...b, disputeId: id }, k); }

  @Post('complaints') @Auth('FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Libro de Reclamaciones virtual (respuesta en 15 días hábiles, D. S. 011-2011-PCM)' })
  @Body$({ type: 'RECLAMO', related: 'Estado de cuenta de octubre', amount: 4.5, detail: 'Me cobraron un pedido cancelado', request: 'Que lo descuenten' }, ['type', 'related', 'detail', 'request'])
  complaint(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'COMPLAINT_FILE', { ...b, complaintId: b?.complaintId ?? 'cmp-' + uid() }, k); }

  @Post('tickets') @Auth()
  @ApiOperation({ summary: 'Consulta a Soporte' })
  @Body$({ topic: 'Cobros y pagos', text: '¿Cómo cambio mi número de Yape?' }, ['topic', 'text'])
  ticket(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'TICKET_OPEN', { ...b, ticketId: b?.ticketId ?? 'tk-' + uid() }, k); }

  @Post('reports') @Auth()
  @ApiOperation({ summary: 'Denuncia de una publicación, usuario, mensaje o calificación' })
  @Body$({ targetType: 'LISTING', targetId: 'l-w-papa', reason: 'Fotos que no son de la cosecha' }, ['targetType', 'targetId', 'reason'])
  async report(@Me() u: AuthUser, @Body() b: any) {
    if (!['LISTING', 'ORGANIZATION', 'MESSAGE', 'REVIEW'].includes(b?.targetType)) throw new DomainHttpError(422, 'BAD_TARGET', 'Tipo de denuncia no válido.');
    const id = 'rep-' + uid();
    await rows(this.engine.pool, 'INSERT INTO reports (uuid, reporter_user_id, target_type, target_uuid, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, this.engine.store.ids.need('users', u.id), b.targetType, String(b.targetId).slice(0, 80), String(b.reason ?? '').slice(0, 200), new Date(this.engine.simNow())]);
    return { id, status: 'ABIERTA' };
  }

  @Get('notifications') @Auth()
  @ApiOperation({ summary: 'Avisos de mi organización (el equipo ve también los del panel)' })
  @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'cursor', required: false })
  async notifications(@Me() u: AuthUser, @Query('limit') limitQ?: string, @Query('cursor') cursor?: string) {
    const limit = limitOf(limitQ);
    const cur = readCursor<number>(cursor);
    const who = u.role === 'ADMIN' ? [u.orgId, 'ADMIN'] : [u.orgId];
    const list = await rows(this.engine.pool, `SELECT uuid AS id, kind, title, body, link, created_at AS at, seq FROM notifications WHERE recipient IN (?) ${cur ? 'AND seq < ?' : ''} ORDER BY seq DESC LIMIT ?`, cur ? [who, cur, limit + 1] : [who, limit + 1]);
    return page(list.map(n => ({ ...n, at: n.at.getTime() })) as any[], limit, (n: any) => n.seq);
  }

  @Post('devices') @Auth()
  @ApiOperation({ summary: 'Registra el celular o navegador para avisos push' })
  @Body$({ id: 'dev-123', label: 'Celular de Wilber', platform: 'ANDROID', pushToken: 'token-de-fcm' }, ['id'])
  async device(@Me() u: AuthUser, @Body() b: any) {
    const id = String(b?.id ?? 'dev-' + uid()).slice(0, 80);
    await rows(this.engine.pool, `INSERT INTO devices (uuid, user_id, label, platform, push_token, last_seen_at) VALUES (?, ?, ?, ?, ?, NOW(3)) AS nw
       ON DUPLICATE KEY UPDATE label = nw.label, push_token = nw.push_token, last_seen_at = nw.last_seen_at`,
      [id, this.engine.store.ids.need('users', u.id), b?.label ? String(b.label).slice(0, 80) : null, ['ANDROID', 'IOS', 'WEB'].includes(b?.platform) ? b.platform : 'WEB', b?.pushToken ? String(b.pushToken).slice(0, 255) : null]);
    return { id };
  }
}
