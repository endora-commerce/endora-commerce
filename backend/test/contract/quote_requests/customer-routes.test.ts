import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedCustomFieldAudienceCases } from '../../helpers/custom-field-audience.js';
import { adminUserIdKeys, deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { quoteRequestSchema } from '@endora-commerce/contracts';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * T026 — Customer-facing Quote Requests routes.
 *
 * Covers create + submit, list, get, resubmit. The accept-revision /
 * reject-revision paths are exercised by the negotiation-loop
 * integration test (T046, US3).
 */
describe('Customer Quote Requests routes (US1)', () => {
  let h: BackendServerHandle;
  let createdRfqId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a Pending Quote Request with one line item', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        headerNote: 'Could you match the X price?',
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 50, desiredUnitPrice: 8.0 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        id: string;
        status: string;
        items: Array<{ productId: string; quantity: number; desiredUnitPrice: number | null }>;
        events: Array<{ eventType: string }>;
      };
    };
    expect(body.data.status).toBe('Pending');
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.productId).toBe(SEED_PRODUCT_101_ID);
    expect(body.data.items[0]?.quantity).toBe(50);
    expect(body.data.items[0]?.desiredUnitPrice).toBe(8);
    expect(body.data.events.map((e) => e.eventType)).toEqual(['created', 'submitted']);
    createdRfqId = body.data.id;
    expect(adminUserIdKeys(body)).toEqual([]);
    expect(disagreements(deepStrict(quoteRequestSchema), body.data)).toEqual([]);
  });

  it('lists the Quote Request in the customer view', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; status: string; lineCount: number }>;
    };
    expect(body.data.find((r) => r.id === createdRfqId)).toBeTruthy();
  });

  it('returns the detail with no comparison block while Pending without revisions', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${createdRfqId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        id: string;
        status: string;
        awaitingCustomerRevisionAcceptance: boolean;
        comparisonAgainstLastSeen: unknown;
      };
    };
    expect(body.data.id).toBe(createdRfqId);
    expect(body.data.awaitingCustomerRevisionAcceptance).toBe(false);
    expect(body.data.comparisonAgainstLastSeen).toBeNull();
  });

  it('answers the customer only customer-visible custom-field values; the administrator reads all', async () => {
    const audience = await seedCustomFieldAudienceCases(h, 'quote_request', createdRfqId);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${createdRfqId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { customFieldValues: unknown } }).data.customFieldValues).toEqual(
      audience.customerVisible,
    );
    for (const key of [audience.internalKey, audience.implicitKey, audience.orphanKey]) {
      expect(res.body).not.toContain(key);
    }

    // The customer list is a summary and carries no custom-field values at all.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(audience.visibleKey);
    expect(list.body).not.toContain(audience.internalKey);

    const admin = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${createdRfqId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(admin.statusCode).toBe(200);
    expect((admin.json() as { data: { customFieldValues: unknown } }).data.customFieldValues).toEqual(
      audience.stored,
    );
  });

  it('answers the customer no administrator identifier; the administrator reads them', async () => {
    // A quote an administrator created, is assigned to, and has acted on.
    const conn = h.em().getConnection();
    await conn.execute(
      `update "quote_requests" set created_by_admin_user_id = ?, assigned_admin_user_id = ? where id = ?`,
      [TEST_ADMIN_ID, TEST_ADMIN_ID, createdRfqId],
    );
    await conn.execute(
      `update "quote_request_events" set actor_admin_user_id = ?, actor_customer_account_id = null where quote_request_id = ?`,
      [TEST_ADMIN_ID, createdRfqId],
    );

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${createdRfqId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: unknown }).data;
    expect(adminUserIdKeys(detail)).toEqual([]);
    expect(res.body).not.toContain(TEST_ADMIN_ID);
    expect(disagreements(deepStrict(quoteRequestSchema), detail)).toEqual([]);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(adminUserIdKeys(list.json())).toEqual([]);
    expect(list.body).not.toContain(TEST_ADMIN_ID);

    const admin = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${createdRfqId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(admin.statusCode).toBe(200);
    const adminDetail = (
      admin.json() as {
        data: {
          createdByAdminUserId: string | null;
          assignedAdminUserId: string | null;
          events: Array<{ actorAdminUserId: string | null }>;
        };
      }
    ).data;
    expect(adminDetail.createdByAdminUserId).toBe(TEST_ADMIN_ID);
    expect(adminDetail.assignedAdminUserId).toBe(TEST_ADMIN_ID);
    expect(adminDetail.events.every((e) => e.actorAdminUserId === TEST_ADMIN_ID)).toBe(true);
  });

  it('rejects a draft body without items (FR-021)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('resubmits an existing RFQ as a fresh Pending RFQ', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${createdRfqId}/resubmit`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        id: string;
        status: string;
        items: Array<{ productId: string; desiredUnitPrice: number | null }>;
        events: Array<{ eventType: string; payload: Record<string, unknown> }>;
      };
    };
    expect(body.data.id).not.toBe(createdRfqId);
    expect(body.data.status).toBe('Pending');
    expect(body.data.items[0]?.productId).toBe(SEED_PRODUCT_101_ID);
    // Resubmit pre-fills at the customer's current price list — desiredUnitPrice
    // is intentionally cleared, not carried over from the source.
    expect(body.data.items[0]?.desiredUnitPrice).toBeNull();
    const types = body.data.events.map((e) => e.eventType);
    expect(types).toContain('re-submitted');
    // The source quote carries administrator ids by now; the reply to the customer names none.
    expect(adminUserIdKeys(body)).toEqual([]);
    expect(res.body).not.toContain(TEST_ADMIN_ID);
  });

  it('returns 404 for a Quote Request belonging to a different customer', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quote-requests/00000000-0000-4000-8000-00000000ffff',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(404);
  });
});
