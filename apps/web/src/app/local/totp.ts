/*
 * Doble factor (TOTP, RFC 6238) para la versión sin internet: el mismo código de 6 dígitos que
 * muestran Google Authenticator o Microsoft Authenticator. SHA-1 y HMAC escritos aquí porque el
 * WebView del APK sin internet no siempre tiene crypto.subtle (no es un «contexto seguro»).
 */

function sha1(data: Uint8Array): Uint8Array {
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const o = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => o.setUint32(i * 4, h));
  return out;
}

export function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? sha1(key) : key);
  const inner = new Uint8Array(64 + msg.length);
  const outer = new Uint8Array(64 + 20);
  for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(msg, 64);
  outer.set(sha1(inner), 64);
  return sha1(outer);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => new Uint8Array((String(h).match(/../g) ?? []).map(x => parseInt(x, 16)));

/** Bytes al azar (secreto del doble factor, sal de la contraseña). */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); }
  return b;
}

export function totpAt(secret: Uint8Array, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const msg = new Uint8Array(8);
  const dv = new DataView(msg.buffer);
  dv.setUint32(0, Math.floor(counter / 2 ** 32));
  dv.setUint32(4, counter >>> 0);
  const h = hmacSha1(secret, msg);
  const o = h[19] & 15;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(n).padStart(6, '0');
}

export function verifyTotp(secret: Uint8Array, code: string, at = Date.now()): boolean {
  const c = String(code ?? '').replace(/\D/g, '');
  return c.length === 6 && [-1, 0, 1].some(d => totpAt(secret, at + d * 30_000) === c);
}

export const otpauthUri = (email: string, secret: Uint8Array) => `otpauth://totp/Mesagri:${encodeURIComponent(email)}?secret=${base32(secret)}&issuer=Mesagri&digits=6&period=30`;

/** Huella de la contraseña (en el celular, con sal y muchas vueltas de HMAC-SHA1). */
export function passwordHash(password: string, saltHex: string): string {
  const enc = new TextEncoder();
  let h = hmacSha1(fromHex(saltHex), enc.encode(password));
  for (let i = 0; i < 2000; i++) h = hmacSha1(h, enc.encode(password));
  return toHex(h);
}
