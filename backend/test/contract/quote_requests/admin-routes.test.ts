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

  it('names each listed status in the response language, beside its code (issue #455)', async () => {
    const created = await createPendingRfq();
    // An administrator's language is the stored preference, not a header.
    const setLanguage = async (preferredLanguage: 'en' | 'pl' | null) => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferred-language',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { preferredLanguage },
      });
      expect(res.statusCode, res.body).toBe(200);
    };
    const named = async (language: 'en' | 'pl') => {
      await setLanguage(language);
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/quote-requests',
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ id: string; status: string; statusName?: string }> };
      const row = body.data.find((r) => r.id === created.id);
      return [row?.status, row?.statusName];
    };
    try {
      expect(await named('pl')).toEqual(['Pending', 'Oczekujące']);
      expect(await named('en')).toEqual(['Pending', 'Pending']);
    } finally {
      await setLanguage(null);
    }
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
  /**
   * Feature 146, T042 — the admin detail carries what the rep's screen needs:
   * the stored at-request reference, the customer's proposal (with the
   * submission-record fallback of research R4 for a row a pre-146 revision
   * stripped), the packaging snapshot, and the request's sales channel.
   */
  describe('146 — reference price, proposal, packaging and channel on the admin detail', () => {
    const admin = { b2b_session: 'stub-admin-session' };

    async function createProposed(desiredUnitPrice: number): Promise<{ id: string; version: number }> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: { b2b_session: 'stub-customer-session' },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice }] },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string; version: number } }).data;
    }

    async function adminDetail(id: string): Promise<{
      salesChannelId?: unknown;
      items: Array<Record<string, unknown>>;
    }> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/quote-requests/${id}`,
        cookies: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { items: Array<Record<string, unknown>> } }).data;
    }

    it('answers the stored reference, the proposal, the packaging keys and salesChannelId', async () => {
      const created = await createProposed(8);
      const capturedAt = '2026-10-01T10:00:00.000Z';
      await h
        .em()
        .getConnection()
        .execute(
          `update "quote_request_items" set reference_unit_price = ?, reference_currency = ?, ` +
            `reference_captured_at = ?, packaging_unit_name = ?, packaging_unit_base_quantity = ? ` +
            `where quote_request_id = ?`,
          ['10.00', 'PLN', capturedAt, 'Box of 10', 10, created.id],
        );

      const detail = await adminDetail(created.id);
      expect(detail).toHaveProperty('salesChannelId');
      expect(detail.salesChannelId === null || typeof detail.salesChannelId === 'string').toBe(true);
      expect(detail.items[0]).toMatchObject({
        referencePrice: { amount: 10, currency: 'PLN', capturedAt },
        customerProposedUnitPrice: 8,
        desiredUnitPrice: 8,
        packagingUnitName: 'Box of 10',
        packagingUnitBaseQuantity: 10,
      });
    });

    it('answers referencePrice null and customerProposedUnitPrice null when neither is stored', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: { b2b_session: 'stub-customer-session' },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
      });
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      await h
        .em()
        .getConnection()
        .execute(
          `update "quote_request_items" set reference_unit_price = null, reference_currency = null, ` +
            `reference_captured_at = null where quote_request_id = ?`,
          [id],
        );
      const [item] = (await adminDetail(id)).items;
      expect(item).toHaveProperty('referencePrice', null);
      expect(item).toHaveProperty('customerProposedUnitPrice', null);
      expect(item).toHaveProperty('packagingUnitName', null);
      expect(item).toHaveProperty('packagingUnitBaseQuantity', null);
    });

    it('falls back to the submission record for a revised line whose row lost the proposal (R4, US1 #4)', async () => {
      const created = await createProposed(8);
      const modified = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${created.id}`,
        cookies: admin,
        headers: { 'if-match': `"${created.version}"` },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9 }] },
      });
      expect(modified.statusCode, modified.body).toBe(200);
      // A revision written before feature 146 rewrote the row without the proposal.
      await h
        .em()
        .getConnection()
        .execute(`update "quote_request_items" set desired_unit_price = null where quote_request_id = ?`, [
          created.id,
        ]);

      const [item] = (await adminDetail(created.id)).items;
      expect(item?.['desiredUnitPrice']).toBeNull();
      expect(item?.['agreedUnitPrice']).toBe(9);
      expect(item?.['customerProposedUnitPrice']).toBe(8);
    });
  });
});
