/* Catálogo, publicaciones, favoritos e idiomas (14.6). Las búsquedas usan la vista v_active_listings. */
import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { uid, CRITICAL_KEYS } from '@mesagri/shared';
import { rows } from '../db/db';
import { EngineService } from '../core/engine.service';
import { Commands } from '../core/commands';
import { Auth, Me, OptionalAuth } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { Body$, limitOf, page, readCursor, must } from './helpers';

@ApiTags('Catálogo y publicaciones')
@Controller()
export class CatalogController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Get('catalog/products')
  @ApiOperation({ summary: 'Catálogo maestro con sinónimos (español y quechua) y precios de referencia' })
  async products() {
    const list = await rows(this.engine.pool, `
      SELECT p.code, p.name, p.short_name, c.code AS category, p.default_unit, p.allowed_units, p.sack_kg, p.jaba_kg, p.perishability, p.perish_days, p.storable,
             p.varieties, r.price_farm_per_kg, r.price_market_per_kg, r.source,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('alias', a.alias, 'language', a.language, 'status', a.review_status)) FROM catalog_product_aliases a WHERE a.catalog_product_id = p.id) AS aliases
        FROM catalog_products p JOIN product_categories c ON c.id = p.category_id LEFT JOIN crop_references r ON r.catalog_product_id = p.id
       WHERE p.active = TRUE ORDER BY c.id, p.name`);
    return { items: list.map(r => ({ ...r, storable: !!r.storable })) };
  }

  @Get('listings')
  @ApiOperation({ summary: 'Búsqueda de publicaciones activas (vista v_active_listings), con paginación por cursor' })
  @ApiQuery({ name: 'q', required: false, description: 'Producto o sinónimo (papa, chuño, cebolla...)' })
  @ApiQuery({ name: 'product', required: false }) @ApiQuery({ name: 'province', required: false, enum: ['AREQUIPA', 'CAMANA', 'CAYLLOMA'] })
  @ApiQuery({ name: 'minLevel', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'cursor', required: false })
  async listings(@Query('q') q?: string, @Query('product') product?: string, @Query('province') province?: string, @Query('minLevel') minLevel?: string, @Query('limit') limitQ?: string, @Query('cursor') cursor?: string) {
    const limit = limitOf(limitQ);
    const where: string[] = ['(v.expires_at IS NULL OR v.expires_at > ?)'];
    const args: any[] = [new Date(this.engine.simNow())];
    if (product) { where.push('v.product_code = ?'); args.push(product); }
    if (province) { where.push('v.seller_province = ?'); args.push(province); }
    if (minLevel) { where.push('v.seller_level >= ?'); args.push(Number(minLevel)); }
    if (q?.trim()) {
      where.push(`(v.product_name LIKE ? OR v.product_code IN (SELECT cp.code FROM catalog_product_aliases a JOIN catalog_products cp ON cp.id = a.catalog_product_id WHERE a.alias LIKE ?))`);
      args.push(`%${q.trim()}%`, `%${q.trim().toLowerCase()}%`);
    }
    const cur = readCursor<[number, string]>(cursor);
    if (cur) { where.push('(v.created_at < ? OR (v.created_at = ? AND v.listing_uuid < ?))'); args.push(new Date(cur[0]), new Date(cur[0]), cur[1]); }
    const list = await rows(this.engine.pool, `SELECT v.* FROM v_active_listings v WHERE ${where.join(' AND ')} ORDER BY v.created_at DESC, v.listing_uuid DESC LIMIT ?`, [...args, limit + 1]);
    return page(list.map(r => ({ ...r, harvest_seal: !!r.harvest_seal })) as any[], limit, (r: any) => [r.created_at.getTime(), r.listing_uuid]);
  }

  @Get('listings/:id')
  @ApiOperation({ summary: 'Detalle de una publicación (sin la ubicación exacta de la chacra, RN-17)' })
  listing(@Param('id') id: string) {
    const w = this.engine.world;
    const l = must(w.listings[id], 'la publicación');
    const o = w.orgs[l.orgId];
    const farm = l.farmId ? w.farms[l.farmId] : undefined;
    return { ...l, seller: o ? { id: o.id, name: o.name, district: o.district, province: o.province, level: o.level } : undefined, farm: farm ? { name: farm.name, district: farm.district, areaHa: farm.areaHa } : undefined, photoUrls: l.photoIds.map(p => `/api/v1/files/${p}`) };
  }

  @Post('listings') @Auth('FARMER')
  @ApiOperation({ summary: 'Publica una cosecha (precio por unidad de venta, RN-06; verosimilitud, RN-23; sello «cosechado hoy», RN-22)' })
  @Body$({ productId: 'papa_amarilla', unit: 'saco', unitKg: 50, qty: 10, price: 90, quality: 'PRIMERA', harvestDate: 1793710800000, photoIds: ['ph-123'], farmId: 'farm-h1' }, ['productId', 'unit', 'qty', 'price'])
  publish(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) {
    return this.cmd.run(u, 'LISTING_PUBLISH', { ...b, orgId: u.orgId, listingId: b?.listingId ?? 'l-' + uid() }, k);
  }

  @Patch('listings/:id') @Auth('FARMER')
  @ApiOperation({ summary: 'Cambia el precio o la cantidad mínima' })
  @Body$({ price: 85, minQty: 2, confirmPrice: true })
  edit(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'LISTING_EDIT', { ...b, listingId: id }, k); }

  @Post('listings/:id/stock-adjustments') @Auth('FARMER')
  @ApiOperation({ summary: 'Ajuste de stock con movimiento de inventario' })
  @Body$({ addQty: 5 }, ['addQty'])
  adjust(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'LISTING_EDIT', { listingId: id, addQty: Number(b?.addQty) }, k); }

  @Post('listings/:id/pause') @Auth('FARMER')
  @ApiOperation({ summary: 'Pausa la publicación' })
  pause(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'LISTING_PAUSE', { listingId: id }, k); }

  @Post('listings/:id/resume') @Auth('FARMER')
  @ApiOperation({ summary: 'Vuelve a publicar' })
  resume(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'LISTING_RESUME', { listingId: id }, k); }

  @Delete('listings/:id') @Auth('FARMER')
  @ApiOperation({ summary: 'Retira la publicación (los pedidos en curso siguen)' })
  remove(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) { return this.cmd.run(u, 'LISTING_REMOVE', { listingId: id }, k); }

  @Put('favorites/:type/:id') @Auth('BUYER')
  @ApiOperation({ summary: 'Marca o desmarca un favorito (type: listings, sellers o carriers)' })
  @Body$({ on: true })
  favorite(@Me() u: AuthUser, @Param('type') type: string, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    return this.cmd.run(u, 'FAVORITE_TOGGLE', { orgId: u.orgId, kind: type, id, on: b?.on }, k);
  }

  @Get('i18n/:language') @OptionalAuth()
  @ApiOperation({ summary: 'Contenido multilingüe aprobado (catálogo, respuestas rápidas y pantallas críticas), 16.4' })
  i18n(@Param('language') lang: string) {
    const w = this.engine.world;
    const items: Record<string, string> = {};
    for (const [key, langs] of Object.entries(w.translations)) {
      const t = (langs as any)[lang];
      if (t?.status === 'APPROVED' && t.text) items[key] = t.text;
    }
    return { language: lang, enabled: w.settings.languages.enabled.includes(lang), items, keys: CRITICAL_KEYS.map(k => k.key), audios: [] };
  }
}
