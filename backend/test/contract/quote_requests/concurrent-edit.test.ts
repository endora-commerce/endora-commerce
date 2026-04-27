import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedRfqForConcurrentEdit } from '../../helpers/seed-rfqs.js';

/**
 * T052 — Two concurrent `PATCH` calls on the same RFQ with the same `If-Match`
 * header: exactly one must return 200, the other must return 409 VERSION_CONFLICT.
 * Proves the optimistic concurrency rule from quote_requests.contract.md.
 */

describe('concurrent PATCH /api/v1/quote-requests/current/items/:itemId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRfqForConcurrentEdit(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('one PATCH wins, the other returns 409 VERSION_CONFLICT', async () => {
    const itemId = '00000000-0000-4000-8000-000000002101';
    const ifMatch = '"1"';
    const [a, b] = await Promise.all([
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/current/items/${itemId}`,
        payload: { quantity: 5 },
        headers: { 'if-match': ifMatch },
        cookies: { b2b_session: 'stub-customer-session' },
      }),
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/current/items/${itemId}`,
        payload: { quantity: 6 },
        headers: { 'if-match': ifMatch },
        cookies: { b2b_session: 'stub-customer-session' },
      }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    const loser = a.statusCode === 409 ? a : b;
    const body = loser.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
  });
});
