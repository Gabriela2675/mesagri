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
import { WhatsAppService } from '../auth/whatsapp';
import { otpCode } from '../auth/secrets';

class SessionsDto { @ApiProperty({ type: [String], example: ['u-wilber', 'u-charo'] }) userIds!: string[]; @ApiPropertyOptional() device?: string; }
class ClockDto { @ApiProperty({ description: 'Milisegundos a adelantar (hasta 120 días)', example: 3600000 }) ms!: number; }

function demoOnly() {
  if (!CONFIG.demo) throw new DomainHttpError(403, 'NOT_DEMO', 'Solo disponible en modo demo.');
}

@ApiTags('Demo')
@ApiHeader({ name: 'x-team-key', required: false, description: 'Clave del equipo (TEAM_KEY). Obligatoria si el servidor tiene una.' })
@Controller('demo')
export class DemoController {
  constructor(private readonly engine: EngineService, private readonly auth: AuthService, private readonly wa: WhatsAppService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado del servidor: época, reloj de la demo y personas de ejemplo' })
  async status() {
    const w = await this.wa.status();
    return { demo: CONFIG.demo, teamKeyRequired: !!CONFIG.teamKey, whatsapp: { configured: w.configured, presenter: w.presenter, templateStatus: w.templateStatus }, clockMode: CONFIG.clockMode, epoch: this.engine.epoch, boot: this.engine.boot, seq: this.engine.seq, simNow: this.engine.simNow(), serverNow: Date.now(), personas: CONFIG.demo ? PERSONAS : [] };
  }

  @Post('sessions') @HttpCode(200)
  @ApiOperation({ summary: 'Sesiones de las personas de ejemplo sin código (escenario de varios celulares)' })
  sessions(@Body() b: SessionsDto, @Headers('x-team-key') key?: string) { requireTeam(key); return this.auth.demoSessions(b.userIds, b.device); }

  @Get('whatsapp')
  @ApiOperation({ summary: 'Estado de WhatsApp: configurado, plantilla del código (aprobada o pendiente), enviados hoy y el último error' })
  whatsapp(@Headers('x-team-key') key?: string) { requireTeam(key); return this.wa.status(); }

  @Post('whatsapp/test') @HttpCode(200)
  @ApiOperation({ summary: 'Manda un código de prueba por WhatsApp a un celular (para comprobar la configuración)' })
  async whatsappTest(@Body() b: { phone?: string }, @Headers('x-team-key') key?: string) {
    requireTeam(key);
    const digits = String(b?.phone ?? '').replace(/\D/g, '');
    const to = digits.length === 9 ? '51' + digits : digits;
    if (!/^51\d{9}$/.test(to)) throw new DomainHttpError(422, 'BAD_PHONE', 'Escribe el celular con 9 dígitos.');
    if (!this.wa.configured) throw new DomainHttpError(409, 'WHATSAPP_OFF', 'Falta configurar WHATSAPP_TOKEN y WHATSAPP_PHONE_ID en el servidor.');
    try { await this.wa.sendCode(to, otpCode()); } catch (e: any) { throw new DomainHttpError(502, 'WHATSAPP', e?.userMessage ?? 'No se pudo enviar.', { detail: e?.message }); }
    return { ok: true, to: '+' + to };
  }

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
