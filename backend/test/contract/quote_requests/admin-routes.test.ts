import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T037 — Admin-facing Quote Requests routes for US2 (approve, cancel,
 * list, get, assign).
 */
describe('Admin Quote Requests routes (US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createPendingRfq(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }],
      },
    });
    const body = res.json() as { data: { id: string; version: number } };
    return body.data;
  }

  /**
   * A Pending request the operator has priced — the only kind `approve`
   * accepts. Approving needs an agreed unit price on every line, and a request
   * as the customer raises it has none.
   */
  async function createPricedPendingRfq(): Promise<{ id: string; version: number }> {
    const created = await createPendingRfq();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9.0 }] },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('lists Pending Quote Requests visible to the admin', async () => {
    const created = await createPendingRfq();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/quote-requests',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; status: string }> };
    expect(body.data.find((r) => r.id === created.id)?.status).toBe('Pending');
  });

  it('approves a priced Pending Quote Request', async () => {
    const created = await createPricedPendingRfq();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; approvedAt: string | null; events: Array<{ eventType: string }> };
    };
    expect(body.data.status).toBe('Approved');
    expect(body.data.approvedAt).not.toBeNull();
    expect(body.data.events.map((e) => e.eventType)).toContain('approved');
  });

  it('cancels a Pending Quote Request and persists the reason', async () => {
    const created = await createPendingRfq();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/cancel`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: { reason: 'Out of stock for the requested volume' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; cancellationReason: string | null };
    };
    expect(body.data.status).toBe('Canceled');
    expect(body.data.cancellationReason).toBe('Out of stock for the requested volume');
  });

  it('rejects approval on a stale If-Match header (409)', async () => {
    const created = await createPendingRfq();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': '"999"' },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses approval of a request with an unpriced line (409 QUOTE_INCOMPLETE)', async () => {
    const created = await createPendingRfq();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('QUOTE_INCOMPLETE');
  });

  it('rejects approval on a terminal status (409)', async () => {
    const created = await createPricedPendingRfq();
    // First approve succeeds.
    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    // Second approve on the now-Approved row should be refused.
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('RFQ_NOT_QUOTED');
  });
});
