import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T165 — Admin inventory: list + set absolute on-hand. Reserved counters
 * are driven by orders and are not editable here.
 */

describe('Admin inventory stock-level routes', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists stock levels with hydrated product info', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/inventory?productId=${SEED_PRODUCT_101_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ productId: string; onHand: number; available: number; productSku: string | null }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.productId).toBe(SEED_PRODUCT_101_ID);
  });

  it('sets an absolute on-hand value for the product', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { productId: SEED_PRODUCT_101_ID, onHand: 250 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { onHand: number; productId: string };
    };
    expect(body.data.onHand).toBe(250);
    expect(body.data.productId).toBe(SEED_PRODUCT_101_ID);
  });
});
