/**
 * Storefront service worker (T236 / FR-104).
 *
 * Caching strategy:
 *   - HTML navigations to /catalog, /c/<slug>, /p/<slug>: stale-while-revalidate
 *     so previously visited Product / Category / Catalog pages remain viewable
 *     offline (FR-104).
 *   - Static `_next/static/**` assets: cache-first (immutable hashed URLs).
 *   - Everything else: network-first with no cache write.
 *
 * Offline fallback:
 *   - When a navigation request fails AND the URL is not in the cache, serve
 *     `/offline` from the cache. Cart / Checkout / RFQ screens render an
 *     offline banner and disable submit (per R-15 — done client-side in those
 *     pages, not here).
 *
 * The SW is plain ES2020 — no bundler, no runtime dep. Themes can replace it
 * by dropping a different `service-worker.js` into `storefront/public/`.
 */

const VERSION = 'v1';
const HTML_CACHE = `b2b-html-${VERSION}`;
const ASSET_CACHE = `b2b-assets-${VERSION}`;
const OFFLINE_URL = '/offline';

const NAVIGATION_PREFIXES = ['/catalog', '/c/', '/p/', '/search'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(HTML_CACHE);
      // Pre-cache the offline fallback so it's available even on the very
      // first offline visit.
      await cache.add(new Request(OFFLINE_URL, { credentials: 'same-origin' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous SW versions.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('b2b-') && !n.endsWith(`-${VERSION}`))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Never intercept non-GET — POST/PUT/PATCH/DELETE always go to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Static hashed assets — cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Navigations to the catalog surface — stale-while-revalidate + offline
  // fallback when both miss.
  const isNavigation = request.mode === 'navigate';
  const isCatalogPath = NAVIGATION_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (isNavigation && (isCatalogPath || url.pathname === '/')) {
    event.respondWith(staleWhileRevalidate(request, HTML_CACHE));
    return;
  }

  // Everything else — network-first, no cache write.
  event.respondWith(fetch(request).catch(() => fallbackToOffline(request)));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    // Kick the revalidate off in the background.
    networkPromise.then(() => undefined);
    return cached;
  }
  const networked = await networkPromise;
  if (networked) return networked;
  return fallbackToOffline(request);
}

async function fallbackToOffline(request) {
  if (request.mode !== 'navigate') {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
  const cache = await caches.open(HTML_CACHE);
  const fallback = await cache.match(OFFLINE_URL);
  if (fallback) return fallback;
  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}
