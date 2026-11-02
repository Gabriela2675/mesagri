/*
 * Herramientas de la demo (solo con DEMO_MODE=true): personas de ejemplo sin código, reloj que se
 * adelanta y reinicio de los datos. En el piloto real estas rutas no existen.
 * En la nube las protege la clave del equipo (encabezado x-team-key, ver common/team.ts).
 */
import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { PERSONAS } from '@mesagri/shared';
import { EngineService } from '../core/engine.service';
import { AuthService } from '../auth/auth.service';
import { CONFIG } from '../config';
import { DomainHttpError } from '../common/errors';
import { requireTeam } from '../common/team';

class SessionsDto { @ApiProperty({ type: [String], example: ['u-wilber', 'u-charo'] }) userIds!: string[]; @ApiPropertyOptional() device?: string; }
class ClockDto { @ApiProperty({ description: 'Milisegundos a adelantar (hasta 120 días)', example: 3600000 }) ms!: number; }

function demoOnly() {
  if (!CONFIG.demo) throw new DomainHttpError(403, 'NOT_DEMO', 'Solo disponible en modo demo.');
}

@ApiTags('Demo')
@ApiHeader({ name: 'x-team-key', required: false, description: 'Clave del equipo (TEAM_KEY). Obligatoria si el servidor tiene una.' })
@Controller('demo')
export class DemoController {
  constructor(private readonly engine: EngineService, private readonly auth: AuthService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado del servidor: época, reloj de la demo y personas de ejemplo' })
  status() {
    return { demo: CONFIG.demo, teamKeyRequired: !!CONFIG.teamKey, clockMode: CONFIG.clockMode, epoch: this.engine.epoch, boot: this.engine.boot, seq: this.engine.seq, simNow: this.engine.simNow(), serverNow: Date.now(), personas: CONFIG.demo ? PERSONAS : [] };
  }

  @Post('sessions') @HttpCode(200)
  @ApiOperation({ summary: 'Sesiones de las personas de ejemplo sin código (escenario de varios celulares)' })
  sessions(@Body() b: SessionsDto, @Headers('x-team-key') key?: string) { requireTeam(key); return this.auth.demoSessions(b.userIds, b.device); }

  @Get('team')
  @ApiOperation({ summary: 'Cuentas del equipo con su clave de prueba y el código vigente del doble factor' })
  team(@Headers('x-team-key') key?: string) { demoOnly(); requireTeam(key); return this.auth.teamCodes(); }

  @Post('clock') @HttpCode(200)
  @ApiOperation({ summary: 'Adelanta el reloj de la demo (para ver vencer plazos)' })
  async clock(@Body() b: ClockDto, @Headers('x-team-key') key?: string) {
    demoOnly();
    requireTeam(key);
    const ms = Math.round(Number(b?.ms));
    const r = await this.engine.apply({ type: 'CLOCK_ADVANCE', actor: 'system', p: { ms } }, true);
    if (!r.ok) throw new DomainHttpError(422, r.error.code, r.error.message);
    const t = await this.engine.apply({ type: 'CLOCK_TICK', actor: 'system', p: {} }, true);
    return { ok: true, seq: t.ok ? t.seq : r.seq, simNow: this.engine.simNow() };
  }

  @Post('reset') @HttpCode(200)
  @ApiOperation({ summary: 'Reinicia la demo: vuelve al martes 3 de noviembre de 2026, 8:30, con los datos de ejemplo' })
  async reset(@Headers('x-team-key') key?: string) {
    demoOnly();
    requireTeam(key);
    await this.engine.reset();
    return { ok: true, epoch: this.engine.epoch, simNow: this.engine.simNow() };
  }
}
