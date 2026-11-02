/*
 * Equipo de Mesagri (W-19): la administración general crea las cuentas del panel, asigna el rol de
 * cada persona (administración general, verificación, soporte o analista), pausa o reactiva su
 * acceso y le entrega una clave temporal. La persona, al entrar por primera vez, crea su propia
 * contraseña y activa el doble factor en su celular.
 */
import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import crypto from 'node:crypto';
import { uid, seedSets } from '@mesagri/shared';
import { exec, rows } from '../db/db';
import { TeamAccounts } from './team.accounts';
import { EngineService } from '../core/engine.service';
import { Commands } from '../core/commands';
import { Auth, Me } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { hashPassword } from '../auth/secrets';
import { DomainHttpError } from '../common/errors';
import { Body$ } from './helpers';

const TEMP_HOURS = 72;

/** Clave temporal fácil de dictar: tres grupos de letras y números sin confusiones (sin 0/O, 1/l). */
function tempPassword(): string {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const g = () => Array.from({ length: 4 }, () => A[crypto.randomInt(0, A.length)]).join('');
  return `${g()}-${g()}-${g()}`;
}

@ApiTags('Equipo de Mesagri')
@Controller('admin/team')
export class TeamController {
  constructor(private readonly engine: EngineService, private readonly cmd: Commands, private readonly team: TeamAccounts) {}

  /**
   * Clave temporal (vence en 3 días): se entrega una sola vez a quien administra. En su primer ingreso
   * la persona crea su propia contraseña y activa el doble factor en su celular, así nadie más los conoce.
   * Cierra las sesiones que tenía abiertas.
   */
  private async credentials(userId: string) {
    const row = this.engine.store.ids.opt('users', userId);
    const u = this.engine.world.users[userId];
    if (!row || !u) throw new DomainHttpError(404, 'NOT_FOUND', 'No encontramos a esa persona del equipo.');
    const password = tempPassword();
    await exec(this.engine.pool, `UPDATE users SET password_hash = ?, password_temp = 1, password_temp_until = NOW(3) + INTERVAL ${TEMP_HOURS} HOUR,
      totp_secret_enc = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?`, [await hashPassword(password), row]);
    await exec(this.engine.pool, 'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [row]);
    await this.team.saveCredentials(userId);
    return { userId, name: u.name, email: u.email, password, expiresAt: Date.now() + TEMP_HOURS * 3600_000 };
  }

  @Get() @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Cómo entra cada persona del equipo: cuenta de prueba, clave temporal pendiente (y si venció) y último ingreso' })
  async list() {
    const ids = Object.values(this.engine.world.users).filter(u => u.role === 'ADMIN').map(u => u.id);
    if (!ids.length) return [];
    const own = await this.team.withCredentials();
    const list = await rows(this.engine.pool, `SELECT uuid, password_temp, (password_temp_until IS NOT NULL AND password_temp_until < NOW(3)) AS expired, last_login_at FROM users WHERE uuid IN (${ids.map(() => '?').join(',')})`, ids);
    const by = new Map(list.map(r => [String(r.uuid), r]));
    return ids.map(id => {
      const r = by.get(id);
      const pending = !!Number(r?.password_temp ?? 0);
      return { userId: id, demo: seedSets().users.has(id) && !own.has(id), pending, expired: pending && !!Number(r?.expired ?? 0), lastLoginAt: r?.last_login_at ? new Date(r.last_login_at).getTime() : null };
    });
  }

  @Post() @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Agrega a una persona al equipo con su rol y devuelve su clave temporal (vence en 3 días)', description: 'La clave se muestra una sola vez. Roles: GENERAL, VERIFIER, SUPPORT, ANALYST. En su primer ingreso la persona crea su contraseña y activa su doble factor.' })
  @Body$({ name: 'Rosa Quispe', email: 'rosa@mesagri.pe', phone: '900000010', adminRole: 'SUPPORT' }, ['name', 'email', 'phone', 'adminRole'])
  async add(@Me() u: AuthUser, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const userId = 'u-' + uid();
    const r = await this.cmd.run(u, 'STAFF_ADD', { userId, name: b?.name, email: b?.email, phone: b?.phone, adminRole: b?.adminRole }, k);
    return { ...r, access: await this.credentials(userId) };
  }

  @Post(':id/role') @HttpCode(200) @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Cambia el rol de una persona del equipo' })
  @Body$({ adminRole: 'VERIFIER' }, ['adminRole'])
  role(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    return this.cmd.run(u, 'STAFF_ROLE_SET', { userId: id, adminRole: b?.adminRole }, k);
  }

  @Post(':id/status') @HttpCode(200) @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Pausa o reactiva el acceso al panel (al pausar se cierran sus sesiones)' })
  @Body$({ active: false }, ['active'])
  async status(@Me() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') k?: string) {
    const r = await this.cmd.run(u, 'STAFF_STATUS_SET', { userId: id, active: b?.active === true }, k);
    if (b?.active !== true) {
      const row = this.engine.store.ids.opt('users', id);
      if (row) await exec(this.engine.pool, 'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [row]);
    }
    return r;
  }

  @Post(':id/access') @HttpCode(200) @Auth('ADMIN:GENERAL')
  @ApiOperation({ summary: 'Nueva clave temporal (por ejemplo, si olvidó su contraseña o perdió el celular): al entrar crea otra contraseña y activa otra vez su doble factor; cierra sus sesiones' })
  async reset(@Me() u: AuthUser, @Param('id') id: string, @Headers('idempotency-key') k?: string) {
    const r = await this.cmd.run(u, 'STAFF_ACCESS_RESET', { userId: id }, k);
    return { ...r, access: await this.credentials(id) };
  }
}
