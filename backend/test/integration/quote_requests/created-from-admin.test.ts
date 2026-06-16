import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';

/**
 * T055 — Create-on-behalf flow (US4).
 *
 * Admin/sales-rep creates an RFQ for a customer → status `Created from
 * admin`. The customer accepts → `Approved`, or rejects → `Canceled`.
 */
describe('Quote Requests — create on behalf (US4)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createOnBehalf(): Promise<{ id: string; version: number; currentRevisionNumber: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 89.0 },
        ],
        headerNote: 'Per phone call.',
      },
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; version: number; currentRevisionNumber: number; status: string } }).data;
    expect(data.status).toBe('Created from admin');
    return data;
  }

  it('creates an RFQ with status Created from admin', async () => {
    const r = await createOnBehalf();
    expect(r.id).toBeTruthy();
  });

  it('surfaces the awaiting-acceptance flag so the customer can accept/reject', async () => {
    const r = await createOnBehalf();
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = (
      detailRes.json() as { data: { awaitingCustomerRevisionAcceptance: boolean } }
    ).data;
    expect(detail.awaitingCustomerRevisionAcceptance).toBe(true);
  });

  it('customer accepts → Approved', async () => {
    const r = await createOnBehalf();
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;
    const acceptRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${r.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: detail.currentRevisionNumber },
    });
    expect(acceptRes.statusCode).toBe(200);
    const accepted = (acceptRes.json() as { data: { status: string } }).data;
    expect(accepted.status).toBe('Approved');
  });

  it('customer rejects → Canceled with reason', async () => {
    const r = await createOnBehalf();
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;
    const rejectRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${r.id}/reject-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        expectedRevisionNumber: detail.currentRevisionNumber,
        reason: 'Already sourced elsewhere',
      },
    });
    expect(rejectRes.statusCode).toBe(200);
    const rejected = (rejectRes.json() as { data: { status: string; cancellationReason: string | null } }).data;
    expect(rejected.status).toBe('Canceled');
    expect(rejected.cancellationReason).toBe('Already sourced elsewhere');
  });

  it('rejects create-on-behalf when customer does not belong to organization', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: '00000000-0000-4000-8000-00000000ffff',
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 1 }],
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
