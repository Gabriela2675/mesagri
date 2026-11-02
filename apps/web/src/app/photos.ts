/*
 * Fotos (14.5): se comprimen en el celular (unos 300 KB) y se suben aparte al servidor, con
 * reintento. Mientras tanto se ven desde la copia local. Las fotos de productos se leen con su
 * enlace; el DNI, la selfie y los documentos, con un enlace firmado de un minuto.
 */
import { api, API, isNetwork } from './net';
import { idbDel, idbGet, idbPut, lsGet, lsSet } from './persist';
import type { Store } from './store';

export interface PhotoStore {
  put(id: string, dataUrl: string, opt?: { kind?: string; userId?: string }): Promise<void>;
  get(id: string): Promise<string | undefined>;
  peek(id: string): string | undefined;
}

const QUEUE_KEY = 'mesagri.v2.uploads';
type Item = { id: string; kind: string; userId?: string; tries: number; nextAt: number };

/** Tipo de archivo del servidor según lo que se fotografía. */
export function fileKind(k?: string): 'FOTO' | 'DNI' | 'SELFIE' | 'DOCUMENTO' {
  if (!k) return 'FOTO';
  if (k === 'dni' || k === 'licencia') return 'DNI';
  if (k === 'selfie') return 'SELFIE';
  if (['documento', 'ruc', 'constancia', 'autorizacion', 'soat', 'citv', 'tuc'].includes(k)) return 'DOCUMENTO';
  return 'FOTO';
}

export function serverPhotos(store: Store): PhotoStore & { pendingUploads(): number } {
  const mem = new Map<string, string>();
  const urls = new Map<string, { url: string; until: number }>();
  let queue: Item[] = [];
  try { queue = JSON.parse(lsGet(QUEUE_KEY) ?? '[]'); } catch { queue = []; }
  const save = () => lsSet(QUEUE_KEY, JSON.stringify(queue));
  let busy = false;

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      for (const it of [...queue]) {
        if (it.nextAt > Date.now()) continue;
        const data = mem.get(it.id) ?? (await idbGet(it.id));
        if (!data) { queue = queue.filter(x => x !== it); save(); continue; }
        const userId = it.userId && store.sessions.has(it.userId) ? it.userId : store.sessions.any()?.userId;
        if (!userId) break; // todavía sin sesión (registro en curso): se sube después
        try {
          const token = await store.sessions.token(userId);
          if (!token) break;
          await api('/files', { token, body: { id: it.id, kind: it.kind, dataUrl: data } });
          queue = queue.filter(x => x !== it);
          save();
        } catch (e) {
          it.tries++;
          it.nextAt = Date.now() + Math.min(60_000, 1500 * 2 ** Math.min(it.tries, 5));
          save();
          if (!isNetwork(e) && it.tries > 3) { queue = queue.filter(x => x !== it); save(); }
          if (isNetwork(e)) break;
        }
      }
    } finally { busy = false; }
  }
  setInterval(() => { void pump(); }, 3000);

  return {
    pendingUploads: () => queue.length,
    peek: (id) => mem.get(id) ?? urls.get(id)?.url,
    async put(id, dataUrl, opt) {
      mem.set(id, dataUrl);
      await idbPut(id, dataUrl);
      queue.push({ id, kind: fileKind(opt?.kind), userId: opt?.userId, tries: 0, nextAt: 0 });
      save();
      void pump();
    },
    async get(id) {
      if (mem.has(id)) return mem.get(id);
      const local = await idbGet(id);
      if (local) { mem.set(id, local); return local; }
      const cached = urls.get(id);
      if (cached && cached.until > Date.now()) return cached.url;
      const url = `${API}/files/${encodeURIComponent(id)}`;
      try {
        const head = await fetch(url, { method: 'HEAD' });
        if (head.ok) { urls.set(id, { url, until: Infinity }); return url; }
        if (head.status === 403) {
          // documento de identidad: enlace firmado de un minuto (lo pide quien puede verlo)
          for (const uid of store.sessions.ids()) {
            try {
              const token = await store.sessions.token(uid);
              const r = await api<{ url: string; expiresAt: number }>(`/files/${encodeURIComponent(id)}/url`, { token });
              urls.set(id, { url: r.url, until: r.expiresAt - 5000 });
              return r.url;
            } catch { /* esta sesión no puede verlo */ }
          }
        }
      } catch { /* sin señal */ }
      return undefined;
    },
  };
}

export async function clearLocalPhoto(id: string) { await idbDel(id); }

/** Versión autónoma: las fotos quedan en el celular (IndexedDB), no se suben a ningún servidor. */
export function localPhotos(): PhotoStore & { pendingUploads(): number } {
  const mem = new Map<string, string>();
  return {
    pendingUploads: () => 0,
    peek: (id) => mem.get(id),
    async put(id, dataUrl) { mem.set(id, dataUrl); await idbPut(id, dataUrl); },
    async get(id) {
      if (mem.has(id)) return mem.get(id);
      const local = await idbGet(id);
      if (local) mem.set(id, local);
      return local;
    },
  };
}
