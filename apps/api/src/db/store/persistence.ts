/*
 * Persistencia del mundo en MySQL.
 *
 * - load(): arma el mundo leyendo las tablas (fuente de la verdad).
 * - persist(): dentro de una transacción, escribe solo las entidades que cambiaron entre el mundo
 *   anterior y el nuevo (compara su JSON), más lo agregado a las bitácoras.
 * - reset(): vacía los datos (no el catálogo) para reiniciar la demo.
 */
import type { Pool, PoolConnection } from 'mysql2/promise';
import { emptyWorld } from '@mesagri/shared';
import type { World } from '@mesagri/shared';
import { exec, rows } from '../db';
import { IdCache } from './ids';
import { Unit, sig } from './units';
import { stateUnit, settingsUnit, padronUnit, usersUnit, orgsUnit, farmsUnit, casesUnit } from './u-core';
import { listingsUnit, ordersUnit, subOrdersUnit, movementsUnit, reviewsUnit, disputesUnit, ticketsUnit, messagesUnit, complaintsUnit, notifsUnit, auditUnit } from './u-market';
import { statementsUnit, invoicesUnit, usedOpsUnit, proposalsUnit, translationsUnit, favoritesUnit } from './u-billing';
import { bookingsUnit, lotsUnit, releasesUnit, stoIncidentsUnit, shipmentsUnit } from './u-logistics';
import { requestsUnit, schedulesUnit, catalogUnit } from './u-r2';

/** Orden de escritura (respeta las llaves foráneas). Los borrados van en orden inverso. */
export const UNITS: Unit[] = [
  stateUnit, settingsUnit, padronUnit, catalogUnit, usersUnit, orgsUnit, farmsUnit, casesUnit,
  listingsUnit, ordersUnit, subOrdersUnit, movementsUnit, reviewsUnit, disputesUnit, ticketsUnit, messagesUnit, complaintsUnit,
  statementsUnit, invoicesUnit, usedOpsUnit, bookingsUnit, lotsUnit, releasesUnit, stoIncidentsUnit, shipmentsUnit,
  requestsUnit, schedulesUnit, translationsUnit, favoritesUnit, proposalsUnit, notifsUnit, auditUnit,
];

/** Tablas de referencia que no se tocan al reiniciar la demo. */
/** Se conservan al reiniciar la demo: el equipo de Mesagri (cuentas del panel creadas o hechas propias). */
export const KEEP_ON_RESET = ['team_accounts'];
export const REFERENCE_TABLES = ['schema_migrations', 'ubigeo', 'roles', 'units', 'product_categories', 'catalog_products', 'catalog_product_aliases', 'crop_references', 'market_prices'];

type Sigs = Map<string, Map<string, string>>;

export interface PersistStats { saved: number; removed: number; units: string[] }

export class Persistence {
  readonly ids = new IdCache();
  private sigs: Sigs = new Map();

  constructor(readonly pool: Pool) {}

  /** Lee las llaves internas (catálogo, rutas, planes y lo ya guardado). */
  async init(): Promise<void> {
    await this.ids.loadAll(this.pool);
  }

  /** ¿Ya hay un mundo guardado? */
  async hasWorld(): Promise<boolean> {
    const r = await rows(this.pool, "SELECT COUNT(*) AS n FROM system_state WHERE state_key = 'engine'");
    return Number(r[0]?.n ?? 0) > 0;
  }

  /** Arma el mundo desde las tablas. */
  async load(): Promise<World> {
    await this.ids.loadAll(this.pool);
    const w = emptyWorld();
    const x = { c: this.pool, ids: this.ids, w };
    for (const u of UNITS) await u.load(x);
    this.sigs = this.computeSigs(w);
    return w;
  }

  private computeSigs(w: World): Sigs {
    const all: Sigs = new Map();
    for (const u of UNITS) {
      if (!u.entries) continue;
      const m = new Map<string, string>();
      for (const [k, v] of u.entries(w)) m.set(k, sig(v));
      all.set(u.name, m);
    }
    return all;
  }

  /**
   * Escribe lo que cambió entre `prev` y `cur` usando la conexión `c` (dentro de una transacción).
   * Devuelve una función que se llama después del COMMIT para recordar el nuevo estado.
   */
  async persist(c: PoolConnection, prev: World | undefined, cur: World): Promise<{ commit: () => void; stats: PersistStats }> {
    const x = { c, ids: this.ids, w: cur };
    const next: Sigs = new Map();
    const removals: (() => Promise<void>)[] = [];
    const stats: PersistStats = { saved: 0, removed: 0, units: [] };
    const base = prev ? this.sigs : new Map<string, Map<string, string>>();
    for (const u of UNITS) {
      if (u.append) await u.append(x, prev, cur);
      if (!u.entries) continue;
      const old = base.get(u.name) ?? new Map<string, string>();
      const prevVals = prev ? new Map(u.entries(prev)) : new Map<string, unknown>();
      const m = new Map<string, string>();
      let touched = false;
      for (const [k, v] of u.entries(cur)) {
        const s = sig(v);
        m.set(k, s);
        if (old.get(k) === s) continue;
        await u.save!(x, k, v, old.has(k) ? prevVals.get(k) : undefined);
        stats.saved++;
        touched = true;
      }
      for (const k of old.keys()) {
        if (m.has(k)) continue;
        touched = true;
        removals.push(async () => {
          if (u.remove) { await u.remove!(x, k, prevVals.get(k)); stats.removed++; }
          else console.warn(`[mesagri] ${u.name}: «${k}» ya no existe en el mundo y no se borra de la base`);
        });
      }
      if (touched) stats.units.push(u.name);
      next.set(u.name, m);
    }
    for (const r of removals.reverse()) await r();
    return { commit: () => { this.sigs = next; }, stats };
  }

  /** Si la transacción falló, los ids que se anotaron pueden no existir: se vuelven a leer. */
  async recover() {
    await this.ids.loadAll(this.pool);
  }

  /** Vacía todas las tablas de datos (no el catálogo) para reiniciar la demo. */
  async reset(): Promise<void> {
    const c = await this.pool.getConnection();
    try {
      const tables = (await rows(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'")).map(r => r.t as string);
      await exec(c, 'SET FOREIGN_KEY_CHECKS = 0');
      for (const t of tables) if (!REFERENCE_TABLES.includes(t) && !KEEP_ON_RESET.includes(t)) await exec(c, `TRUNCATE TABLE \`${t}\``);
      // productos que el equipo agregó al catálogo (W-09): vuelven al catálogo maestro
      await exec(c, 'DELETE FROM catalog_products WHERE custom_definition IS NOT NULL');
      await exec(c, 'SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      c.release();
    }
    this.sigs = new Map();
    await this.ids.loadAll(this.pool);
  }
}
