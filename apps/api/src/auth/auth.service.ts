/*
 * Autenticación (14.4): celular con código de un solo uso, cuentas del panel con contraseña
 * Argon2id y doble factor, token de acceso de 15 minutos y token de refresco rotativo guardado
 * como hash. Si alguien reutiliza un token ya rotado, se cierran todas las sesiones del usuario.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import crypto from 'node:crypto';
import { isPhoneValid, uid, seedSets, maskPhone } from '@mesagri/shared';
import type { User } from '@mesagri/shared';
import { CONFIG } from '../config';
import { exec, rows } from '../db/db';
import { decrypt, encrypt, randomToken, sha256 } from '../db/secure';
import { EngineService } from '../core/engine.service';
import { DomainHttpError, ruleError } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { hashPassword, otpCode, totp, verifyPassword, verifyTotp } from './secrets';
import { WhatsAppService, WhatsAppError } from './whatsapp';
import { teamOk } from '../common/team';

const ROLE_NAME: Record<string, string> = { FARMER: 'agricultor', BUYER: 'comprador (MYPE)', WAREHOUSE: 'almacén aliado', CARRIER: 'transportista aliado', ADMIN: 'equipo de Mesagri' };

export interface AuthUser { id: string; role: User['role']; adminRole?: User['adminRole']; orgId: string; name: string }
export interface Session { userId: string; accessToken: string; refreshToken: string; expiresAt: number }
export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'RECOVER';

const OTP_TTL = 5 * 60_000;
const ID_RE = /^[A-Za-z0-9:_.-]{3,80}$/;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Autenticación');
  private readonly limiter = new RateLimiter();

  constructor(private readonly engine: EngineService, private readonly jwt: JwtService, private readonly wa: WhatsAppService) {
    engine.seedHooks.push(() => this.ensureTeamCredentials());
    // al reiniciar la demo se empieza de cero también con los límites de intentos
    engine.bus.on('reset', () => this.limiter.clear());
  }

  async onModuleInit() {
    await this.engine.whenReady;
    await this.ensureTeamCredentials();
  }

  /** Las cuentas del equipo necesitan contraseña y secreto de doble factor (se crean al sembrar). */
  async ensureTeamCredentials() {
    const list = await rows(this.engine.pool, `
      SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'ADMIN' AND (u.password_hash IS NULL OR u.totp_secret_enc IS NULL)`);
    if (!list.length) return;
    const hash = await hashPassword(CONFIG.adminPassword);
    for (const r of list) {
      await exec(this.engine.pool, 'UPDATE users SET password_hash = ?, totp_secret_enc = ? WHERE id = ?', [hash, encrypt(crypto.randomBytes(20).toString('hex')), r.id]);
    }
    this.log.log(`Claves y doble factor del equipo listos (${list.length} cuentas)`);
  }

  private guard(key: string, max: number, windowMs: number) {
    if (!this.limiter.hit(key, max, windowMs)) throw new DomainHttpError(429, 'TOO_MANY', 'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentar.');
  }

  private userByPhone(phone: string): User | undefined {
    return Object.values(this.engine.world.users).find(u => u.phone === phone);
  }

  /* ---------------- Códigos por WhatsApp o SMS ---------------- */

  /* ---------------- Celulares de confianza ---------------- */

  /** ¿Esta llave es de un celular donde la persona ya ingresó? */
  private async deviceTrusted(userId: string, key?: string): Promise<boolean> {
    if (!key || !/^[A-Za-z0-9_-]{20,100}$/.test(key)) return false;
    const row = this.engine.store.ids.opt('users', userId);
    if (!row) return false;
    const r = await rows(this.engine.pool, 'SELECT id FROM trusted_devices WHERE user_id = ? AND key_hash = ?', [row, sha256(key)]);
    return r.length > 0;
  }

  /** Recuerda el celular donde se ingresó y devuelve su llave (la misma si ya la tenía). */
  async trustDevice(userId: string, key?: string, label?: string): Promise<string | undefined> {
    const row = this.engine.store.ids.opt('users', userId);
    if (!row) return undefined;
    if (key && (await this.deviceTrusted(userId, key))) {
      await exec(this.engine.pool, 'UPDATE trusted_devices SET last_used_at = NOW(3) WHERE key_hash = ?', [sha256(key)]);
      return key;
    }
    const fresh = randomToken(24);
    await exec(this.engine.pool, 'INSERT INTO trusted_devices (user_id, key_hash, label) VALUES (?, ?, ?)', [row, sha256(fresh), label ? String(label).slice(0, 80) : null]);
    return fresh;
  }

  /**
   * En la versión de prueba no hay proveedor de SMS y el código se muestra en pantalla. Para que
   * nadie entre a la cuenta de otra persona con solo saber su número, a las cuentas reales se les
   * muestra solo en un celular donde ya ingresaron (o si el equipo restableció su acceso). Las
   * cuentas de ejemplo son públicas: siempre lo muestran.
   */
  private async showCode(u: User | undefined, purpose: OtpPurpose, deviceKey?: string): Promise<boolean> {
    if (!CONFIG.demo) return false;
    if (purpose === 'REGISTER' || !u || !CONFIG.teamKey) return true;
    if (seedSets().users.has(u.id)) return true;
    if (await this.deviceTrusted(u.id, deviceKey)) return true;
    const row = this.engine.store.ids.opt('users', u.id);
    const n = row ? (await rows(this.engine.pool, 'SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?', [row]))[0] : { n: 0 };
    return !Number(n?.n ?? 0);
  }

  /** Guarda un código nuevo (solo su huella) y lo devuelve para mandarlo o mostrarlo. */
  private async issueCode(phone: string, purpose: OtpPurpose): Promise<string> {
    const code = otpCode();
    await exec(this.engine.pool, 'INSERT INTO otp_codes (phone_e164, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)', ['+51' + phone, purpose, sha256(`${phone}:${purpose}:${code}`), new Date(Date.now() + OTP_TTL)]);
    return code;
  }

  /** Pedidos de código de cuentas de prueba hechos desde el celular de quien presenta (por WhatsApp). */
  private readonly demoAsks = new Map<string, { phone: string; purpose: OtpPurpose; until: number }>();

  /**
   * Pide un código de 6 dígitos.
   * - Con WhatsApp en modo «responder» (sin costo): no se manda nada todavía. La app abre WhatsApp
   *   con el mensaje listo para el número de Mesagri; cuando la persona lo envía, Meta avisa al
   *   webhook y se le responde con el código (answerWhatsApp). Como el mensaje sale de su propio
   *   WhatsApp, prueba que el número es suyo.
   * - Con WhatsApp en modo «plantilla»: Mesagri le escribe primero con el código (Meta lo cobra).
   * - Cuentas de ejemplo (públicas): el código se muestra en pantalla. Quien presenta (con la clave
   *   del equipo) lo pide por WhatsApp, como sería con una cuenta real.
   * - Sin WhatsApp: en la versión de prueba, en pantalla (con las reglas de los celulares de confianza).
   */
  async requestOtp(phoneRaw: string, purpose: OtpPurpose, ip: string, deviceKey?: string, teamKey?: string, stage = false) {
    const phone = String(phoneRaw ?? '').replace(/\s/g, '');
    if (!isPhoneValid(phone)) throw new DomainHttpError(422, 'BAD_PHONE', 'Ese número no parece correcto (9 dígitos, empieza con 9).');
    if (!['REGISTER', 'LOGIN', 'RECOVER'].includes(purpose)) throw new DomainHttpError(422, 'BAD_PURPOSE', 'Motivo no válido.');
    this.guard('otp-ip:' + ip, CONFIG.demo ? 300 : 40, 15 * 60_000);
    this.guard('otp:' + phone, CONFIG.demo ? 30 : 6, 15 * 60_000);
    const u = this.userByPhone(phone);
    if (purpose === 'REGISTER' && u) throw new DomainHttpError(409, 'PHONE_TAKEN', 'Ese celular ya tiene una cuenta. Ingresa con «Ya tengo cuenta».');
    // Las cuentas del equipo también reciben el código: al verificarlo, la app las lleva al panel web
    if (purpose !== 'REGISTER' && !u) throw new DomainHttpError(404, 'NO_ACCOUNT', 'No hay una cuenta con ese celular. Regístrate gratis.');
    const base = { expiresIn: OTP_TTL / 1000 };
    const wa = CONFIG.whatsapp;
    const presenter = teamKey !== undefined && teamOk(teamKey) && (!!teamKey || !CONFIG.teamKey);
    // escenario de la demo (celulares simulados en una pantalla, solo el equipo): código en pantalla
    if (CONFIG.demo && stage && presenter) {
      const code = await this.issueCode(phone, purpose);
      return { ...base, sent: true, channel: 'PANTALLA', demoCode: code, demoAccount: !!u && seedSets().users.has(u.id) };
    }

    if (u && seedSets().users.has(u.id)) {
      // cuenta de ejemplo: quien presenta la pide por WhatsApp, como sería de verdad
      if (CONFIG.demo && presenter && this.wa.responder) {
        let ask = '';
        do { ask = Array.from({ length: 4 }, () => 'ACDEFHJKMNPRTUVWXY'[crypto.randomInt(0, 18)]).join(''); } while (this.demoAsks.has(ask));
        for (const [k, v] of this.demoAsks) if (v.until < Date.now()) this.demoAsks.delete(k);
        this.demoAsks.set(ask, { phone, purpose, until: Date.now() + 10 * 60_000 });
        const link = await this.wa.link(`Hola Mesagri, quiero el código de la cuenta de prueba ${ask}`);
        if (link) return { ...base, sent: false, channel: 'WHATSAPP_IN', wa: link, demoAccount: true };
      }
      if (CONFIG.demo && presenter && this.wa.configured && !this.wa.responder && wa.demoTo.length) {
        const code = await this.issueCode(phone, purpose);
        try {
          for (const to of wa.demoTo) await this.wa.sendCode(to, code);
          return { ...base, sent: true, channel: 'WHATSAPP', to: maskPhone(wa.demoTo[0].slice(-9)), demoAccount: true };
        } catch (e) {
          return { ...base, sent: false, channel: 'PANTALLA', demoCode: code, demoAccount: true, notice: (e as WhatsAppError).userMessage ?? 'No pudimos enviar el WhatsApp.' };
        }
      }
      const code = await this.issueCode(phone, purpose);
      return { ...base, sent: CONFIG.demo, channel: 'PANTALLA', demoCode: CONFIG.demo ? code : undefined, demoAccount: true };
    }

    if (this.wa.responder) {
      const link = await this.wa.link(purpose === 'REGISTER' ? 'Hola Mesagri, quiero mi código para crear mi cuenta' : 'Hola Mesagri, quiero mi código para ingresar');
      if (link) return { ...base, sent: false, channel: 'WHATSAPP_IN', wa: link };
      this.log.warn('WhatsApp sin número de Mesagri: el código se muestra en pantalla');
    } else if (this.wa.configured) {
      this.guard('wa:' + phone, CONFIG.demo ? 8 : 5, 15 * 60_000);
      this.guard('wa-ip:' + ip, CONFIG.demo ? 60 : 30, 15 * 60_000);
      const code = await this.issueCode(phone, purpose);
      try {
        await this.wa.sendCode('51' + phone, code);
        return { ...base, sent: true, channel: 'WHATSAPP', to: maskPhone(phone) };
      } catch (e) {
        const why = e instanceof WhatsAppError ? e.userMessage : 'No pudimos enviar el WhatsApp.';
        // versión de prueba: para registrarse o en el celular de la persona, el código en pantalla
        if (CONFIG.demo && (await this.showCode(u, purpose, deviceKey))) return { ...base, sent: false, channel: 'PANTALLA', demoCode: code, notice: why };
        throw new DomainHttpError(502, 'WHATSAPP', why);
      }
    }
    // Sin proveedor de mensajes: en la versión de prueba el código se muestra en pantalla.
    const show = await this.showCode(u, purpose, deviceKey);
    const code = show ? await this.issueCode(phone, purpose) : undefined;
    return { ...base, sent: show, channel: 'PANTALLA', demoCode: code, ...(CONFIG.demo && !show ? { deviceOnly: true } : {}) };
  }

  /**
   * Alguien le escribió a Mesagri por WhatsApp: se le responde con su código. El número del que
   * escribe es el de su cuenta (o el de la cuenta que va a crear). Si el mensaje trae la clave de
   * un pedido de cuenta de prueba (quien presenta), el código es de esa cuenta de prueba.
   */
  async answerWhatsApp(m: { from: string; text: string }): Promise<void> {
    const from = String(m.from ?? '').replace(/\D/g, '');
    if (!from) return;
    const reply = (t: string) => this.wa.sendText(from, t);
    try {
      this.guard('wa-in:' + from, 8, 15 * 60_000);
    } catch {
      await reply('Pediste muchos códigos seguidos. Espera unos minutos y vuelve a intentar.');
      return;
    }
    const ask = [...String(m.text ?? '').toUpperCase().matchAll(/\b[A-Z]{4}\b/g)].map(x => x[0]).find(k => this.demoAsks.has(k));
    if (ask) {
      const d = this.demoAsks.get(ask)!;
      this.demoAsks.delete(ask);
      if (d.until >= Date.now()) {
        const code = await this.issueCode(d.phone, d.purpose);
        const who = this.userByPhone(d.phone);
        await reply(`Código de la cuenta de prueba de ${who?.name ?? 'Mesagri'}: *${code}*\n\nEscríbelo en la app. Vence en 5 minutos.`);
        return;
      }
    }
    if (!/^51\d{9}$/.test(from)) {
      await reply('Hola. Por ahora Mesagri funciona con celulares de Perú (+51).');
      return;
    }
    const phone = from.slice(2);
    if (!isPhoneValid(phone)) { await reply('Hola. Para usar Mesagri necesitas un celular de Perú.'); return; }
    const u = this.userByPhone(phone);
    if (u?.role === 'ADMIN') {
      await reply('Tu cuenta es del equipo de Mesagri: entra por el panel web con tu correo, tu contraseña y el código de tu app de autenticación.');
      return;
    }
    const purpose: OtpPurpose = u ? 'LOGIN' : 'REGISTER';
    const code = await this.issueCode(phone, purpose);
    const fmt = `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
    await reply(`Tu código de Mesagri es: *${code}*\n\nEscríbelo en la app para ${u ? 'ingresar' : 'crear tu cuenta'} con el celular ${fmt}. Vence en 5 minutos.\nNo se lo compartas a nadie: Mesagri nunca te lo pide.`);
  }

  async verifyOtp(phoneRaw: string, purpose: OtpPurpose, code: string, opts: { consume?: boolean } = {}) {
    const phone = String(phoneRaw ?? '').replace(/\s/g, '');
    this.guard('otp-check:' + phone, CONFIG.demo ? 60 : 12, 15 * 60_000);
    const r = (await rows(this.engine.pool, `
      SELECT id, code_hash, attempts FROM otp_codes WHERE phone_e164 = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW(3)
       ORDER BY id DESC LIMIT 1`, ['+51' + phone, purpose]))[0];
    if (!r) throw new DomainHttpError(422, 'CODE_EXPIRED', 'El código venció o no existe. Pide uno nuevo.');
    if (r.attempts >= 5) throw new DomainHttpError(429, 'TOO_MANY', 'Demasiados intentos con este código. Pide uno nuevo.');
    const ok = crypto.timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(sha256(`${phone}:${purpose}:${String(code ?? '').trim()}`)));
    if (!ok) {
      await exec(this.engine.pool, 'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [r.id]);
      throw new DomainHttpError(422, 'BAD_CODE', 'El código no es correcto. Revisa el mensaje o pide otro.');
    }
    if (opts.consume !== false) await exec(this.engine.pool, 'UPDATE otp_codes SET consumed_at = NOW(3) WHERE id = ?', [r.id]);
    return phone;
  }

  private async consumeOtp(phone: string, purpose: OtpPurpose) {
    await exec(this.engine.pool, 'UPDATE otp_codes SET consumed_at = NOW(3) WHERE phone_e164 = ? AND purpose = ? AND consumed_at IS NULL', ['+51' + phone, purpose]);
  }

  /** Paso del registro: el código se verifica y se entrega un permiso de 15 minutos para crear la cuenta. */
  async registerTicket(phone: string, code: string) {
    const p = await this.verifyOtp(phone, 'REGISTER', code);
    const ticket = await this.jwt.signAsync({ typ: 'otp', purpose: 'REGISTER', phone: p, ep: this.engine.epoch }, { expiresIn: 15 * 60 });
    return { ticket, expiresIn: 15 * 60 };
  }

  async register(ticket: string, ev: { id?: string; p: any }, device?: string, deviceKey?: string) {
    let t: any;
    try { t = await this.jwt.verifyAsync(ticket); } catch { throw new DomainHttpError(401, 'TICKET', 'Verifica tu celular otra vez: el permiso para crear la cuenta venció.'); }
    if (t.typ !== 'otp' || t.purpose !== 'REGISTER' || t.ep !== this.engine.epoch) throw new DomainHttpError(401, 'TICKET', 'Verifica tu celular otra vez.');
    const p = ev?.p ?? {};
    if (String(p.phone ?? '').replace(/\s/g, '') !== t.phone) throw new DomainHttpError(422, 'PHONE_MISMATCH', 'El celular no coincide con el que verificaste.');
    if (!ID_RE.test(String(p.userId ?? '')) || !ID_RE.test(String(p.orgId ?? ''))) throw new DomainHttpError(422, 'BAD_ID', 'Identificadores no válidos.');
    const r = await this.engine.apply({ id: ev.id, type: 'USER_REGISTER', actor: String(p.userId), p, device });
    if (!r.ok) throw ruleError(r.error);
    const session = await this.issue(String(p.userId), device);
    const { changes: _c, ...applied } = r as typeof r & { changes?: unknown };
    return { ...applied, event: undefined, session, deviceKey: await this.trustDevice(String(p.userId), deviceKey, device) };
  }

  /**
   * Ingreso con celular y código. Si la app dice qué tipo de cuenta espera (agricultor, comprador,
   * almacén o transportista) y el celular es de otro tipo, no se entra y el código sigue sirviendo
   * para reintentar con el tipo correcto. Las cuentas del equipo entran por el panel web.
   */
  async login(phone: string, code: string, device?: string, role?: string, deviceKey?: string) {
    const p = await this.verifyOtp(phone, 'LOGIN', code, { consume: false });
    const u = this.userByPhone(p);
    if (!u) { await this.consumeOtp(p, 'LOGIN'); throw new DomainHttpError(404, 'NO_ACCOUNT', 'No hay una cuenta con ese celular.'); }
    if (u.role === 'ADMIN') {
      await this.consumeOtp(p, 'LOGIN');
      const email = (await rows(this.engine.pool, 'SELECT email FROM users WHERE uuid = ?', [u.id]))[0]?.email ?? undefined;
      throw new DomainHttpError(409, 'USE_PANEL', 'Tu cuenta es del equipo de Mesagri: ingresa por el panel web con tu correo, tu contraseña y el código de tu app de autenticación.', { email });
    }
    const want = role ? String(role).toUpperCase() : undefined;
    if (want && want !== u.role && ['FARMER', 'BUYER', 'WAREHOUSE', 'CARRIER'].includes(want)) {
      throw new DomainHttpError(409, 'ROLE_MISMATCH', `Ese celular está registrado como ${ROLE_NAME[u.role] ?? 'otro tipo de cuenta'}. Elige «${ROLE_NAME[u.role]}» para ingresar.`, { role: u.role });
    }
    if (u.status === 'SUSPENDED') {
      await this.consumeOtp(p, 'LOGIN');
      const w = this.engine.world;
      const o = w.orgs[u.orgId];
      const m = o?.members?.find(x => x.userId === u.id);
      const titular = w.users[o?.memberIds[0] ?? '']?.name ?? 'El titular';
      if (m && !m.active) throw new DomainHttpError(403, 'MEMBER_PAUSED', `${titular} pausó tu acceso a ${o!.name}. Pídele que lo vuelva a activar.`);
      if (!m && o && o.memberIds[0] !== u.id && o.memberIds.includes(u.id)) throw new DomainHttpError(403, 'MEMBER_REMOVED', `${titular} te quitó el acceso a ${o.name}.`);
      throw new DomainHttpError(403, 'SUSPENDED', 'Tu cuenta está suspendida. Escribe a Soporte de Mesagri.');
    }
    await this.consumeOtp(p, 'LOGIN');
    await exec(this.engine.pool, 'UPDATE users SET last_login_at = NOW(3) WHERE uuid = ?', [u.id]);
    return { userId: u.id, role: u.role, session: await this.issue(u.id, device), deviceKey: await this.trustDevice(u.id, deviceKey, device) };
  }

  /* ---------------- Panel web: contraseña y doble factor ---------------- */

  async adminLogin(emailRaw: string, password: string, code: string, ip: string, device?: string) {
    this.guard('admin-ip:' + ip, CONFIG.demo ? 300 : 30, 15 * 60_000);
    const email = String(emailRaw ?? '').trim().toLowerCase();
    const r = (await rows(this.engine.pool, 'SELECT id, uuid, password_hash, totp_secret_enc, failed_logins, locked_until FROM users WHERE email = ?', [email]))[0];
    const u = r ? this.engine.world.users[r.uuid] : undefined;
    const bad = () => new DomainHttpError(401, 'BAD_LOGIN', 'El correo, la contraseña o el código de doble factor no son correctos.');
    if (!r || !u || u.role !== 'ADMIN') throw bad();
    if (r.locked_until && r.locked_until.getTime() > Date.now()) throw new DomainHttpError(429, 'LOCKED', 'La cuenta está bloqueada 15 minutos por intentos fallidos.');
    const okPass = await verifyPassword(String(password ?? ''), r.password_hash);
    const okCode = !!r.totp_secret_enc && verifyTotp(Buffer.from(decrypt(r.totp_secret_enc), 'hex'), String(code ?? ''));
    if (!okPass || !okCode) {
      const n = Number(r.failed_logins) + 1;
      await exec(this.engine.pool, 'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60_000) : null, r.id]);
      throw bad();
    }
    if (u.status !== 'ACTIVE') throw new DomainHttpError(403, 'SUSPENDED', 'Tu usuario está suspendido.');
    await exec(this.engine.pool, 'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [r.id]);
    return { userId: u.id, session: await this.issue(u.id, device) };
  }

  /** Código vigente del doble factor de una cuenta del equipo (solo para la demo). */
  async teamCodes() {
    const list = await rows(this.engine.pool, "SELECT u.uuid, u.email, u.totp_secret_enc FROM users u WHERE u.email IS NOT NULL AND u.totp_secret_enc IS NOT NULL ORDER BY u.id");
    const at = Date.now();
    return list.map(r => {
      const u = this.engine.world.users[r.uuid];
      return { userId: r.uuid, name: u?.name, email: r.email, adminRole: u?.adminRole, password: CONFIG.adminPassword, code: totp(Buffer.from(decrypt(r.totp_secret_enc), 'hex'), at), validFor: 30 - Math.floor(at / 1000) % 30 };
    });
  }

  /* ---------------- Sesiones ---------------- */

  async issue(userId: string, device?: string, family?: string): Promise<Session & { rowId: number }> {
    const fam = family ?? 'f' + uid();
    const accessToken = await this.jwt.signAsync({ typ: 'access', sub: userId, ep: this.engine.epoch, fam }, { expiresIn: CONFIG.accessTtlSeconds });
    const refreshToken = randomToken(32);
    const userRow = this.engine.store.ids.need('users', userId);
    const ins = await exec(this.engine.pool, 'INSERT INTO refresh_tokens (user_id, token_hash, family, device_label, expires_at) VALUES (?, ?, ?, ?, ?)',
      [userRow, sha256(refreshToken), fam, device ? String(device).slice(0, 80) : null, new Date(Date.now() + CONFIG.refreshTtlDays * 86_400_000)]);
    return { userId, accessToken, refreshToken, expiresAt: Date.now() + CONFIG.accessTtlSeconds * 1000, rowId: Number(ins.insertId) };
  }

  async refresh(token: string): Promise<Session> {
    const r = (await rows(this.engine.pool, 'SELECT rt.*, u.uuid FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = ?', [sha256(String(token ?? ''))]))[0];
    if (!r || r.expires_at.getTime() < Date.now()) throw new DomainHttpError(401, 'SESSION_EXPIRED', 'Tu sesión venció. Ingresa de nuevo.');
    if (r.revoked_at) {
      // un token ya rotado se volvió a usar: alguien pudo copiarlo. Se cierran todas las sesiones.
      await exec(this.engine.pool, 'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [r.user_id]);
      this.log.warn(`Token de refresco reutilizado (usuario ${r.uuid}): se cerraron sus sesiones`);
      throw new DomainHttpError(401, 'SESSION_REUSED', 'Por seguridad cerramos tus sesiones. Ingresa de nuevo.');
    }
    const u = this.engine.world.users[r.uuid];
    if (!u) throw new DomainHttpError(401, 'SESSION_EXPIRED', 'Tu sesión venció. Ingresa de nuevo.');
    const next = await this.issue(r.uuid, r.device_label ?? undefined, r.family);
    await exec(this.engine.pool, 'UPDATE refresh_tokens SET revoked_at = NOW(3), replaced_by = ? WHERE id = ?', [next.rowId, r.id]);
    const { rowId: _r, ...s } = next;
    return s;
  }

  async logout(token: string) {
    const r = (await rows(this.engine.pool, 'SELECT family FROM refresh_tokens WHERE token_hash = ?', [sha256(String(token ?? ''))]))[0];
    if (r) await exec(this.engine.pool, 'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE family = ? AND revoked_at IS NULL', [r.family]);
    return { ok: true };
  }

  /** Valida el token de acceso: firma, vigencia, época de la demo y que el usuario exista. */
  async verifyAccess(token: string): Promise<AuthUser> {
    let t: any;
    try { t = await this.jwt.verifyAsync(token); } catch (e: any) {
      throw new DomainHttpError(401, e?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID', 'Tu sesión venció. Ingresa de nuevo.');
    }
    if (t.typ !== 'access') throw new DomainHttpError(401, 'TOKEN_INVALID', 'Token no válido.');
    if (t.ep !== this.engine.epoch) throw new DomainHttpError(401, 'EPOCH', 'La demo se reinició. Ingresa de nuevo.');
    const u = this.engine.world.users[t.sub];
    if (!u) throw new DomainHttpError(401, 'NO_USER', 'Tu usuario ya no existe.');
    return { id: u.id, role: u.role, adminRole: u.adminRole, orgId: u.orgId, name: u.name };
  }

  /** Sesiones de las personas de ejemplo sin código (solo en modo demo: escenario de varios celulares). */
  async demoSessions(userIds: string[], device?: string): Promise<Session[]> {
    if (!CONFIG.demo) throw new DomainHttpError(403, 'NOT_DEMO', 'Solo disponible en modo demo.');
    const out: Session[] = [];
    for (const id of [...new Set(userIds ?? [])].slice(0, 40)) {
      if (!this.engine.world.users[id]) continue;
      const { rowId: _r, ...s } = await this.issue(id, device ?? 'escenario de la demo');
      out.push(s);
    }
    return out;
  }
}
