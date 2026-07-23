import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { findAttributeExtensionByKey } from '../../helpers/seed-catalog.js';
import { Comparison } from '../../../src/modules/comparisons/entities/comparison.entity.js';
import { ComparisonProduct } from '../../../src/modules/comparisons/entities/comparison-product.entity.js';

/**
 * T018 — Contract test for the customer-facing comparisons CRUD bundle
 * (US1, feature 007). Exercises every endpoint in
 * `contracts/public-comparisons-crud.md` against a real Postgres + the
 * real settings + sales-channels modules. Anonymous flow: the first
 * write mints `compare_token`; subsequent calls reuse it.
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('Compare module — public CRUD contract (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

    // Flag two of the seeded attributes as comparable so the projection
    // has rows to emit. `color` is shared across all three products;
    // `material` differs.
    const em = h.em();
    for (const key of ['color', 'material']) {
      const ext = await findAttributeExtensionByKey(em, key);
      if (ext) ext.isComparable = true;
    }
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Each test starts from an empty comparisons table so cookies and
    // owner identity don't leak between cases.
    const em = h.em();
    await em.nativeDelete(ComparisonProduct, {});
    await em.nativeDelete(Comparison, {});
  });

  // ---------------------------------------------------------------------
  // GET /me — empty state
  // ---------------------------------------------------------------------

  it('GET /me returns 204 when caller has no comparison and no cookie', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      headers: SALES_CHANNEL_HEADER,
    });
    expect(res.statusCode).toBe(204);
  });

  // ---------------------------------------------------------------------
  // POST /me/products — create on first call, set anonymous cookie
  // ---------------------------------------------------------------------

  it('POST /me/products creates the comparison and mints compare_token cookie', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { id: string; products: unknown[]; shareToken: string } };
    expect(body.data.products).toHaveLength(1);
    expect(typeof body.data.shareToken).toBe('string');
    expect(body.data.shareToken.length).toBeGreaterThanOrEqual(20);

    // Cookie shape: HttpOnly, SameSite=Lax, Path=/.
    const setCookie = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie ?? '';
    expect(cookieHeader).toContain('compare_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Path=/');
  });

  // ---------------------------------------------------------------------
  // POST /me/products — idempotent on duplicate add
  // ---------------------------------------------------------------------

  it('POST /me/products is idempotent on duplicate productId', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        ...SALES_CHANNEL_HEADER,
        'content-type': 'application/json',
        cookie,
      },
      payload: { productId: SEED_PRODUCT_101_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { products: unknown[] } };
    expect(body.data.products).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // POST /me/products — refuses unknown product
  // ---------------------------------------------------------------------

  it('POST /me/products returns 404 PRODUCT_NOT_FOUND for an unknown id', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        ...SALES_CHANNEL_HEADER,
        'content-type': 'application/json',
        cookie,
      },
      payload: { productId: '00000000-0000-4000-8000-00000000ffff' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.PRODUCT_NOT_FOUND },
    });
  });

  // ---------------------------------------------------------------------
  // POST /me/products — 422 on malformed UUID
  // ---------------------------------------------------------------------

  it('POST /me/products returns 422 VALIDATION_FAILED on a non-UUID productId', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } });
  });

  // ---------------------------------------------------------------------
  // GET /me — full read shape
  // ---------------------------------------------------------------------

  it('GET /me returns the full owner view with comparable attribute rows', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json', cookie },
      payload: { productId: SEED_PRODUCT_102_ID },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        products: Array<{ id: string; name: unknown; price: unknown; available: boolean }>;
        comparableAttributes: Array<{ key: string; rowClass: 'common' | 'different' }>;
        displayMode: 'all' | 'common' | 'differences';
        maxProducts: number;
      };
    };
    expect(body.data.products.map((p) => p.id)).toEqual([
      SEED_PRODUCT_101_ID,
      SEED_PRODUCT_102_ID,
    ]);
    expect(body.data.displayMode).toBe('all');
    expect(body.data.maxProducts).toBeGreaterThan(0);

    // Both `color` (different — red vs blue) and `material` (different
    // — steel vs aluminium) appear with rowClass='different'.
    const byKey = new Map(body.data.comparableAttributes.map((r) => [r.key, r.rowClass]));
    expect(byKey.get('color')).toBe('different');
    expect(byKey.get('material')).toBe('different');
  });

  // ---------------------------------------------------------------------
  // PATCH /me — display mode
  // ---------------------------------------------------------------------

  it('PATCH /me persists the chosen display mode', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);

    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json', cookie },
      payload: { displayMode: 'differences' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { data: { displayMode: string } }).data.displayMode).toBe(
      'differences',
    );
  });

  it('PATCH /me returns 422 on an invalid displayMode value', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json', cookie },
      payload: { displayMode: 'rainbow' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('PATCH /me returns 404 when the caller has no comparison', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { displayMode: 'common' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.COMPARISON_NOT_FOUND } });
  });

  // ---------------------------------------------------------------------
  // DELETE /me/products/:id — remove
  // ---------------------------------------------------------------------

  it('DELETE /me/products/:id removes the product', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json', cookie },
      payload: { productId: SEED_PRODUCT_102_ID },
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/comparisons/me/products/${SEED_PRODUCT_101_ID}`,
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(del.statusCode).toBe(200);
    const body = del.json() as { data: { products: Array<{ id: string }> } };
    expect(body.data.products.map((p) => p.id)).toEqual([SEED_PRODUCT_102_ID]);
  });

  it('DELETE /me/products/:id returns 404 PRODUCT_NOT_IN_COMPARISON when the product is absent', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/comparisons/me/products/${SEED_PRODUCT_103_ID}`,
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.PRODUCT_NOT_IN_COMPARISON },
    });
  });

  // ---------------------------------------------------------------------
  // DELETE /me — comparison goes away
  // ---------------------------------------------------------------------

  it('DELETE /me returns 204 and the comparison is gone', async () => {
    const cookie = await mintAnonymousComparison(h, SEED_PRODUCT_101_ID);

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(del.statusCode).toBe(204);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(after.statusCode).toBe(204);
  });

  it('DELETE /me returns 404 when the caller has no comparison', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/comparisons/me',
      headers: SALES_CHANNEL_HEADER,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.COMPARISON_NOT_FOUND } });
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Helper: create a comparison anonymously and return the `compare_token`
 * cookie value (formatted for the next request's `cookie` header).
 */
async function mintAnonymousComparison(
  h: BackendServerHandle,
  productId: string,
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
    payload: { productId },
  });
  if (res.statusCode !== 200) {
    throw new Error(`mint failed: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('no compare_token cookie was set on first POST');
  // setCookie may be `compare_token=...; HttpOnly; ...`; we only need the
  // first kv pair to send back.
  const [first] = raw.split(';');
  return first ?? '';
}
