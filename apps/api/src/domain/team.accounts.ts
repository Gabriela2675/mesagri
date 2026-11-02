/*
 * El equipo de Mesagri se conserva al reiniciar la demo.
 *
 * Reiniciar la demo vuelve a la historia de ejemplo, pero no cambia quién trabaja en Mesagri: las
 * personas que agregó la administración general, los roles que cambió, los datos que cada persona
 * personalizó y las claves que hizo suyas se guardan en team_accounts y se vuelven a poner sobre la
 * historia nueva. Una cuenta del equipo sin clave guardada aquí es una cuenta de prueba: entra con
 * la clave de la demo y el código que se ve con la clave del equipo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { isPhoneValid, defaultPrefs, seedSets, type World, type User } from '@mesagri/shared';
import { EngineService, Applied } from '../core/engine.service';
import { exec, rows } from '../db/db';

/** Lo que se guarda de cada persona del equipo. */
interface Saved { name: string; shortName?: string; email?: string; phone?: string; adminRole?: User['adminRole']; status?: User['status']; createdAt?: number }

const PROFILE_EVENTS = new Set(['STAFF_ADD', 'STAFF_ROLE_SET', 'STAFF_STATUS_SET', 'PROFILE_SET']);

@Injectable()
export class TeamAccounts {
  private readonly log = new Logger('Equipo');

  constructor(private readonly engine: EngineService) {
    engine.seedTransforms.push(w => this.overlay(w));
    engine.seedHooks.push(() => this.restoreCredentials());
    engine.bus.on('event', (a: Applied) => {
      if (!PROFILE_EVENTS.has(a.event.type)) return;
      const id = a.event.type === 'PROFILE_SET' ? a.event.actor : String(a.event.p?.userId ?? '');
      if (this.engine.world.users[id]?.role !== 'ADMIN') return;
      void this.saveProfile(id).catch(e => this.log.error(`No se pudo guardar al equipo: ${e?.message ?? e}`));
    });
  }

  /** Guarda los datos de una persona del equipo (como están ahora en el mundo). */
  async saveProfile(userId: string) {
    const u = this.engine.world.users[userId];
    if (!u || u.role !== 'ADMIN') return;
    const p: Saved = { name: u.name, shortName: u.shortName, email: u.email, phone: u.phone, adminRole: u.adminRole, status: u.status, createdAt: u.createdAt };
    await exec(this.engine.pool, 'INSERT INTO team_accounts (user_uuid, profile) VALUES (?, ?) AS n ON DUPLICATE KEY UPDATE profile = n.profile', [userId, JSON.stringify(p)]);
  }

  /** Guarda las claves que tiene ahora la persona (clave temporal, o contraseña y doble factor propios). */
  async saveCredentials(userId: string) {
    await this.saveProfile(userId);
    await exec(this.engine.pool, `UPDATE team_accounts t JOIN users u ON u.uuid = t.user_uuid
       SET t.password_hash = u.password_hash, t.password_temp = u.password_temp, t.password_temp_until = u.password_temp_until, t.totp_secret_enc = u.totp_secret_enc
     WHERE t.user_uuid = ?`, [userId]);
  }

  /** Personas del equipo con clave propia o temporal (ya no son cuentas de prueba). */
  async withCredentials(): Promise<Set<string>> {
    const list = await rows(this.engine.pool, 'SELECT user_uuid FROM team_accounts WHERE password_hash IS NOT NULL');
    return new Set(list.map(r => String(r.user_uuid)));
  }

  /** ¿Entra todavía con la clave de prueba de la demo? */
  async isDemo(userId: string): Promise<boolean> {
    return seedSets().users.has(userId) && !(await this.withCredentials()).has(userId);
  }

  /** Sobre la historia de ejemplo nueva: el equipo vuelve con sus datos y quienes se agregaron vuelven a estar. */
  private async overlay(w: World) {
    const list = await rows(this.engine.pool, 'SELECT user_uuid, profile FROM team_accounts ORDER BY updated_at');
    if (!list.length) return;
    const org = Object.values(w.orgs).find(o => o.type === 'MESAGRI');
    let n = 0;
    for (const r of list) {
      const id = String(r.user_uuid);
      const p: Saved | undefined = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile;
      if (!p?.name || !org) continue;
      const free = (pred: (x: User) => boolean) => !Object.values(w.users).some(x => x.id !== id && pred(x));
      const email = p.email && free(x => (x.email ?? '').toLowerCase() === p.email!.toLowerCase()) ? p.email : undefined;
      const phone = p.phone && isPhoneValid(p.phone) && free(x => x.phone === p.phone) ? p.phone : undefined;
      const u = w.users[id];
      if (u) {
        if (u.role !== 'ADMIN') continue; // en la historia nueva ese id es de otra cuenta
        u.name = p.name;
        if (p.shortName) u.shortName = p.shortName;
        if (email) u.email = email;
        if (phone) u.phone = phone;
        if (p.adminRole) u.adminRole = p.adminRole;
        if (p.status) u.status = p.status;
      } else {
        if (!email || !phone || !p.adminRole) continue;
        w.users[id] = { id, name: p.name, shortName: p.shortName ?? p.name.split(' ')[0], phone, role: 'ADMIN', adminRole: p.adminRole, orgId: org.id, email, createdAt: Math.min(p.createdAt ?? w.now, w.now), prefs: defaultPrefs('es'), status: p.status ?? 'ACTIVE' };
        if (!org.memberIds.includes(id)) org.memberIds.push(id);
      }
      n++;
    }
    // siempre queda al menos una persona de administración general con acceso
    const generals = Object.values(w.users).filter(u => u.role === 'ADMIN' && u.adminRole === 'GENERAL' && u.status === 'ACTIVE');
    if (!generals.length) for (const id of ['u-majo', 'u-gaby', 'u-dayis', 'u-kevin']) if (w.users[id]) { w.users[id].adminRole = 'GENERAL'; w.users[id].status = 'ACTIVE'; }
    if (n) this.log.log(`El equipo de Mesagri vuelve con sus datos (${n} ${n === 1 ? 'persona' : 'personas'})`);
  }

  /** Después de guardar la historia nueva: cada persona vuelve a entrar con sus claves. */
  private async restoreCredentials() {
    await exec(this.engine.pool, `UPDATE users u JOIN team_accounts t ON t.user_uuid = u.uuid
       SET u.password_hash = t.password_hash, u.password_temp = t.password_temp, u.password_temp_until = t.password_temp_until, u.totp_secret_enc = t.totp_secret_enc
     WHERE t.password_hash IS NOT NULL`);
  }
}
