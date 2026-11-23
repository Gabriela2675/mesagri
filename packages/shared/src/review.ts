/*
 * Revisión de cada publicación antes de que la vean los compradores:
 *   1) automática: reglas (precio, cantidad, fotos, fecha de cosecha, historial) y, en el servidor,
 *      una IA que mira las fotos (apps/api/src/review);
 *   2) el equipo de Mesagri la aprueba, pide cambios o la rechaza (panel W-06);
 *   3) recién entonces se publica.
 * Las reglas corren en el celular y en el servidor (mismo resultado), también sin internet.
 */
import type { World, Listing, AutoReview, ReviewCheck, ReviewVerdict } from './types';
import { product, suggestedPricePerKg } from './catalog';
import { plausibility } from './rules';
import { money, pct } from './format';
import { DAY } from './time';

export const VERDICT_LABEL: Record<ReviewVerdict, string> = { OK: 'Sin observaciones', OBSERVAR: 'Mirar con cuidado', RECHAZAR: 'No parece verídica' };

/** Foto elegida de la galería del celular (no tomada con la cámara de la app). */
export const fromGallery = (photoId: string) => photoId.startsWith('ph-gal-');

/** Publicaciones de otros agricultores que usan alguna de estas fotos (misma foto = señal de copia). */
export function photosUsedElsewhere(w: World, l: Pick<Listing, 'id' | 'orgId' | 'photoIds'>): string[] {
  const mine = new Set(l.photoIds);
  if (!mine.size) return [];
  return Object.values(w.listings).filter(x => x.id !== l.id && x.orgId !== l.orgId && x.photoIds.some(p => mine.has(p))).map(x => x.id);
}

/** Revisión por reglas: lo que se puede comprobar sin mirar las fotos. */
export function rulesReview(w: World, l: Listing, t: number): AutoReview {
  const prod = product(l.productId);
  const o = w.orgs[l.orgId];
  const checks: ReviewCheck[] = [];
  // precio frente a los de referencia (precio en chacra y en el mercado mayorista)
  const ppk = l.unitKg ? l.price / l.unitKg : l.price;
  const sug = suggestedPricePerKg(prod.id);
  const lo = prod.ref.chacra * 0.5, hi = prod.ref.mayorista * 1.6;
  const dev = sug ? ppk / sug - 1 : 0;
  const within = Math.abs(dev) <= w.settings.priceDeviation + 1e-9;
  checks.push({
    key: 'precio', label: 'Precio',
    ok: ppk < lo || ppk > hi ? false : within ? true : null,
    detail: `${money(ppk)} por kg; referencia ${money(prod.ref.chacra)} en chacra y ${money(prod.ref.mayorista)} en el mayorista (${dev >= 0 ? '+' : '−'}${pct(Math.abs(dev))} del sugerido).`
      + (ppk < lo ? ' Muy por debajo: puede ser un error de unidad o un señuelo.' : ppk > hi ? ' Muy por encima: puede ser el precio del saco puesto por kilo.' : ''),
  });
  // cantidad frente a lo que rinde la chacra (RN-23)
  const farm = l.farmId ? w.farms[l.farmId] : undefined;
  const kg = l.qtyTotal * (l.unitKg || 1);
  if (l.fromLotId) {
    const lot = w.lots[l.fromLotId];
    checks.push({ key: 'cantidad', label: 'Cantidad', ok: true, detail: `Sale de un lote pesado y guardado en un almacén aliado${lot ? ` (${lot.code})` : ''}.` });
  } else if (farm) {
    const pl = plausibility(kg, farm.areaHa, prod.yieldHigh, w.settings.plausibilityFactor);
    checks.push({ key: 'cantidad', label: 'Cantidad', ok: pl.ok ? true : null, detail: `${Math.round(kg).toLocaleString('es-PE')} kg de una chacra de ${String(farm.areaHa).replace('.', ',')} ha: ${pl.ok ? 'cabe en lo que rinde' : `pasa ${w.settings.plausibilityFactor} veces lo que rinde (hasta ${Math.round(pl.maxKg).toLocaleString('es-PE')} kg, RN-23)`}.` });
  } else {
    checks.push({ key: 'cantidad', label: 'Cantidad', ok: null, detail: `${Math.round(kg).toLocaleString('es-PE')} kg sin una chacra registrada: no se puede comparar con lo que rinde.` });
  }
  // fotos: que haya, de dónde salen y que no sean de otra publicación
  const dup = photosUsedElsewhere(w, l);
  const gallery = l.photoIds.filter(fromGallery).length;
  checks.push({
    key: 'fotos', label: 'Fotos',
    ok: dup.length ? false : !l.photoIds.length ? (l.fromLotId ? null : false) : gallery === l.photoIds.length ? null : true,
    detail: dup.length ? `Una foto ya está en una publicación de otro agricultor.` : !l.photoIds.length ? 'Sin fotos de la cosecha.' : `${l.photoIds.length} ${l.photoIds.length === 1 ? 'foto' : 'fotos'}${gallery ? `, ${gallery === l.photoIds.length ? 'todas' : gallery} de la galería del celular (no tomadas con la app)` : ', tomadas con la cámara de la app'}.`,
  });
  // fecha de cosecha
  const ago = Math.round((t - l.harvestDate) / DAY);
  checks.push({
    key: 'cosecha', label: 'Cosecha',
    ok: ago < -2 ? false : ago > prod.perishDays ? null : true,
    detail: ago < -2 ? 'La fecha de cosecha está en el futuro.' : ago > prod.perishDays ? `Cosechada hace ${ago} días: ${prod.name.toLowerCase()} dura unos ${prod.perishDays} días.` : ago <= 0 ? 'Cosechada hoy.' : `Cosechada hace ${ago} ${ago === 1 ? 'día' : 'días'}.`,
  });
  // historial del agricultor
  if (o) {
    const mine = Object.values(w.listings).filter(x => x.orgId === o.id && x.id !== l.id);
    const rejected = mine.filter(x => x.status === 'REJECTED' || (x.status === 'REMOVED' && !!x.reviewReason)).length;
    const approved = mine.filter(x => !!x.review?.approvedAt || ['ACTIVE', 'SOLD_OUT', 'EXPIRED'].includes(x.status)).length;
    checks.push({
      key: 'agricultor', label: 'Agricultor',
      ok: rejected ? null : true,
      detail: `Nivel ${o.level}${o.counters.completedSales ? ` · ${o.counters.completedSales} ventas conformes` : ' · todavía sin ventas'} · ${approved} ${approved === 1 ? 'publicación aprobada' : 'publicaciones aprobadas'}${rejected ? ` · ${rejected} rechazada${rejected === 1 ? '' : 's'} antes` : ''}.`,
    });
  }
  const bad = checks.filter(c => c.ok === false).length, warn = checks.filter(c => c.ok === null).length;
  const verdict: ReviewVerdict = bad ? 'RECHAZAR' : warn ? 'OBSERVAR' : 'OK';
  const score = Math.max(0, Math.min(100, 100 - 35 * bad - 12 * warn));
  const issues = checks.filter(c => c.ok !== true).map(c => c.label.toLowerCase());
  return {
    by: 'REGLAS', at: t, verdict, score, checks,
    summary: verdict === 'OK' ? 'Las reglas no encuentran nada raro. Falta mirar las fotos.' : `Revisar: ${issues.join(', ')}.`,
    farmerMessage: farmerHint(checks),
  };
}

/** Qué corregir, en palabras simples (se le dice al agricultor si el equipo pide cambios). */
function farmerHint(checks: ReviewCheck[]): string | undefined {
  const c = (k: string) => checks.find(x => x.key === k);
  if (c('fotos')?.ok === false) return /otro agricultor/.test(c('fotos')!.detail) ? 'Pon fotos tuyas de esta cosecha: una foto ya la usa otra persona.' : 'Pon al menos una foto de tu cosecha, tomada con la app.';
  if (c('precio')?.ok === false) return 'Revisa el precio: ¿es por kilo, por arroba o por saco?';
  if (c('cosecha')?.ok === false) return 'Revisa la fecha de cosecha.';
  return undefined;
}

/** Junta la revisión de la IA con la de las reglas: el precio, la cantidad y el historial siguen siendo de las reglas. */
export function mergeReviews(rules: AutoReview, ai: Omit<AutoReview, 'by'> & { by?: 'IA' }): AutoReview {
  const keep = rules.checks.filter(c => !ai.checks.some(x => x.key === c.key) || c.key === 'precio' || c.key === 'cantidad' || c.key === 'agricultor' || c.key === 'cosecha');
  const extra = ai.checks.filter(x => !keep.some(c => c.key === x.key));
  // el precio y la cantidad los mira también la IA: su frase se suma al detalle de la regla
  const merged = keep.map(c => { const x = ai.checks.find(y => y.key === c.key); return x && x.detail && x.detail !== c.detail ? { ...c, detail: `${c.detail} IA: ${x.detail}` } : c; });
  const checks = [...merged, ...extra];
  const rank: Record<ReviewVerdict, number> = { OK: 0, OBSERVAR: 1, RECHAZAR: 2 };
  // lo que encontraron las reglas no se pierde: si las reglas marcan algo, al menos «mirar con cuidado»
  const floor: ReviewVerdict = rules.checks.some(c => c.ok === false && c.key !== 'fotos') ? 'OBSERVAR' : rules.verdict === 'OK' ? 'OK' : 'OBSERVAR';
  const verdict = rank[ai.verdict] >= rank[floor] ? ai.verdict : floor;
  return { ...ai, by: 'IA', checks, verdict, score: Math.round(Math.min(ai.score, verdict === 'OK' ? 100 : rules.score + 10)), farmerMessage: ai.farmerMessage || rules.farmerMessage };
}
