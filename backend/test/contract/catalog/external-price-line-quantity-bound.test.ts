import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — `POST /api/v1/external/catalog/prices` bounds a line's quantity
 * at `LINE_QUANTITY_MAX`: one past it is the namespace's
 * `422 VALIDATION_FAILED` naming the field, the bound itself is priced.
 */
describe('POST /api/v1/external/catalog/prices — line quantity bound (issue #351)', () => {
  let h: BackendServerHandle;
  let token = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        name: `Line quantity bound ${Date.now()}`,
        scopes: ['catalog:read'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: await systemDefaultSalesChannelId(h.em()),
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    token = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const price = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/catalog/prices',
      headers: { authorization: `Bearer ${token}` },
      payload: { lines: [{ sku: SEED_PRODUCT_101_SKU, quantity }] },
    });

  it('refuses one past the bound with 422 and prices the bound', async () => {
    expectQuantityRefused(await price(LINE_QUANTITY_MAX + 1), 'lines.0.quantity', { external: true });
    expectQuantityRefused(await price(2 ** 31), 'lines.0.quantity', { external: true });
    const res = await price(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
  });
});
