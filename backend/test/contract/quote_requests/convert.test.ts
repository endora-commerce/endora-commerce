import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T060 — `POST /api/v1/quote-requests/:id/convert-to-order`.
 *
 * Verifies the contract:
 *   - 200 with `{ cartId, checkoutUrl }` on Approved.
 *   - 409 when the RFQ is in any other status.
 *   - 404 when the caller cannot see the RFQ.
 */
describe('Convert RFQ to order — contract (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createApprovedRfq(): Promise<{ id: string }> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 9.5 }],
      },
    });
    const rfq = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${rfq.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9.0 }] },
    });
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const cur = (detail.json() as { data: { currentRevisionNumber: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: cur.currentRevisionNumber },
    });
    return { id: rfq.id };
  }

  it('returns cartId + checkoutUrl when Approved', async () => {
    const { id } = await createApprovedRfq();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/convert-to-order`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { cartId: string; checkoutUrl: string } };
    expect(body.data.cartId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.checkoutUrl).toContain('cartId=');
    expect(body.data.checkoutUrl).toContain('fromRfq=');
  });

  it('rejects conversion on a Pending RFQ (409)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    const id = (created.json() as { data: { id: string } }).data.id;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/convert-to-order`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for an RFQ owned by another customer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests/00000000-0000-4000-8000-00000000ffff/convert-to-order',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
