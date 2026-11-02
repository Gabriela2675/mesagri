/*
 * Datos de referencia (13.3, catálogos): ubigeo, roles, unidades, categorías, catálogo maestro,
 * sinónimos, rendimientos y precios de referencia. Salen del paquete compartido, así la app y
 * la base usan los mismos valores.
 */
import { DISTRICTS, PROVINCES, PRODUCTS, UNIT_LABEL, CATEGORY_LABEL, QU_PRODUCT_DRAFTS } from '@mesagri/shared';
import type { Conn } from '../db';
import { exec, insertMany, js } from '../db';

export const ROLES = [
  { id: 1, code: 'FARMER', label: 'Agricultor' },
  { id: 2, code: 'BUYER', label: 'Comprador MYPE' },
  { id: 3, code: 'WAREHOUSE', label: 'Almacén aliado' },
  { id: 4, code: 'CARRIER', label: 'Transportista aliado' },
  { id: 5, code: 'ADMIN', label: 'Equipo de Mesagri' },
];

const perish = (days: number) => (days <= 12 ? 'ALTA' : days <= 60 ? 'MEDIA' : 'BAJA');

export async function writeReference(c: Conn) {
  await insertMany(c, 'ubigeo', DISTRICTS.map(d => ({
    code: d.code, department: 'Arequipa', province_code: d.province, province: PROVINCES[d.province].name, district: d.name,
    is_city: !!d.city, map_x: d.geo.x, map_y: d.geo.y,
  })));
  await insertMany(c, 'roles', ROLES);
  await insertMany(c, 'units', Object.entries(UNIT_LABEL).map(([code, u]) => ({ code, label_one: u.one, label_many: u.many, short_label: u.short })));
  const cats = Object.entries(CATEGORY_LABEL).map(([code, name], i) => ({ id: i + 1, code, name }));
  await insertMany(c, 'product_categories', cats);
  const catId = Object.fromEntries(cats.map(x => [x.code, x.id]));
  await insertMany(c, 'catalog_products', PRODUCTS.map((p, i) => ({
    id: i + 1, code: p.id, category_id: catId[p.category], name: p.name, short_name: p.short, letter: p.letter, color: p.color,
    default_unit: p.units[0], allowed_units: js(p.units), sack_kg: p.sackKg, jaba_kg: p.jabaKg ?? null, perishability: perish(p.perishDays),
    perish_days: p.perishDays, storable: p.storable, shrink_class: p.merma, igv_treatment_default: 'EXONERADO', varieties: js(p.varieties ?? []), active: true,
  })));
  const aliases: any[] = [];
  PRODUCTS.forEach((p, i) => {
    const seen = new Set<string>();
    // la intercalación utf8mb4_0900_ai_ci no distingue tildes ni mayúsculas: «canchán» = «canchan»
    for (const s of p.synonyms) { const a = s.trim().toLowerCase(); const k = a.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (!a || seen.has(k)) continue; seen.add(k); aliases.push({ catalog_product_id: i + 1, alias: a, language: 'es', is_preferred: false, review_status: 'APROBADO' }); }
    const qu = QU_PRODUCT_DRAFTS[p.id];
    if (qu) aliases.push({ catalog_product_id: i + 1, alias: qu, language: 'qu', is_preferred: false, review_status: 'BORRADOR' });
  });
  await insertMany(c, 'catalog_product_aliases', aliases);
  await insertMany(c, 'crop_references', PRODUCTS.map((p, i) => ({
    catalog_product_id: i + 1, yield_kg_ha_high: Math.round(p.yieldHigh * 1000), price_farm_per_kg: p.ref.chacra, price_market_per_kg: p.ref.mayorista, source: p.ref.source, harvest_months: null,
  })));
  await insertMany(c, 'market_prices', PRODUCTS.flatMap((p, i) => [
    { catalog_product_id: i + 1, market: 'Precio en chacra', price_per_kg: p.ref.chacra, observed_on: '2026-10-01', source: p.ref.source },
    { catalog_product_id: i + 1, market: 'Mercado mayorista de Arequipa', price_per_kg: p.ref.mayorista, observed_on: '2026-10-01', source: p.ref.source },
  ]));
}

export async function clearReference(c: Conn) {
  for (const t of ['market_prices', 'crop_references', 'catalog_product_aliases', 'catalog_products', 'product_categories', 'units', 'roles', 'ubigeo']) await exec(c, `DELETE FROM \`${t}\``);
}
