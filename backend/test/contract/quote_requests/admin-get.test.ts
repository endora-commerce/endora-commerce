import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedRfqForAdminQuote } from '../../helpers/seed-rfqs.js';

/**
 * T092 — `GET /api/v1/admin/quote-requests/:id` returns a single RFQ for
 * the supplier admin so the detail page doesn't need to filter the whole
 * list client-side. Anonymous + missing IDs are rejected the usual way.
 */

describe('GET /api/v1/admin/quote-requests/:id', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRfqForAdminQuote(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the RFQ + its items', async () => {
    const rfqId = '00000000-0000-4000-8000-000000002001';
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfqId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { id: string; status: string; items: Array<{ id: string; quantity: number }> };
    };
    expect(body.data.id).toBe(rfqId);
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it('returns 404 NOT_FOUND for an unknown RFQ id', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/quote-requests/00000000-0000-4000-8000-000000099999',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('rejects anonymous callers with 401', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/quote-requests/00000000-0000-4000-8000-000000002001',
    });
    expect(res.statusCode).toBe(401);
  });
});
