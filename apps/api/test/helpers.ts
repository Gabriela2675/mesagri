/* Ayudas de las pruebas: comparar mundos y preparar una base de prueba. */
import type { World } from '@mesagri/shared';
import { migrate, dropDatabase } from '../src/db/migrate';
import { createPool, tx } from '../src/db/db';
import { writeReference } from '../src/db/store/reference';

/** Forma canónica: claves ordenadas, números redondeados, sin campos undefined. */
export function canon(x: any): any {
  if (x === null || x === undefined) return x;
  if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : String(x);
  if (Array.isArray(x)) return x.map(canon);
  if (typeof x === 'object') {
    const o: any = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = canon(x[k]);
    return o;
  }
  return x;
}

const short = (v: any) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 160 ? s.slice(0, 160) + '…' : s; };

/** Diferencias entre dos valores (rutas), para entender qué no volvió igual de la base. */
export function diff(a: any, b: any, path = '', out: string[] = [], max = 40): string[] {
  if (out.length >= max) return out;
  if (a === b) return out;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) { out.push(`${path}: ${short(a)} ≠ ${short(b)}`); return out; }
  if (ta === 'object' || ta === 'array') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], `${path}.${k}`, out, max);
    return out;
  }
  out.push(`${path}: ${short(a)} ≠ ${short(b)}`);
  return out;
}

/** Diferencias entre dos mundos (sin los rechazos, que no se guardan). */
export function worldDiff(a: World, b: World, max = 40): string[] {
  const x = canon({ ...a, rejected: {} }), y = canon({ ...b, rejected: {} });
  return diff(x, y, 'w', [], max);
}

export async function freshDb(name: string) {
  await dropDatabase(name);
  await migrate({ database: name });
  const pool = createPool(name);
  await tx(pool, c => writeReference(c));
  return pool;
}
