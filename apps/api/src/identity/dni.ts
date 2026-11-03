/*
 * Consulta del DNI: ¿el nombre que escribió la persona es el que figura en RENIEC para ese número?
 *
 * - Con DNI_API_URL y DNI_API_TOKEN, pregunta a un proveedor de consultas (cada consulta cuesta: se
 *   guarda 30 días en identity_lookups y hay un tope diario). Cada proveedor nombra distinto los
 *   campos; se leen los nombres más comunes (nombres, apellido_paterno, first_name, fullName...).
 *   Si el proveedor informa el fallecimiento, se usa; si no, queda «la fuente no lo informa».
 * - Sin proveedor, en la demo responde el padrón de prueba (TEST_DNIS), con un DNI de una persona
 *   fallecida para ver el bloqueo.
 * - A quien se registra solo se le dice si coincide; el nombre oficial queda para el equipo.
 * - Cuando llega un expediente con identidad, el servidor consulta y anota el resultado
 *   (VERIF_IDCHECK, acción que solo hace el servidor).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { registryFor, testDni, dniDigitOk } from '@mesagri/shared';
import type { RegistryCheck } from '@mesagri/shared';
import { CONFIG } from '../config';
import { exec, rows } from '../db/db';
import { EngineService, type Applied } from '../core/engine.service';

export interface ProviderPerson { found: boolean; surnames?: string; given?: string; full?: string; deceased: boolean | null; digit?: string }

/** Lee los nombres en la respuesta del proveedor, se llamen como se llamen. */
export function readProviderPerson(body: unknown): ProviderPerson {
  const flat: Record<string, unknown> = {};
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 3) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = k.toLowerCase().replace(/[^a-z]/g, '');
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1);
      else if (flat[key] === undefined) flat[key] = v;
    }
  };
  walk(body, 0);
  const pick = (...keys: string[]) => { for (const k of keys) { const v = flat[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return undefined; };
  const given = pick('nombres', 'prenombres', 'firstname', 'firstnames', 'givennames', 'given');
  const pat = pick('apellidopaterno', 'paternallastname', 'paternalname', 'firstlastname', 'primerapellido', 'apepat');
  const mat = pick('apellidomaterno', 'maternallastname', 'maternalname', 'secondlastname', 'segundoapellido', 'apemat');
  const surnames = [pat, mat].filter(Boolean).join(' ') || pick('lastname', 'apellidos', 'surnames');
  const full = pick('nombrecompleto', 'fullname', 'nombrescompletos', 'completename');
  let deceased: boolean | null = null;
  for (const k of ['fallecido', 'deceased', 'isdeceased', 'fechafallecimiento', 'fechadefuncion', 'dateofdeath', 'defuncion']) {
    const v = flat[k];
    if (v === undefined || v === null || v === '') continue;
    deceased = typeof v === 'boolean' ? v : /^(si|sí|true|1|s|y|yes)$/i.test(String(v).trim()) || /\d{4}|\d{2}\/\d{2}/.test(String(v));
    break;
  }
  const estado = pick('estado', 'restriccion', 'restricciones', 'observacion', 'observaciones', 'vitalstatus');
  if (estado && /FALLEC|DECEAS|DEFUNC/i.test(estado)) deceased = true;
  const digit = pick('digitoverificador', 'codigoverificacion', 'verificationdigit', 'verificationnumber', 'digitoverificacion', 'dv');
  return { found: !!(given || surnames || full), surnames, given, full, deceased, digit: digit && /^[0-9A-K]$/i.test(digit) ? digit.toUpperCase() : undefined };
}

@Injectable()
export class DniRegistry implements OnModuleInit {
  private readonly log = new Logger('DNI');
  private day = { date: '', n: 0 };

  constructor(private readonly engine: EngineService) {}

  onModuleInit() {
    // expediente con identidad: el servidor consulta el DNI y anota el resultado
    this.engine.bus.on('event', (a: Applied) => {
      const t = a.event.type;
      if ((t === 'VERIF_SUBMIT' || t === 'VERIF_RESPOND') && a.event.p?.identity) {
        void this.autoCheck(String(a.event.p.caseId)).catch(e => this.log.warn(`Consulta del DNI: ${e?.message ?? e}`));
      }
    });
  }

  configured(): boolean { return !!(CONFIG.dniApi.url && CONFIG.dniApi.token); }
  source(): RegistryCheck['source'] { return this.configured() ? 'PROVEEDOR' : CONFIG.demo ? 'PADRON_PRUEBA' : 'SIN_CONSULTA'; }
  providerName(): string {
    if (CONFIG.dniApi.provider) return CONFIG.dniApi.provider;
    try { return new URL(CONFIG.dniApi.url.replace('{dni}', '0')).hostname; } catch { return 'proveedor'; }
  }

  /** Consulta el DNI y compara el nombre (y el dígito, si el proveedor lo da). */
  async check(dni: string, name: string, digit?: string, opts: { fresh?: boolean } = {}): Promise<RegistryCheck> {
    const at = this.engine.simNow();
    const src = this.source();
    if (src === 'PADRON_PRUEBA') return registryFor(testDni(dni), dni, name, digit, at, 'PADRON_PRUEBA');
    if (src === 'SIN_CONSULTA') return { status: 'UNAVAILABLE', source: 'SIN_CONSULTA', digitOk: dniDigitOk(dni, digit), deceased: null, at, note: 'No hay un proveedor de consulta del DNI configurado.' };
    const r = await this.lookup(dni, opts.fresh);
    const provider = this.providerName();
    if ('error' in r) return { status: 'UNAVAILABLE', source: 'PROVEEDOR', provider, digitOk: dniDigitOk(dni, digit), deceased: null, at, note: r.error };
    const person = r.found ? { dni, surnames: r.surnames ?? r.full ?? '', given: r.surnames ? r.given ?? '' : '', deceased: r.deceased ?? undefined, note: '' } : undefined;
    const reg = registryFor(person, dni, name, digit, at, 'PROVEEDOR', provider);
    if (r.found && r.deceased === null) reg.deceased = null;
    // si el proveedor da el dígito, manda el suyo
    if (r.digit && digit) reg.digitOk = r.digit === String(digit).trim().toUpperCase();
    return reg;
  }

  private async lookup(dni: string, fresh?: boolean): Promise<ProviderPerson | { error: string }> {
    const pool = this.engine.pool;
    if (!fresh) {
      const c = (await rows(pool, 'SELECT found, data FROM identity_lookups WHERE dni = ? AND purge_after > NOW(3)', [dni]))[0];
      if (c) return { ...(c.data ?? {}), found: !!c.found, deceased: c.data?.deceased ?? null } as ProviderPerson;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (this.day.date !== today) this.day = { date: today, n: 0 };
    if (this.day.n >= CONFIG.dniApi.dailyMax) return { error: 'Se llegó al tope de consultas del día. Lo revisa una persona del equipo.' };
    this.day.n++;
    const url = CONFIG.dniApi.url.includes('{dni}') ? CONFIG.dniApi.url.replace('{dni}', dni) : CONFIG.dniApi.url.replace(/\/?$/, '/') + dni;
    const header = CONFIG.dniApi.header || 'Authorization';
    const value = header.toLowerCase() === 'authorization' && !/^(bearer|basic|token)\s/i.test(CONFIG.dniApi.token) ? `Bearer ${CONFIG.dniApi.token}` : CONFIG.dniApi.token;
    let res: Response;
    try {
      res = await fetch(url, { headers: { [header]: value, Accept: 'application/json' }, signal: AbortSignal.timeout(CONFIG.dniApi.timeoutMs) });
    } catch (e: any) {
      this.log.warn(`El proveedor no respondió: ${e?.name === 'TimeoutError' ? 'tardó demasiado' : e?.message ?? e}`);
      return { error: 'El servicio de consulta del DNI no respondió. Lo revisa una persona del equipo.' };
    }
    let body: unknown = undefined;
    try { body = await res.json(); } catch { /* sin JSON */ }
    if (res.status === 401 || res.status === 403) { this.log.warn(`El proveedor rechazó el token (${res.status})`); return { error: 'El servicio de consulta del DNI rechazó la clave. Revisa DNI_API_TOKEN en Render.' }; }
    if (res.status === 429 || res.status >= 500) return { error: 'El servicio de consulta del DNI está ocupado. Lo revisa una persona del equipo.' };
    const person: ProviderPerson = res.status === 404 || res.status === 400 || res.status === 422 ? { found: false, deceased: null } : readProviderPerson(body);
    if (!res.ok && !person.found && res.status !== 404 && res.status !== 400 && res.status !== 422) return { error: `El servicio de consulta del DNI respondió ${res.status}.` };
    try {
      await exec(pool, 'INSERT INTO identity_lookups (dni, source, provider, found, data, looked_up_at, purge_after) VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3) + INTERVAL 30 DAY) AS n ON DUPLICATE KEY UPDATE found = n.found, data = n.data, provider = n.provider, looked_up_at = n.looked_up_at, purge_after = n.purge_after',
        [dni, 'PROVEEDOR', this.providerName().slice(0, 60), person.found ? 1 : 0, JSON.stringify(person)]);
      await exec(pool, 'DELETE FROM identity_lookups WHERE purge_after < NOW(3)');
    } catch (e: any) { this.log.warn(`No se guardó la consulta: ${e?.message ?? e}`); }
    return person;
  }

  /** Consulta el DNI de un expediente y lo anota (acción del servidor). */
  async autoCheck(caseId: string, fresh = false): Promise<RegistryCheck | undefined> {
    const k = this.engine.world.cases[caseId];
    if (!k?.identity) return undefined;
    const { dni, name, digit } = k.identity;
    const reg = await this.check(dni, name, digit, { fresh });
    const r = await this.engine.apply({ type: 'VERIF_IDCHECK', actor: 'system', p: { caseId, dni, registry: reg } }, true);
    if (!r.ok) this.log.warn(`No se anotó la consulta del DNI: ${r.error.message}`);
    return reg;
  }
}
