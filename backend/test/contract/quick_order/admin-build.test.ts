import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 039 (US1 / FR-008) — admin quick-order import + build on behalf of
 * a customer. Guarded by `orders:write`; the stub admin session holds
 * wildcard permissions.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const SIMPLE_SKU = 'EXAMPLE-SIMPLE-001';

describe('Admin quick-order on behalf', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects an unauthenticated import', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/import',
      payload: { csv: `sku,quantity\n${SIMPLE_SKU},1` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('imports and builds a quote request on behalf of a customer', async () => {
    const importRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/import',
      cookies: ADMIN_COOKIE,
      payload: { csv: `sku,quantity\n${SIMPLE_SKU},3` },
    });
    expect(importRes.statusCode).toBe(200);
    const recognized = (
      importRes.json() as {
        data: { recognized: Array<{ productId: string; variantId: string | null; quantity: number }> };
      }
    ).data.recognized;
    expect(recognized.length).toBe(1);

    const buildRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/build',
      cookies: ADMIN_COOKIE,
      payload: {
        target: 'quote_request',
        onBehalfOf: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        items: recognized.map((r) => ({
          productId: r.productId,
          variantId: r.variantId,
          quantity: r.quantity,
        })),
      },
    });
    expect(buildRes.statusCode).toBe(200);
    const body = buildRes.json() as { data: { target: string; quoteRequestId: string } };
    expect(body.data.target).toBe('quote_request');
    expect(body.data.quoteRequestId).toBeTruthy();
  });

  it('requires onBehalfOf for an admin build', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/build',
      cookies: ADMIN_COOKIE,
      payload: {
        target: 'cart',
        items: [{ productId: '00000000-0000-4000-8000-000000000101', quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(422);
  });
});
