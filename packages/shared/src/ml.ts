/*
 * Primer filtro con Machine Learning: ¿las fotos muestran el producto que se publica?
 *
 * Modelo de visión CLIP ViT-B/32 (OpenCLIP, entrenado con 2 000 millones de imágenes con texto de
 * LAION-2B, licencia MIT), cuantizado a int8 (89 MB). Corre gratis en el servidor de Mesagri (y en el
 * navegador en la demo sin internet): ninguna foto sale a otra empresa. Convierte cada foto en un
 * vector y lo compara con 103 etiquetas en texto (los 19 productos del catálogo, otros productos del
 * campo, cosas que no son productos —botellas, personas, capturas…— y fotos que no dejan ver nada):
 * es clasificación «zero-shot», no hizo falta entrenarlo con fotos de Mesagri.
 *
 * Aquí está la decisión (igual en el servidor y en el navegador): por foto, SÍ muestra el producto,
 * DUDOSO o NO; por publicación, junto con las reglas (precio, cantidad, cosecha), recomienda
 * PUBLICAR, REVISAR o NO PUBLICAR, con los motivos, notas para el equipo y un mensaje para el
 * agricultor. La decisión final siempre es del equipo (W-06).
 * Las etiquetas y los umbrales se armaron y probaron con scripts/ml (ver su LEEME).
 */
import type { World, Listing, MlReview, MlPhoto, MlMatch, MlDecision, MlSee, ReviewCheck, ListingReview, ReviewVerdict } from './types';
import { product } from './catalog';
import { rulesReview } from './review';

export interface MlLabel { id: string; es: string; group: 'producto' | 'otro' | 'no' | 'duda' }
export interface MlModel {
  name: string;
  dim: number;
  /** escala de CLIP (100): convierte el parecido (coseno) en probabilidades */
  scale: number;
  labels: MlLabel[];
  /** productos que se confunden a la vista con cada producto del catálogo */
  similar: Record<string, string[]>;
  /** variedades del mismo producto (papa amarilla, blanca, nativa…) */
  variety: string[][];
  /** vectores de las etiquetas [etiquetas × dim], de norma 1 */
  emb: Float32Array;
  /** «foto de catálogo con fondo blanco» y «foto de la cosecha» [2 × dim] */
  white: Float32Array;
  index: Map<string, number>;
}

/** Umbrales (probados con 1 174 fotos: ver scripts/ml/LEEME.md). */
export const ML_T = {
  /** SÍ: probabilidad del producto declarado y parecido mínimo con su texto */
  siP: 0.25, siCos: 0.22,
  /** SÍ por variedad (se ven papas, pero no se distingue cuál) */
  varP: 0.45,
  /** NO: otra cosa gana con esta probabilidad y al producto le queda menos de esto */
  noP: 0.30, noRest: 0.05,
  /** NO: el parecido con el producto es muy bajo */
  noCos: 0.18,
  /** foto de catálogo (fondo blanco): probabilidad desde la que se avisa */
  white: 0.90,
  /** misma foto que la de otra publicación: huellas (dHash de 64 bits) casi iguales, o parecidas y con el mismo contenido para el modelo */
  dupHash: 6, dupHashNear: 12, dupCos: 0.93,
  /** foto oscura (luz promedio de 0 a 255) y movida (nitidez) */
  dark: 45, blur: 10,
};

export const ML_DECISION_LABEL: Record<MlDecision, string> = { PUBLICAR: 'Se puede publicar', REVISAR: 'Revisar antes de publicar', NO_PUBLICAR: 'No publicar' };
export const ML_MATCH_LABEL: Record<MlMatch, string> = { SI: 'Muestra el producto', DUDA: 'No se distingue bien', NO: 'No corresponde', SIN_ANALIZAR: 'Sin analizar' };
export const ML_IMAGE_SIZE = 224;
/** Normalización de CLIP (media y desviación por canal RGB). */
export const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
export const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];

/* ---------------- Modelo (etiquetas) ---------------- */

function b64bytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** float16 (como se guardan los vectores de las etiquetas) a float32. */
function f16(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}

/** Lee labels.json (lo arma scripts/ml/export_labels.py). */
export function parseMlModel(j: any): MlModel {
  const labels: MlLabel[] = (j?.labels ?? []).map((l: any) => ({ id: String(l.id), es: String(l.es), group: l.group }));
  const dim = Number(j?.dim) || 512;
  const emb = f16(b64bytes(String(j?.emb ?? '')));
  const white = f16(b64bytes(String(j?.white ?? '')));
  if (!labels.length || emb.length !== labels.length * dim || white.length !== 2 * dim) throw new Error('labels.json del modelo no es válido');
  return { name: String(j.model ?? 'CLIP'), dim, scale: Number(j.scale) || 100, labels, similar: j.similar ?? {}, variety: j.variety ?? [], emb, white, index: new Map(labels.map((l, i) => [l.id, i])) };
}

/* ---------------- Imagen ---------------- */

/** Píxeles RGB(A) de 224×224 a la entrada del modelo: [3, 224, 224] normalizado como CLIP. */
export function toPixels(rgb: ArrayLike<number>, channels: 3 | 4, size = ML_IMAGE_SIZE): Float32Array {
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (rgb[i * channels + c] / 255 - CLIP_MEAN[c]) / CLIP_STD[c];
  return out;
}

/** Luz promedio (0 a 255) y nitidez (varianza del laplaciano) de la foto de 224×224. */
export function photoQuality(rgb: ArrayLike<number>, channels: 3 | 4, size = ML_IMAGE_SIZE): { light: number; sharp: number } {
  const g = new Float32Array(size * size);
  let sum = 0;
  for (let i = 0; i < size * size; i++) { const y = 0.299 * rgb[i * channels] + 0.587 * rgb[i * channels + 1] + 0.114 * rgb[i * channels + 2]; g[i] = y; sum += y; }
  let s1 = 0, s2 = 0, k = 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    const v = g[i - 1] + g[i + 1] + g[i - size] + g[i + size] - 4 * g[i];
    s1 += v; s2 += v * v; k++;
  }
  return { light: Math.round(sum / (size * size)), sharp: Math.round((s2 / k - (s1 / k) ** 2) / 10) };
}

/**
 * Huella de la foto (dHash de 64 bits, en hexadecimal) a partir de la foto en gris de 9×8: cambia muy
 * poco si la foto se recomprime, se achica o se aclara, y mucho entre fotos distintas.
 */
export function dHash(gray: ArrayLike<number>): string {
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
/** Bits distintos entre dos huellas (0 = la misma foto). */
export function hamming(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 64;
  let d = 0;
  for (let i = 0; i < 16; i += 2) { let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}
/** ¿Es la misma foto (copiada)? Huella casi igual, o parecida y con el mismo contenido para el modelo. */
export const sameImage = (dist: number, cos: number) => dist <= ML_T.dupHash || (dist <= ML_T.dupHashNear && cos >= ML_T.dupCos);

/** Parecido (coseno) entre dos vectores de fotos. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

/* ---------------- Decisión por foto ---------------- */

export interface MlJudgement {
  match: Exclude<MlMatch, 'SIN_ANALIZAR'>;
  /** probabilidad del producto declarado (con sus variedades) */
  declared: number;
  sees: MlSee[];
  /** etiqueta más probable */
  top: MlLabel;
  topP: number;
  /** probabilidad de que sea una foto de catálogo con fondo blanco */
  white: number;
  /** la foto muestra otra variedad del mismo producto */
  otherVariety?: MlLabel;
  /** seguridad de la conclusión (0 a 1) */
  sure: number;
}

/** Qué ve el modelo en una foto (vector de la foto) y si muestra el producto declarado. */
export function judgePhoto(m: MlModel, img: ArrayLike<number>, productId: string): MlJudgement {
  const L = m.labels.length, D = m.dim;
  let norm = 0;
  for (let k = 0; k < D; k++) norm += img[k] * img[k];
  norm = Math.sqrt(norm) || 1;
  const cos = new Float32Array(L);
  for (let i = 0; i < L; i++) { let s = 0; for (let k = 0; k < D; k++) s += m.emb[i * D + k] * img[k]; cos[i] = s / norm; }
  let mx = -Infinity;
  for (let i = 0; i < L; i++) mx = Math.max(mx, m.scale * cos[i]);
  const P = new Float32Array(L);
  let tot = 0;
  for (let i = 0; i < L; i++) { P[i] = Math.exp(m.scale * cos[i] - mx); tot += P[i]; }
  for (let i = 0; i < L; i++) P[i] /= tot;
  let wa = 0, wb = 0;
  for (let k = 0; k < D; k++) { wa += m.white[k] * img[k]; wb += m.white[D + k] * img[k]; }
  const white = 1 / (1 + Math.exp(-m.scale * (wa - wb) / norm));

  const d = m.index.get(productId);
  const order = Array.from(P.keys()).sort((a, b) => P[b] - P[a]);
  const top = order[0];
  const sees = order.slice(0, 3).map(i => ({ id: m.labels[i].id, es: m.labels[i].es, p: Math.round(P[i] * 100) }));
  if (d === undefined) return { match: 'DUDA', declared: 0, sees, top: m.labels[top], topP: P[top], white, sure: 0 };
  const varIds = (m.variety.find(g => g.includes(productId)) ?? [productId]).filter(x => x !== productId);
  const vi = varIds.map(x => m.index.get(x)).filter((x): x is number => x !== undefined);
  const si = (m.similar[productId] ?? []).filter(x => !varIds.includes(x)).map(x => m.index.get(x)).filter((x): x is number => x !== undefined);
  const pd = P[d], pv = vi.reduce((a, i) => a + P[i], 0), ps = si.reduce((a, i) => a + P[i], 0);
  const grp = m.labels[top].group;
  let match: MlJudgement['match'];
  let otherVariety: MlLabel | undefined;
  if (cos[d] >= ML_T.siCos && pd >= ML_T.siP) match = 'SI';
  else if (cos[d] >= ML_T.siCos && vi.includes(top) && pd + pv >= ML_T.varP) { match = 'SI'; otherVariety = m.labels[top]; }
  else if (grp === 'duda' && P[top] >= ML_T.noP) match = 'DUDA';
  else if (top !== d && !vi.includes(top) && !si.includes(top) && P[top] >= ML_T.noP && pd + pv + ps < ML_T.noRest) match = 'NO';
  else if (cos[d] < ML_T.noCos && pd + pv + ps < ML_T.noRest) match = 'NO';
  else match = 'DUDA';
  const sure = match === 'SI' ? pd + pv : match === 'NO' ? P[top] : Math.max(pd + pv + ps, P[top]);
  return { match, declared: Math.round((pd + pv) * 100), sees, top: m.labels[top], topP: P[top], white, otherVariety, sure };
}

/* ---------------- Revisión de la publicación ---------------- */

/** Lo que el servidor (o el navegador) sabe de cada foto antes de decidir. */
export interface MlPhotoInput {
  photoId: string;
  /** vector de la foto (sin él: no se pudo analizar) */
  emb?: ArrayLike<number>;
  light?: number;
  sharp?: number;
  /** foto casi igual a la de otra publicación de otro agricultor: de quién es */
  dupOf?: string;
  /** foto de ejemplo de la demo (un dibujo): no se analiza */
  sample?: boolean;
}

const pctTxt = (p: number) => `${Math.round(p)} %`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RANK: Record<MlDecision, number> = { PUBLICAR: 0, REVISAR: 1, NO_PUBLICAR: 2 };
const worse = (a: MlDecision, b: MlDecision): MlDecision => (RANK[a] >= RANK[b] ? a : b);

/** Foto de ejemplo de la demo (dibujada por la app): el modelo no la analiza. */
export const isSamplePhoto = (id: string) => id.startsWith('seed-photo-') || id.startsWith('ph-ej-');

/**
 * Revisión completa: lo que el modelo vio en cada foto, junto con las reglas, y la recomendación.
 * `inputs` va en el orden de las fotos de la publicación (la primera es la portada).
 */
export function mlReview(w: World, l: Listing, inputs: MlPhotoInput[], m: MlModel, t: number, ms?: number): MlReview {
  const prod = product(l.productId);
  const name = prod.name.toLowerCase();
  const photos: MlPhoto[] = [];
  const copies: string[] = [];
  let sure = 1;
  inputs.slice(0, 5).forEach((x, i) => {
    const n = i + 1;
    if (x.sample) { photos.push({ photoId: x.photoId, n, match: 'SIN_ANALIZAR', declared: 0, sees: [], note: 'Foto de ejemplo de la demo (un dibujo): el modelo no la analiza.' }); return; }
    if (!x.emb) { photos.push({ photoId: x.photoId, n, match: 'SIN_ANALIZAR', declared: 0, sees: [], note: 'La foto no llegó al servidor: no se pudo analizar. Mírala tú.' }); return; }
    const j = judgePhoto(m, x.emb, l.productId);
    let match: MlMatch = j.match;
    let note: string;
    const top = j.sees[0];
    if (j.match === 'SI') {
      note = j.otherVariety
        ? `Se ve ${prod.id.startsWith('papa') ? 'papa' : name} (${pctTxt(j.declared)}), pero se parece más a ${j.otherVariety.es} (${pctTxt(j.topP * 100)}): revisa la variedad.`
        : `Se ve ${name} (${pctTxt(j.declared)}).`;
    } else if (j.match === 'NO') {
      note = `Se ve ${j.top.es} (${pctTxt(j.topP * 100)}), no ${name}.`;
    } else if (j.top.group === 'duda') {
      note = `${cap(j.top.es)} (${pctTxt(j.topP * 100)}): no se ve ${name} con claridad.`;
    } else if (j.top.id === l.productId) {
      note = `Podría ser ${name}, pero el modelo no está seguro (${pctTxt(j.declared)}).`;
    } else {
      note = `No se distingue bien: se parece a ${j.top.es} (${pctTxt(j.topP * 100)}); ${name} ${pctTxt(j.declared)}.`;
    }
    if (x.dupOf) { match = 'NO'; note = 'Es casi la misma foto que la de otra publicación: parece copiada. ' + note; copies.push(`La foto ${n} es casi igual a una de ${x.dupOf}.`); }
    if (match === 'SI' && j.white >= ML_T.white) { match = 'DUDA'; note += ' Parece foto de catálogo o de internet (producto sobre fondo blanco), no de la cosecha.'; }
    if (x.light !== undefined && x.light < ML_T.dark) note += ' La foto está muy oscura.';
    else if (x.sharp !== undefined && x.sharp < ML_T.blur) note += ' La foto está movida o borrosa.';
    sure = Math.min(sure, x.dupOf ? 0.97 : j.sure);
    photos.push({ photoId: x.photoId, n, match, declared: j.declared, sees: j.sees, note });
  });

  const done = photos.filter(p => p.match !== 'SIN_ANALIZAR');
  const nNo = done.filter(p => p.match === 'NO').length, nDuda = done.filter(p => p.match === 'DUDA').length;
  const copied = inputs.some(x => !!x.dupOf);
  // lo que dicen las fotos
  // la portada que no corresponde (o todas, o una copiada): no se publica así
  const coverBad = photos[0]?.match === 'NO';
  let decision: MlDecision = !done.length ? 'REVISAR' : nNo === done.length || copied || coverBad ? 'NO_PUBLICAR' : nNo || nDuda ? 'REVISAR' : 'PUBLICAR';
  if (!done.length) sure = 0.5;
  // y lo que dicen las reglas (precio, cantidad, cosecha, historial)
  const rules = rulesReview(w, l, t);
  // de las reglas, «fotos» solo si dice algo que el modelo no ve (sin fotos, de la galería, repetidas)
  const ruleChecks = rules.checks.filter(c => c.key !== 'fotos' || !l.photoIds.length || c.ok !== true);
  if (rules.checks.some(c => c.ok === false)) decision = worse(decision, 'NO_PUBLICAR');
  else if (rules.checks.some(c => c.ok === null)) decision = worse(decision, 'REVISAR');

  const reasons: ReviewCheck[] = [
    ...photos.map(p => ({ key: `foto${p.n}`, label: p.n === 1 ? 'Foto 1 (portada)' : `Foto ${p.n}`, ok: p.match === 'SI' ? true : p.match === 'NO' ? false : null, detail: p.note })),
    ...ruleChecks.map(c => ({ ...c })),
  ];

  // notas para el equipo
  const notes: string[] = [...copies];
  const bad = photos.filter(p => p.match === 'NO');
  if (bad.length && bad.length < done.length) notes.push(`${bad.length === 1 ? `La foto ${bad[0].n} no corresponde` : `Las fotos ${bad.map(p => p.n).join(' y ')} no corresponden`}${done.every(p => p.match !== 'DUDA') ? `; las demás sí muestran ${name}` : ''}: puedes pedir que ${bad.length === 1 ? 'la quite' : 'las quite'}${coverBad ? ' y que ponga de portada una foto de su cosecha' : ''}.`);
  if (photos.some(p => p.match === 'SI' && /variedad/.test(p.note))) notes.push('El modelo reconoce el producto, pero distingue mal las variedades (amarilla, blanca, nativa): confírmalo en la foto.');
  if (photos.some(p => /catálogo/.test(p.note))) notes.push('Una foto parece sacada de internet: pide una foto real de la cosecha, tomada con la app.');
  if (photos.some(p => p.match === 'SIN_ANALIZAR')) notes.push(photos.every(p => p.match === 'SIN_ANALIZAR') ? 'No hubo fotos que analizar: decide mirando la publicación.' : 'Hay fotos que el modelo no analizó: míralas tú.');
  if (l.photoIds.some(id => id.startsWith('ph-gal-'))) notes.push('Hay fotos elegidas de la galería del celular (no tomadas con la app): pueden ser de otra fecha o de internet.');
  if (prod.id === 'olluco' || prod.id === 'oca' || prod.id === 'chuno') notes.push(`El modelo conoce poco ${name === 'chuño' ? 'el chuño' : `la ${name}`} (cultivo andino): su opinión pesa menos.`);

  const farmerMessage = farmerHint(photos, rules.farmerMessage, name);
  return { at: t, model: m.name, decision, confidence: Math.round(sure * 100), photos, reasons, notes, farmerMessage, ms: ms === undefined ? undefined : Math.round(ms) };
}

function farmerHint(photos: MlPhoto[], rulesMsg: string | undefined, name: string): string | undefined {
  const no = photos.filter(p => p.match === 'NO');
  if (no.some(p => /copiada/.test(p.note))) return `Pon fotos tuyas de esta cosecha de ${name}: una foto se parece a la de otra persona.`;
  if (no.length) return `${no.length === 1 ? `La foto ${no[0].n} no muestra` : `Las fotos ${no.map(p => p.n).join(' y ')} no muestran`} tu ${name}. Toma una foto de tu cosecha con la app y vuelve a enviarla.`;
  if (photos.some(p => /catálogo/.test(p.note))) return `Toma una foto real de tu ${name} con la app (no una de internet).`;
  if (photos.some(p => /oscura|movida/.test(p.note))) return `Toma otra foto de tu ${name} con más luz y sin mover el celular.`;
  if (rulesMsg) return rulesMsg;
  if (photos.some(p => p.match === 'DUDA')) return `En la foto no se ve bien tu ${name}: toma una foto de cerca, con buena luz.`;
  return undefined;
}

/** Recomendación en palabras simples (la primera línea de la tarjeta del panel). */
export function mlHeadline(r: MlReview, productName: string): string {
  const name = productName.toLowerCase();
  const no = r.photos.filter(p => p.match === 'NO');
  const firstBad = r.reasons.find(c => c.ok === false && !c.key.startsWith('foto'));
  if (r.decision === 'PUBLICAR') return `Las fotos muestran ${name} y las reglas no ven nada raro: se puede publicar.`;
  if (r.decision === 'NO_PUBLICAR') {
    if (no.length) return `No la dejes publicar: ${no.length === r.photos.length ? (no.length === 1 ? 'la foto no muestra' : 'ninguna foto muestra') : `la foto ${no[0].n} no muestra`} ${name}${/copiada/.test(no[0].note) ? ' (parece copiada)' : ''}.`;
    return `No la dejes publicar así: ${firstBad ? `${firstBad.label.toLowerCase()} — ${firstBad.detail.replace(/\.$/, '')}` : 'las reglas marcan un problema'}.`;
  }
  const d = r.photos.find(p => p.match === 'DUDA' || p.match === 'NO' || p.match === 'SIN_ANALIZAR');
  if (d) return `Revísala antes de publicar: foto ${d.n} — ${d.note.replace(/\.$/, '')}.`;
  const rule = r.reasons.find(c => c.ok === null && !/^foto\d/.test(c.key));
  return rule ? `Revísala antes de publicar: ${rule.label.toLowerCase()} — ${rule.detail.replace(/\.$/, '')}.` : 'Revísala antes de publicar: las reglas piden mirar con cuidado.';
}

/** La revisión que manda el servidor (o el navegador en la demo): solo campos conocidos y textos cortos. */
export function cleanMl(x: any, t: number): MlReview {
  const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const matches: MlMatch[] = ['SI', 'DUDA', 'NO', 'SIN_ANALIZAR'];
  const decisions: MlDecision[] = ['PUBLICAR', 'REVISAR', 'NO_PUBLICAR'];
  const photos: MlPhoto[] = (Array.isArray(x?.photos) ? x.photos : []).slice(0, 5).map((p: any, i: number) => ({
    photoId: str(p?.photoId, 80), n: num(p?.n || i + 1, 1, 5), match: matches.includes(p?.match) ? p.match : 'SIN_ANALIZAR', declared: num(p?.declared, 0, 100),
    sees: (Array.isArray(p?.sees) ? p.sees : []).slice(0, 3).map((s: any) => ({ id: str(s?.id, 30), es: str(s?.es, 80), p: num(s?.p, 0, 100) })),
    note: str(p?.note, 300),
  }));
  const reasons: ReviewCheck[] = (Array.isArray(x?.reasons) ? x.reasons : []).slice(0, 12).map((k: any) => ({
    key: str(k?.key, 30) || 'ml', label: str(k?.label, 40) || 'Modelo', ok: k?.ok === true ? true : k?.ok === false ? false : null, detail: str(k?.detail, 400),
  }));
  return {
    at: t, model: str(x?.model, 80) || 'CLIP', decision: decisions.includes(x?.decision) ? x.decision : 'REVISAR', confidence: num(x?.confidence, 0, 100),
    photos, reasons, notes: (Array.isArray(x?.notes) ? x.notes : []).slice(0, 6).map((s: unknown) => str(s, 300)).filter(Boolean),
    farmerMessage: str(x?.farmerMessage, 300) || undefined, ms: x?.ms === undefined ? undefined : num(x.ms, 0, 3_600_000),
  };
}

/** Lo que muestra la cola del panel: lo peor entre la revisión automática y la del modelo. */
export function reviewVerdict(r: ListingReview): ReviewVerdict {
  const ml: ReviewVerdict | undefined = r.mlState === 'LISTA' && r.ml ? ({ PUBLICAR: 'OK', REVISAR: 'OBSERVAR', NO_PUBLICAR: 'RECHAZAR' } as const)[r.ml.decision] : undefined;
  const rank: Record<ReviewVerdict, number> = { OK: 0, OBSERVAR: 1, RECHAZAR: 2 };
  return ml && rank[ml] > rank[r.auto.verdict] ? ml : r.auto.verdict;
}
