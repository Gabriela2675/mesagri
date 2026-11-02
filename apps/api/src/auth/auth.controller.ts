/* Autenticación y perfil (14.6: /auth, /me). */
import { Body, Controller, Get, Headers, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { buyerLimit, farmerLimit, orgStats, monthPurchases, uid } from '@mesagri/shared';
import { AuthService, OtpPurpose } from './auth.service';
import { Auth, Me } from './auth.guard';
import type { AuthUser } from './auth.service';
import { Commands } from '../core/commands';
import { EngineService } from '../core/engine.service';
import { exec } from '../db/db';
import { DomainHttpError } from '../common/errors';

class OtpDto { @ApiProperty({ example: '987654321' }) phone!: string; @ApiProperty({ enum: ['REGISTER', 'LOGIN', 'RECOVER'] }) purpose!: OtpPurpose; @ApiPropertyOptional({ description: 'Escenario de la demo (con la clave del equipo): el código se muestra en pantalla' }) escenario?: boolean; }
class OtpVerifyDto { @ApiProperty({ example: '987654321' }) phone!: string; @ApiProperty({ example: '123456' }) code!: string; }
class RegisterDto {
  @ApiProperty({ description: 'Permiso que entrega /auth/otp/verify' }) ticket!: string;
  @ApiProperty({ description: 'Acción USER_REGISTER: { id, p: { userId, orgId, role, phone, name, dni?, lang, org: {...}, carrier?, warehouse? } }' }) event!: { id?: string; p: any };
  @ApiPropertyOptional() device?: string;
}
class LoginDto { @ApiProperty({ example: '951234678' }) phone!: string; @ApiProperty({ example: '123456' }) code!: string; @ApiPropertyOptional() device?: string; @ApiPropertyOptional({ enum: ['FARMER', 'BUYER', 'WAREHOUSE', 'CARRIER'], description: 'Tipo de cuenta que eligió la persona; si no coincide responde 409 ROLE_MISMATCH' }) role?: string; }
class AdminLoginDto { @ApiProperty({ example: 'carlos@mesagri.pe' }) email!: string; @ApiProperty() password!: string; @ApiProperty({ description: 'Código de 6 dígitos de la app de autenticación' }) code!: string; @ApiPropertyOptional() device?: string; }
class RefreshDto { @ApiProperty() refreshToken!: string; }
class PrefsDto { @ApiPropertyOptional({ enum: ['es', 'qu', 'ay'] }) lang?: string; @ApiPropertyOptional() audioGuide?: boolean; @ApiPropertyOptional() bilingual?: boolean; @ApiPropertyOptional({ enum: [1, 1.25, 1.5] }) textScale?: number; @ApiPropertyOptional() dataSaver?: boolean; @ApiPropertyOptional({ enum: ['coma', 'punto'] }) numFmt?: string; }
class MePatchDto { @ApiPropertyOptional() address?: string; @ApiPropertyOptional() receiver?: string; @ApiPropertyOptional() district?: string; }
class PrivacyDto { @ApiProperty({ enum: ['ACCESO', 'RECTIFICACION', 'CANCELACION', 'OPOSICION'] }) kind!: string; @ApiPropertyOptional() detail?: string; }

/** De quién viene el pedido (detrás del proxy de la nube, según TRUST_PROXY). */
const ip = (req: Request) => String(req.ip ?? req.socket?.remoteAddress ?? '');

@ApiTags('Autenticación')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly engine: EngineService, private readonly cmd: Commands) {}

  @Post('auth/otp') @HttpCode(200)
  @ApiOperation({ summary: 'Envía un código de 6 dígitos por WhatsApp (registro, ingreso o recuperación)', description: 'channel WHATSAPP: el código llegó por WhatsApp (to: número enmascarado). channel PANTALLA: versión de prueba, el código viene en demoCode (cuentas de ejemplo; sin WhatsApp configurado; o si WhatsApp no pudo entregarlo, solo para registrarse o en un celular de confianza, encabezado x-device-key). Con x-team-key, el código de las cuentas de ejemplo llega al WhatsApp del equipo (DEMO_WHATSAPP_TO).' })
  otp(@Body() b: OtpDto, @Req() req: Request, @Headers('x-device-key') key?: string, @Headers('x-team-key') team?: string) { return this.auth.requestOtp(b.phone, b.purpose, ip(req), key, team, b?.escenario === true); }

  @Post('auth/otp/verify') @HttpCode(200)
  @ApiOperation({ summary: 'Verifica el código del registro y entrega un permiso de 15 minutos para crear la cuenta' })
  verify(@Body() b: OtpVerifyDto) { return this.auth.registerTicket(b.phone, b.code); }

  @Post('auth/register')
  @ApiOperation({ summary: 'Crea la cuenta (rol, organización y consentimientos) y abre la sesión' })
  register(@Body() b: RegisterDto, @Headers('x-device-key') key?: string) { return this.auth.register(b.ticket, b.event, b.device, key); }

  @Post('auth/login') @HttpCode(200)
  @ApiOperation({ summary: 'Ingreso con celular y código', description: 'Con role, responde 409 ROLE_MISMATCH si el celular es de otro tipo de cuenta (el código sigue sirviendo). Las cuentas del equipo reciben 409 USE_PANEL: entran por el panel web.' })
  login(@Body() b: LoginDto, @Headers('x-device-key') key?: string) { return this.auth.login(b.phone, b.code, b.device, b.role, key); }

  @Post('auth/admin/login') @HttpCode(200)
  @ApiOperation({ summary: 'Ingreso al panel web: correo, contraseña (Argon2id) y doble factor (TOTP)', description: 'Cinco intentos fallidos bloquean la cuenta 15 minutos.' })
  adminLogin(@Body() b: AdminLoginDto, @Req() req: Request) { return this.auth.adminLogin(b.email, b.password, b.code, ip(req), b.device); }

  @Post('auth/refresh') @HttpCode(200)
  @ApiOperation({ summary: 'Renueva la sesión (token de refresco rotativo)', description: 'Si se reutiliza un token ya rotado, se cierran todas las sesiones del usuario.' })
  refresh(@Body() b: RefreshDto) { return this.auth.refresh(b.refreshToken); }

  @Post('auth/logout') @HttpCode(200)
  @ApiOperation({ summary: 'Cierra la sesión (toda la cadena de tokens de ese dispositivo)' })
  logout(@Body() b: RefreshDto) { return this.auth.logout(b.refreshToken); }

  @Get('me') @Auth()
  @ApiOperation({ summary: 'Perfil, organización, nivel y límites' })
  me(@Me() u: AuthUser) {
    const w = this.engine.world;
    const user = w.users[u.id];
    const org = w.orgs[user.orgId];
    const limits = org?.type === 'FARMER' ? farmerLimit(w.settings, org.level) : org?.type === 'BUYER' ? buyerLimit(w.settings, org.level) : undefined;
    const { phone, dni, ...safe } = user;
    return {
      user: { ...safe, phoneMasked: '+51 ' + phone.slice(0, 3) + ' *** ' + phone.slice(-3), dniMasked: dni ? '****' + dni.slice(-4) : undefined },
      organization: org ? { id: org.id, type: org.type, name: org.name, legalName: org.legalName, ruc: org.ruc, district: org.district, province: org.province, level: org.level, status: org.status, taxRegime: org.taxRegime, acceptsCash: org.acceptsCash, subscription: org.subscription, carrierLevel: org.carrier?.level, warehouseLevel: org.warehouse?.level } : undefined,
      limits,
      stats: org ? orgStats(w, org.id) : undefined,
      monthPurchases: org?.type === 'BUYER' ? monthPurchases(w, org.id, this.engine.simNow()) : undefined,
    };
  }

  @Patch('me') @Auth()
  @ApiOperation({ summary: 'Actualiza dirección, quién recibe o distrito (MYPE)' })
  patchMe(@Me() u: AuthUser, @Body() b: MePatchDto, @Headers('idempotency-key') idem?: string) { return this.cmd.run(u, 'ORG_UPDATE', { orgId: u.orgId, ...b }, idem); }

  @Get('me/preferences') @Auth()
  @ApiOperation({ summary: 'Idioma, etiquetas bilingües, guía de audio y tamaño de texto' })
  prefs(@Me() u: AuthUser) { return this.engine.world.users[u.id].prefs; }

  @Put('me/preferences') @Auth()
  @ApiOperation({ summary: 'Guarda las preferencias (el idioma no depende del teléfono)' })
  setPrefs(@Me() u: AuthUser, @Body() b: PrefsDto, @Headers('idempotency-key') idem?: string) { return this.cmd.run(u, 'PREFS_SET', { prefs: b }, idem); }

  @Post('me/privacy-requests') @Auth('FARMER', 'BUYER', 'CARRIER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Solicitud ARCO (acceso, rectificación, cancelación u oposición): 10 días hábiles para responder' })
  async privacy(@Me() u: AuthUser, @Body() b: PrivacyDto) {
    if (!['ACCESO', 'RECTIFICACION', 'CANCELACION', 'OPOSICION'].includes(b.kind)) throw new DomainHttpError(422, 'BAD_KIND', 'Elige qué derecho quieres ejercer.');
    const id = 'arco-' + uid();
    const due = new Date(Date.now() + 14 * 86_400_000);
    await exec(this.engine.pool, 'INSERT INTO privacy_requests (uuid, user_id, kind, detail, due_at) VALUES (?, ?, ?, ?, ?)', [id, this.engine.store.ids.need('users', u.id), b.kind, String(b.detail ?? '').slice(0, 2000), due]);
    return { id, status: 'RECIBIDA', dueAt: due.getTime() };
  }
}
