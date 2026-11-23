/*
 * Lugares de Arequipa sin internet: buscador de distritos y centros poblados (INEI) y
 * «¿en qué distrito cae este punto?» para el GPS o el mapa.
 *
 * Los datos pesan (4 727 centros poblados y los límites de 109 distritos): la app los carga
 * solo cuando se abre el buscador (places-data.ts). Este módulo no los importa.
 * Los límites son simplificados: cerca de un borde el distrito puede salir equivocado, por eso
 * se combina con los centros poblados cercanos y se pide confirmar cuando hay duda.
 */
import { DISTRICTS, DISTRICT_BY_CODE, PROVINCES, AREQUIPA_BOX, fold, haversineKm, inBox } from './ubigeo';

export type PlaceKind = 'DISTRITO' | 'CCPP_U' | 'CCPP_R';
export interface Place {
  /** código INEI: 6 dígitos (distrito) o 10 (centro poblado) */
  id: string;
  name: string;
  kind: PlaceKind;
  district: string;
  lat: number;
  lng: number;
}
interface Keys { nf: string; nw: string[]; ns: string[]; cw: string[]; cs: string[] }
export interface PlaceData {
  places: Place[];
  /** distrito → polígonos → anillos → [lng, lat] */
  limits: Record<string, number[][][][]>;
  keys: Keys[];
  grid: Map<string, number[]>;
}

export interface RawCcpp { filas: [string, string, number, number, 'U' | 'R'][] }
export interface RawLimits { distritos: Record<string, number[][][][]> }

/* ---------- texto ---------- */

/** Clave fonética simple del castellano y el quechua escrito: «Yanke» = «Yanque», «Wambo» = «Huambo», «Chivai» = «Chivay». */
export function sound(word: string): string {
  let s = fold(word).replace(/\s+/g, '');
  s = s.replace(/qu(?=[ei])/g, 'k').replace(/gu(?=[ei])/g, 'g').replace(/g(?=[ei])/g, 'j')
    .replace(/q+/g, 'k').replace(/cc/g, 'k').replace(/ch/g, '%').replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/%/g, 'ch')
    .replace(/z/g, 's').replace(/v/g, 'b').replace(/ll/g, 'y').replace(/w/g, 'u').replace(/x/g, 'ks');
  s = s.replace(/ch/g, '%').replace(/h/g, '').replace(/%/g, 'ch');
  s = s.replace(/y(?![aeiou])/g, 'i');
  return s.replace(/(.)\1+/g, '$1');
}

function words(s: string): string[] { return fold(s).split(' ').filter(Boolean); }

/** Distancia de edición (Levenshtein) con salida temprana si pasa de max. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* ---------- datos ---------- */

const CELL = 0.05; // ~5,5 km
const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

export function buildPlaceData(raw: RawCcpp, lim: RawLimits): PlaceData {
  const places: Place[] = DISTRICTS.map(d => ({ id: d.code, name: d.name, kind: 'DISTRITO', district: d.code, lat: d.lat, lng: d.lng }));
  for (const [id, name, lat, lng, t] of raw.filas) {
    const d = DISTRICT_BY_CODE[id.slice(0, 6)];
    if (!d) continue;
    // la capital ya está como distrito (misma ubicación y nombre)
    if (id.endsWith('0001') && (fold(name) === fold(d.name) || fold(name) === fold(d.capital))) continue;
    places.push({ id, name, kind: t === 'U' ? 'CCPP_U' : 'CCPP_R', district: d.code, lat, lng });
  }
  const keys = places.map(p => {
    const d = DISTRICT_BY_CODE[p.district];
    const ctx = `${d.name} ${PROVINCES[d.province].name}${p.kind === 'DISTRITO' ? ' ' + d.capital : ''}`;
    const nw = words(p.name), cw = words(ctx);
    return { nf: fold(p.name), nw, ns: nw.map(sound), cw, cs: cw.map(sound) };
  });
  const grid = new Map<string, number[]>();
  places.forEach((p, i) => {
    const k = cellKey(p.lat, p.lng);
    let a = grid.get(k);
    if (!a) { a = []; grid.set(k, a); }
    a.push(i);
  });
  return { places, limits: lim.distritos, keys, grid };
}

/* ---------- buscar por nombre ---------- */

export interface PlaceHit { place: Place; score: number }

const KIND_BONUS: Record<PlaceKind, number> = { DISTRITO: 1.2, CCPP_U: 0.6, CCPP_R: 0 };

function tokenScore(t: string, st: string, k: Keys, fuzzy: boolean): { name: number; ctx: number } {
  let name = 0;
  for (let i = 0; i < k.nw.length; i++) {
    const w = k.nw[i];
    if (w === t) { name = Math.max(name, 3.5); break; }
    if (w.startsWith(t)) name = Math.max(name, 3);
    else if (st && k.ns[i].startsWith(st)) name = Math.max(name, 2.5);
    else if (fuzzy && t.length >= 4 && editDistance(w.slice(0, t.length + 1), t, t.length >= 7 ? 2 : 1) <= (t.length >= 7 ? 2 : 1)) name = Math.max(name, 1.4);
  }
  if (!name && t.length >= 3 && k.nf.replace(/ /g, '').includes(t)) name = 1;
  let ctx = 0;
  if (!name) {
    for (let i = 0; i < k.cw.length; i++) {
      if (k.cw[i].startsWith(t)) { ctx = 1; break; }
      if (st && k.cs[i].startsWith(st)) ctx = 0.8;
      else if (fuzzy && t.length >= 4 && editDistance(k.cw[i].slice(0, t.length + 1), t, 1) <= 1) ctx = Math.max(ctx, 0.6);
    }
  }
  return { name, ctx };
}

/**
 * Busca distritos y centros poblados. Todas las palabras deben aparecer en el nombre o en
 * «distrito, provincia» («yanque caylloma», «pedregal majes»). Tolera tildes y errores leves.
 */
export function searchPlaces(data: PlaceData, query: string, opts: { limit?: number; near?: { lat: number; lng: number }; district?: string } = {}): PlaceHit[] {
  const limit = opts.limit ?? 8;
  const q = fold(query);
  if (q.replace(/ /g, '').length < 2) return [];
  const toks = q.split(' ').filter(Boolean).filter((t, i, a) => !(t.length === 1 && a.length > 1 && /^(y|e|a|o)$/.test(t)));
  const stop = new Set(['de', 'del', 'la', 'las', 'los', 'el']);
  const main = toks.filter(t => !stop.has(t));
  const use = main.length ? main : toks;
  const st = use.map(sound);
  const run = (fuzzy: boolean) => {
    const out: PlaceHit[] = [];
    for (let i = 0; i < data.places.length; i++) {
      const p = data.places[i];
      if (opts.district && p.district !== opts.district) continue;
      const k = data.keys[i];
      let score = 0, inName = 0;
      let ok = true;
      for (let j = 0; j < use.length; j++) {
        const s = tokenScore(use[j], st[j], k, fuzzy);
        if (!s.name && !s.ctx) { ok = false; break; }
        score += s.name || s.ctx;
        if (s.name) inName++;
      }
      if (!ok || !inName) continue;
      if (k.nf === q) score += 4;
      else if (k.nf.startsWith(q)) score += 3;
      if (inName === use.length) score += 1;
      score += KIND_BONUS[p.kind] - Math.min(1, p.name.length / 80);
      if (opts.near) score += 1.5 * Math.exp(-haversineKm(opts.near.lat, opts.near.lng, p.lat, p.lng) / 30);
      out.push({ place: p, score });
    }
    return out;
  };
  let hits = run(false);
  if (hits.length < limit) {
    const seen = new Set(hits.map(h => h.place.id));
    hits = hits.concat(run(true).filter(h => !seen.has(h.place.id)).map(h => ({ ...h, score: h.score - 1 })));
  }
  hits.sort((a, b) => b.score - a.score || a.place.name.length - b.place.name.length || a.place.name.localeCompare(b.place.name, 'es'));
  // un mismo nombre en el mismo distrito (dos «La Curva»): se queda el primero
  const seenName = new Set<string>();
  const res: PlaceHit[] = [];
  for (const h of hits) {
    const key = fold(h.place.name) + '|' + h.place.district;
    if (seenName.has(key)) continue;
    seenName.add(key);
    res.push(h);
    if (res.length >= limit) break;
  }
  return res;
}

/* ---------- puntos: distrito y lugares cercanos ---------- */

function inRing(x: number, y: number, ring: number[][]): boolean {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

export function inDistrict(data: PlaceData, lat: number, lng: number, code: string): boolean {
  const polys = data.limits[code];
  if (!polys) return false;
  return polys.some(poly => inRing(lng, lat, poly[0]) && !poly.slice(1).some(h => inRing(lng, lat, h)));
}

/** Distancia (km) del punto al borde del distrito. */
export function edgeKm(data: PlaceData, lat: number, lng: number, code: string): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  const px = lng * kx, py = lat * ky;
  let best = Infinity;
  for (const poly of data.limits[code] ?? []) for (const ring of poly) {
    for (let i = 1; i < ring.length; i++) {
      const ax = ring[i - 1][0] * kx, ay = ring[i - 1][1] * ky, bx = ring[i][0] * kx, by = ring[i][1] * ky;
      const dx = bx - ax, dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
  }
  return best;
}

/** Lugares más cercanos a un punto (hasta maxKm). */
export function nearestPlaces(data: PlaceData, lat: number, lng: number, k = 5, maxKm = 15): { place: Place; km: number }[] {
  const r = Math.ceil(maxKm / 5.5);
  const ci = Math.floor(lat / CELL), cj = Math.floor(lng / CELL);
  const out: { place: Place; km: number }[] = [];
  for (let a = ci - r; a <= ci + r; a++) for (let b = cj - r; b <= cj + r; b++) {
    for (const i of data.grid.get(`${a}:${b}`) ?? []) {
      const p = data.places[i];
      const km = haversineKm(lat, lng, p.lat, p.lng);
      if (km <= maxKm) out.push({ place: p, km });
    }
  }
  out.sort((x, y) => x.km - y.km);
  return out.slice(0, k);
}

export interface Located {
  /** dentro de la región Arequipa */
  inside: boolean;
  /** el distrito más probable */
  district?: string;
  /** distritos posibles, el primero es el más probable */
  candidates: string[];
  /** hay duda (cerca de un borde o los pueblos cercanos son de otro distrito): pedir confirmación */
  ambiguous: boolean;
  /** centro poblado o capital más cercano */
  near?: { place: Place; km: number };
}

/** ¿En qué distrito de Arequipa está este punto? Combina los límites con los centros poblados cercanos. */
export function locatePoint(data: PlaceData, lat: number, lng: number): Located {
  if (!inBox(lat, lng, AREQUIPA_BOX)) return { inside: false, candidates: [], ambiguous: false };
  const score = new Map<string, number>();
  const add = (c: string, v: number) => score.set(c, (score.get(c) ?? 0) + v);
  const hits = Object.keys(data.limits).filter(c => inDistrict(data, lat, lng, c));
  for (const c of hits) add(c, 2);
  const nb = nearestPlaces(data, lat, lng, 5, 6);
  for (const n of nb) add(n.place.district, 1 / (1 + n.km));
  if (!score.size) {
    // fuera de todos los polígonos (costa o límites simplificados): el borde más cercano, si está a menos de 4 km
    let best = '', bk = Infinity;
    for (const c of Object.keys(data.limits)) { const e = edgeKm(data, lat, lng, c); if (e < bk) { bk = e; best = c; } }
    if (bk > 4) return { inside: false, candidates: [], ambiguous: false, near: nearestPlaces(data, lat, lng, 1, 40)[0] };
    add(best, 1);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0][1];
  const candidates = ranked.filter(([, v]) => v >= top * 0.15).slice(0, 3).map(([c]) => c);
  // el pueblo más cercano manda si está a menos de 2 km (la capital de Camaná cae en Samuel Pastor según los límites simplificados)
  if (nb[0] && nb[0].km < 2 && !candidates.includes(nb[0].place.district)) candidates.splice(Math.min(1, candidates.length), 0, nb[0].place.district);
  const ambiguous = !hits.length || (hits.length > 0 && edgeKm(data, lat, lng, hits[0]) < 0.8) || (ranked.length > 1 && ranked[1][1] >= 0.6 * top);
  return { inside: true, district: candidates[0], candidates, ambiguous, near: nb[0] ?? nearestPlaces(data, lat, lng, 1, 40)[0] };
}

/** Texto corto de un lugar: «Champi Chico · Cayma, Arequipa». */
export function placeSub(p: Place): string {
  const d = DISTRICT_BY_CODE[p.district];
  const prov = PROVINCES[d.province].name;
  if (p.kind === 'DISTRITO') return d.capital && fold(d.capital) !== fold(d.name.replace(/\s*\(.*\)$/, '')) ? `Distrito · capital ${d.capital} · ${prov}` : `Distrito · provincia de ${prov}`;
  return `${p.kind === 'CCPP_U' ? 'Pueblo' : 'Centro poblado'} · ${d.name}, ${prov}`;
}
