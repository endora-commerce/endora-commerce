import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T046 — Negotiation loop integration test.
 *
 * Covers the full US3 cycle:
 *   1. Customer submits → Pending
 *   2. Admin modifies → awaiting customer revision acceptance
 *   3. Customer rejects revision → Canceled
 *
 * Plus the happy path (customer accepts revision → Approved) and the
 * stale-revision-number 409 conflict.
 */
describe('Quote Requests — negotiation loop (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createPending(quantity = 50, desiredUnitPrice = 8): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity, desiredUnitPrice }],
      },
    });
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('admin modify flips awaiting_customer_revision_acceptance and emits a modified event with diff', async () => {
    const created = await createPending();
    const modifyRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 8.5 },
        ],
      },
    });
    expect(modifyRes.statusCode).toBe(200);
    const modified = (modifyRes.json() as { data: { awaitingCustomerRevisionAcceptance: boolean; currentRevisionNumber: number; events: Array<{ eventType: string; payload: Record<string, unknown> }> } }).data;
    expect(modified.awaitingCustomerRevisionAcceptance).toBe(true);
    expect(modified.currentRevisionNumber).toBeGreaterThan(0);
    const modifyEvent = modified.events.find((e) => e.eventType === 'modified');
    expect(modifyEvent).toBeDefined();
    expect(modifyEvent?.payload).toMatchObject({ type: 'modified' });
  });

  it('customer accepts revision → Approved', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 8.25 }],
      },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;

    const acceptRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${created.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: detail.currentRevisionNumber },
    });
    expect(acceptRes.statusCode).toBe(200);
    const accepted = (acceptRes.json() as { data: { status: string; awaitingCustomerRevisionAcceptance: boolean } }).data;
    expect(accepted.status).toBe('Approved');
    expect(accepted.awaitingCustomerRevisionAcceptance).toBe(false);
  });

  it('customer rejects revision with reason → Canceled', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 12.0 }],
      },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;

    const rejectRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${created.id}/reject-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        expectedRevisionNumber: detail.currentRevisionNumber,
        reason: 'Price too high',
      },
    });
    expect(rejectRes.statusCode).toBe(200);
    const rejected = (rejectRes.json() as { data: { status: string; cancellationReason: string | null } }).data;
    expect(rejected.status).toBe('Canceled');
    expect(rejected.cancellationReason).toBe('Price too high');
  });

  it('rejects accept-revision with stale expectedRevisionNumber (409)', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 9.0 }],
      },
    });
    const acceptRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${created.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: 999 },
    });
    expect(acceptRes.statusCode).toBe(409);
  });

  it('detail surfaces a comparison block while awaiting acceptance', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 60, agreedUnitPrice: 8.0 }],
      },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { comparisonAgainstLastSeen: { diff: Array<{ kind: string }> } | null } }).data;
    expect(detail.comparisonAgainstLastSeen).not.toBeNull();
    const kinds = detail.comparisonAgainstLastSeen?.diff.map((d) => d.kind);
    expect(kinds).toContain('line_quantity');
    expect(kinds).toContain('line_agreed_unit_price');
  });
});
