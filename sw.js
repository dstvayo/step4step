const CACHE = 's4s-v10';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/estimate.js',
  './js/points.js',
  './js/backup.js',
  './js/homesync.js',
  './js/ai.js',
  './js/sync.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Netzwerk zuerst, Cache als Offline-Reserve: Updates kommen so bei jedem Start mit Internet an,
// ohne dass eine neue Cache-Version nötig ist. Bei langsamem Netz (> 3 s) greift der Cache.
self.addEventListener('fetch', e => {
  const req = e.request;
  // Nur eigene Dateien – Gemini, Firebase usw. laufen direkt ins Netz
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const fromNet = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });
  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  const slow = new Promise(r => setTimeout(r, 3000)).then(fromCache);

  e.respondWith(
    Promise.race([fromNet, slow])
      .then(r => r || fromNet)
      .catch(() => fromCache().then(r => r || Response.error()))
  );
});

// Neustart-Button: alle App-Dateien frisch laden. addAll ist „alles oder nichts“ –
// ohne Internet bleibt der bisherige Stand im Cache und die App startet trotzdem.
self.addEventListener('message', e => {
  if (e.data !== 'refresh') return;
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => e.ports[0]?.postMessage('ok'), () => e.ports[0]?.postMessage('offline'))
  );
});

// ── Benachrichtigung angeklickt ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.registration.scope) && 'focus' in c) {
          return c.focus();
        }
      }
      return clients.openWindow(self.registration.scope);
    })
  );
});
