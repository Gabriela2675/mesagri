/* Límite de intentos en memoria (por IP y por celular), 14.4. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  clear() { this.hits.clear(); }
  /** true si todavía puede; registra el intento. */
  hit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter(t => now - t < windowMs);
    if (list.length >= max) { this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) this.hits.clear();
    return true;
  }
}
