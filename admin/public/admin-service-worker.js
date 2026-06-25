/**
 * Admin service worker (feature 046, US6).
 *
 * Minimal installability + asset caching for the admin SPA. The admin is a
 * distinct PWA from the storefront (its own scope/identity — FR-002) and does
 * NOT subscribe to or receive push notifications (FR-025). Plain ES2020, no
 * bundler — mirrors the storefront SW.
 *
 * Cache name is keyed by build version (?v=<buildId> at registration) so a new
 * deploy invalidates old caches on activate.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'v1';
const ASSET_CACHE = `b2b-admin-assets-${VERSION}`;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('b2b-admin-') && !n.endsWith(`-${VERSION}`))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API/business responses.
  if (url.pathname.startsWith('/api/')) return;
  // Cache-first for Vite hashed assets (immutable URLs).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
