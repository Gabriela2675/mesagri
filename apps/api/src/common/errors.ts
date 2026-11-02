/*
 * Errores como application/problem+json (14.6). Los errores de las reglas llevan el mismo código
 * y mensaje que muestra la app («Ese número de operación ya se usó en otro pago»).
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';

export class DomainHttpError extends HttpException {
  constructor(status: number, public readonly code: string, message: string, public readonly data?: unknown) {
    super({ code, message, data }, status);
  }
}

/** Error de una regla de negocio: 409 si es un conflicto de estado, 422 si el dato no sirve, 403 si no le toca. */
export function ruleError(e: { code: string; message: string; data?: unknown }): DomainHttpError {
  const forbidden = ['FORBIDDEN', 'SUSPENDED', 'NO_USER'];
  const conflict = ['STATE', 'DUPLICATE', 'ALREADY', 'CLOSED', 'STOCK', 'OP_DUPLICATE', 'OPEN_CASE', 'NO_SPACE', 'PLAN_LIMIT', 'INACTIVE'];
  const status = forbidden.includes(e.code) ? 403 : e.code === 'NOT_FOUND' ? 404 : conflict.includes(e.code) ? 409 : 422;
  return new DomainHttpError(status, e.code, e.message, e.data);
}

const TITLES: Record<number, string> = { 400: 'Solicitud no válida', 401: 'Inicia sesión', 403: 'No permitido', 404: 'No encontrado', 409: 'Conflicto', 413: 'Archivo muy grande', 422: 'No se pudo hacer', 429: 'Demasiados intentos', 500: 'Error del servidor', 503: 'No disponible' };

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('API');
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (!res || typeof res.status !== 'function') return; // WebSocket
    let status = 500, code = 'ERROR', message = 'No pudimos completar la acción. Intenta de nuevo.', data: unknown;
    if (err instanceof DomainHttpError) { status = err.getStatus(); code = err.code; message = err.message; data = err.data; }
    else if (err instanceof HttpException) {
      status = err.getStatus();
      const b: any = err.getResponse();
      code = typeof b === 'object' && b?.code ? b.code : status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHORIZED' : 'HTTP_' + status;
      message = typeof b === 'object' ? (Array.isArray(b?.message) ? b.message.join('. ') : b?.message ?? err.message) : String(b);
      if (status === 404 && code === 'NOT_FOUND' && message.startsWith('Cannot')) message = 'No existe esa ruta del API.';
      data = typeof b === 'object' ? b?.data : undefined;
    } else {
      this.log.error(`${req?.method} ${req?.url}: ${(err as any)?.stack ?? err}`);
    }
    res.status(status).type('application/problem+json').json({ type: `https://mesagri.pe/errores/${code.toLowerCase()}`, title: TITLES[status] ?? 'Error', status, code, detail: message, data, instance: req?.url });
  }
}
