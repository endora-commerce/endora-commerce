/**
 * Storefront service worker (feature 046 — FR-012..016, FR-021, FR-027/028).
 *
 * Caching (config-gated):
 *   - Caching only happens when the backend reports `cachingEnabled: true`
 *     (fetched from same-origin `/pwa/config` on activate + periodic message).
 *     When disabled, all `b2b-*` caches are purged and every request goes to the
 *     network (FR-016).
 *   - HTML navigations to /catalog, /c/<slug>, /p/<slug>, /search and `/`:
 *     stale-while-revalidate (offline-viewable shell, FR-013).
 *   - Static `_next/static/**`: cache-first (immutable hashed URLs).
 *   - `/api/**` is NEVER cached — prices, stock and cart always come fresh
 *     from the network (FR-014).
 *   - Everything else: network-first.
 *
 * Updates (FR-027/028):
 *   - Cache names are keyed by the build version (`__SW_VERSION__`, replaced at
 *     build/registration time). A new build → new cache names → old caches
 *     dropped on activate, so returning clients pick up new assets within one
 *     navigation without a manual cache clear. `skipWaiting` is gated on a
 *     client message so an update never discards in-progress work mid-task.
 *
 * Push (FR-021):
 *   - `push` shows a system notification; `notificationclick` focuses/opens the
 *     deep-link URL.
 *
 * Plain ES2020 — no bundler, no runtime dep. Themes can replace this file.
 */

// Replaced with the storefront build id at registration time (?v=<buildId>);
// falls back to a static string so the file is valid standalone.
const VERSION = (new URL(self.location.href).searchParams.get('v')) || 'v1';
const HTML_CACHE = `b2b-html-${VERSION}`;
const ASSET_CACHE = `b2b-assets-${VERSION}`;
const OFFLINE_URL = '/offline';
const CONFIG_URL = '/pwa/config';

const NAVIGATION_PREFIXES = ['/catalog', '/c/', '/p/', '/search'];

// In-memory caching gate; refreshed on activate and on a 'pwa:refresh-config'
// message. Defaults to false so we never cache before the first config read.
let cachingEnabled = false;

async function refreshConfig() {
  try {
    const res = await fetch(CONFIG_URL, { credentials: 'same-origin' });
    if (!res.ok) return;
    const config = await res.json();
    cachingEnabled = config.cachingEnabled === true;
    if (!cachingEnabled) await purgeCaches();
  } catch {
    // Network error — leave the current gate value untouched.
  }
}

async function purgeCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith('b2b-')).map((n) => caches.delete(n)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(HTML_CACHE);
      // Pre-cache the offline fallback so it's available on the first offline visit.
      await cache.add(new Request(OFFLINE_URL, { credentials: 'same-origin' }));
      // Do NOT skipWaiting automatically — wait for a client signal so an update
      // never yanks the page mid-task (FR-028).
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
      await refreshConfig();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'pwa:skip-waiting') {
    // Client confirmed it's safe to activate the new SW now (FR-028).
    self.skipWaiting();
  } else if (event.data.type === 'pwa:refresh-config') {
    event.waitUntil(refreshConfig());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Never intercept non-GET — POST/PUT/PATCH/DELETE always go to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API/business responses — prices/stock/cart must stay fresh (FR-014).
  if (url.pathname.startsWith('/api/')) return;

  // With caching disabled, behave like a plain site (network-first, no writes).
  if (!cachingEnabled) {
    event.respondWith(fetch(request).catch(() => fallbackToOffline(request)));
    return;
  }

  // Static hashed assets — cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Navigations to the catalog surface — stale-while-revalidate + offline fallback.
  const isNavigation = request.mode === 'navigate';
  const isCatalogPath = NAVIGATION_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (isNavigation && (isCatalogPath || url.pathname === '/')) {
    event.respondWith(staleWhileRevalidate(request, HTML_CACHE));
    return;
  }

  // Everything else — network-first, no cache write.
  event.respondWith(fetch(request).catch(() => fallbackToOffline(request)));
});

// Push delivery (FR-021).
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Notification';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })(),
  );
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
