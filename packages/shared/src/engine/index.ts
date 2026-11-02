/*
 * Punto de entrada del motor: aplicar un evento, reconstruir el mundo y validar en seco.
 */
import type { World, MEvent } from '../types';
import { HANDLERS, DomainError, SYSTEM_USER, emptyWorld, structuredCloneSafe, Ctx } from './core';
import { tick } from './tick';
import './accounts';
import './listings';
import './orders';
import './shipping';
import './storage';
import './billing';
import './r2';
import { checkMemberPerm, memberOf } from './r2';
import { registerProducts } from '../catalog';
import { buildSeedWith, SEED_ANCHOR } from '../seed';

export { DomainError, emptyWorld, tick, structuredCloneSafe };

let SEED_CACHE: World | undefined;
export function seedWorld(): World { if (!SEED_CACHE) SEED_CACHE = buildSeedWith(applySafe, tick); return SEED_CACHE; }

/** Orden total de los eventos: reloj lógico (Lamport), hora y id. Todos los celulares ordenan igual. */
export function eventOrder(a: MEvent, b: MEvent): number {
  if (a.type === 'WORLD_INIT' && b.type !== 'WORLD_INIT') return -1;
  if (b.type === 'WORLD_INIT' && a.type !== 'WORLD_INIT') return 1;
  return a.lamport - b.lamport || a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Aplica un evento (valida y muta). Lanza DomainError si una regla no se cumple. */
export function applyEvent(w: World, e: MEvent): any {
  if (e.type === 'WORLD_INIT') {
    if (!SEED_CACHE) SEED_CACHE = buildSeedWith(applySafe, tick);
    Object.assign(w, structuredCloneSafe(SEED_CACHE));
    // el reloj de la demo arranca en el ancla del guion cuando se creó la mesa
    w.clockOffset = SEED_ANCHOR - (Number(e.p.realAt) || SEED_ANCHOR);
    return;
  }
  if (w.catalogExtra) registerProducts(w.catalogExtra);
  tick(w, e.t);
  const actor = e.actor === 'system' ? SYSTEM_USER : w.users[e.actor];
  if (!actor && e.type !== 'USER_REGISTER') throw new DomainError('NO_USER', 'Primero inicia sesión.');
  if (actor && actor.status === 'SUSPENDED') {
    // a quien el titular pausó (equipo de la MYPE o quien publica por el agricultor) se le dice quién lo pausó
    const o = w.orgs[actor.orgId];
    const m = actor !== SYSTEM_USER ? memberOf(w, actor) : undefined;
    const titular = w.users[o?.memberIds[0] ?? '']?.name ?? 'El titular';
    if (m && !m.active) throw new DomainError('MEMBER_PAUSED', `${titular} pausó tu acceso a ${o?.name ?? 'la cuenta'}. Pídele que lo vuelva a activar.`);
    if (!m && o && o.memberIds[0] !== actor.id && o.memberIds.includes(actor.id)) throw new DomainError('MEMBER_REMOVED', `${titular} te quitó el acceso a ${o.name}.`);
    throw new DomainError('SUSPENDED', 'Tu usuario está suspendido.');
  }
  const h = HANDLERS[e.type];
  if (!h) throw new DomainError('UNKNOWN', `Acción desconocida: ${e.type}`);
  // quien no es titular (equipo de la MYPE o quien publica por el agricultor) actúa con sus permisos
  if (actor && actor !== SYSTEM_USER) checkMemberPerm(w, actor, e.type);
  const ctx: Ctx = { w, e, t: Math.max(e.t, w.now), a: actor ?? SYSTEM_USER, n: 0 };
  return h(ctx);
}

/** Aplica y, si falla, registra el rechazo sin romper la reconstrucción. */
export function applySafe(w: World, e: MEvent): { ok: boolean; result?: any; error?: { code: string; message: string; data?: any } } {
  try {
    const result = applyEvent(w, e);
    return { ok: true, result };
  } catch (err: any) {
    const code = err instanceof DomainError ? err.code : 'BUG';
    const message = err instanceof DomainError ? err.message : 'No pudimos guardar. Intenta de nuevo.';
    if (!(err instanceof DomainError)) console.error('[mesagri] error inesperado en', e.type, err);
    w.rejected[e.id] = { code, message, type: e.type, actor: e.actor };
    return { ok: false, error: { code, message, data: (err as DomainError).data } };
  }
}

/** Reconstruye el mundo desde cero con todos los eventos. */
export function replay(events: MEvent[]): World {
  const sorted = [...events].sort(eventOrder);
  const w = emptyWorld();
  for (const e of sorted) applySafe(w, e);
  return w;
}

/** Prueba un evento sobre una copia del mundo para saber si pasaría (la app orienta antes de enviar). */
export function dryRun(w: World, e: MEvent): { ok: boolean; result?: any; error?: { code: string; message: string; data?: any }; world?: World } {
  const copy = structuredCloneSafe(w);
  try {
    const result = applyEvent(copy, e);
    return { ok: true, result, world: copy };
  } catch (err: any) {
    if (err instanceof DomainError) return { ok: false, error: { code: err.code, message: err.message, data: err.data } };
    console.error('[mesagri] error inesperado (prueba)', e.type, err);
    return { ok: false, error: { code: 'BUG', message: 'No pudimos guardar. Intenta de nuevo.' } };
  }
}
