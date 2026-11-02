/*
 * Intérprete de frases para publicar con la voz (6.4, 14.8). Extrae producto, cantidad, unidad,
 * precio, fecha de cosecha y calidad, con una confianza por campo. Nunca publica solo:
 * el agricultor confirma en A-11 (RF-VOZ-04).
 *
 * Incluye las 6 reglas que faltaron en el experimento H2 de la sesión 05:
 *   1. precios sin «soles» («a dos cincuenta el kilo», «a uno cincuenta»)
 *   2. diminutivos («cebollita», «papitas», «kilitos», «saquitos»)
 *   3. «y medio» («dos kilos y medio», «saco y medio»)
 *   4. «medio saco» (25 kg)
 *   5. precio por saco («a 120 el saco») → se convierte a precio por kilo
 *   6. «hace una semana» (y «la semana pasada», «hace dos semanas», días de la semana)
 */
import type { Unit, Quality } from './types';
import { PRODUCTS, product, ARROBA_KG } from './catalog';
import { DAY, lima, startOfDay } from './time';

export interface VoiceResult {
  text: string;
  productId?: string;
  variety?: string;
  qty?: number;
  unit?: Unit;
  unitKg?: number;
  qtyKg?: number;
  pricePerKg?: number;
  priceSaid?: { amount: number; per: 'kg' | 'saco' | 'arroba' | 'jaba' };
  harvestDaysAgo?: number;
  quality?: Quality;
  confidence: { product: number; qty: number; price: number; harvest: number };
  notes: string[];
  /** Hay producto y cantidad: se pasa directo a confirmar (corrige D-04). */
  complete: boolean;
}

type UnitWord = { unit: Unit | 'quintal' | 'tonelada'; kg?: number };
const UNITS: Record<string, UnitWord> = {
  kilo: { unit: 'kg' }, kilos: { unit: 'kg' }, kg: { unit: 'kg' }, kgs: { unit: 'kg' }, kilogramo: { unit: 'kg' }, kilogramos: { unit: 'kg' },
  saco: { unit: 'saco' }, sacos: { unit: 'saco' }, costal: { unit: 'saco' }, costales: { unit: 'saco' },
  arroba: { unit: 'arroba', kg: ARROBA_KG }, arrobas: { unit: 'arroba', kg: ARROBA_KG },
  jaba: { unit: 'jaba' }, jabas: { unit: 'jaba' }, caja: { unit: 'jaba' }, cajas: { unit: 'jaba' },
  quintal: { unit: 'quintal', kg: 46 }, quintales: { unit: 'quintal', kg: 46 },
  tonelada: { unit: 'tonelada', kg: 1000 }, toneladas: { unit: 'tonelada', kg: 1000 },
  atado: { unit: 'atado' }, atados: { unit: 'atado' },
};

/** Diminutivos y formas coloquiales → palabra base (regla 2). */
const DIMINUTIVES: Record<string, string> = {
  papita: 'papa', papitas: 'papas', cebollita: 'cebolla', cebollitas: 'cebollas', habita: 'haba', habitas: 'habas', choclito: 'choclo', choclitos: 'choclos',
  tomatito: 'tomate', tomatitos: 'tomates', zanahorita: 'zanahoria', zanahoritas: 'zanahorias', quinuita: 'quinua', frejolito: 'frejol', frejolitos: 'frejoles',
  frijolito: 'frijol', frijolitos: 'frijoles', arrocito: 'arroz', olluquito: 'olluco', olluquitos: 'ollucos', ajito: 'ajo', ajitos: 'ajos', ocita: 'oca', ocitas: 'ocas',
  kilito: 'kilo', kilitos: 'kilos', saquito: 'saco', saquitos: 'sacos', costalito: 'costal', jabita: 'jaba', jabitas: 'jabas', rocotito: 'rocoto', rocotitos: 'rocotos',
  solcito: 'sol', solcitos: 'soles', centimito: 'centimo', centimitos: 'centimos', poquito: 'poco', ahorita: 'ahora', amarillita: 'amarilla', amarillitas: 'amarillas',
  blanquita: 'blanca', blanquitas: 'blancas', rojita: 'roja', rojitas: 'rojas', zapallito: 'zapallo',
};

const UNITS_WORDS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = { cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900 };
const FILLERS = new Set(['este', 'pues', 'oiga', 'mire', 'ya', 'eh', 'mmm', 'ah', 'bueno', 'senorita', 'joven', 'caserita', 'casera', 'ps', 'nomas', 'oye', 'mamita', 'papito', 'hermano', 'amigo']);

export function stripAccents(s: string): string { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function isNumWord(w: string) { return w in UNITS_WORDS || w in TENS || w in HUNDREDS || w === 'mil'; }

function isQuantityContext(tokens: string[], i: number): boolean {
  const next = tokens[i + 1];
  if (!next) return false;
  return next in UNITS || next === 'sol' || next === 'soles' || isNumWord(next) || next === 'y';
}

/**
 * Convierte palabras numéricas en números: «doscientos cincuenta» → 250, «dos mil quinientos» → 2500.
 * Dos números seguidos que no forman uno solo quedan separados: «uno cincuenta» → 1 y 50 (soles y céntimos).
 */
export function wordsToNumbers(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i];
    if (!isNumWord(w) || ((w === 'un' || w === 'una') && !isQuantityContext(tokens, i))) { out.push(w); i++; continue; }
    let total = 0, current = 0, used = 0, j = i;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t in HUNDREDS) { if (used && current % 1000 !== 0) break; current += HUNDREDS[t]; j++; used++; continue; }
      if (t in TENS) {
        if (used && current % 100 !== 0) break;
        current += TENS[t]; j++; used++;
        if (tokens[j] === 'y' && tokens[j + 1] in UNITS_WORDS && UNITS_WORDS[tokens[j + 1]] < 10) { current += UNITS_WORDS[tokens[j + 1]]; j += 2; used += 2; }
        continue;
      }
      if (t in UNITS_WORDS) {
        if (used && (current % 100 !== 0 || (current === 0 && total === 0))) break;
        if ((t === 'un' || t === 'una') && used && !isQuantityContext(tokens, j)) break;
        current += UNITS_WORDS[t]; j++; used++; continue;
      }
      if (t === 'mil') { total += (current || 1) * 1000; current = 0; j++; used++; continue; }
      break;
    }
    out.push(String(total + current));
    i = j;
  }
  return out;
}

function normalize(text: string): string[] {
  let s = ' ' + text.toLowerCase() + ' ';
  s = s.replace(/s\/\.?\s*/g, ' soles ').replace(/½/g, ' y medio ');
  s = s.replace(/(\d)\s*kgs?\b/g, '$1 kg').replace(/(\d)\s*kilos?\b/g, '$1 kilos');
  s = s.replace(/(\d+),(\d{1,2})(?!\d)/g, '$1.$2');
  s = s.replace(/[¿?¡!;:"«»()]/g, ' ').replace(/,/g, ' ').replace(/\.(?!\d)/g, ' ');
  let tokens = s.split(/\s+/).filter(Boolean).map(t => stripAccents(t));
  tokens = tokens.map(t => DIMINUTIVES[t] ?? t).filter(t => !FILLERS.has(t));
  return wordsToNumbers(tokens);
}

/** Singular simple para buscar en el catálogo («cebollas» → «cebolla», «frejoles» → «frejol»). */
function singular(t: string): string {
  if (t.length > 4 && /(les|res|nes|des)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

const isNum = (t?: string) => t !== undefined && /^\d+(\.\d+)?$/.test(t);
const PER_WORDS = ['el', 'por', 'cada', 'x', 'al', 'la'];
type Per = 'kg' | 'saco' | 'arroba' | 'jaba';
const perOf = (u: UnitWord): Per => (u.unit === 'saco' ? 'saco' : u.unit === 'arroba' ? 'arroba' : u.unit === 'jaba' ? 'jaba' : 'kg');

export interface VoiceContext { now: number; crops?: string[] }

const GENERIC = ['papa', 'papas', 'arroz', 'frejol', 'frijol', 'frejoles', 'frijoles', 'haba', 'habas', 'maiz', 'cebolla', 'cebollas'];

export function interpret(text: string, ctx: VoiceContext): VoiceResult {
  const tokens = normalize(text);
  const joined = ' ' + tokens.join(' ') + ' ';
  const joinedSing = ' ' + tokens.map(singular).join(' ') + ' ';
  const res: VoiceResult = { text, confidence: { product: 0, qty: 0, price: 0, harvest: 0 }, notes: [], complete: false };
  const used = new Set<number>();

  /* ---------- Producto ---------- */
  const candidates: { pid: string; syn: string; len: number }[] = [];
  for (const p of PRODUCTS) for (const syn of p.synonyms) {
    const n = ' ' + stripAccents(syn.toLowerCase()) + ' ';
    if (joined.includes(n) || joinedSing.includes(n)) candidates.push({ pid: p.id, syn: stripAccents(syn.toLowerCase()), len: syn.length });
  }
  candidates.sort((a, b) => b.len - a.len);
  if (candidates.length) {
    let best = candidates[0];
    const generic = best.syn.split(' ').length === 1 && GENERIC.includes(best.syn);
    if (generic && ctx.crops?.length) {
      const fam = candidates.filter(c => c.syn === best.syn || singular(c.syn) === singular(best.syn)).map(c => c.pid);
      const fromCrops = ctx.crops.find(c => fam.includes(c));
      if (fromCrops) best = { ...best, pid: fromCrops };
    }
    res.productId = best.pid;
    res.confidence.product = generic ? 0.75 : 0.95;
    if (generic) res.notes.push(`Entendí «${best.syn}»: revisa la variedad.`);
    const pr = product(best.pid);
    for (const v of pr.varieties ?? []) if (joined.includes(' ' + stripAccents(v.toLowerCase()) + ' ')) { res.variety = v; break; }
  }

  /* ---------- Precio (reglas 1 y 5) ---------- */
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let r: { amount: number; end: number } | undefined, start = i;
    if ((t === 'a' || t === 'en' || t === 'precio' || t === 'vendo' || t === 'cuesta' || t === 'vale') && isNum(tokens[i + 1]) && !UNITS[tokens[i + 2]]) {
      start = i + 1; r = readPrice(tokens, i + 1);
    } else if (isNum(t) && (tokens[i + 1] === 'soles' || tokens[i + 1] === 'sol' || tokens[i + 1] === 'centimos')) {
      r = readPrice(tokens, i);
    } else if (isNum(t) && PER_WORDS.includes(tokens[i + 1]) && UNITS[tokens[i + 2]] && !(i > 0 && isNum(tokens[i - 1]))) {
      // «cebolla 50 kilos, 1.50 el kilo»: un número seguido de «el kilo» es un precio
      r = { amount: Number(t), end: i };
    }
    if (!r) continue;
    let per: Per = 'kg';
    let explicitPer = false;
    for (let k = r.end + 1; k <= r.end + 3 && k < tokens.length; k++) {
      const u = UNITS[tokens[k]];
      if (u && (PER_WORDS.includes(tokens[k - 1]) || k === r.end + 1)) { per = perOf(u); explicitPer = true; break; }
      if (isNum(tokens[k])) break;
    }
    // «el kilo a 2», «el saco a 120»
    if (!explicitPer && start >= 2) {
      const before = tokens.slice(Math.max(0, start - 3), start - 1);
      if (before.length >= 2 && PER_WORDS.includes(before[before.length - 2]) && UNITS[before[before.length - 1]]) { per = perOf(UNITS[before[before.length - 1]]); explicitPer = true; }
    }
    for (let k = start - 1; k <= r.end; k++) used.add(k);
    res.priceSaid = { amount: r.amount, per };
    res.confidence.price = explicitPer ? 0.9 : 0.75;
    break;
  }

  /* ---------- Cantidad (reglas 3 y 4) ---------- */
  let qty: number | undefined, unit: Unit | undefined, unitKg: number | undefined, qConf = 0;
  const yMedio = (k: number) => tokens[k] === 'y' && (tokens[k + 1] === 'medio' || tokens[k + 1] === 'media');
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    const t = tokens[i];
    // «medio saco», «media arroba»
    if ((t === 'medio' || t === 'media') && UNITS[tokens[i + 1]] && !used.has(i + 1)) {
      const u = UNITS[tokens[i + 1]];
      qty = 0.5; unit = toUnit(u.unit); unitKg = u.kg; qConf = 0.9; used.add(i); used.add(i + 1);
      break;
    }
    // «saco y medio» (sin número delante)
    if (UNITS[t] && !isNum(tokens[i - 1]) && !PER_WORDS.includes(tokens[i - 1] ?? '') && yMedio(i + 1)) {
      const u = UNITS[t];
      qty = 1.5; unit = toUnit(u.unit); unitKg = u.kg; qConf = 0.85; [i, i + 1, i + 2].forEach(x => used.add(x));
      break;
    }
    if (!isNum(t)) continue;
    let n = Number(t);
    const u = UNITS[tokens[i + 1]];
    if (u && !used.has(i + 1)) {
      used.add(i); used.add(i + 1);
      let k = i + 2;
      if (yMedio(k)) { n += 0.5; used.add(k); used.add(k + 1); k += 2; }
      // «saco de 100 kilos»
      let ukg = u.kg;
      if (u.unit === 'saco' && tokens[k] === 'de' && isNum(tokens[k + 1]) && UNITS[tokens[k + 2]]?.unit === 'kg') { ukg = Number(tokens[k + 1]); used.add(k + 1); used.add(k + 2); }
      qty = n; unit = toUnit(u.unit); unitKg = ukg; qConf = 0.9;
      break;
    }
    // «dos y medio kilos»
    if (yMedio(i + 1) && UNITS[tokens[i + 3]]) {
      const uu = UNITS[tokens[i + 3]];
      qty = n + 0.5; unit = toUnit(uu.unit); unitKg = uu.kg; qConf = 0.85; [i, i + 1, i + 2, i + 3].forEach(x => used.add(x));
      break;
    }
    // número sin unidad: se asume kilos, con baja confianza
    if (qty === undefined && tokens[i - 1] !== 'hace' && !['dias', 'dia', 'semanas', 'semana', 'meses', 'mes'].includes(tokens[i + 1] ?? '')) { qty = n; unit = 'kg'; qConf = 0.5; used.add(i); }
  }
  if (qty !== undefined && unit) {
    const pid = res.productId;
    const big = unitKg === 46 || unitKg === 1000;
    if (unit === 'saco') unitKg = unitKg ?? (pid ? product(pid).sackKg : 50);
    if (unit === 'jaba') unitKg = unitKg ?? (pid ? product(pid).jabaKg ?? 25 : 25);
    if (unit === 'arroba') unitKg = ARROBA_KG;
    if (unit === 'kg' && !big) unitKg = 1;
    const kgTotal = round(qty * (unitKg ?? 1));
    // quintales y toneladas se pasan a kilos; sacos con fracción también (RN-25: unidades de conteo enteras)
    if (big || (unit !== 'kg' && !Number.isInteger(qty))) {
      const plural = unit === 'saco' ? 'sacos' : unit === 'arroba' ? 'arrobas' : unit === 'jaba' ? 'jabas' : 'atados';
      res.notes.push(!big ? `Los ${plural} van enteros: lo pasé a ${fmtKg(kgTotal)} kg.` : `Lo pasé a ${fmtKg(kgTotal)} kg.`);
      res.qty = kgTotal; res.unit = 'kg'; res.unitKg = 1;
    } else { res.qty = qty; res.unit = unit; res.unitKg = unitKg ?? 1; }
    res.qtyKg = kgTotal;
    res.confidence.qty = qConf;
  }

  /* ---------- Precio por kilo ---------- */
  if (res.priceSaid) {
    let { amount, per } = res.priceSaid;
    const pid = res.productId;
    // un precio muy alto «por kilo» sin unidad dicha suele ser por saco («papa a 120»)
    if (per === 'kg' && res.confidence.price < 0.9 && pid && amount > 30) {
      per = 'saco'; res.priceSaid.per = 'saco'; res.notes.push('Entendí el precio por saco: revisa.');
    }
    const sackKg = pid ? (res.unit === 'saco' && res.unitKg ? res.unitKg : product(pid).sackKg) : 50;
    const perKg = per === 'kg' ? amount : per === 'saco' ? amount / sackKg : per === 'arroba' ? amount / ARROBA_KG : amount / (pid ? product(pid).jabaKg ?? 25 : 25);
    res.pricePerKg = Math.round(perKg * 100) / 100;
    if (per !== 'kg') res.notes.push(`Precio por ${per}: S/ ${amount.toFixed(2).replace('.', ',')} = S/ ${res.pricePerKg.toFixed(2).replace('.', ',')} por kg.`);
  }

  /* ---------- Fecha de cosecha (regla 6) ---------- */
  const h = harvest(joined, ctx.now);
  if (h !== undefined) { res.harvestDaysAgo = h.days; res.confidence.harvest = h.conf; if (h.note) res.notes.push(h.note); }

  /* ---------- Calidad ---------- */
  if (/ (de )?primera | extra | selecta | buena calidad | calidad a /.test(joined)) res.quality = 'PRIMERA';
  else if (/ (de )?segunda | calidad b /.test(joined)) res.quality = 'SEGUNDA';
  else if (/ (de )?tercera | descarte | calidad c /.test(joined)) res.quality = 'TERCERA';

  if (!res.productId) res.notes.push('No entendí el producto: elígelo con su ícono.');
  if (res.qty === undefined) res.notes.push('No entendí la cantidad.');
  if (res.pricePerKg === undefined) res.notes.push('No dijiste el precio: te sugerimos uno.');
  res.complete = !!res.productId && res.qty !== undefined && res.qty > 0;
  return res;
}

function toUnit(u: string): Unit { return (u === 'quintal' || u === 'tonelada') ? 'kg' : (u as Unit); }
function round(n: number) { return Math.round(n * 1000) / 1000; }
function fmtKg(n: number) { return String(n).replace('.', ','); }

/** Lee un precio desde la posición i: «2.50», «2 soles 50», «2 con 50», «2 50» (soles y céntimos), «50 centimos». */
function readPrice(tokens: string[], i: number): { amount: number; end: number } | undefined {
  if (!isNum(tokens[i])) return undefined;
  let a = Number(tokens[i]);
  let end = i;
  if (tokens[i + 1] === 'centimos') return { amount: a / 100, end: i + 1 };
  let k = i + 1;
  if (tokens[k] === 'soles' || tokens[k] === 'sol') { end = k; k++; }
  const joiner = tokens[k] === 'con' || tokens[k] === 'y';
  if (joiner) k++;
  // céntimos: número de 1 o 2 cifras que no es una cantidad con unidad
  if (isNum(tokens[k]) && Number(tokens[k]) < 100 && Number.isInteger(Number(tokens[k])) && Number.isInteger(a) && !UNITS[tokens[k + 1]] && (joiner || end > i || a < 30)) {
    const c = Number(tokens[k]);
    a = a + (tokens[k].length === 1 && c < 10 && !joiner ? c / 10 : c / 100);
    end = k;
    if (tokens[k + 1] === 'centimos') end = k + 1;
  }
  return { amount: Math.round(a * 100) / 100, end };
}

function harvest(joined: string, now: number): { days: number; conf: number; note?: string } | undefined {
  if (/ (cosechad[oa]s? )?(de )?hoy | recien cosechad| esta manana | ahora mismo /.test(joined)) return { days: 0, conf: 0.95 };
  if (/ antier | anteayer | antes de ayer /.test(joined)) return { days: 2, conf: 0.9 };
  if (/ ayer /.test(joined)) return { days: 1, conf: 0.95 };
  if (/ (hace (una|1) semana|la semana pasada|semana pasada) /.test(joined)) return { days: 7, conf: 0.85 };
  const w = joined.match(/ hace (\d+) semanas? /);
  if (w) return { days: Number(w[1]) * 7, conf: 0.8 };
  const d = joined.match(/ hace (\d+) dias? /);
  if (d) return { days: Number(d[1]), conf: 0.9 };
  if (/ hace (un|1) mes /.test(joined)) return { days: 30, conf: 0.7 };
  const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  for (let i = 0; i < days.length; i++) if (joined.includes(` el ${days[i]} `)) {
    const today = lima(now).dow; // 1 = lunes
    let diff = today - (i + 1);
    if (diff <= 0) diff += 7;
    return { days: diff, conf: 0.8, note: `Cosecha del ${days[i]} pasado.` };
  }
  if (/ manana (cosecho|voy a cosechar)| (voy a|vamos a) cosechar /.test(joined)) return { days: -1, conf: 0.6, note: 'Todavía no cosechas: la pre-venta llega en R2. Publica cuando coseches.' };
  return undefined;
}

export function harvestDate(now: number, daysAgo: number | undefined): number {
  return startOfDay(now) - Math.max(0, daysAgo ?? 0) * DAY + 7 * 3600_000;
}

/** Frases de ejemplo para probar sin micrófono (incluyen las 6 reglas nuevas). */
export const SAMPLE_PHRASES = [
  'Tengo 50 kilos de cebolla roja, cosechada hoy, a uno cincuenta el kilo',
  'Papitas amarillas, dos sacos, a dos setenta el kilo',
  'Vendo dos kilos y medio de habas a tres soles',
  'Medio saco de papa blanca a sesenta el saco',
  'Papa amarilla, diez sacos a ciento treinta y cinco el saco, de primera',
  'Cebolla roja doscientos kilos, cosechada hace una semana, a 1.40',
];
