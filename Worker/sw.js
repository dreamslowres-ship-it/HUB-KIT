/* Service Worker principal del App Hub (ubicado en Worker/sw.js) */
const CORE_SHELL = [
  './',
  './index.html',
  './Worker/manifest.webmanifest',
  './Worker/pwa-icon-192.png',
  './Worker/pwa-icon-512.png'
];

let activeCacheName = 'apphub-core-v1';

async function resolveCacheName() {
  try {
    const res = await fetch('./hub_version.json?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.cacheName) return data.cacheName;
      if (data && data.version) return `apphub-${data.version}-${data.build || 1}`;
    }
  } catch (e) {}
  return activeCacheName;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    activeCacheName = await resolveCacheName();
    const cache = await caches.open(activeCacheName);
    await cache.addAll(CORE_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const current = await resolveCacheName();
    activeCacheName = current;
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== current).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const clients = await self.clients.matchAll();
      clients.forEach((c) => c.postMessage({ type: 'CACHES_CLEARED' }));
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isConfigOrHtml =
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/');

  if (isConfigOrHtml) {
    event.respondWith((async () => {
      try {
        const networkRes = await fetch(req, { cache: 'no-store' });
        if (networkRes && networkRes.ok) {
          const cache = await caches.open(activeCacheName);
          cache.put(req, networkRes.clone());
        }
        return networkRes;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then(async (networkRes) => {
      if (networkRes && networkRes.ok) {
        const cache = await caches.open(activeCacheName);
        cache.put(req, networkRes.clone());
      }
      return networkRes;
    }).catch(() => null);

    return cached || (await fetchPromise);
  })());
});