import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { setupTestServer } from '../../helpers/test-server.js';

/**
 * T049 — Happy path for an RFQ:
 * 1. Customer POSTs items to `/quote-requests/current/items`
 * 2. Customer POSTs `/quote-requests/current/submit` → 200, status flips draft → new
 * 3. Submitting an empty draft → 422 RFQ_EMPTY (second sub-test)
 *
 * Relies on a stub customer session set by the auth plugin.
 */

describe('POST /api/v1/quote-requests/current/submit', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await setupTestServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('submits a non-empty draft: 200 and status flips to "new"', async () => {
    // Step 1 — ensure we have an item.
    const addItem = await app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests/current/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 3 },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(addItem.statusCode).toBe(200);

    // Step 2 — submit.
    const submit = await app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests/current/submit',
      payload: {},
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(submit.statusCode).toBe(200);
    const body = submit.json() as { data: { status: string; submittedAt: string | null } };
    expect(body.data.status).toBe('new');
    expect(body.data.submittedAt).not.toBeNull();
  });

  it('returns 422 RFQ_EMPTY when submitting an empty draft', async () => {
    // Fresh draft (different stub session implies a different draft).
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests/current/submit',
      payload: {},
      cookies: { b2b_session: 'stub-empty-draft-customer-session' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.RFQ_EMPTY);
  });
});
