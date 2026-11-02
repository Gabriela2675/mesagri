/*
 * Contraseñas con Argon2id (hash-wasm, sin compilar nada nativo) y doble factor TOTP (RFC 6238),
 * compatible con Google Authenticator o Microsoft Authenticator.
 */
import crypto from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: crypto.randomBytes(16), parallelism: 1, iterations: 3, memorySize: 19456, hashLength: 32, outputType: 'encoded' });
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try { return await argon2Verify({ password, hash }); } catch { return false; }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function totp(secret: Buffer, at = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(at / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

/** Acepta el código actual y el de 30 s antes o después (relojes un poco desfasados). */
export function verifyTotp(secret: Buffer, code: string, at = Date.now()): boolean {
  const c = String(code ?? '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  for (const d of [-1, 0, 1]) {
    const exp = totp(secret, at + d * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) return true;
  }
  return false;
}

export function otpauthUri(email: string, secret: Buffer): string {
  return `otpauth://totp/Mesagri:${encodeURIComponent(email)}?secret=${base32(secret)}&issuer=Mesagri&digits=6&period=30`;
}

/** Código de 6 dígitos para el celular (WhatsApp o SMS). */
export const otpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
