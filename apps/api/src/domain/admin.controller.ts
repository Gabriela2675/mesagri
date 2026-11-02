/* Verificación (expedientes, chacras, cuentas de cobro) y administración del panel (14.6). */
import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { uid, SETTING_KEYS } from '@mesagri/shared';
import { rows, exec } from '../db/db';
import { EngineService } from '../core/engine.service';
import { Commands } from '../core/commands';
import { Auth, Me } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';
import { Body$, limitOf, page, readCursor, must } from './helpers';

@ApiTags('Verificación')
@Controller()
export class VerificationController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Post('verification/cases') @Auth('FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Envía un expediente para subir de nivel (las alertas antifraude se calculan en el servidor)' })
  @Body$({ targetLevel: 1, evidence: [{ key: 'dni', label: 'DNI (ambas caras)', photoId: 'ph-1' }, { key: 'selfie', label: 'Selfie', photoId: 'ph-2' }] }, ['targetLevel', 'evidence'])
  submit(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'VERIF_SUBMIT', { ...b, orgId: u.orgId, caseId: b?.caseId ?? 'case-' + uid() }, k); }

  @Post('verification/cases/:id/respond') @Auth('FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Responde a un pedido de más información' })
  @Body$({ text: 'Envío la foto nítida', evidence: [] })
  respond(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'VERIF_RESPOND', { ...b, caseId: id }, k); }

  @Post('verification/cases/:id/appeal') @Auth('FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Apela un rechazo' })
  @Body$({ text: 'Adjunto la constancia correcta' }, ['text'])
  appeal(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'VERIF_APPEAL', { ...b, caseId: id }, k); }

  @Post('farms') @Auth('FARMER')
  @ApiOperation({ summary: 'Registra una chacra (la ubicación exacta nunca se muestra a los compradores, RN-17)' })
  @Body$({ name: 'Chacra La Pampa', district: '040201', areaHa: 1.5, tenure: 'PROPIA', crops: ['arroz_cascara'], photoIds: [] }, ['name', 'district', 'areaHa'])
  farm(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'FARM_ADD', { ...b, orgId: u.orgId, farmId: b?.farmId ?? 'farm-' + uid() }, k); }

  @Get('farms') @Auth('FARMER')
  @ApiOperation({ summary: 'Mis chacras' })
  async farms(@Me() u: AuthUser) {
    const list = await rows(this.engine.pool, 'SELECT f.uuid AS id, f.name, f.ubigeo AS district, f.area_ha, f.tenure, f.crops, f.gps_source, f.created_at FROM farms f JOIN organizations o ON o.id = f.organization_id WHERE o.uuid = ? ORDER BY f.id', [u.orgId]);
    return { items: list };
  }

  @Post('payout-accounts') @Auth('FARMER', 'CARRIER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Cuentas de cobro (se cifran con AES-256-GCM; una de un tercero exige autorización, RN-28)' })
  @Body$({ accounts: [{ id: 'pa-1', kind: 'YAPE', number: '951234678', holder: 'Wilber Huamaní', relation: 'PROPIA' }], acceptsCash: true }, ['accounts'])
  payout(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'PAYOUT_SET', { ...b, orgId: u.orgId }, k); }

  @Put('service-areas') @Auth('FARMER')
  @ApiOperation({ summary: 'Zonas de entrega del agricultor, su costo y los días de entrega' })
  @Body$({ areas: [{ district: '040101', fee: 15 }], days: [2, 4, 6], pickupPoint: 'Chacra La Pampa, Camaná' }, ['areas'])
  zones(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'ZONES_SET', { ...b, orgId: u.orgId }, k); }

  @Post('me/consents') @Auth()
  @ApiOperation({ summary: 'Consentimientos por finalidad (Ley 29733)' })
  @Body$({ version: '1.0', items: { distrito: true, dni: true, whatsapp: true, precios: false } }, ['items'])
  consents(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'CONSENTS_ACCEPT', b, k); }

  @Get('admin/verification/queue') @Auth('ADMIN:VERIFIER', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Cola del verificador: lo más antiguo primero, con alertas (vista v_verification_queue)' })
  @ApiQuery({ name: 'subject', required: false, enum: ['FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE'] })
  async queue(@Query('subject') subject?: string) {
    const list = await rows(this.engine.pool, `SELECT * FROM v_verification_queue ${subject ? 'WHERE subject = ?' : ''} ORDER BY submitted_at`, subject ? [subject] : []);
    return { items: list };
  }

  @Post('admin/verification/cases/:id/take') @Auth('ADMIN:VERIFIER', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Toma un expediente' })
  take(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'VERIF_TAKE', { caseId: id }, k); }

  @Post('admin/verification/cases/:id/decision') @Auth('ADMIN:VERIFIER', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Aprueba, rechaza o pide información (motivo obligatorio, RF-VER-07)' })
  @Body$({ result: 'APPROVE', reason: 'DNI y selfie coinciden' }, ['result', 'reason'])
  decide(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'VERIF_DECIDE', { ...b, caseId: id }, k); }

  @Post('admin/carriers/:orgId/inspection') @Auth('ADMIN:VERIFIER', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Revisión del vehículo (20 puntos, mínimo 80 y sin fallas críticas, RN-52)' })
  @Body$({ score: 92, criticalFails: 0, checklist: { frenos: true, luces: true } }, ['score'])
  inspect(@Me() u: AuthUser, @Param('orgId') orgId: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'CARRIER_INSPECTION', { ...b, orgId }, k); }

  @Post('admin/storage/:orgId/inspection') @Auth('ADMIN:VERIFIER', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Visita de campo al almacén (mínimo 80, RN-42)' })
  @Body$({ score: 88, criticalFails: 0 }, ['score'])
  visit(@Me() u: AuthUser, @Param('orgId') orgId: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'WAREHOUSE_VISIT', { ...b, orgId }, k); }
}

@ApiTags('Administración')
@Controller('admin')
export class AdminController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Get('settings') @Auth('ADMIN')
  @ApiOperation({ summary: 'Configuración vigente (límites, comisión, plazos, planes y rutas) y cambios pendientes' })
  settings() {
    const w = this.engine.world;
    return { settings: w.settings, editable: SETTING_KEYS.map(k => ({ key: k.key, label: k.label, group: k.group, unit: k.unit, value: k.get(w.settings) })), proposals: Object.values(w.proposals) };
  }

  @Post('settings/changes') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Propone un cambio (lo aprueba otra persona, RN-50)' })
  @Body$({ key: 'orderResponseHours', value: 10, reason: 'Pedidos de hoteles más rápidos', effectiveFrom: 1793797200000 }, ['key', 'value', 'reason'])
  propose(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SETTING_PROPOSE', { ...b, proposalId: b?.proposalId ?? 'prop-' + uid() }, k); }

  @Post('settings/changes/:id/approve') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Segunda aprobación (no puede ser quien propuso)' })
  approve(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SETTING_APPROVE', { proposalId: id }, k); }

  @Post('settings/changes/:id/reject') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Rechaza un cambio propuesto' })
  @Body$({ reason: 'Esperemos al fin de la campaña' }, ['reason'])
  reject(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'SETTING_REJECT', { proposalId: id, reason: b?.reason }, k); }

  @Post('translations') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Revisa o aprueba una traducción al quechua o aimara (RN-32)' })
  @Body$({ key: 'product.papa_amarilla', lang: 'qu', text: "Q'illu papa", status: 'APPROVED' }, ['key', 'lang', 'status'])
  translate(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'TRANSLATION_SET', b, k); }

  @Get('audit-logs') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Auditoría: quién hizo qué y cuándo' })
  @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'cursor', required: false }) @ApiQuery({ name: 'actor', required: false })
  async audit(@Query('limit') limitQ?: string, @Query('cursor') cursor?: string, @Query('actor') actor?: string) {
    const limit = limitOf(limitQ, 50);
    const cur = readCursor<number>(cursor);
    const where: string[] = [], args: any[] = [];
    if (cur) { where.push('a.seq < ?'); args.push(cur); }
    if (actor) { where.push('a.actor_uuid = ?'); args.push(actor); }
    const list = await rows(this.engine.pool, `SELECT a.uuid AS id, a.seq, a.created_at AS at, a.actor_uuid AS actor, a.action, a.entity_type AS entity, a.detail, a.before_data AS \`before\`, a.after_data AS \`after\` FROM audit_logs a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.seq DESC LIMIT ?`, [...args, limit + 1]);
    return page(list.map(r => ({ ...r, at: r.at.getTime() })) as any[], limit, (r: any) => r.seq);
  }

  @Get('metrics') @Auth('ADMIN')
  @ApiOperation({ summary: 'Indicadores del piloto (sin datos personales): ventas por mes, organizaciones por nivel, pedidos y verificación' })
  async metrics() {
    const q = (sql: string, a: any[] = []) => rows(this.engine.pool, sql, a);
    const [sales, orgs, subs, queue, listings, money] = await Promise.all([
      q('SELECT period, SUM(sales) AS sales, SUM(sales_total) AS total, SUM(commission_total) AS commission FROM v_monthly_sales GROUP BY period ORDER BY period'),
      q('SELECT kind, verification_level AS level, status, COUNT(*) AS n FROM organizations GROUP BY kind, verification_level, status ORDER BY kind, level'),
      q('SELECT status, COUNT(*) AS n, SUM(total) AS total FROM sub_orders GROUP BY status'),
      q('SELECT subject, COUNT(*) AS n, MIN(submitted_at) AS oldest FROM v_verification_queue GROUP BY subject'),
      q('SELECT COUNT(*) AS n FROM v_active_listings'),
      q(`SELECT 'COMISION' AS concept, period, SUM(commission) AS total FROM commission_statements GROUP BY period
         UNION ALL SELECT 'ALMACEN', period, SUM(commission) FROM storage_statements GROUP BY period
         UNION ALL SELECT 'TRANSPORTE', period, SUM(commission) FROM carrier_statements GROUP BY period
         UNION ALL SELECT 'MEMBRESIA', period, SUM(amount) FROM subscription_invoices WHERE status <> 'VOID' GROUP BY period ORDER BY period`),
    ]);
    return { monthlySales: sales, organizations: orgs, subOrders: subs, verificationQueue: queue, activeListings: Number(listings[0]?.n ?? 0), revenue: money, gmvByMonth: this.engine.world.monthlyGmv };
  }

  @Post('complaints/:id/answer') @Auth('ADMIN:SUPPORT', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Responde un reclamo o queja del Libro de Reclamaciones' })
  @Body$({ answer: 'Anulamos el cargo y emitimos la nota de crédito.' }, ['answer'])
  answer(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'COMPLAINT_ANSWER', { complaintId: id, answer: b?.answer }, k); }

  @Post('disputes/:id/resolve') @Auth('ADMIN:SUPPORT', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Resuelve una disputa (a favor de una parte o por acuerdo)' })
  @Body$({ outcome: 'ACUERDO', refund: 10, note: 'Se devuelven 5 kg' }, ['outcome', 'note'])
  resolve(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'DISPUTE_RESOLVE', { ...b, disputeId: id }, k); }

  @Post('tickets/:id/reply') @Auth('ADMIN:SUPPORT', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Responde una consulta de Soporte' })
  @Body$({ text: 'Desde Perfil › Cuentas de cobro.', close: true }, ['text'])
  reply(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'TICKET_REPLY', { ...b, ticketId: id }, k); }

  @Get('billing') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Cobros de Mesagri: estados de cuenta y membresías, con los pagos por conciliar' })
  async billing() {
    const w = this.engine.world;
    return {
      statements: Object.values(w.statements).map(s => ({ id: s.id, code: s.code, kind: s.kind, org: w.orgs[s.orgId]?.name, period: s.period, total: s.total, status: s.status, payment: s.payment, dueAt: s.dueAt })),
      invoices: Object.values(w.invoices).map(i => ({ ...i, org: w.orgs[i.orgId]?.name })),
      toReconcile: (await rows(this.engine.pool, 'SELECT * FROM billing_payments WHERE reconciled_at IS NULL ORDER BY paid_at')),
    };
  }

  @Post('billing/:kind/:id/reconcile') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Concilia un pago (kind: statements o invoices); si no coincide, se observa con motivo' })
  @Body$({ ok: true, note: '' })
  reconcile(@Me() u: AuthUser, @Param('kind') kind: string, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    return this.cmd.run(u, 'BILLING_RECONCILE', { kind: kind === 'invoices' ? 'INVOICE' : 'STATEMENT', id, ok: b?.ok !== false, note: b?.note }, k);
  }

  @Post('statements/:id/items/:itemId/void') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Anula un cargo del estado de cuenta (nota de crédito, motivo obligatorio)' })
  @Body$({ reason: 'El pedido se canceló antes de entregarse' }, ['reason'])
  voidItem(@Me() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'CHARGE_VOID', { statementId: id, itemId, reason: b?.reason }, k); }

  @Post('organizations/:id/suspend') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Suspende una cuenta (motivo obligatorio)' })
  @Body$({ reason: 'Fraude confirmado' }, ['reason'])
  suspend(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'ORG_SUSPEND', { orgId: id, reason: b?.reason }, k); }

  @Post('organizations/:id/reset-access') @Auth('ADMIN:GENERAL', 'ADMIN:SUPPORT')
  @ApiOperation({ summary: 'Cierra todas las sesiones de la cuenta (tokens de refresco) y olvida sus celulares; vuelven a entrar con su código', description: 'Queda en auditoría. Los tokens de acceso vencen solos en 15 minutos.' })
  @Body$({ reason: 'Perdió el celular' }, [])
  async resetAccess(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const r = await this.cmd.run(u, 'ACCESS_RESET', { orgId: id, reason: b?.reason }, k);
    const res = await exec(this.engine.pool, `UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE revoked_at IS NULL AND user_id IN (
      SELECT om.user_id FROM organization_members om JOIN organizations o ON o.id = om.organization_id WHERE o.uuid = ?)`, [id]);
    // olvida sus celulares de confianza: en la versión de prueba, el próximo celular donde ingrese verá el código
    const dev = await exec(this.engine.pool, `DELETE FROM trusted_devices WHERE user_id IN (
      SELECT om.user_id FROM organization_members om JOIN organizations o ON o.id = om.organization_id WHERE o.uuid = ?)`, [id]);
    return { ...r, sessionsClosed: res.affectedRows, devicesForgotten: dev.affectedRows };
  }

  @Post('organizations/:id/reactivate') @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Reactiva una cuenta suspendida' })
  reactivate(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'ORG_REACTIVATE', { orgId: id }, k); }

  @Post('listings/:id/moderate') @Auth('ADMIN:VERIFIER', 'ADMIN:GENERAL')
  @ApiOperation({ summary: 'Aprueba o rechaza una publicación en revisión (precio fuera de rango, nivel 1)' })
  @Body$({ decision: 'APPROVE', reason: '' }, ['decision'])
  moderate(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'LISTING_MODERATE', { ...b, listingId: id }, k); }

  @Get('shipments') @Auth('ADMIN')
  @ApiOperation({ summary: 'Envíos del día y sin transportista' })
  shipments() {
    const w = this.engine.world;
    const now = this.engine.simNow();
    const day = 86_400_000;
    return { items: Object.values(w.shipments).filter(s => Math.abs(s.pickupAt - now) < day || s.status === 'NO_CARRIER' || s.status === 'OFFERING').map(s => ({ ...s, buyer: w.orgs[s.buyerOrgId]?.name, seller: w.orgs[s.sellerOrgId]?.name, carrier: s.carrierOrgId ? w.orgs[s.carrierOrgId]?.name : undefined })) };
  }

  @Get('organizations/:id') @Auth('ADMIN')
  @ApiOperation({ summary: 'Ficha de una organización para el panel (el analista no ve datos personales)' })
  org(@Me() u: AuthUser, @Param('id') id: string) {
    const w = this.engine.world;
    const o = must(w.orgs[id], 'la organización');
    if (u.adminRole === 'ANALYST') return { id: o.id, type: o.type, district: o.district, level: o.level, status: o.status, counters: o.counters };
    return { ...o, payout: o.payout.map(a => ({ ...a, number: '••••' + String(a.number).slice(-4) })) };
  }
}

void DomainHttpError;
