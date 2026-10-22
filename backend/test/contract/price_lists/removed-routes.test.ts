import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T097, FR-037) — the old admin pricing routes are gone in
 * the release that adds the price-book API: the engine, the rule-target
 * pickers, the product's linked-lists panel and the resolved-price probe answer
 * 404. The display-mode routes stay.
 */
describe('removed admin pricing routes (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  const LIST = '00000000-0000-4000-8000-00000000d51b';

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers 404 on every removed path', async () => {
    const gone: Array<['get' | 'post' | 'put' | 'patch' | 'delete', string]> = [
      ['get', '/api/v1/admin/price-lists-engine'],
      ['post', '/api/v1/admin/price-lists-engine'],
      ['get', `/api/v1/admin/price-lists-engine/${LIST}`],
      ['patch', `/api/v1/admin/price-lists-engine/${LIST}`],
      ['post', `/api/v1/admin/price-lists-engine/${LIST}/activate`],
      ['get', `/api/v1/admin/price-lists-engine/${LIST}/products`],
      ['put', `/api/v1/admin/price-lists-engine/${LIST}/products/${SEED_PRODUCT_101_ID}/brackets`],
      ['get', `/api/v1/admin/price-lists-engine/${LIST}/matrix`],
      ['post', '/api/v1/admin/price-lists-engine/internal/sweep'],
      ['get', '/api/v1/admin/pricing/rule-targets/organizations'],
      ['get', '/api/v1/admin/pricing/rule-targets/currencies'],
      ['get', `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/price-lists`],
      ['get', `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`],
    ];
    for (const [method, url] of gone) {
      const res = method === 'get' || method === 'delete' ? await api[method](url) : await api[method](url, {});
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
    }
  });

  it('keeps the display-mode routes', async () => {
    const res = await api.get('/api/v1/admin/pricing/display-mode-overrides');
    expect(res.status, res.raw).toBe(200);
  });
});
