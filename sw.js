const CACHE_NAME = '99-super-app-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy to prevent ERR_FAILED or outdated Vercel cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
