import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 053 — US1 / SC-001: cross-module channel-resolution consistency.
 *
 * Every storefront-facing surface resolves the SAME sales channel for a given
 * request, because they all read the single channel the canonical resolver
 * middleware attached (`request.salesChannel`). We observe this at the HTTP
 * boundary: the resolver echoes the resolved code on every `/api/v1/*`
 * response via the `x-sales-channel` header — set in the onRequest hook, so it
 * is present even on 404/400 handler outcomes. If any module re-resolved to a
 * different channel, that would be a US1 defect regardless of this echo; the
 * echo proves the one authoritative resolution that all modules now consume.
 *
 * Matrix: {header, no-header/default} × {catalog, cms, megamenu, blog, search,
 * pricing}. (Host-map resolution is exercised by the resolver's own suite; it
 * cannot be driven through inject() without a configured SALES_CHANNEL_HOST_MAP.)
 */
describe('cross-module sales-channel resolution consistency (feature 053 / SC-001)', () => {
  let h: BackendServerHandle;
  let defaultCode: string;

  // Surface paths that flow through the resolver. Status is irrelevant — the
  // echo header is set before the handler runs, so a 404/400 still proves the
  // resolved channel for that surface.
  const SURFACES = [
    '/api/v1/catalog/products?limit=1',
    '/api/v1/catalog/categories',
    '/api/v1/catalog/filters',
    '/api/v1/cms/pages/by-slug?slug=nonexistent',
    '/api/v1/megamenu/by-channel',
    '/api/v1/blog',
    '/api/v1/search/suggest?q=widget',
    '/api/v1/storefront/products/00000000-0000-4000-8000-000000000000/resolved-price',
  ];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'us1-catalog' });
    const def = await h.salesChannels.resolver.getSystemDefault();
    if (!def) throw new Error('system-default sales channel missing in test setup');
    defaultCode = def.code;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function echoedChannels(headers?: Record<string, string>): Promise<string[]> {
    const echoes: string[] = [];
    for (const url of SURFACES) {
      const res = await h.app.inject({ method: 'GET', url, ...(headers ? { headers } : {}) });
      const echo = res.headers['x-sales-channel'];
      echoes.push(Array.isArray(echo) ? (echo[0] ?? '') : (echo ?? ''));
    }
    return echoes;
  }

  it('resolves the header-named channel identically on every surface', async () => {
    const echoes = await echoedChannels({ 'x-sales-channel': 'pl_retail' });
    for (const echo of echoes) expect(echo).toBe('pl_retail');
  });

  it('resolves the one system-default channel identically on every surface when no header is present', async () => {
    const echoes = await echoedChannels();
    for (const echo of echoes) expect(echo).toBe(defaultCode);
    // And the set collapses to exactly one channel — no per-module divergence.
    expect(new Set(echoes).size).toBe(1);
  });

  it('refuses an unknown channel code identically on every surface (US2 / SC-002)', async () => {
    for (const url of SURFACES) {
      const res = await h.app.inject({
        method: 'GET',
        url,
        headers: { 'x-sales-channel': 'no-such-channel-053' },
      });
      // The resolver refuses before any handler — same 400 UNKNOWN_SALES_CHANNEL
      // envelope on every surface (never a per-module 200/404 with content).
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe('UNKNOWN_SALES_CHANNEL');
    }
  });
});
