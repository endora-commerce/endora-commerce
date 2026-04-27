import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedRfqForAcceptExpired } from '../../helpers/seed-rfqs.js';

/**
 * T051 — Accepting a quoted RFQ after `expiresAt` must return `410 RFQ_EXPIRED`.
 * The expiry job (T078) transitions the RFQ to `expired`, but this contract
 * test covers the live-time path even if the job has not run yet.
 */

describe('POST /api/v1/quote-requests/:id/accept — expired quote', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRfqForAcceptExpired(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 410 RFQ_EXPIRED on an expired quote', async () => {
    // Seed: RFQ 2002 is "quoted" with expiresAt in the past.
    const rfqId = '00000000-0000-4000-8000-000000002002';
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfqId}/accept`,
      payload: {},
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(410);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.RFQ_EXPIRED);
  });
});
