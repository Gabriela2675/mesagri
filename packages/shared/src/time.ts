/*
 * Tiempo en America/Lima (UTC−5, sin horario de verano). RNF-17: se guarda en UTC
 * (milisegundos) y se muestra en hora de Lima, sin depender de la zona del teléfono.
 */
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
const LIMA_OFFSET = -5 * HOUR;

export interface LimaParts { y: number; m: number; d: number; hh: number; mm: number; dow: number }

export function lima(t: number): LimaParts {
  const x = new Date(t + LIMA_OFFSET);
  const dow0 = x.getUTCDay(); // 0 = domingo
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), hh: x.getUTCHours(), mm: x.getUTCMinutes(), dow: dow0 === 0 ? 7 : dow0 };
}

/** Epoch de una fecha/hora de Lima. */
export function limaTime(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return Date.UTC(y, m - 1, d, hh, mm) - LIMA_OFFSET;
}

export function startOfDay(t: number): number { const p = lima(t); return limaTime(p.y, p.m, p.d); }
export function endOfDay(t: number): number { return startOfDay(t) + DAY - 1; }
export function atHour(t: number, hh: number, mm = 0): number { const p = lima(t); return limaTime(p.y, p.m, p.d, hh, mm); }
export function addDays(t: number, n: number): number { return t + n * DAY; }

export function periodOf(t: number): string { const p = lima(t); return `${p.y}-${String(p.m).padStart(2, '0')}`; }
export function periodStart(period: string): number { const [y, m] = period.split('-').map(Number); return limaTime(y, m, 1); }
export function nextPeriod(period: string): string { const [y, m] = period.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
export function prevPeriod(period: string): string { const [y, m] = period.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
export function addMonths(t: number, n: number): number {
  const p = lima(t);
  let y = p.y, m = p.m + n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return limaTime(y, m, Math.min(p.d, dim), p.hh, p.mm);
}

/** Suma días hábiles (lunes a viernes). Plazo del Libro de Reclamaciones (RN-20). */
export function addBusinessDays(t: number, n: number): number {
  let x = t, added = 0;
  while (added < n) { x += DAY; const dow = lima(x).dow; if (dow <= 5) added++; }
  return x;
}

export function businessDaysBetween(from: number, to: number): number {
  if (to <= from) return 0;
  let x = startOfDay(from), n = 0;
  while (x + DAY <= to) { x += DAY; if (lima(x).dow <= 5) n++; }
  return n;
}

export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DOW_SHORT = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const DOW_CHIP = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const DOW_LONG = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}
