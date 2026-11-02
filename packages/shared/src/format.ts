/*
 * Formato de números, dinero y fechas (15.4 · Tipografía · Números).
 * Por defecto: «S/ 1,50» y «S/ 2 500» (coma decimal y espacio de miles) y porcentajes con espacio («3 %»).
 * El documento pide confirmar en las pruebas con usuarios si prefieren el punto decimal (el de Yape):
 * por eso el formato es una preferencia del usuario.
 */
import { lima, MONTHS_SHORT, DOW_SHORT, DAY, startOfDay, HOUR, MIN, MONTHS } from './time';

export type NumMode = 'coma' | 'punto';
const NBSP = ' ';

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function num(n: number, decimals = 0, mode: NumMode = 'coma'): string {
  if (!isFinite(n)) return '—';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [i, d] = fixed.split('.');
  const intS = mode === 'coma' ? group(i, NBSP) : group(i, ',');
  const out = d ? intS + (mode === 'coma' ? ',' : '.') + d : intS;
  return (neg ? '−' : '') + out;
}

/** Número con hasta `max` decimales, sin ceros sobrantes (cantidades en kg admiten 3, RN-25). */
export function numTrim(n: number, max = 3, mode: NumMode = 'coma'): string {
  if (!isFinite(n)) return '—';
  const r = Math.round(n * 10 ** max) / 10 ** max;
  const dec = (String(r).split('.')[1] ?? '').length;
  return num(r, Math.min(dec, max), mode);
}

export function money(n: number, mode: NumMode = 'coma'): string { return 'S/' + NBSP + num(n, 2, mode); }
/** Montos enteros sin decimales («S/ 2 500»); con céntimos si los tiene. */
export function moneyShort(n: number, mode: NumMode = 'coma'): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? 'S/' + NBSP + num(r, 0, mode) : money(r, mode);
}
export function kg(n: number, mode: NumMode = 'coma'): string { return numTrim(n, 1, mode) + NBSP + 'kg'; }
export function pct(r: number, mode: NumMode = 'coma'): string { return numTrim(r * 100, 1, mode) + NBSP + '%'; }

export interface Fmt {
  mode: NumMode;
  num: (n: number, d?: number) => string;
  numTrim: (n: number, max?: number) => string;
  money: (n: number) => string;
  moneyShort: (n: number) => string;
  kg: (n: number) => string;
  pct: (r: number) => string;
}

export function makeFmt(mode: NumMode = 'coma'): Fmt {
  return {
    mode,
    num: (n, d = 0) => num(n, d, mode),
    numTrim: (n, max = 3) => numTrim(n, max, mode),
    money: n => money(n, mode),
    moneyShort: n => moneyShort(n, mode),
    kg: n => kg(n, mode),
    pct: r => pct(r, mode),
  };
}

export const FMT = makeFmt('coma');

/* ---------- Fechas ---------- */
export function hhmm(t: number): string { const p = lima(t); return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`; }
export function dateShort(t: number): string { const p = lima(t); return `${DOW_SHORT[p.dow]} ${p.d} ${MONTHS_SHORT[p.m - 1]}`; }
export function dateNum(t: number): string { const p = lima(t); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`; }
export function dateDM(t: number): string { const p = lima(t); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`; }
export function dateLong(t: number): string { const p = lima(t); return `${p.d} de ${MONTHS[p.m - 1]} de ${p.y}`; }
export function dayMonth(t: number): string { const p = lima(t); return `${p.d} de ${MONTHS[p.m - 1]}`; }

/** «hoy», «ayer», «mañana», o la fecha corta. */
export function relDay(t: number, now: number): string {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return 'hoy';
  if (diff === -1) return 'ayer';
  if (diff === 1) return 'mañana';
  if (diff === -2) return 'anteayer';
  return dateShort(t);
}

export function relDayTime(t: number, now: number): string {
  const r = relDay(t, now);
  return `${r} ${hhmm(t)}`;
}

/** «hace 12 min», «hace 3 h», «hace 2 días» */
export function ago(t: number, now: number): string {
  const d = now - t;
  if (d < MIN) return 'recién';
  if (d < HOUR) return `hace ${Math.floor(d / MIN)} min`;
  if (d < DAY) return `hace ${Math.floor(d / HOUR)} h`;
  const days = Math.floor(d / DAY);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/** «3 h», «1 h 20 min», «45 min», «2 días» */
export function duration(ms: number): string {
  if (ms <= 0) return '0 min';
  const total = Math.max(1, Math.round(ms / MIN));
  if (total < 60) return `${total} min`;
  if (ms < DAY) {
    const h = Math.floor(total / 60), m = total % 60;
    return m >= 5 && h < 10 ? `${h} h ${m} min` : `${Math.round(total / 60)} h`;
  }
  const days = Math.round(ms / DAY);
  return days === 1 ? '1 día' : `${days} días`;
}

export function harvestText(t: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff === 2) return 'Anteayer';
  if (diff === 7) return 'Hace una semana';
  return `Hace ${diff} días`;
}

export function plural(n: number, one: string, many: string): string { return n === 1 ? one : many; }
