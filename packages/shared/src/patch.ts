/*
 * Sincronización por cambios: después de cada acción, el servidor manda a cada celular solo las
 * entidades que cambiaron, ya filtradas para su perfil (privacy.ts). El celular las reemplaza en
 * su copia del mundo. Así nadie recibe datos de otros que su perfil no puede ver, y nadie tiene
 * que volver a aplicar acciones ajenas.
 */
import type { World } from './types';
import { NOTIF_CAP, AUDIT_CAP } from './engine/core';
import { maskCtx, maskEntity, filterItems, relatedOrgs, type Viewer } from './privacy';

/** Lo que cambió en el mundo con una acción. */
export interface Changes {
  /** colecciones: ids nuevos o cambiados */
  set: Map<string, string[]>;
  /** colecciones: ids que ya no están */
  del: Map<string, string[]>;
  /** listas (avisos, auditoría, movimientos): lo agregado al final */
  push: Map<string, unknown[]>;
  /** listas que se mandan completas (no se pudo saber qué cambió) */
  rep: Set<string>;
  /** valores sueltos (hora, ajustes, desfase del reloj...) */
  scal: string[];
}

export interface PatchMeta { id: string; type: string; actor: string; t: number }

/** Mensaje para un celular: número de acción, cuál fue y las entidades que cambiaron para su perfil. */
export interface Patch {
  seq: number;
  ev?: PatchMeta;
  set?: Record<string, Record<string, unknown>>;
  del?: Record<string, string[]>;
  push?: Record<string, unknown[]>;
  rep?: Record<string, unknown[]>;
  scal?: Record<string, unknown>;
}

const SKIP = new Set(['rejected']);
const SCALAR_OBJECTS = new Set(['settings']);
const kindOf = (k: string, v: unknown): 'rec' | 'arr' | 'scal' | 'skip' =>
  SKIP.has(k) ? 'skip' : Array.isArray(v) ? 'arr' : v && typeof v === 'object' && !SCALAR_OBJECTS.has(k) ? 'rec' : 'scal';

const enc = (x: unknown) => JSON.stringify(x, (_k, v) => (v === Infinity ? '∞' : v === -Infinity ? '-∞' : v));

/** Recuerda la huella de cada entidad del mundo para saber qué cambió con cada acción. */
export class WorldTracker {
  private recs = new Map<string, Map<string, string>>();
  private arrs = new Map<string, { len: number; last: string }>();
  private scals = new Map<string, string>();

  reset(w: World) {
    this.recs.clear(); this.arrs.clear(); this.scals.clear();
    this.diff(w);
  }

  diff(w: World): Changes {
    const ch: Changes = { set: new Map(), del: new Map(), push: new Map(), rep: new Set(), scal: [] };
    for (const k of Object.keys(w)) {
      const v = (w as any)[k];
      const kind = kindOf(k, v);
      if (kind === 'rec') {
        const old = this.recs.get(k) ?? new Map<string, string>();
        const cur = new Map<string, string>();
        const set: string[] = [];
        for (const id of Object.keys(v)) {
          const s = enc(v[id]);
          cur.set(id, s);
          if (old.get(id) !== s) set.push(id);
        }
        const del = [...old.keys()].filter(id => !cur.has(id));
        if (set.length) ch.set.set(k, set);
        if (del.length) ch.del.set(k, del);
        this.recs.set(k, cur);
      } else if (kind === 'arr') {
        const list = v as unknown[];
        const prev = this.arrs.get(k);
        const last = list.length ? enc(list[list.length - 1]) : '';
        if (!prev || !prev.len) {
          if (list.length) ch.push.set(k, list.slice());
        } else if (!list.length) {
          ch.rep.add(k);
        } else if (list.length >= prev.len && enc(list[prev.len - 1]) === prev.last) {
          // las listas solo crecen al final: lo anterior sigue en su lugar
          if (list.length > prev.len) ch.push.set(k, list.slice(prev.len));
        } else {
          // llegó al tope y se recortó al principio: se busca dónde quedó lo anterior
          let i = list.length - 1;
          const floor = Math.max(0, list.length - 2000);
          while (i >= floor && enc(list[i]) !== prev.last) i--;
          if (i >= floor) { if (i < list.length - 1) ch.push.set(k, list.slice(i + 1)); }
          else ch.rep.add(k);
        }
        this.arrs.set(k, { len: list.length, last });
      } else if (kind === 'scal') {
        const s = enc(v);
        if (this.scals.get(k) !== s) ch.scal.push(k);
        this.scals.set(k, s);
      }
    }
    return ch;
  }
}

export const emptyChanges = (): Changes => ({ set: new Map(), del: new Map(), push: new Map(), rep: new Set(), scal: [] });

/**
 * Cambios para un perfil. `prevRelated` son las contrapartes que tenía antes de la acción: si
 * aparece una nueva (le hicieron un pedido), se le mandan completos sus datos de contacto.
 */
export function patchFor(ch: Changes, w: World, v: Viewer, seq: number, ev?: PatchMeta, prevRelated?: Set<string>): { patch: Patch; related?: Set<string> } {
  const x = maskCtx(w, v);
  const p: Patch = { seq, ...(ev ? { ev } : {}) };
  const set: Record<string, Record<string, unknown>> = {};
  const put = (col: string, id: string | undefined) => {
    if (!id) return;
    const val = (w as any)[col]?.[id];
    if (val === undefined) return;
    const m = maskEntity(col, id, val, x);
    if (m === undefined) return;
    (set[col] ??= {})[id] = m;
  };
  for (const [col, ids] of ch.set) for (const id of ids) put(col, id);
  // lo que se ve de un pedido y de su chat depende también del transportista asignado al envío
  for (const id of ch.set.get('shipments') ?? []) { const sh = w.shipments[id]; if (sh) { put('subOrders', sh.subOrderId); put('messages', sh.subOrderId); } }
  if (x.org && prevRelated) {
    for (const org of new Set([...x.related, ...prevRelated])) {
      if (x.related.has(org) === prevRelated.has(org)) continue;
      put('orgs', org);
      for (const uid of w.orgs[org]?.memberIds ?? []) put('users', uid);
    }
  }
  if (Object.keys(set).length) p.set = set;
  if (ch.del.size) p.del = Object.fromEntries(ch.del);
  const push: Record<string, unknown[]> = {};
  for (const [col, items] of ch.push) { const f = filterItems(col, items, x); if (f.length) push[col] = f; }
  if (Object.keys(push).length) p.push = push;
  if (ch.rep.size) p.rep = Object.fromEntries([...ch.rep].map(col => [col, filterItems(col, (w as any)[col] ?? [], x)]));
  if (ch.scal.length) p.scal = Object.fromEntries(ch.scal.map(k => [k, (w as any)[k]]));
  return { patch: p, related: x.org ? x.related : undefined };
}

/** Contrapartes de quien mira (para recordarlas entre una acción y otra). */
export const relatedOf = (w: World, v: Viewer): Set<string> | undefined => (v.kind === 'user' ? relatedOrgs(w, v.orgId) : undefined);

const CAPS: Record<string, number> = { notifs: NOTIF_CAP, audit: AUDIT_CAP };

/** Aplica los cambios a la copia del mundo del celular (la modifica). */
export function applyPatch(w: World, p: Patch): void {
  const ww = w as any;
  for (const col in p.set ?? {}) {
    const rec = ww[col] && typeof ww[col] === 'object' ? ww[col] : (ww[col] = {});
    const add = p.set![col];
    for (const id in add) rec[id] = add[id];
  }
  for (const col in p.del ?? {}) { const rec = ww[col]; if (rec) for (const id of p.del![col]) delete rec[id]; }
  for (const col in p.rep ?? {}) ww[col] = p.rep![col].slice();
  for (const col in p.push ?? {}) {
    const list: unknown[] = Array.isArray(ww[col]) ? ww[col] : (ww[col] = []);
    list.push(...p.push![col]);
    const cap = CAPS[col];
    if (cap && list.length > cap) list.splice(0, list.length - cap);
  }
  for (const k in p.scal ?? {}) ww[k] = p.scal![k];
}
