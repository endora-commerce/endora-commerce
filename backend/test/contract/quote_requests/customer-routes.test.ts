import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

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
