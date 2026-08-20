import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';

/**
 * T020 — Integration test: anonymous-cookie ownership flow (US1, R-2).
 *
 * Asserts:
 *   - The first write mints `compare_token` with HttpOnly + SameSite=Lax
 *     + Path=/.
 *   - Subsequent calls bearing the cookie target the same Comparison
 *     (the same DB row by id).
 *   - A request without the cookie does NOT see the existing Comparison
 *     (returns 204 from GET /me).
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('Compare module — anonymous-cookie ownership (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // No `beforeEach` cleanup (issue #166): the cookie *is* the identity this
  // file is about, and every case mints its own by posting without one. A test
  // that emptied the table would be deleting rows other files created to prove
  // a point about its own.

  it('mints compare_token on the first write with HttpOnly + SameSite=Lax + Path=/', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });

    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
    expect(raw).toMatch(/^compare_token=/);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Path=/');
    // 1-year Max-Age (60 * 60 * 24 * 365 = 31536000).
    expect(raw).toMatch(/Max-Age=31536000/i);
  });

  it('subsequent calls with the cookie target the same Comparison row', async () => {
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    const cookie = extractCookie(first.headers['set-cookie']);
    const firstBody = first.json() as { data: { id: string } };

    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        ...SALES_CHANNEL_HEADER,
        'content-type': 'application/json',
        cookie,
      },
      payload: { productId: SEED_PRODUCT_102_ID },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { data: { id: string; products: unknown[] } };
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.data.products).toHaveLength(2);
  });

  it('a request without the cookie does NOT see another caller’s Comparison', async () => {
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    expect(first.statusCode).toBe(200);

    // A second caller, no cookie — must see "no comparison yet", whatever
    // comparisons other callers hold.
    const otherCaller = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      headers: SALES_CHANNEL_HEADER,
    });
    expect(otherCaller.statusCode).toBe(204);
  });
});

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no Set-Cookie present');
  return raw.split(';')[0] ?? '';
}
