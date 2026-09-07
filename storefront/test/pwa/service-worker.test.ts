import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T236 / FR-104 — service worker contract.
 *
 * The reference SW lives at `public/service-worker.js` (no bundler, no
 * runtime dep). These tests pin its caching contract so a refactor that
 * regresses the offline behaviour fails CI.
 */

const SW_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/service-worker.js');
const swSource = readFileSync(SW_PATH, 'utf-8');

describe('service-worker.js — caching contract', () => {
  it('caches the offline fallback during install', () => {
    expect(swSource).toMatch(/install/);
    expect(swSource).toMatch(/cache\.add\(new Request\(OFFLINE_URL/);
  });

  it('declares stale-while-revalidate for catalog navigations', () => {
    expect(swSource).toMatch(/staleWhileRevalidate/);
    // The navigation prefixes that should follow SWR.
    expect(swSource).toMatch(/'\/catalog'/);
    expect(swSource).toMatch(/'\/c\/'/);
    expect(swSource).toMatch(/'\/p\/'/);
  });

  it('declares cache-first for hashed _next/static assets', () => {
    expect(swSource).toMatch(/cacheFirst/);
    expect(swSource).toMatch(/_next\/static\//);
  });

  it('falls back to /offline only on navigation failures', () => {
    expect(swSource).toMatch(/fallbackToOffline/);
    expect(swSource).toMatch(/request\.mode !== 'navigate'/);
  });

  it('drops caches from previous SW versions on activate', () => {
    expect(swSource).toMatch(/activate/);
    expect(swSource).toMatch(/caches\.delete/);
  });

  it('never intercepts non-GET requests', () => {
    expect(swSource).toMatch(/request\.method !== 'GET'/);
  });

  it('never caches /api responses — business data stays fresh (FR-014)', () => {
    expect(swSource).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/);
  });

  it('gates caching behind the backend config flag (FR-012/016)', () => {
    expect(swSource).toMatch(/cachingEnabled/);
    expect(swSource).toMatch(/purgeCaches/);
    expect(swSource).toMatch(/\/pwa\/config/);
  });

  it('keys cache names by build version for deterministic updates (FR-027)', () => {
    expect(swSource).toMatch(/searchParams\.get\('v'\)/);
    expect(swSource).toMatch(/b2b-assets-\$\{VERSION\}/);
  });

  it('applies an update only on a client signal (FR-028)', () => {
    expect(swSource).toMatch(/pwa:skip-waiting/);
    expect(swSource).toMatch(/self\.skipWaiting\(\)/);
  });

  it('handles push + notificationclick (FR-021)', () => {
    expect(swSource).toMatch(/addEventListener\('push'/);
    expect(swSource).toMatch(/addEventListener\('notificationclick'/);
    expect(swSource).toMatch(/showNotification/);
  });
});

describe('manifest route', () => {
  it('declares the metadata fields Lighthouse audits look for', async () => {
    const route = await import('../../app/manifest.webmanifest/route');
    // The route now resolves per-channel config from the backend and falls back
    // to platform defaults when it is unreachable (as in this unit test).
    const res = await route.GET();
    expect(res.headers.get('Content-Type')).toBe('application/manifest+json');
    const body = await res.json();
    expect(body).toMatchObject({
      name: expect.any(String),
      short_name: expect.any(String),
      start_url: '/',
      display: 'standalone',
    });
    expect(Array.isArray(body.icons)).toBe(true);
    expect(body.icons.length).toBeGreaterThanOrEqual(2);
    expect(body.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);
  });
});
