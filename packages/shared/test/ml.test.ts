import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { seedWorld, applySafe, structuredCloneSafe } from '../src/engine/index';
import type { MEvent, World } from '../src/types';
import { MIN } from '../src/time';
import { judgePhoto, mlReview, parseMlModel, cleanMl, mlHeadline, reviewVerdict, toPixels, photoQuality, isSamplePhoto, dHash, hamming, sameImage, type MlModel } from '../src/ml';
import { maskWorld, type Viewer } from '../src/privacy';

let n = 0;
const fresh = () => structuredCloneSafe(seedWorld());
const run = (w: World, actor: string, type: string, p: any) => applySafe(w, { id: `ml-${++n}`, type, actor, t: w.now + MIN, lamport: 0, p } as MEvent);
const publish = (w: World, id: string, extra: any = {}) => run(w, 'u-wilber', 'LISTING_PUBLISH', {
  orgId: 'org-wilber', listingId: id, productId: 'cebolla_roja', unit: 'kg', unitKg: 1, qty: 200, price: 1.5, harvestDate: w.now, quality: 'PRIMERA',
  farmId: 'farm-wilber', photoIds: ['ph-cam-' + id], harvestSeal: true, ...extra,
});

/** Modelo de juguete: cada etiqueta es un eje; una foto «es» la etiqueta hacia la que apunta. */
const LABELS = [
  { id: 'cebolla_roja', es: 'cebolla roja', group: 'producto' }, { id: 'papa_amarilla', es: 'papa amarilla', group: 'producto' },
  { id: 'papa_blanca', es: 'papa blanca', group: 'producto' }, { id: 'ajo', es: 'ajo', group: 'producto' },
  { id: 'bebida_deportiva', es: 'una botella de bebida (tipo Gatorade)', group: 'no' }, { id: 'chacra', es: 'la chacra o el paisaje, sin el producto de cerca', group: 'duda' },
] as const;
const D = LABELS.length + 2;
function toyModel(): MlModel {
  const emb = new Float32Array(LABELS.length * D);
  LABELS.forEach((_, i) => { emb[i * D + i] = 1; });
  const white = new Float32Array(2 * D);
  white[LABELS.length] = 1; white[D + LABELS.length + 1] = 1; // eje «fondo blanco» y eje «cosecha»
  return { name: 'juguete', dim: D, scale: 100, labels: LABELS.map(l => ({ ...l })), similar: { cebolla_roja: ['ajo'] }, variety: [['papa_amarilla', 'papa_blanca']], emb, white, index: new Map(LABELS.map((l, i) => [l.id, i])) };
}
const photo = (w: Partial<Record<(typeof LABELS)[number]['id'] | 'blanco' | 'cosecha', number>>) => {
  const v = new Float32Array(D);
  LABELS.forEach((l, i) => { v[i] = w[l.id] ?? 0; });
  v[LABELS.length] = w.blanco ?? 0; v[LABELS.length + 1] = w.cosecha ?? 0.3;
  return v;
};

describe('primer filtro con Machine Learning: ¿la foto muestra el producto?', () => {
  const m = toyModel();
  it('la foto del producto declarado: sí; una botella: no; la chacra de lejos: dudosa', () => {
    expect(judgePhoto(m, photo({ cebolla_roja: 1 }), 'cebolla_roja')).toMatchObject({ match: 'SI', declared: 100 });
    const botella = judgePhoto(m, photo({ bebida_deportiva: 1 }), 'cebolla_roja');
    expect(botella).toMatchObject({ match: 'NO', declared: 0 });
    expect(botella.sees[0]).toMatchObject({ id: 'bebida_deportiva', p: 100 });
    expect(judgePhoto(m, photo({ chacra: 1 }), 'cebolla_roja').match).toBe('DUDA');
    // otro producto del catálogo que no se parece: no corresponde
    expect(judgePhoto(m, photo({ papa_amarilla: 1 }), 'cebolla_roja').match).toBe('NO');
  });

  it('lo que se confunde a la vista (ajo por cebolla) es dudoso; otra variedad del mismo producto, sí (con nota)', () => {
    expect(judgePhoto(m, photo({ ajo: 1, cebolla_roja: 0.97 }), 'cebolla_roja').match).toBe('DUDA');
    const j = judgePhoto(m, photo({ papa_blanca: 1, papa_amarilla: 0.98 }), 'papa_amarilla');
    expect(j).toMatchObject({ match: 'SI' });
    expect(j.otherVariety?.id).toBe('papa_blanca');
  });

  it('la publicación con una botella de portada: «no publicar», con motivos, notas y mensaje para el agricultor', () => {
    const w = fresh();
    publish(w, 'l-ml1', { photoIds: ['ph-cam-a', 'ph-cam-b'] });
    const l = w.listings['l-ml1'];
    const r = mlReview(w, l, [{ photoId: 'ph-cam-a', emb: photo({ bebida_deportiva: 1 }) }, { photoId: 'ph-cam-b', emb: photo({ cebolla_roja: 1 }) }], m, w.now, 512);
    expect(r.decision).toBe('NO_PUBLICAR');
    expect(r.photos.map(p => p.match)).toEqual(['NO', 'SI']);
    expect(r.photos[0].note).toBe('Se ve una botella de bebida (tipo Gatorade) (100 %), no cebolla roja.');
    expect(r.reasons.map(c => c.key)).toEqual(['foto1', 'foto2', 'precio', 'cantidad', 'cosecha', 'agricultor']);
    expect(r.notes[0]).toContain('La foto 1 no corresponde; las demás sí muestran cebolla roja');
    expect(r.farmerMessage).toBe('La foto 1 no muestra tu cebolla roja. Toma una foto de tu cosecha con la app y vuelve a enviarla.');
    expect(mlHeadline(r, 'Cebolla roja')).toBe('No la dejes publicar: la foto 1 no muestra cebolla roja.');
    expect(r.ms).toBe(512);
  });

  it('todas las fotos del producto y reglas sin observaciones: «se puede publicar»; una foto que no es portada y no corresponde: «revisar»', () => {
    const w = fresh();
    publish(w, 'l-ml2', { photoIds: ['ph-cam-c', 'ph-cam-d'] });
    const l = w.listings['l-ml2'];
    const ok = mlReview(w, l, [{ photoId: 'ph-cam-c', emb: photo({ cebolla_roja: 1 }) }, { photoId: 'ph-cam-d', emb: photo({ cebolla_roja: 1 }) }], m, w.now);
    expect(ok).toMatchObject({ decision: 'PUBLICAR', confidence: 100, farmerMessage: undefined });
    expect(mlHeadline(ok, 'Cebolla roja')).toContain('se puede publicar');
    const mixed = mlReview(w, l, [{ photoId: 'ph-cam-c', emb: photo({ cebolla_roja: 1 }) }, { photoId: 'ph-cam-d', emb: photo({ bebida_deportiva: 1 }) }], m, w.now);
    expect(mixed.decision).toBe('REVISAR');
  });

  it('el precio imposible lo marcan las reglas aunque las fotos estén bien; fotos copiadas, de catálogo, oscuras y de ejemplo', () => {
    const w = fresh();
    publish(w, 'l-ml3', { price: 0.3, confirmPrice: true });
    const l = w.listings['l-ml3'];
    const r = mlReview(w, l, [{ photoId: l.photoIds[0], emb: photo({ cebolla_roja: 1 }) }], m, w.now);
    expect(r.decision).toBe('NO_PUBLICAR');
    expect(r.reasons.find(c => c.key === 'precio')!.ok).toBe(false);
    expect(mlHeadline(r, 'Cebolla roja')).toMatch(/^No la dejes publicar así: precio/);
    const copia = mlReview(w, l, [{ photoId: 'x', emb: photo({ cebolla_roja: 1 }), dupOf: 'Justina (papa nativa)' }], m, w.now);
    expect(copia.photos[0]).toMatchObject({ match: 'NO' });
    expect(copia.photos[0].note).toMatch(/^Es casi la misma foto que la de otra publicación/);
    expect(copia.notes[0]).toBe('La foto 1 es casi igual a una de Justina (papa nativa).');
    expect(copia.farmerMessage).toContain('una foto se parece a la de otra persona');
    const blanco = mlReview(w, l, [{ photoId: 'x', emb: photo({ cebolla_roja: 1, blanco: 1, cosecha: 0 }), light: 30 }], m, w.now);
    expect(blanco.photos[0].match).toBe('DUDA');
    expect(blanco.photos[0].note).toContain('fondo blanco');
    expect(blanco.photos[0].note).toContain('muy oscura');
    const ejemplo = mlReview(w, l, [{ photoId: 'ph-ej-1', sample: true }], m, w.now);
    expect(ejemplo.photos[0].match).toBe('SIN_ANALIZAR');
    expect(isSamplePhoto('ph-ej-1') && isSamplePhoto('seed-photo-tomate') && !isSamplePhoto('ph-cam-1')).toBe(true);
  });

  it('solo el servidor anota el resultado, para la versión que se revisó; cambiar el precio lo vuelve a pedir', () => {
    const w = fresh();
    publish(w, 'l-ml4');
    const l = w.listings['l-ml4'];
    const q = l.review!.queuedAt;
    const ml = mlReview(w, l, [{ photoId: l.photoIds[0], emb: photo({ bebida_deportiva: 1 }) }], m, w.now);
    const p = { listingId: 'l-ml4', queuedAt: q, photos: l.photoIds.join('|'), price: l.price };
    expect(run(w, 'u-lucia', 'LISTING_ML_REVIEW', { ...p, state: 'LISTA', ml }).error?.code).toBe('FORBIDDEN');
    expect(run(w, 'system', 'LISTING_ML_REVIEW', { ...p, state: 'PENDIENTE' }).ok).toBe(true);
    expect(l.review!.mlState).toBe('PENDIENTE');
    expect(run(w, 'system', 'LISTING_ML_REVIEW', { ...p, photos: 'otra', state: 'LISTA', ml }).result).toMatchObject({ stale: true });
    expect(run(w, 'system', 'LISTING_ML_REVIEW', { ...p, queuedAt: q - 1, state: 'LISTA', ml }).result).toMatchObject({ stale: true });
    const r = run(w, 'system', 'LISTING_ML_REVIEW', { ...p, state: 'LISTA', ml });
    expect(r.result).toMatchObject({ ok: true, decision: 'NO_PUBLICAR' });
    expect(l.review).toMatchObject({ mlState: 'LISTA', ml: { decision: 'NO_PUBLICAR', model: 'juguete' } });
    expect(l.status).toBe('IN_REVIEW');
    expect(reviewVerdict(l.review!)).toBe('RECHAZAR');
    expect(w.notifs.at(-1)).toMatchObject({ to: 'ADMIN', title: 'El modelo de ML recomienda no publicar' });
    expect(w.audit.at(-1)).toMatchObject({ action: 'REVISIÓN ML' });
    // el agricultor cambia el precio: el primer filtro se vuelve a calcular
    expect(run(w, 'u-wilber', 'LISTING_EDIT', { listingId: 'l-ml4', price: 1.6 }).ok).toBe(true);
    expect(l.review!.ml).toBeUndefined();
    expect(l.review!.mlState).toBeUndefined();
    expect(run(w, 'system', 'LISTING_ML_REVIEW', { ...p, state: 'ERROR', note: 'sin memoria' }).result).toMatchObject({ stale: true });
    expect(run(w, 'system', 'LISTING_ML_REVIEW', { ...p, price: 1.6, state: 'ERROR', note: 'sin memoria' }).ok).toBe(true);
    expect(l.review).toMatchObject({ mlState: 'ERROR', mlNote: 'sin memoria' });
  });

  it('lo que manda el servidor se limpia: campos conocidos, textos cortos, números en rango', () => {
    const c = cleanMl({ decision: 'BORRAR', confidence: 400, photos: [{ match: 'X', declared: -3, note: 'a'.repeat(900), sees: [{ id: 'x', es: 'y', p: 140 }, {}, {}, {}] }], reasons: 'no', notes: ['ok', 5] }, 7);
    expect(c).toMatchObject({ at: 7, decision: 'REVISAR', confidence: 100, model: 'CLIP' });
    expect(c.photos[0]).toMatchObject({ match: 'SIN_ANALIZAR', declared: 0, n: 1 });
    expect(c.photos[0].note.length).toBe(300);
    expect(c.photos[0].sees.length).toBe(3);
    expect(c.photos[0].sees[0].p).toBe(100);
    expect(c.reasons).toEqual([]);
    expect(c.notes).toEqual(['ok', '5']);
  });

  it('el agricultor ve su revisión pero no las notas internas para el equipo; un comprador no ve nada', () => {
    const w = fresh();
    expect(run(w, 'u-nuevo', 'USER_REGISTER', { userId: 'u-nuevo', orgId: 'org-nuevo', role: 'FARMER', phone: '987650098', name: 'Agricultor Nuevo', lang: 'es', org: { district: '040519', name: 'Agricultor Nuevo' } }).ok).toBe(true);
    w.orgs['org-nuevo'].level = 1;
    expect(run(w, 'u-nuevo', 'LISTING_PUBLISH', { orgId: 'org-nuevo', listingId: 'l-ml5', productId: 'cebolla_roja', unit: 'kg', unitKg: 1, qty: 40, price: 1.5, harvestDate: w.now, photoIds: ['ph-cam-y'] }).ok).toBe(true);
    const l = w.listings['l-ml5'];
    const ml = mlReview(w, l, [{ photoId: l.photoIds[0], emb: photo({ cebolla_roja: 1 }), dupOf: 'Justina (papa nativa)' }], m, w.now);
    expect(run(w, 'system', 'LISTING_ML_REVIEW', { listingId: 'l-ml5', queuedAt: l.review!.queuedAt, state: 'LISTA', ml }).ok).toBe(true);
    const owner: Viewer = { kind: 'user', userId: 'u-nuevo', orgId: 'org-nuevo' };
    const buyer: Viewer = { kind: 'user', userId: 'u-charo', orgId: 'org-geranios' };
    const admin: Viewer = { kind: 'admin', userId: 'u-lucia' };
    expect(maskWorld(w, admin).listings['l-ml5'].review!.ml!.notes[0]).toContain('Justina');
    expect(maskWorld(w, owner).listings['l-ml5'].review!.ml).toMatchObject({ decision: 'NO_PUBLICAR', notes: [] });
    expect(JSON.stringify(maskWorld(w, owner).listings['l-ml5'])).not.toContain('Justina');
    expect(maskWorld(w, buyer).listings['l-ml5'].review).toBeUndefined();
  });

  it('fotos copiadas: la huella cambia poco si la foto se recomprime y mucho entre fotos distintas', () => {
    const grad = Array.from({ length: 72 }, (_, i) => (i % 9) * 20 + Math.floor(i / 9));
    const h = dHash(grad);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe('0000000000000000');
    const noisy = grad.map((v, i) => (i % 9 === 4 ? v + 25 : v));
    expect(hamming(h, dHash(noisy))).toBe(8);
    expect(hamming(h, dHash(grad.map(v => 255 - v)))).toBe(64);
    expect(hamming(h, 'nada')).toBe(64);
    expect(sameImage(3, 0.5)).toBe(true);
    expect(sameImage(10, 0.96)).toBe(true);
    expect(sameImage(10, 0.9)).toBe(false);
    expect(sameImage(20, 0.99)).toBe(false);
  });

  it('el modelo que va con la app: 103 etiquetas, con los 19 productos del catálogo, y su lectura de imágenes', () => {
    const file = path.resolve(__dirname, '../../../models/clip-vit-b32/labels.json');
    const real = parseMlModel(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(real.labels.length).toBe(103);
    expect(real.dim).toBe(512);
    expect(real.labels.filter(l => l.group === 'producto').length).toBe(19);
    for (const id of ['papa_amarilla', 'cebolla_roja', 'maiz_choclo', 'chuno', 'bebida_deportiva']) expect(real.index.has(id)).toBe(true);
    // vectores de norma 1 (float16)
    const row = real.emb.slice(0, 512);
    expect(Math.sqrt(row.reduce((a, x) => a + x * x, 0))).toBeCloseTo(1, 2);
    // entrada del modelo: un píxel blanco normalizado como CLIP; luz y nitidez
    const white = new Uint8Array(224 * 224 * 4).fill(255);
    const px = toPixels(white, 4);
    expect(px.length).toBe(3 * 224 * 224);
    expect(px[0]).toBeCloseTo((1 - 0.48145466) / 0.26862954, 4);
    expect(photoQuality(white, 4)).toEqual({ light: 255, sharp: 0 });
  });
});
