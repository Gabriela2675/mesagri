/* Identificadores. El engine solo usa funciones deterministas (hash del id del evento),
 * para que todos los celulares reconstruyan el mismo mundo. */

const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Pseudoaleatorio determinista a partir de una semilla de texto. */
export function rng(seed: string): () => number {
  let a = hashStr(seed) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Códigos secretos (entrega, recojo, QR). El servidor los genera al azar y los manda dentro de la
 * acción (p.secrets); sin ellos (celular sin señal, pruebas) se derivan del id, para que todos los
 * celulares lleguen al mismo resultado.
 */
export function secretOr(given: unknown, re: RegExp, fallback: () => string): string {
  return typeof given === 'string' && re.test(given) ? given : fallback();
}

/** Huella de 53 bits (cyrb53): rápida, igual en el navegador y en el servidor. */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Códigos sellados. A quien no debe conocer un código (el transportista no conoce el código de
 * entrega del comprador; el comprador no conoce el QR del agricultor) el servidor le manda solo su
 * huella: su celular puede comprobar el código que le dictan, pero no leerlo.
 */
export function sealCode(code: string, salt: string): string {
  return '#' + cyrb53(salt + '|' + String(code ?? '').trim().toUpperCase()).toString(36);
}
export const isSealed = (s: unknown): boolean => typeof s === 'string' && s.startsWith('#');
/** ¿El código escrito es el esperado? Funciona con el código o con su huella. */
export function codeMatches(expected: string | undefined, typed: unknown, salt: string): boolean {
  if (!expected) return false;
  const t = String(typed ?? '').trim();
  if (!t) return false;
  return isSealed(expected) ? sealCode(t, salt) === expected : t.toUpperCase() === expected.toUpperCase();
}
/** Sal de cada código (el mismo código en dos pedidos da huellas distintas). */
export const CODE_SALT = { delivery: (subOrderId: string) => subOrderId + ':entrega', pickup: (subOrderId: string) => subOrderId + ':recojo', qr: (subOrderId: string) => subOrderId + ':qr', booking: (bookingId: string) => bookingId + ':reserva' };

export function codeFrom(seed: string, len = 6): string {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[Math.floor(r() * ALPHA.length)];
  return s;
}

export function digitsFrom(seed: string, n = 4): string {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += String(Math.floor(r() * 10));
  // evitar códigos triviales (0000, 1111)
  if (/^(\d)\1+$/.test(s)) s = s.slice(0, n - 1) + String((Number(s[n - 1]) + 3) % 10);
  return s;
}

/** Id aleatorio para crear entidades desde la app (no se usa dentro del engine). */
export function uid(prefix = ''): string {
  const c: { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined = (globalThis as any).crypto;
  let r = '';
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(10);
    c.getRandomValues(b);
    for (const x of b) r += ALPHA[x % ALPHA.length];
  } else {
    for (let i = 0; i < 10; i++) r += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return prefix ? `${prefix}-${r.toLowerCase()}` : r.toLowerCase();
}

export function pad(n: number, w: number): string { return String(n).padStart(w, '0'); }
