/*
 * Cifrado en la aplicación (14.9): AES-256-GCM para cuentas de cobro y códigos de entrega;
 * SHA-256 para huellas (códigos, tokens). La clave viene de DATA_KEY y nunca va al repositorio.
 */
import crypto from 'node:crypto';
import { CONFIG } from '../config';

/** 64 caracteres hexadecimales = la clave tal cual; cualquier otro secreto largo (el que genera la nube) se convierte en 32 bytes con SHA-256. */
function dataKey(v: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  if (v.length < 32) throw new Error('DATA_KEY debe tener 64 caracteres hexadecimales o ser un secreto de al menos 32 caracteres.');
  return crypto.createHash('sha256').update(v, 'utf8').digest();
}
const KEY = dataKey(CONFIG.dataKey);

export function encrypt(text: string): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function decrypt(buf: Buffer): string {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
