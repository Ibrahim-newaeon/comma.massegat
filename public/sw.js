// public/sw.js
// Service worker: push notifications and an offline shell.

const CACHE = 'comms-v1';
const SHELL = ['/', '/login', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {
      // A shell asset missing must not block installation — push still works.
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Network-first for navigation. A chat app showing stale messages is worse
 * than showing an offline notice — the cache is a fallback, not a source of
 * truth. API requests are never cached at all.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r ?? caches.match('/'))),
    );
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); } catch { return; }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'New message', {
      body: payload.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Direction and language come from the RECIPIENT's locale, so an Arabic
      // notification renders RTL even on a device set to English.
      dir: payload.dir ?? 'auto',
      lang: payload.lang ?? 'en',
      // Collapse by channel: twenty messages from one conversation should be
      // one notification, not twenty.
      tag: payload.channelId ?? 'general',
      renotify: true,
      data: { channelId: payload.channelId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab rather than opening a second one.
      for (const client of clients) {
        if (client.url.includes('/chat') && 'focus' in client) {
          client.postMessage({ type: 'open-channel', channelId: event.notification.data?.channelId });
          return client.focus();
        }
      }
      return self.clients.openWindow('/chat');
    }),
  );
});
