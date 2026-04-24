import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T050 — `POST /admin/quote-requests/:id/quote` where the request body is
 * missing a line-item pricing entry for one of the RFQ's items must return
 * `422 QUOTE_INCOMPLETE`. Partial quotes are not allowed (FR-022).
 */

describe('POST /api/v1/admin/quote-requests/:id/quote — incomplete quote', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 422 QUOTE_INCOMPLETE when an RFQ item is missing from the request', async () => {
    const rfqId = '00000000-0000-4000-8000-000000002001';
    // Seed: RFQ has 2 items, both must be priced. We pass only one.
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${rfqId}/quote`,
      payload: {
        items: [
          {
            itemId: '00000000-0000-4000-8000-000000002101',
            quotedUnitPrice: 19.99,
          },
        ],
        terms: { leadTimeDays: 7, validityDays: 14 },
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.QUOTE_INCOMPLETE);
  });
});
