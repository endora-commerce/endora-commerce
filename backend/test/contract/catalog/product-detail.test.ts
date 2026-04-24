import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T044 — `GET /catalog/products/:idOrSlug` must omit price fields on a non-public
 * Sales Channel (R-18 + FR-106).
 *
 * The Sales Channel is inferred from the `X-Sales-Channel` header for API consumers.
 * Seed data (T093) provides `pl_retail` (public) and `pl_b2b_vip` (non-public).
 */

describe('GET /api/v1/catalog/products/:slug — price visibility by Sales Channel', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('includes price when the Sales Channel is public', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products/example-simple-product',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { price: { amount: number; currency: string } | null } };
    expect(body.data.price).not.toBeNull();
    expect(body.data.price?.amount).toBeTypeOf('number');
    expect(body.data.price?.currency).toMatch(/^[A-Z]{3}$/);
  });

  it('omits price when the Sales Channel is non-public', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products/example-simple-product',
      headers: { 'x-sales-channel': 'pl_b2b_vip' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { price: unknown } };
    // R-18: non-public channels strip the price field to null (or omit entirely).
    expect(body.data.price === null || body.data.price === undefined).toBe(true);
  });
});
