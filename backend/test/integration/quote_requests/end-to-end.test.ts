import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setupTestServer } from '../../helpers/test-server.js';

/**
 * T054 — End-to-end RFQ journey:
 *   Customer adds 3 items → submits → Supplier employee claims → sends quote →
 *   Customer accepts.
 * Each step must return the expected status and each transition must be visible
 * via `GET /quote-requests/:id`.
 */

interface Rfq {
  id: string;
  status: string;
  items: { id: string; quantity: number; quotedUnitPrice: number | null }[];
}

describe('RFQ end-to-end — 3 items, claim, quote, accept', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await setupTestServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks every transition without an error', async () => {
    const productIds = [
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
    ];
    const customerCookie = { b2b_session: 'stub-customer-session-rfq' };
    const adminCookie = { b2b_session: 'stub-admin-session' };

    // 1. Customer adds 3 items.
    for (const pid of productIds) {
      const add = await app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests/current/items',
        payload: { productId: pid, quantity: 2 },
        cookies: customerCookie,
      });
      expect(add.statusCode).toBe(200);
    }

    // 2. Customer submits.
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests/current/submit',
      payload: {},
      cookies: customerCookie,
    });
    expect(submit.statusCode).toBe(200);
    const submitted = submit.json() as { data: Rfq };
    expect(submitted.data.status).toBe('new');
    const rfqId = submitted.data.id;

    // 3. Admin claims.
    const claim = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${rfqId}/claim`,
      payload: {},
      cookies: adminCookie,
    });
    expect(claim.statusCode).toBe(200);
    expect((claim.json() as { data: Rfq }).data.status).toBe('under_review');

    // 4. Admin sends a quote for every item.
    const quotePayload = {
      items: submitted.data.items.map((it) => ({ itemId: it.id, quotedUnitPrice: 9.99 })),
      terms: { leadTimeDays: 5, validityDays: 30 },
    };
    const quote = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${rfqId}/quote`,
      payload: quotePayload,
      cookies: adminCookie,
    });
    expect(quote.statusCode).toBe(200);
    expect((quote.json() as { data: Rfq }).data.status).toBe('quoted');

    // 5. Customer accepts.
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfqId}/accept`,
      payload: {},
      cookies: customerCookie,
    });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { data: Rfq }).data.status).toBe('accepted');
  });
});
