/*
 * Publicaciones e inventario (6.3, CU-05, RN-02, RN-05, RN-07, RN-22, RN-23, RN-25, RN-29, RN-40).
 */
import type { Listing, Unit } from '../types';
import { on, fail, audit, notify, requireMember, requireAdmin, requireActive, getOrg, must } from './core';
import { product, suggestedPricePerKg, unitKgFor } from '../catalog';
import { farmerLimit, priceDeviation, plausibility, r3 } from '../rules';
import { activeListings, overdueStatement } from '../queries';
import { DAY, startOfDay } from '../time';
import { money } from '../format';

/** Precios por volumen: solo pares válidos (sin pares, la publicación no tiene escalas). */
function cleanTiers(x: unknown): { minKg: number; price: number }[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.slice(0, 5).map((t: any) => ({ minKg: Number(t?.minKg) || 0, price: Number(t?.price) || 0 })).filter(t => t.minKg > 0 && t.price > 0);
  return out.length ? out : undefined;
}

const COUNT_UNITS: Unit[] = ['saco', 'arroba', 'jaba', 'atado'];

export function validQty(unit: Unit, qty: number): boolean {
  if (!(qty > 0)) return false;
  if (COUNT_UNITS.includes(unit)) return Number.isInteger(qty);          // RN-25
  return Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6;           // kg: hasta 3 decimales
}

on('LISTING_PUBLISH', (c) => {
  const { w, t } = c;
  const p = c.e.p;
  const o = getOrg(w, p.orgId);
  requireMember(c.a, o.id);
  if (o.type !== 'FARMER') fail('FORBIDDEN', 'Solo los agricultores publican cosechas.');
  requireActive(o);
  if (o.level < 1) fail('LEVEL0', 'Primero necesitamos verificar tu identidad (nivel 1). Mientras tanto puedes explorar el catálogo (RN-02).');
  const od = overdueStatement(w, o.id);
  if (od) fail('STATEMENT_OVERDUE', `Tu estado de cuenta de ${od.period} venció. Págalo para volver a publicar; tus pedidos en curso siguen (RN-40).`, { statementId: od.id });
  if (w.listings[p.listingId]) fail('DUPLICATE', 'Esta publicación ya se envió.');
  const prod = product(p.productId);
  if (!p.productId || prod.id !== p.productId) fail('BAD_PRODUCT', 'Elige un producto del catálogo.');
  const unit = (p.unit ?? 'kg') as Unit;
  const qty = Number(p.qty);
  if (!validQty(unit, qty)) fail('BAD_QTY', COUNT_UNITS.includes(unit) ? 'Los sacos, jabas y arrobas van en números enteros (RN-25).' : 'Escribe una cantidad mayor que cero.');
  const price = Math.round(Number(p.price) * 100) / 100;
  if (!(price > 0)) fail('BAD_PRICE', 'Escribe el precio por ' + (unit === 'kg' ? 'kilo' : unit) + '.');
  const unitKg = unit === 'kg' ? 1 : Number(p.unitKg) || unitKgFor(prod.id, unit);
  const lim = farmerLimit(w.settings, o.level);
  let lot: any;
  if (p.fromLotId) {
    lot = must(w.lots[p.fromLotId], 'NOT_FOUND', 'No encontramos ese lote.');
    if (lot.farmerOrgId !== o.id) fail('FORBIDDEN', 'Ese lote es de otra persona.');
    if (lot.status !== 'IN_DEPOSIT' && lot.status !== 'FOR_SALE') fail('LOT_STATE', 'Ese lote no está disponible para la venta.');
    if (qty * unitKg > lot.balanceKg + 0.001) fail('LOT_BALANCE', `En el almacén quedan ${lot.balanceKg} kg de ese lote.`);
    if (lot.listingId && w.listings[lot.listingId] && ['ACTIVE', 'PAUSED', 'SOLD_OUT'].includes(w.listings[lot.listingId].status)) fail('LOT_LISTED', 'Ese lote ya está publicado. Edita esa publicación.');
  } else if (lim.listings !== null && activeListings(w, o.id).length >= lim.listings) {
    fail('LISTING_CAP', `Con el nivel ${o.level} puedes tener ${lim.listings} publicaciones activas. Pausa una o sube de nivel: con el Padrón de Productores llegas a 30.`);
  }
  const ppk = price / unitKg;
  const dev = priceDeviation(ppk, suggestedPricePerKg(prod.id), w.settings.priceDeviation);
  if (dev.ask && !p.confirmPrice) fail('PRICE_CONFIRM', `Tu precio se aleja ${Math.round(Math.abs(dev.dev) * 100)} % del sugerido (${money(suggestedPricePerKg(prod.id))} por kg). ¿Lo confirmas?`, { dev: dev.dev });
  let status: Listing['status'] = 'ACTIVE';
  let reviewReason: string | undefined;
  const farm = p.farmId ? w.farms[p.farmId] : undefined;
  if (farm && !lot) {
    const pl = plausibility(qty * unitKg, farm.areaHa, prod.yieldHigh, w.settings.plausibilityFactor);
    if (!pl.ok) { status = 'IN_REVIEW'; reviewReason = `La cantidad pasa ${w.settings.plausibilityFactor} veces lo que rinde ${farm.areaHa} ha de ${prod.name.toLowerCase()} (RN-23).`; }
  }
  const harvestDate = Number(p.harvestDate) || t;
  const photoIds: string[] = Array.isArray(p.photoIds) ? p.photoIds.map(String).slice(0, 10) : [];
  // RN-22: «cosechado hoy» solo con foto tomada en la app el mismo día
  const seal = !!p.harvestSeal && photoIds.length > 0 && startOfDay(harvestDate) === startOfDay(t);
  const l: Listing = {
    id: p.listingId, orgId: o.id, productId: prod.id, variety: p.variety || undefined, unit, unitKg, qtyTotal: qty, available: qty, reserved: 0, sold: 0,
    price, harvestDate, quality: p.quality ?? 'PRIMERA', farmId: farm?.id, photoIds, harvestSeal: seal, status, reviewReason,
    createdAt: t, expiresAt: t + (lot ? 120 : prod.perishDays) * DAY, minQty: Math.max(0, Number(p.minQty) || 0), fromLotId: lot?.id,
    tiers: cleanTiers(p.tiers),
  };
  if (!l.tiers) delete l.tiers;
  w.listings[l.id] = l;
  w.movements.push({ at: t, listingId: l.id, kind: 'INIT', qty, ref: c.e.id });
  if (lot) { lot.status = 'FOR_SALE'; lot.listingId = l.id; }
  if (status === 'IN_REVIEW') {
    notify(c, 'ADMIN', 'SYSTEM', 'Publicación para revisar', `${o.name}: ${prod.name} · ${reviewReason}`, { screen: 'W-06' });
    notify(c, o.id, 'SYSTEM', 'Tu publicación está en revisión', reviewReason ?? '');
  }
  if (dev.ask || o.level === 1) l.flags = [...(dev.ask ? [`Precio ${dev.dev > 0 ? '+' : ''}${Math.round(dev.dev * 100)} % del sugerido`] : []), ...(o.level === 1 ? ['Agricultor de nivel 1'] : [])];
  return { listingId: l.id, status };
});

on('LISTING_EDIT', (c) => {
  const l = must(c.w.listings[c.e.p.listingId], 'NOT_FOUND', 'No encontramos la publicación.');
  requireMember(c.a, l.orgId);
  const p = c.e.p;
  let newPrice = l.price, add = 0;
  if (p.price !== undefined) {
    newPrice = Math.round(Number(p.price) * 100) / 100;
    if (!(newPrice > 0)) fail('BAD_PRICE', 'Escribe un precio mayor que cero.');
    const dev = priceDeviation(newPrice / l.unitKg, suggestedPricePerKg(l.productId), c.w.settings.priceDeviation);
    if (dev.ask && !p.confirmPrice) fail('PRICE_CONFIRM', `Tu precio se aleja ${Math.round(Math.abs(dev.dev) * 100)} % del sugerido. ¿Lo confirmas?`);
  }
  if (p.addQty !== undefined) {
    add = Number(p.addQty);
    if (!validQty(l.unit, Math.abs(add)) && add !== 0) fail('BAD_QTY', 'Cantidad no válida.');
    if (l.available + add < 0) fail('BAD_QTY', 'No puedes quitar más de lo disponible.');
    if (l.fromLotId && add > 0) fail('LOT', 'La cantidad de un lote la fija el almacén.');
  }
  l.price = newPrice;
  if (add) {
    l.available = r3(l.available + add); l.qtyTotal = r3(l.qtyTotal + add);
    c.w.movements.push({ at: c.t, listingId: l.id, kind: 'ADJUST', qty: add, ref: c.e.id });
    if (l.status === 'SOLD_OUT' && l.available > 0) l.status = 'ACTIVE';
  }
  if (p.minQty !== undefined) l.minQty = Math.max(0, Number(p.minQty) || 0);
  if (p.photoIds !== undefined) {
    // fotos de la cosecha: hasta 5, la primera es la portada (el sello «Cosechado hoy» no cambia)
    if (!Array.isArray(p.photoIds) || p.photoIds.length > 5 || p.photoIds.some((x: unknown) => !/^[A-Za-z0-9:_.-]{3,80}$/.test(String(x)))) fail('BAD_PHOTOS', 'Puedes poner hasta 5 fotos.');
    l.photoIds = [...new Set<string>(p.photoIds.map(String))];
  }
});

on('LISTING_PAUSE', (c) => {
  const l = must(c.w.listings[c.e.p.listingId], 'NOT_FOUND', 'No encontramos la publicación.');
  requireMember(c.a, l.orgId);
  if (l.status !== 'ACTIVE' && l.status !== 'SOLD_OUT') fail('STATE', 'Solo se pausa una publicación activa.');
  l.status = 'PAUSED';
});

on('LISTING_RESUME', (c) => {
  const l = must(c.w.listings[c.e.p.listingId], 'NOT_FOUND', 'No encontramos la publicación.');
  requireMember(c.a, l.orgId);
  if (l.status !== 'PAUSED') fail('STATE', 'Esta publicación no está pausada.');
  const o = getOrg(c.w, l.orgId);
  const od = overdueStatement(c.w, o.id);
  if (od) fail('STATEMENT_OVERDUE', 'Tu estado de cuenta venció. Págalo para reactivar publicaciones (RN-40).');
  const lim = farmerLimit(c.w.settings, o.level);
  if (!l.fromLotId && lim.listings !== null && activeListings(c.w, o.id).length >= lim.listings) fail('LISTING_CAP', `Con tu nivel puedes tener ${lim.listings} publicaciones activas.`);
  if (l.expiresAt <= c.t) l.expiresAt = c.t + product(l.productId).perishDays * DAY;
  l.status = l.available > 0 ? 'ACTIVE' : 'SOLD_OUT';
});

on('LISTING_REMOVE', (c) => {
  const l = must(c.w.listings[c.e.p.listingId], 'NOT_FOUND', 'No encontramos la publicación.');
  requireMember(c.a, l.orgId);
  if (l.reserved > 0) fail('RESERVED', 'Tiene pedidos en curso: termínalos antes de darla de baja.');
  l.status = 'REMOVED';
  if (l.fromLotId && c.w.lots[l.fromLotId]?.status === 'FOR_SALE') c.w.lots[l.fromLotId].status = 'IN_DEPOSIT';
});

on('LISTING_MODERATE', (c) => {
  requireAdmin(c.a, 'GENERAL', 'SUPPORT', 'VERIFIER');
  const l = must(c.w.listings[c.e.p.listingId], 'NOT_FOUND', 'No encontramos la publicación.');
  const d = c.e.p.decision as 'APPROVE' | 'REJECT' | 'PAUSE';
  const reason = String(c.e.p.reason ?? '').trim();
  if (d !== 'APPROVE' && reason.length < 5) fail('REASON_REQUIRED', 'Escribe el motivo: el agricultor lo va a leer.');
  const before = l.status;
  if (d === 'APPROVE') { l.status = l.available > 0 ? 'ACTIVE' : 'SOLD_OUT'; l.reviewReason = undefined; l.flags = undefined; }
  if (d === 'REJECT') { if (l.reserved > 0) fail('RESERVED', 'Tiene pedidos en curso.'); l.status = 'REJECTED'; l.reviewReason = reason; }
  if (d === 'PAUSE') { l.status = 'PAUSED'; l.reviewReason = reason; }
  audit(c, c.a.id, 'MODERACIÓN', l.id, `${product(l.productId).name} de ${c.w.orgs[l.orgId]?.name}: ${d}${reason ? ' · ' + reason : ''}`, before, l.status);
  notify(c, l.orgId, 'SYSTEM', d === 'APPROVE' ? 'Tu publicación ya se ve' : 'Revisamos tu publicación', d === 'APPROVE' ? `${product(l.productId).name} ya aparece en el catálogo.` : reason);
});
