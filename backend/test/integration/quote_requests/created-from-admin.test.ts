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
import { shareQuoteRequestForTest } from '../../helpers/quote-request-share.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

/**
 * T055 — Create-on-behalf flow (US4), with `specs/192-quote-request-draft-share/`
 * T026 (FR-001, FR-005, FR-013).
 *
 * Admin/sales-rep creates an RFQ for a customer → status `Created from
 * admin`, **unshared**: the customer neither sees it nor is told anything
 * until an operator shares it. Once shared, the customer accepts → `Approved`,
 * or rejects → `Canceled`.
 */
describe('Quote Requests — create on behalf (US4)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await h.em().fork().execute<Array<{ n: string }>>(sql, params))[0]!.n);
  const records = (id: string) =>
    scalar(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ?`, [id]);

  async function createOnBehalf(
    items: Array<Record<string, unknown>> = [{ productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 89.0 }],
  ): Promise<{ id: string; version: number; currentRevisionNumber: number; sharedWithCustomer: boolean; expiresAt: string | null }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items,
        headerNote: 'Per phone call.',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const data = (
      res.json() as {
        data: { id: string; version: number; currentRevisionNumber: number; status: string; sharedWithCustomer: boolean; expiresAt: string | null };
      }
    ).data;
    expect(data.status).toBe('Created from admin');
    return data;
  }

  it('creates an RFQ with status Created from admin, unshared, without a date', async () => {
    const r = await createOnBehalf();
    expect(r.id).toBeTruthy();
    expect(r.sharedWithCustomer).toBe(false);
    expect(r.expiresAt).toBeNull();
  });

  it('records nothing for the customer, and the customer cannot see it, until it is shared', async () => {
    const r = await createOnBehalf();
    expect(await records(r.id)).toBe(0);
    const before = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${r.id}`, cookies: CUSTOMER });
    expect(before.statusCode).toBe(404);

    await shareQuoteRequestForTest(h.app, r.id);

    expect(await records(r.id)).toBeGreaterThan(0);
    const after = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${r.id}`, cookies: CUSTOMER });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { data: { awaitingCustomerRevisionAcceptance: boolean } }).data.awaitingCustomerRevisionAcceptance).toBe(
      true,
    );
  });

  it('accepts a line without a price, unshared (FR-013)', async () => {
    const r = await createOnBehalf([
      { productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 5 },
      { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    ]);
    expect(r.sharedWithCustomer).toBe(false);
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${r.id}`, cookies: ADMIN });
    const items = (detail.json() as { data: { items: Array<{ agreedUnitPrice: number | null }> } }).data.items;
    expect(items.map((item) => item.agreedUnitPrice).sort()).toEqual([5, null].sort());
    expect(await records(r.id)).toBe(0);
  });

  it('customer accepts → Approved, once shared', async () => {
    const r = await createOnBehalf();
    await shareQuoteRequestForTest(h.app, r.id);
    const detailRes = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${r.id}`, cookies: CUSTOMER });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;
    const acceptRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${r.id}/accept-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: detail.currentRevisionNumber },
    });
    expect(acceptRes.statusCode).toBe(200);
    const accepted = (acceptRes.json() as { data: { status: string } }).data;
    expect(accepted.status).toBe('Approved');
  });

  it('customer rejects → Canceled with reason, once shared', async () => {
    const r = await createOnBehalf();
    await shareQuoteRequestForTest(h.app, r.id);
    const detailRes = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${r.id}`, cookies: CUSTOMER });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;
    const rejectRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${r.id}/reject-revision`,
      cookies: CUSTOMER,
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
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: '00000000-0000-4000-8000-00000000ffff',
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 1 }],
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
