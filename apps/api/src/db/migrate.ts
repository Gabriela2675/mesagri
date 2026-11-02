/*
 * Migraciones versionadas (14.1): aplica en orden los archivos db/migrations/NNNN_*.sql que falten
 * y los registra en schema_migrations. Crea la base si falta; el usuario de mínimos privilegios lo
 * crea el instalador (INSTALAR.cmd) o la imagen de MySQL (infra/docker-compose.yml).
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { CONFIG } from '../config';
import { connOptions } from './db';

export const MIGRATIONS_DIR = [path.resolve(__dirname, '../../../../db/migrations'), path.resolve(process.cwd(), 'db/migrations'), path.resolve(process.cwd(), '../../db/migrations')].find(d => fs.existsSync(d)) ?? path.resolve(__dirname, '../../../../db/migrations');

/** Divide un archivo SQL en sentencias (sin procedimientos ni DELIMITER). */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '', inStr: string | null = null;
  const lines = sql.replace(/\r\n/g, '\n').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  for (let i = 0; i < lines.length; i++) {
    const ch = lines[i];
    if (inStr) { cur += ch; if (ch === inStr && lines[i - 1] !== '\\') inStr = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; cur += ch; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function migrate(opts: { database?: string; log?: (m: string) => void } = {}): Promise<string[]> {
  const database = opts.database ?? CONFIG.db.database;
  const log = opts.log ?? (() => undefined);
  const c = await mysql.createConnection({ ...connOptions(), timezone: 'Z', charset: 'utf8mb4_0900_ai_ci' });
  try {
    await c.query("SET time_zone = '+00:00'");
    // en la nube la base ya existe (y el usuario puede no tener permiso para crear otras)
    const [have] = await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if (!(have as any[]).length) await c.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await c.query(`USE \`${database}\``);
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) COMMENT='Migraciones aplicadas'`);
    const [done] = await c.query('SELECT version FROM schema_migrations');
    const applied = new Set((done as any[]).map(r => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
    const ran: string[] = [];
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      for (const stmt of splitSql(sql)) await c.query(stmt);
      await c.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      log(`Migración aplicada: ${version}`);
      ran.push(version);
    }
    return ran;
  } finally {
    await c.end();
  }
}

/** Borra todo y vuelve a crear la base (reinicio de la demo desde la línea de comandos). */
export async function dropDatabase(database = CONFIG.db.database) {
  const c = await mysql.createConnection(connOptions());
  try { await c.query(`DROP DATABASE IF EXISTS \`${database}\``); } finally { await c.end(); }
}
