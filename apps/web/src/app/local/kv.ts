/*
 * Guardado de la versión autónoma en el celular (IndexedDB). Si el navegador no lo permite
 * (ventana privada), la app funciona igual mientras esté abierta.
 */
let dbp: Promise<IDBDatabase | null> | undefined;
const mem = new Map<string, unknown>();

function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const req = indexedDB.open('mesagri-local', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      setTimeout(() => resolve(null), 4000);
    } catch { resolve(null); }
  });
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) return mem.get(key) as T | undefined;
  return new Promise(resolve => {
    try {
      const r = d.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve((r.result as T) ?? (mem.get(key) as T | undefined));
      r.onerror = () => resolve(mem.get(key) as T | undefined);
    } catch { resolve(mem.get(key) as T | undefined); }
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  mem.set(key, value);
  const d = await db();
  if (!d) return;
  await new Promise<void>(resolve => {
    try {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

export async function kvDel(key: string): Promise<void> {
  mem.delete(key);
  const d = await db();
  if (!d) return;
  await new Promise<void>(resolve => {
    try {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
