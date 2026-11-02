/*
 * Lo que este navegador recuerda: preferencias de la vista de la demo (localStorage) y una copia
 * de las fotos tomadas aquí (IndexedDB), por si se cae la señal antes de subirlas.
 * Todo envuelto en try/catch: en una ventana privada la app funciona igual, solo que no recuerda.
 */
const UI_KEY = 'mesagri.v2.ui';

export function lsGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
export function lsSet(key: string, v: string): boolean { try { localStorage.setItem(key, v); return true; } catch { return false; } }
export function lsDel(key: string) { try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ } }

export function loadUi<T>(fallback: T, key = UI_KEY): T {
  const raw = lsGet(key);
  if (!raw) return fallback;
  try { return { ...fallback, ...JSON.parse(raw) }; } catch { return fallback; }
}
export function saveUi(v: unknown, key = UI_KEY) { lsSet(key, JSON.stringify(v)); }
export function clearUi(key = UI_KEY) { lsDel(key); }

/* ---------- Copia local de las fotos (IndexedDB) ---------- */
let dbp: Promise<IDBDatabase | null> | undefined;
function idb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const req = indexedDB.open('mesagri-fotos', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('photos'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 2500);
    } catch { resolve(null); }
  });
  return dbp;
}

export async function idbPut(id: string, dataUrl: string): Promise<void> {
  const db = await idb();
  if (!db) return;
  try { await new Promise<void>(res => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(dataUrl, id); tx.oncomplete = () => res(); tx.onerror = () => res(); }); } catch { /* sin espacio */ }
}

export async function idbGet(id: string): Promise<string | undefined> {
  const db = await idb();
  if (!db) return undefined;
  try {
    return await new Promise<string | undefined>(res => { const tx = db.transaction('photos', 'readonly'); const r = tx.objectStore('photos').get(id); r.onsuccess = () => res(r.result as string | undefined); r.onerror = () => res(undefined); });
  } catch { return undefined; }
}

export async function idbDel(id: string): Promise<void> {
  const db = await idb();
  if (!db) return;
  try { await new Promise<void>(res => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); }); } catch { /* */ }
}
