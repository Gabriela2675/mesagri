/* Almacenes aliados, membresías y cobros, envíos y transportistas aliados (14.6, R2). */
import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { uid, storageQuote, freightFor, routeFor, carrierStats, provinceOf, warehouseOccupancy } from '@mesagri/shared';
import { rows } from '../db/db';
import { EngineService } from '../core/engine.service';
import { Commands } from '../core/commands';
import { Auth, Me } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';
import { Body$, canSeeShipment, must } from './helpers';

@ApiTags('Almacenes aliados')
@Controller('storage')
export class StorageController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Get('facilities')
  @ApiOperation({ summary: 'Almacenes verificados (A1 o más), con tarifas, espacio libre y productos que reciben' })
  @ApiQuery({ name: 'product', required: false }) @ApiQuery({ name: 'province', required: false })
  async facilities(@Query('product') product?: string, @Query('province') province?: string) {
    const list = await rows(this.engine.pool, `
      SELECT o.uuid AS org_id, o.trade_name AS name, f.facility_type, f.capacity_for_mesagri, f.ubigeo, u.district, u.province_code, f.level, f.map_x, f.map_y,
             wd.default_rate, wd.products, wd.services, wd.optional_services,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('product', p.code, 'perSackMonth', r.price_per_month)) FROM storage_rates r JOIN catalog_products p ON p.id = r.catalog_product_id WHERE r.facility_id = f.id) AS rates
        FROM storage_facilities f JOIN organizations o ON o.id = f.organization_id JOIN warehouse_details wd ON wd.organization_id = o.id JOIN ubigeo u ON u.code = f.ubigeo
       WHERE f.level IN ('A1','A2','A3') AND o.status = 'ACTIVE' ${province ? 'AND u.province_code = ?' : ''} ORDER BY f.level DESC, o.trade_name`, province ? [province] : []);
    const w = this.engine.world;
    return { items: list.filter(r => !product || (r.products ?? []).includes(product)).map(r => ({ ...r, freeSacks: warehouseOccupancy(w, r.org_id).free })) };
  }

  @Post('quote')
  @ApiOperation({ summary: '«¿Te conviene guardar?»: vender hoy, guardar en la chacra o en el almacén (RF-STO-07)' })
  @Body$({ sacks: 10, kgPerSack: 50, pricePerKg: 1, rise: 0.3, months: 2, rate: 1.5, freight: 0, lossFarm: 0.14, lossStore: 0.02 }, ['sacks', 'kgPerSack', 'pricePerKg', 'months', 'rate'])
  quote(@Body() b: any) {
    const n = (k: string, d = 0) => Number(b?.[k] ?? d) || d;
    return storageQuote({ sacks: n('sacks'), kgPerSack: n('kgPerSack', 50), pricePerKg: n('pricePerKg'), rise: n('rise'), months: n('months', 1), rate: n('rate'), freight: n('freight'), lossFarm: n('lossFarm', 0.14), lossStore: n('lossStore', 0.02) });
  }

  @Post('bookings') @Auth('FARMER')
  @ApiOperation({ summary: 'Reserva de espacio (tarifa congelada, el almacén responde en 24 h, RN-43)' })
  @Body$({ facilityOrgId: 'org-pampa', productId: 'arroz_cascara', sacks: 40, kgPerSack: 50, months: 2, arrivalDate: 1793883600000 }, ['facilityOrgId', 'productId', 'sacks', 'months', 'arrivalDate'])
  book(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_BOOK', { ...b, bookingId: b?.bookingId ?? 'bk-' + uid() }, k); }

  @Post('bookings/:id/accept') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'El almacén acepta la reserva' })
  accept(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_BOOK_RESPOND', { bookingId: id, accept: true }, k); }

  @Post('bookings/:id/reject') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'El almacén rechaza la reserva (con motivo)' })
  @Body$({ reason: 'Sin espacio esa semana' }, ['reason'])
  rejectB(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_BOOK_RESPOND', { bookingId: id, accept: false, reason: b?.reason }, k); }

  @Post('bookings/:id/cancel') @Auth('FARMER')
  @ApiOperation({ summary: 'El agricultor cancela su reserva' })
  cancel(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_BOOK_CANCEL', { bookingId: id }, k); }

  @Post('bookings/:id/intake') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'Recepción con peso, calidad y fotos; emite la constancia de depósito (no es warrant)' })
  @Body$({ sacks: 40, weightKg: 1996, quality: 'A', photoIds: [], scaleOk: true }, ['sacks', 'weightKg', 'quality'])
  intake(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_INTAKE', { ...b, bookingId: id, lotId: b?.lotId ?? 'lot-' + uid() }, k); }

  @Post('lots/:id/intake-decision') @Auth('FARMER')
  @ApiOperation({ summary: 'El agricultor acepta o no el peso registrado (diferencia mayor a 2 %, RN-44)' })
  @Body$({ accept: true }, ['accept'])
  intakeDecide(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_INTAKE_DECIDE', { lotId: id, accept: b?.accept !== false }, k); }

  @Get('lots') @Auth('FARMER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Mis lotes (agricultor) o los lotes de mi almacén' })
  lots(@Me() u: AuthUser) {
    const w = this.engine.world;
    return { items: Object.values(w.lots).filter(l => l.farmerOrgId === u.orgId || l.facilityOrgId === u.orgId) };
  }

  @Get('lots/:id/receipt') @Auth('FARMER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Constancia de depósito con su QR (Ley 27287: no es certificado de depósito ni warrant)' })
  receipt(@Me() u: AuthUser, @Param('id') id: string) {
    const w = this.engine.world;
    const l = must(w.lots[id], 'el lote');
    if (![l.farmerOrgId, l.facilityOrgId].includes(u.orgId)) throw new DomainHttpError(403, 'FORBIDDEN', 'Este lote no es tuyo.');
    return { code: l.receiptCode ?? l.code, lot: l, facility: w.orgs[l.facilityOrgId]?.name, farmer: w.orgs[l.farmerOrgId]?.name, qr: `MESAGRI|${l.code}|${l.weightKg}|${l.quality}`, note: 'Constancia de depósito. No es un certificado de depósito ni un warrant (Ley 27287).' };
  }

  @Post('lots/:id/release-orders') @Auth('FARMER')
  @ApiOperation({ summary: 'Orden de salida para retiro o venta (no se activa sin el alquiler pagado, RN-46)' })
  @Body$({ sacks: 10, picker: 'FARMER', pickerName: 'Héctor Mendoza' }, ['sacks', 'picker'])
  release(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_RELEASE_CREATE', { ...b, lotId: id, releaseId: b?.releaseId ?? 'rel-' + uid() }, k); }

  @Post('release-orders/:id/declare-rent') @Auth('FARMER')
  @ApiOperation({ summary: 'El agricultor avisa que pagó el alquiler' })
  @Body$({ method: 'YAPE' })
  declare(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_RENT_DECLARE', { releaseId: id, method: b?.method }, k); }

  @Post('release-orders/:id/confirm-rent') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'El almacén confirma el alquiler y activa la orden de salida' })
  confirmRent(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_RENT_CONFIRM', { releaseId: id }, k); }

  @Post('release-orders/:id/checkout') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'Registra la salida con el QR de la orden, el peso y las guías' })
  @Body$({ code: 'OS-0201', kgOut: 500, pickerOk: true, waybillSender: 'T001-1', waybillCarrier: '' }, ['code'])
  checkout(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_RELEASE_CHECKOUT', { ...b, releaseId: id }, k); }

  @Post('lots/:id/incidents') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'Incidente del lote con el peso actual (el almacén compensa si pasa la tolerancia)' })
  @Body$({ kind: 'MERMA', kgNow: 1950, note: 'Pesaje mensual' }, ['kind', 'kgNow'])
  incident(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STO_INCIDENT', { ...b, lotId: id, incidentId: b?.incidentId ?? 'inc-' + uid() }, k); }

  @Patch('facilities/me') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'Capacidad para Mesagri y tarifa del almacén' })
  @Body$({ capacitySacks: 1500, defaultRate: 1.8 })
  update(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'WAREHOUSE_UPDATE', b, k); }

  @Get('statements') @Auth('WAREHOUSE')
  @ApiOperation({ summary: 'Estado de cuenta del almacén (10 % del alquiler, RN-48)' })
  async statements(@Me() u: AuthUser) {
    return { items: await rows(this.engine.pool, 'SELECT s.uuid AS id, s.code, s.period, s.rent_total, s.commission, s.items, s.issued_at, s.due_on, s.status, s.receipt_number FROM storage_statements s JOIN organizations o ON o.id = s.organization_id WHERE o.uuid = ? ORDER BY s.period DESC', [u.orgId]) };
  }
}

@ApiTags('Membresías y cobros')
@Controller('billing')
export class BillingController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Get('subscription') @Auth('BUYER')
  @ApiOperation({ summary: 'Plan, uso del mes frente al límite, cobros y vencimiento' })
  async subscription(@Me() u: AuthUser) {
    const w = this.engine.world;
    const o = w.orgs[u.orgId];
    const usage = await rows(this.engine.pool, 'SELECT su.period, su.purchases_total, su.users_count, su.locations_count FROM subscription_usage su JOIN subscriptions s ON s.id = su.subscription_id JOIN organizations o ON o.id = s.organization_id WHERE o.uuid = ? ORDER BY su.period DESC LIMIT 6', [u.orgId]);
    return { subscription: o?.subscription, plan: o?.subscription ? w.settings.plans[o.subscription.plan] : undefined, plans: w.settings.plans, usage, invoices: Object.values(w.invoices).filter(i => i.orgId === u.orgId) };
  }

  @Post('subscription/change') @Auth('BUYER')
  @ApiOperation({ summary: 'Sube de plan (en el mes gratis, sin cobrar la diferencia)' })
  @Body$({ plan: 'PRO', method: 'YAPE', operation: '05129999' }, ['plan'])
  change(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SUB_UPGRADE', b, k); }

  @Post('invoices/:id/pay') @Auth('BUYER')
  @ApiOperation({ summary: 'Pago de la membresía con número de operación' })
  @Body$({ method: 'YAPE', operation: '05128888' }, ['method', 'operation'])
  payInvoice(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SUB_PAY', b, k); }

  @Get('statements') @Auth('FARMER', 'WAREHOUSE', 'CARRIER')
  @ApiOperation({ summary: 'Mis estados de cuenta (agricultor, almacén o transportista)' })
  statements(@Me() u: AuthUser) {
    return { items: Object.values(this.engine.world.statements).filter(s => s.orgId === u.orgId).sort((a, b) => b.issuedAt - a.issuedAt) };
  }

  @Get('statements/:id') @Auth('FARMER', 'WAREHOUSE', 'CARRIER', 'ADMIN')
  @ApiOperation({ summary: 'Detalle por venta, por lote o por envío' })
  statement(@Me() u: AuthUser, @Param('id') id: string) {
    const s = must(this.engine.world.statements[id], 'el estado de cuenta');
    if (u.role !== 'ADMIN' && s.orgId !== u.orgId) throw new DomainHttpError(403, 'FORBIDDEN', 'Este estado de cuenta no es tuyo.');
    return s;
  }

  @Post('statements/:id/pay') @Auth('FARMER', 'WAREHOUSE', 'CARRIER')
  @ApiOperation({ summary: 'Pago con número de operación (una constancia no paga dos cargos)' })
  @Body$({ method: 'YAPE', operation: '05127777' }, ['method', 'operation'])
  pay(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STATEMENT_PAY', { ...b, statementId: id }, k); }

  @Post('statements/:id/dispute') @Auth('FARMER', 'WAREHOUSE', 'CARRIER')
  @ApiOperation({ summary: 'Reclamo de un cargo del estado de cuenta' })
  @Body$({ itemId: 'so-h03', reason: 'El pedido se canceló' }, ['itemId', 'reason'])
  dispute(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'STATEMENT_CLAIM', { ...b, statementId: id }, k); }
}

@ApiTags('Envíos y transportistas aliados')
@Controller()
export class ShippingController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Get('carriers/:id')
  @ApiOperation({ summary: 'Ficha pública del transportista: nivel, vehículo, reputación y rutas' })
  carrier(@Param('id') id: string) {
    const w = this.engine.world;
    const o = must(w.orgs[id], 'el transportista');
    if (!o.carrier) throw new DomainHttpError(404, 'NOT_FOUND', 'Esa organización no es transportista.');
    const v = o.carrier.vehicle;
    return { id: o.id, name: o.name, district: o.district, level: o.carrier.level, available: o.carrier.available, vehicle: { vclass: v.vclass, body: v.body, payloadKg: v.payloadKg, year: v.year }, routes: o.carrier.routes, stats: carrierStats(w, o.id) };
  }

  @Post('shipping/quote')
  @ApiOperation({ summary: 'Costo del envío con transportista aliado según la ruta y el peso (tarifa de referencia, RF-TRA-08)' })
  @Body$({ fromDistrict: '040201', toDistrict: '040101', kg: 200 }, ['fromDistrict', 'toDistrict', 'kg'])
  quote(@Body() b: any) {
    const w = this.engine.world;
    const from = provinceOf(String(b?.fromDistrict ?? '')), to = provinceOf(String(b?.toDistrict ?? ''));
    if (!from || !to) throw new DomainHttpError(422, 'BAD_DISTRICT', 'Elige distritos válidos.');
    const route = routeFor(w.settings, from, to);
    if (!route) throw new DomainHttpError(422, 'NO_ROUTE', 'Todavía no hay transportistas aliados en esa ruta.');
    return { route: { id: route.id, name: route.name, scope: route.scope }, ...freightFor(route, Number(b?.kg) || 0, b?.vclass) };
  }

  @Get('carriers/me/offers') @Auth('CARRIER')
  @ApiOperation({ summary: 'Ofertas de envío pendientes para mí (con su plazo para aceptar)' })
  offers(@Me() u: AuthUser) {
    const w = this.engine.world;
    return { items: Object.values(w.shipments).filter(s => s.status === 'OFFERING' && s.offers.some(o => o.carrierOrgId === u.orgId && !o.response)) };
  }

  @Get('carriers/me/route') @Auth('CARRIER')
  @ApiOperation({ summary: 'Ruta del día: recojos y entregas en orden' })
  route(@Me() u: AuthUser) {
    const w = this.engine.world;
    return { items: Object.values(w.shipments).filter(s => s.carrierOrgId === u.orgId && ['ASSIGNED', 'GOING_TO_PICKUP', 'PICKED_UP', 'ARRIVED'].includes(s.status)).sort((a, b) => a.pickupAt - b.pickupAt) };
  }

  @Get('carriers/me/earnings') @Auth('CARRIER')
  @ApiOperation({ summary: 'Fletes cobrados por mes' })
  earnings(@Me() u: AuthUser) {
    const w = this.engine.world;
    const by: Record<string, { shipments: number; freight: number }> = {};
    for (const s of Object.values(w.shipments)) {
      if (s.carrierOrgId !== u.orgId || !(s.status === 'DELIVERED' || s.status === 'CLOSED') || !s.delivery) continue;
      const p = new Date(s.delivery.at - 5 * 3600_000).toISOString().slice(0, 7);
      (by[p] ??= { shipments: 0, freight: 0 }).shipments++;
      by[p].freight = Math.round((by[p].freight + s.freight) * 100) / 100;
    }
    return { byMonth: by };
  }

  @Patch('carriers/me') @Auth('CARRIER')
  @ApiOperation({ summary: 'Disponibilidad para recibir ofertas' })
  @Body$({ available: true }, ['available'])
  available(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'CARRIER_AVAILABLE', { available: !!b?.available }, k); }

  @Post('carriers/me/vehicles/documents') @Auth('CARRIER')
  @ApiOperation({ summary: 'Renueva un papel del vehículo (SOAT, CITV, licencia...) con su vencimiento' })
  @Body$({ kind: 'SOAT', expiresOn: 1830000000000 }, ['kind', 'expiresOn'])
  doc(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'CARRIER_DOC_RENEW', b, k); }

  @Post('shipment-offers/:shipmentId/accept') @Auth('CARRIER')
  @ApiOperation({ summary: 'Acepta la oferta (atómico: gana el primero)' })
  acceptOffer(@Me() u: AuthUser, @Param('shipmentId') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SHIP_OFFER_RESPOND', { shipmentId: id, accept: true }, k); }

  @Post('shipment-offers/:shipmentId/reject') @Auth('CARRIER')
  @ApiOperation({ summary: 'Rechaza la oferta (pasa al siguiente transportista)' })
  @Body$({ reason: 'No tengo espacio' })
  rejectOffer(@Me() u: AuthUser, @Param('shipmentId') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SHIP_OFFER_RESPOND', { shipmentId: id, accept: false, reason: b?.reason }, k); }

  @Get('shipments/:id') @Auth()
  @ApiOperation({ summary: 'Estado del envío, avance y hora estimada de llegada' })
  shipment(@Me() u: AuthUser, @Param('id') id: string) {
    const s = must(this.engine.world.shipments[id], 'el envío');
    if (!canSeeShipment(u, s)) throw new DomainHttpError(403, 'FORBIDDEN', 'No participas en este envío.');
    return s;
  }

  @Post('shipments/:id/:step') @Auth('CARRIER', 'BUYER')
  @ApiOperation({ summary: 'Avance del envío: depart, pickup (QR, conteo, peso, guías), arrive, deliver (código), buyer-paid, incidents, claims, cancel, rating' })
  @Body$({ qr: 'QR-8NYVPC8C', sacks: 6, kg: 300, waybillSender: 'T001-00101', waybillCarrier: 'V001-000101' }, [], 'Campos según el paso')
  step(@Me() u: AuthUser, @Param('id') id: string, @Param('step') step: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const map: Record<string, string> = {
      depart: 'SHIP_DEPART', pickup: 'SHIP_PICKUP', arrive: 'SHIP_ARRIVE', deliver: 'SHIP_DELIVER', 'buyer-paid': 'SHIP_BUYER_PAID', incidents: 'SHIP_INCIDENT',
      claims: 'SHIP_CLAIM', 'claim-response': 'SHIP_CLAIM_RESPOND', cancel: 'SHIP_SWITCH_MODE', rating: 'SHIP_RATE', 'rating-reply': 'SHIP_RATING_REPLY', 'no-show': 'SHIP_NO_SHOW', reoffer: 'SHIP_REOFFER',
    };
    const type = map[step];
    if (!type) throw new DomainHttpError(404, 'NOT_FOUND', 'Paso no válido: ' + Object.keys(map).join(', '));
    const extra = type === 'SHIP_INCIDENT' ? { incidentId: b?.incidentId ?? 'si-' + uid() } : {};
    return this.cmd.run(u, type, { ...b, ...extra, shipmentId: id }, k);
  }

  @Post('shipments/:id/location') @Auth('CARRIER')
  @ApiOperation({ summary: 'Posición durante un envío activo (en el MVP se informa al llegar: no se guarda la ruta)' })
  @Body$({ lat: -16.4, lng: -71.53 })
  location(@Me() u: AuthUser, @Param('id') id: string) {
    const s = must(this.engine.world.shipments[id], 'el envío');
    if (s.carrierOrgId !== u.orgId) throw new DomainHttpError(403, 'FORBIDDEN', 'Este envío no es tuyo.');
    return { ok: true, status: s.status, eta: s.deliverTo };
  }
}
