const CACHE = 'koordination-v1.0';
const OFFLINE_URLS = ['/', '/calendar', '/tasks', '/reminders', '/sharing'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['/manifest.json'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();

  const options = {
    body: data.body || 'Neue Benachrichtigung',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'koordination',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    data: { url: data.url || '/', messageId: data.messageId },
    actions: data.actions || [
      { action: 'confirm', title: '✅ Bestätigt' },
      { action: 'later', title: '⏰ Später' },
      { action: 'open', title: '📱 Öffnen' },
    ],
  };

  e.waitUntil(self.registration.showNotification(data.title || 'Koordination', options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action;
  const data = e.notification.data;

  if (action === 'confirm' || action === 'later') {
    const reaction = action === 'confirm' ? '✅ Bestätigt' : '⏰ Später';
    if (data.messageId) {
      fetch(`/api/sharing/${data.messageId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction }),
      });
    }
  }

  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((cs) => {
      const target = data.url || '/';
      const existing = cs.find((c) => c.url.includes(target));
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});

self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.registration.pushManager.subscribe(e.oldSubscription.options));
});
