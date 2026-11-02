/* Ayudas comunes de los endpoints REST: cuerpos documentados, paginación por cursor y permisos. */
import { ApiBody } from '@nestjs/swagger';
import type { World, SubOrder, Shipment } from '@mesagri/shared';
import type { AuthUser } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';

/** Documenta el cuerpo de un POST con sus campos y un ejemplo. */
export function Body$(example: Record<string, unknown>, required: string[] = [], description?: string) {
  const properties = Object.fromEntries(Object.entries(example).map(([k, v]) => [k, { type: Array.isArray(v) ? 'array' : v === null ? 'string' : typeof v === 'object' ? 'object' : typeof v, example: v }]));
  return ApiBody({ description, schema: { type: 'object', properties, required, example } });
}

/** Cursor opaco: base64 de la última posición vista. */
export const cursorOf = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function readCursor<T>(c?: string): T | undefined {
  if (!c) return undefined;
  try { return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T; } catch { throw new DomainHttpError(400, 'BAD_CURSOR', 'Cursor no válido.'); }
}
export const limitOf = (x: unknown, d = 20) => Math.max(1, Math.min(100, Number(x) || d));

/** Página de resultados con el cursor para la siguiente. */
export function page<T>(items: T[], limit: number, key: (x: T) => unknown) {
  const more = items.length > limit;
  const list = more ? items.slice(0, limit) : items;
  return { items: list, nextCursor: more && list.length ? cursorOf(key(list[list.length - 1])) : null };
}

export const isAdmin = (u: AuthUser, ...roles: string[]) => u.role === 'ADMIN' && (!roles.length || roles.includes(u.adminRole ?? ''));

/** ¿Puede ver este sub-pedido? (comprador, agricultor, su transportista o el equipo) */
export function canSeeSub(w: World, u: AuthUser, s: SubOrder): boolean {
  if (u.role === 'ADMIN') return true;
  if (u.orgId === s.buyerOrgId || u.orgId === s.sellerOrgId) return true;
  const sh = s.shipmentId ? w.shipments[s.shipmentId] : undefined;
  return !!sh && sh.carrierOrgId === u.orgId;
}

export function canSeeShipment(u: AuthUser, s: Shipment): boolean {
  return u.role === 'ADMIN' || [s.buyerOrgId, s.sellerOrgId, s.carrierOrgId].includes(u.orgId) || s.offers.some(o => o.carrierOrgId === u.orgId && !o.response);
}

/** Vista de un sub-pedido para quien lo pide: el código de entrega solo lo ve la MYPE que compró. */
export function subView(w: World, u: AuthUser, s: SubOrder) {
  const { deliveryCode, pickupCode, ...rest } = s;
  const buyer = u.orgId === s.buyerOrgId;
  return { ...rest, deliveryCode: buyer ? deliveryCode : undefined, pickupCode: buyer ? pickupCode : undefined, buyerName: w.orgs[s.buyerOrgId]?.name, sellerName: w.orgs[s.sellerOrgId]?.name };
}

export const must = <T>(x: T | undefined | null, what = 'el registro'): T => {
  if (x === undefined || x === null) throw new DomainHttpError(404, 'NOT_FOUND', `No encontramos ${what}.`);
  return x;
};
