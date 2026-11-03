/*
 * Identidad (14.4, Ley 29733): pre-consulta del DNI mientras la persona llena sus datos (solo dice si
 * el nombre coincide, nunca devuelve el nombre oficial) y nueva consulta desde el panel.
 * La pre-consulta pide el permiso de registro (después de verificar el celular) o una sesión, y tiene
 * límite de intentos para que nadie la use para averiguar datos de otras personas.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { isDniValid, TEST_DNIS } from '@mesagri/shared';
import { EngineService } from '../core/engine.service';
import { Auth, Me, OptionalAuth } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { DomainHttpError } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { Body$ } from '../domain/helpers';
import { DniRegistry } from './dni';

const HOUR = 3600_000;

@ApiTags('Identidad')
@Controller()
export class IdentityController {
  private readonly limiter = new RateLimiter();

  constructor(private readonly reg: DniRegistry, private readonly engine: EngineService, private readonly jwt: JwtService) {
    engine.bus.on('reset', () => this.limiter.clear());
  }

  @Get('identity/registry')
  @ApiOperation({ summary: 'Con qué se consulta el DNI: un proveedor (RENIEC) o el padrón de prueba de la demo' })
  info() {
    const source = this.reg.source();
    return { source, provider: source === 'PROVEEDOR' ? this.reg.providerName() : undefined, tests: source === 'PADRON_PRUEBA' ? TEST_DNIS.map(p => ({ dni: p.dni, note: p.note })) : [] };
  }

  @Post('identity/dni-check') @HttpCode(200) @OptionalAuth()
  @ApiOperation({ summary: 'Pre-consulta: ¿el nombre coincide con el DNI? (con el permiso de registro o una sesión; no devuelve el nombre oficial)' })
  @Body$({ dni: '41235876', digit: '9', name: 'Teodora Quispe Mamani', ticket: 'eyJ...' }, ['dni', 'name'])
  async check(@Req() req: Request, @Body() b: any, @Me() u?: AuthUser) {
    const dni = String(b?.dni ?? '').trim();
    if (!isDniValid(dni)) throw new DomainHttpError(422, 'BAD_DNI', 'El DNI tiene 8 números.');
    const name = String(b?.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 5 || name.split(' ').length < 2) throw new DomainHttpError(422, 'BAD_NAME', 'Escribe el nombre completo, como figura en el DNI.');
    let who = u?.id;
    if (!who && b?.ticket) {
      try {
        const t: any = await this.jwt.verifyAsync(String(b.ticket));
        if (t?.typ === 'otp' && t.purpose === 'REGISTER' && t.ep === this.engine.epoch) who = 'reg:' + t.phone;
      } catch { /* vencido */ }
    }
    if (!who) throw new DomainHttpError(401, 'TICKET', 'Verifica tu celular otra vez para continuar.');
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? '');
    if (!this.limiter.hit('dni:' + who, 10, HOUR) || !this.limiter.hit('dni-ip:' + ip, 40, HOUR)) {
      throw new DomainHttpError(429, 'TOO_MANY', 'Hiciste demasiadas consultas del DNI. Espera un rato o continúa: una persona del equipo lo revisa.');
    }
    const r = await this.reg.check(dni, name, b?.digit ? String(b.digit) : undefined);
    return { status: r.status, source: r.source, provider: r.provider, digitOk: r.digitOk ?? null, deceased: r.deceased ?? null };
  }

  @Post('admin/cases/:id/dni-check') @Auth('ADMIN:GENERAL', 'ADMIN:VERIFIER')
  @ApiOperation({ summary: 'Vuelve a consultar el DNI de un expediente (sin usar la consulta guardada)' })
  async recheck(@Param('id') id: string) {
    const k = this.engine.world.cases[id];
    if (!k) throw new DomainHttpError(404, 'NOT_FOUND', 'No encontramos el expediente.');
    if (!k.identity) throw new DomainHttpError(422, 'NO_IDENTITY', 'Este expediente no tiene DNI para consultar.');
    const registry = await this.reg.autoCheck(id, true);
    return { registry };
  }
}
