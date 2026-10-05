// Service worker for the portal. It keeps the last good copy of the page and everything it
// loaded, so the schedule, lecturer list and heart still open in a lecture hall with no
// signal. The admin page and other sites are never touched.
const VERSION = 'v5-1';
const SHELL = 'alpha-shell-' + VERSION;
const FILES = 'alpha-files-' + VERSION;
const MEDIA = 'alpha-media-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/')).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, FILES, MEDIA]);
    for (const key of await caches.keys()) if (key.startsWith('alpha-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

function cacheable(res) {
  return res && res.ok && res.status === 200 && res.type === 'basic';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/admin') || url.pathname === '/sw.js') return;

  // pages: network first, the cached page when offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (cacheable(res) && url.pathname === '/') (await caches.open(SHELL)).put('/', res.clone());
        return res;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // hashed build files never change: cache first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (cacheable(res)) (await caches.open(FILES)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // uploaded photos never change (the name is their hash): cache first, and keep the newest
  // 80 so a long browse through the galleries does not fill the phone
  if (url.pathname.startsWith('/media/')) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (cacheable(res)) {
        await cache.put(req, res.clone());
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - 80))) await cache.delete(k);
      }
      return res;
    })());
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // everything else of ours (model, images, icons, sound): serve the copy, refresh it behind
  event.respondWith((async () => {
    const cache = await caches.open(FILES);
    const hit = await cache.match(req);
    const fresh = fetch(req).then((res) => {
      if (cacheable(res)) cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      event.waitUntil(fresh.catch(() => {}));
      return hit;
    }
    return fresh;
  })());
});
