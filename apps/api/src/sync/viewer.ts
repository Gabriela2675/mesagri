/*
 * Quién está mirando: el equipo de la demo (clave del equipo), el equipo de Mesagri (panel), una
 * persona con su sesión o alguien que todavía no ingresó. De eso depende lo que se le manda
 * (@mesagri/shared/privacy).
 */
import { ANON, TEAM, type Viewer } from '@mesagri/shared';
import { teamOk } from '../common/team';
import type { AuthService } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';

export interface ViewerRequest { token?: string; team?: string }

/** El escenario de la demo pide el mundo completo mandando la clave del equipo (vacía si el servidor no tiene clave). */
export async function viewerOf(auth: AuthService, r: ViewerRequest): Promise<{ viewer: Viewer; tokenError?: DomainHttpError }> {
  if (r.team !== undefined) {
    if (teamOk(r.team)) return { viewer: TEAM };
    // pidió el mundo completo con una clave que no es: se le dice, para que la escriba otra vez
    return { viewer: ANON, tokenError: new DomainHttpError(401, 'TEAM_KEY', 'Falta la clave del equipo de Mesagri o no es correcta.') };
  }
  const token = String(r.token ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { viewer: ANON };
  try {
    const u = await auth.verifyAccess(token);
    return { viewer: u.role === 'ADMIN' ? { kind: 'admin', userId: u.id } : { kind: 'user', userId: u.id, orgId: u.orgId } };
  } catch (e) {
    return { viewer: ANON, tokenError: e instanceof DomainHttpError ? e : new DomainHttpError(401, 'TOKEN_INVALID', 'Tu sesión venció. Ingresa de nuevo.') };
  }
}
