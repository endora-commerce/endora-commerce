import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  adminCreateQuoteRequestSchema,
  RFQ_CREATED_BY_ADMIN_EVENT,
  type RfqCreatedByAdminEventPayload,
} from '@endora-commerce/contracts';

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
   * The optional, opaque `origin` of the admin create request and the event
   * that hands it on (feature 143, US10).
   */
  it('accepts an optional origin on the admin create request and answers without it', async () => {
    const payload = {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_ID,
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 5 }],
    };
    const origin = { type: 'crm_opportunity', id: '00000000-0000-4000-8000-00000000c0de' };
    expect(adminCreateQuoteRequestSchema.safeParse(payload).success).toBe(true);
    expect(adminCreateQuoteRequestSchema.safeParse({ ...payload, origin }).success).toBe(true);
    expect(adminCreateQuoteRequestSchema.safeParse({ ...payload, origin: { type: 'x' } }).success).toBe(false);
    expect(RFQ_CREATED_BY_ADMIN_EVENT).toBe('rfq.created_by_admin.v1');

    const events: unknown[] = [];
    const off = h.eventBus.on(RFQ_CREATED_BY_ADMIN_EVENT as never, (event: unknown) => {
      events.push(event);
    });
    try {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { ...payload, origin },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: Record<string, unknown> & { id: string } }).data;
      expect(data).not.toHaveProperty('origin');
      // The emitter does not wait for the bus: this listener hears the event
      // once every composed subscriber has had it.
      await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 10_000, interval: 20 });
      // The published payload shape, held as a type.
      const expected: RfqCreatedByAdminEventPayload = {
        rfqId: data.id,
        organizationId: TEST_ORGANIZATION_ID,
        adminUserId: TEST_ADMIN_ID,
        origin,
      };
      expect(events).toEqual([expect.objectContaining(expected)]);
    } finally {
      off();
    }

    const refused = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { ...payload, origin: { type: 'crm_opportunity', id: 'not-a-uuid' } },
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

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

  it('approves a Pending Quote Request', async () => {
    const created = await createPendingRfq();
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

  it('rejects approval on a terminal status (409)', async () => {
    const created = await createPendingRfq();
    // First approve succeeds.
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {},
    });
    // Second approve on the now-Approved row should be refused.
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${created.id}/approve`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});
