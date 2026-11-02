/*
 * Acceso a MySQL con mysql2: grupo de conexiones, transacciones y ayudas para escribir filas.
 * Fechas en UTC, DECIMAL como número y JSON como objeto (13.4).
 */
import mysql, { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { CONFIG } from '../config';

export type Conn = Pool | PoolConnection;
export type Row = Record<string, any>;

/** Datos de conexión (servidor, usuario, clave y cifrado TLS si la base está en la nube). */
export function connOptions(): mysql.ConnectionOptions {
  return { host: CONFIG.db.host, port: CONFIG.db.port, user: CONFIG.db.user, password: CONFIG.db.password, ...(CONFIG.db.ssl ? { ssl: CONFIG.db.ssl } : {}), connectTimeout: 20_000 };
}

export function createPool(database: string = CONFIG.db.database, extra: Partial<mysql.PoolOptions> = {}): Pool {
  const pool = mysql.createPool({
    ...connOptions(),
    database,
    timezone: 'Z',
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: 'utf8mb4_0900_ai_ci',
    connectionLimit: Number(process.env.DB_POOL ?? 8),
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
    idleTimeout: 120_000,
    maxIdle: 2,
    multipleStatements: false,
    ...extra,
  });
  // todas las horas en UTC, también NOW() y CURRENT_TIMESTAMP (la base en la nube puede tener otra zona)
  (pool as any).pool?.on?.('connection', (c: any) => { c.query("SET time_zone = '+00:00'"); });
  return pool;
}

export async function tx<T>(pool: Pool, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    try { await c.rollback(); } catch { /* conexión caída */ }
    throw e;
  } finally {
    c.release();
  }
}

const q = (s: string) => '`' + s + '`';

export async function rows<T = Row>(c: Conn, sql: string, params: any[] = []): Promise<T[]> {
  const [r] = await c.query(sql, params);
  return r as T[];
}

export async function exec(c: Conn, sql: string, params: any[] = []): Promise<ResultSetHeader> {
  const [r] = await c.query(sql, params);
  return r as ResultSetHeader;
}

/**
 * INSERT ... ON DUPLICATE KEY UPDATE por la llave única (uuid u otra). Devuelve el id interno,
 * tanto si insertó como si actualizó (id = LAST_INSERT_ID(id)).
 */
export async function upsert(c: Conn, table: string, row: Row, opts: { keys?: string[]; hasId?: boolean } = {}): Promise<number> {
  const keys = opts.keys ?? ['uuid'];
  const hasId = opts.hasId ?? true;
  const cols = Object.keys(row);
  const upd = cols.filter(k => !keys.includes(k)).map(k => `${q(k)} = nw.${q(k)}`);
  if (hasId) upd.unshift('id = LAST_INSERT_ID(id)');
  if (!upd.length) upd.push(`${q(keys[0])} = nw.${q(keys[0])}`);
  const sql = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) AS nw ON DUPLICATE KEY UPDATE ${upd.join(', ')}`;
  const r = await exec(c, sql, cols.map(k => row[k]));
  return Number(r.insertId);
}

/** Inserta varias filas (mismas columnas) en lotes. */
export async function insertMany(c: Conn, table: string, list: Row[], opts: { chunk?: number; ignore?: boolean } = {}): Promise<void> {
  if (!list.length) return;
  const chunk = opts.chunk ?? 400;
  const cols = Object.keys(list[0]);
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk);
    const sql = `INSERT${opts.ignore ? ' IGNORE' : ''} INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`;
    await exec(c, sql, part.flatMap(r => cols.map(k => r[k])));
  }
}

/* ---------- Conversión de valores del dominio ---------- */

/** ms → Date (DATETIME(3) en UTC). Infinito o vacío → NULL. */
export const dt = (ms: number | undefined | null): Date | null => (ms === undefined || ms === null || !Number.isFinite(ms) ? null : new Date(ms));
/** Date → ms. */
export const ms = (d: Date | null | undefined): number | undefined => (d ? d.getTime() : undefined);
/** Objeto → texto JSON para una columna JSON. */
export const js = (x: unknown): string | null => (x === undefined || x === null ? null : JSON.stringify(x));
export const nul = <T>(x: T | undefined): T | null => (x === undefined ? null : x);
/** TINYINT(1) → boolean (NULL → undefined). */
export const bo = (x: number | null | undefined): boolean | undefined => (x === null || x === undefined ? undefined : !!x);
/** Copia solo los valores definidos (las columnas NULL no aparecen en el objeto del dominio). */
export function clean<T extends Row>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}
