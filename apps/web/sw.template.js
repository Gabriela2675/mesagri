/*
 * Mesagri · service worker de la app instalable (versión autónoma).
 * Guarda la app completa en el celular: se abre aunque no haya señal y, cuando hay, se actualiza sola.
 */
const VERSION = '__VERSION__';
const CACHE = 'mesagri-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mesagri-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // páginas: primero la red (para tener la última versión), si no hay señal, la copia guardada
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./', { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }
  // archivos de la app (llevan su huella en el nombre): primero la copia guardada
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    })),
  );
});
