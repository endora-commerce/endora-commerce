import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — the admin promotion preview's cart snapshot bounds a line's
 * quantity at `LINE_QUANTITY_MAX`, as every other request carrying a line does:
 * one past it is `400 VALIDATION_FAILED` naming the field, the bound is priced.
 */
describe('POST /api/v1/admin/promotions/preview — line quantity bound (issue #351)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const preview = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        organizationId: null,
        customerGroupId: null,
        currency: 'PLN',
        deliveryTotal: 0,
        lines: [
          {
            productId: '00000000-0000-4000-8000-000000000001',
            variantId: null,
            categoryIds: [],
            quantity,
            unitPrice: { amount: 1, currency: 'PLN' },
          },
        ],
      },
    });

  it('refuses one past the bound and previews the bound', async () => {
    expectQuantityRefused(await preview(LINE_QUANTITY_MAX + 1), 'lines.0.quantity');
    const res = await preview(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
  });
});
