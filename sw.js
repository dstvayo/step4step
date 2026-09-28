const CACHE = 's4s-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/db.js',
  '/js/estimate.js',
  '/js/points.js',
  '/js/backup.js',
  '/js/ai.js',
  '/js/sync.js',
  '/js/app.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // API-Anfragen immer direkt durchleiten
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('firebaseio.com') ||
      e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('gstatic.com/firebasejs')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
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
