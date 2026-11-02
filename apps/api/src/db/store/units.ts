/*
 * Mapeo entre el "mundo" del motor de reglas y las tablas de MySQL (sección 13).
 *
 * Cada unidad sabe:
 *   - entries(): qué entidades del mundo le tocan (clave → valor). El servidor compara el JSON de
 *     cada valor antes y después de una acción y solo escribe lo que cambió.
 *   - save(): escribe una entidad con sus tablas hijas (INSERT ... ON DUPLICATE KEY UPDATE).
 *   - remove(): borra una entidad que ya no existe.
 *   - append(): para bitácoras de solo agregar (avisos, auditoría, movimientos).
 *   - load(): reconstruye su parte del mundo desde las tablas.
 *
 * Las tablas son la fuente de la verdad: al arrancar, el servidor arma el mundo leyendo las tablas.
 */
import type { World } from '@mesagri/shared';
import type { Conn } from '../db';
import type { IdCache } from './ids';

export interface StoreCtx {
  c: Conn;
  ids: IdCache;
  w: World;
}

export interface Unit {
  name: string;
  /** Tablas que llena esta unidad (para vaciar al reiniciar la demo). */
  tables: string[];
  entries?(w: World): Iterable<[string, unknown]>;
  save?(x: StoreCtx, key: string, cur: any, prev: any | undefined): Promise<void>;
  remove?(x: StoreCtx, key: string, prev: any): Promise<void>;
  append?(x: StoreCtx, prev: World | undefined, cur: World): Promise<void>;
  load(x: StoreCtx): Promise<void>;
}

/** JSON estable para comparar (Infinity se guarda como texto para no confundirlo con null). */
export function sig(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? `#${x}` : x)) ?? 'undefined';
}

export const same = (a: unknown, b: unknown) => sig(a) === sig(b);

/** ¿Cambió este pedazo entre la versión anterior y la nueva? (sin versión anterior: sí). */
export function changed<T>(prev: T | undefined, cur: T, pick: (v: T) => unknown): boolean {
  return prev === undefined || !same(pick(prev), pick(cur));
}

/** Agrupa filas por una columna. */
export function groupBy<T extends Record<string, any>>(list: T[], key: string): Map<any, T[]> {
  const m = new Map<any, T[]>();
  for (const r of list) {
    const k = r[key];
    let a = m.get(k);
    if (!a) { a = []; m.set(k, a); }
    a.push(r);
  }
  return m;
}

export function indexBy<T extends Record<string, any>>(list: T[], key: string): Map<any, T> {
  const m = new Map<any, T>();
  for (const r of list) m.set(r[key], r);
  return m;
}

/** Quita las claves con undefined o null (las columnas NULL no existen en el objeto del dominio). */
export function strip<T extends Record<string, any>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

/** Fecha de la base (Date) → milisegundos; NULL → undefined. */
export const tms = (d: Date | null | undefined): number | undefined => (d ? d.getTime() : undefined);
/** Fecha obligatoria. */
export const tm = (d: Date): number => d.getTime();
/** Booleano opcional (TINYINT NULL). */
export const ob = (x: number | null | undefined): boolean | undefined => (x === null || x === undefined ? undefined : !!x);
/** Número opcional (DECIMAL NULL). */
export const onum = (x: number | null | undefined): number | undefined => (x === null || x === undefined ? undefined : Number(x));
/** Texto opcional. */
export const ostr = (x: string | null | undefined): string | undefined => (x === null || x === undefined ? undefined : x);
/** Booleano a columna opcional. */
export const bn = (x: boolean | undefined): boolean | null => (x === undefined ? null : !!x);
/** Valor opcional a columna (undefined → NULL). */
export const nv = <T>(x: T | undefined | null): T | null => (x === undefined ? null : x);
/** Texto acotado al largo de la columna (lo que escribe la persona puede ser largo). */
export const cut = (x: string | undefined | null, n: number): string | null => (x === undefined || x === null ? null : String(x).slice(0, n));
