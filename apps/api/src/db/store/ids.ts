/*
 * Llaves internas BIGINT ↔ uuid público (13.4). El servidor guarda en memoria qué id interno
 * tiene cada uuid para resolver las llaves foráneas sin consultar la base en cada escritura.
 */
import type { Conn } from '../db';
import { rows } from '../db';

/** Tablas cuyo id interno se busca por un texto estable (uuid, código o la organización dueña). */
const LOOKUPS: Record<string, string> = {
  users: 'SELECT id, uuid AS k FROM users',
  organizations: 'SELECT id, uuid AS k FROM organizations',
  farms: 'SELECT id, uuid AS k FROM farms',
  verification_cases: 'SELECT id, uuid AS k FROM verification_cases',
  listings: 'SELECT id, uuid AS k FROM listings',
  orders: 'SELECT id, uuid AS k FROM orders',
  sub_orders: 'SELECT id, uuid AS k FROM sub_orders',
  reviews: 'SELECT id, uuid AS k FROM reviews',
  disputes: 'SELECT id, uuid AS k FROM disputes',
  conversations: 'SELECT id, uuid AS k FROM conversations',
  support_tickets: 'SELECT id, uuid AS k FROM support_tickets',
  complaint_book_entries: 'SELECT id, uuid AS k FROM complaint_book_entries',
  payout_accounts: 'SELECT id, uuid AS k FROM payout_accounts',
  commission_statements: 'SELECT id, uuid AS k FROM commission_statements',
  storage_statements: 'SELECT id, uuid AS k FROM storage_statements',
  carrier_statements: 'SELECT id, uuid AS k FROM carrier_statements',
  subscription_invoices: 'SELECT id, uuid AS k FROM subscription_invoices',
  subscriptions: 'SELECT s.id, o.uuid AS k FROM subscriptions s JOIN organizations o ON o.id = s.organization_id',
  storage_facilities: 'SELECT f.id, o.uuid AS k FROM storage_facilities f JOIN organizations o ON o.id = f.organization_id',
  vehicles: 'SELECT v.id, o.uuid AS k FROM vehicles v JOIN organizations o ON o.id = v.carrier_org_id',
  storage_bookings: 'SELECT id, uuid AS k FROM storage_bookings',
  storage_lots: 'SELECT id, uuid AS k FROM storage_lots',
  storage_release_orders: 'SELECT id, uuid AS k FROM storage_release_orders',
  storage_incidents: 'SELECT id, uuid AS k FROM storage_incidents',
  shipments: 'SELECT id, uuid AS k FROM shipments',
  shipping_routes: 'SELECT id, code AS k FROM shipping_routes',
  catalog_products: 'SELECT id, code AS k FROM catalog_products',
  plans: 'SELECT id, code AS k FROM plans',
  roles: 'SELECT id, code AS k FROM roles',
};

export class MissingRef extends Error {
  constructor(public table: string, public key: string) { super(`No existe ${table} «${key}» en la base`); }
}

export class IdCache {
  private maps = new Map<string, Map<string, number>>();

  private m(table: string) {
    let x = this.maps.get(table);
    if (!x) { x = new Map(); this.maps.set(table, x); }
    return x;
  }
  set(table: string, key: string, id: number) { if (id) this.m(table).set(key, id); }
  get(table: string, key: string | undefined | null): number | undefined { return key ? this.m(table).get(key) : undefined; }
  /** Id obligatorio (llave foránea NOT NULL). */
  need(table: string, key: string | undefined | null): number {
    const id = this.get(table, key);
    if (!id) throw new MissingRef(table, String(key));
    return id;
  }
  /** Id opcional (llave foránea que admite NULL). */
  opt(table: string, key: string | undefined | null): number | null { return this.get(table, key) ?? null; }
  delete(table: string, key: string) { this.m(table).delete(key); }
  clear() { this.maps.clear(); }

  async loadAll(c: Conn) {
    this.clear();
    for (const [table, sql] of Object.entries(LOOKUPS)) {
      for (const r of await rows<{ id: number; k: string }>(c, sql)) this.set(table, r.k, Number(r.id));
    }
  }
}
