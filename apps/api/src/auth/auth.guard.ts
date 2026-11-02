/*
 * Guardia de autenticación y autorización (14.4): valida el token y el rol. Nunca se confía en el
 * rol que envía el cliente: sale del usuario guardado en el servidor.
 */
import { applyDecorators, CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService, AuthUser } from './auth.service';
import { DomainHttpError } from '../common/errors';

const ROLES = 'mesagri:roles';
const OPTIONAL = 'mesagri:optional';

/**
 * Exige sesión. Roles posibles: FARMER, BUYER, CARRIER, WAREHOUSE, ADMIN y ADMIN:GENERAL,
 * ADMIN:VERIFIER, ADMIN:SUPPORT, ADMIN:ANALYST. Sin roles: cualquier usuario con sesión.
 */
export function Auth(...roles: string[]) {
  return applyDecorators(SetMetadata(ROLES, roles), UseGuards(AuthGuard), ApiBearerAuth(), ApiUnauthorizedResponse({ description: 'Sin sesión o con el token vencido' }));
}

/** La sesión es opcional (si viene, se valida). */
export function OptionalAuth() {
  return applyDecorators(SetMetadata(OPTIONAL, true), UseGuards(AuthGuard), ApiBearerAuth());
}

export const Me = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

export function roleAllowed(u: AuthUser, roles: string[]): boolean {
  if (!roles.length) return true;
  return roles.some(r => {
    const [role, sub] = r.split(':');
    if (u.role !== role) return false;
    return !sub || u.adminRole === sub;
  });
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL, [ctx.getHandler(), ctx.getClass()]);
    const h = String(req.headers?.authorization ?? '');
    if (!h.startsWith('Bearer ')) {
      if (optional) return true;
      throw new DomainHttpError(401, 'UNAUTHORIZED', 'Inicia sesión para continuar.');
    }
    const user = await this.auth.verifyAccess(h.slice(7).trim());
    req.user = user;
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (!roleAllowed(user, roles)) throw new DomainHttpError(403, 'FORBIDDEN', 'Tu cuenta no puede hacer esta acción.');
    return true;
  }
}
