/*
 * Clave del equipo (TEAM_KEY). Protege lo que solo debe usar el equipo que presenta la demo:
 * sesiones sin código de las personas de ejemplo, reloj, reinicio, claves y códigos del panel y
 * el mundo completo del escenario de varios celulares. Viaja en el encabezado x-team-key.
 * Sin TEAM_KEY (instalación local en una red de confianza) todo queda abierto, como antes.
 */
import crypto from 'node:crypto';
import { CONFIG } from '../config';
import { DomainHttpError } from './errors';

export function teamOk(key: unknown): boolean {
  if (!CONFIG.teamKey) return true;
  const a = crypto.createHash('sha256').update(String(key ?? '')).digest();
  const b = crypto.createHash('sha256').update(CONFIG.teamKey).digest();
  return crypto.timingSafeEqual(a, b);
}

export function requireTeam(key: unknown) {
  if (!teamOk(key)) throw new DomainHttpError(401, 'TEAM_KEY', 'Esta herramienta es del equipo de Mesagri: falta la clave del equipo o no es correcta.');
}
