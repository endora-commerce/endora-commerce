import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { shareQuoteRequestForTest } from '../../helpers/quote-request-share.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * `specs/153-quote-request-pdf-template/` FR-098 — one administrator sends at
 * most 10 quote PDFs a minute. The shared harness boots with the limiter off;
 * this file turns it on and proves the route's declaration is live: the 11th
 * send answers 429 `RATE_LIMITED`, and a refused caller consumes nothing.
 */
describe('153 — Send PDF to customer rate limit [integration]', () => {
  let h: BackendServerHandle;
  let quote: string;
  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ enableRateLimit: true, organizationsMailer: new InMemoryMailer() });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 5 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    quote = (res.json() as { data: { id: string } }).data.id;
    // `specs/192-quote-request-draft-share/` — sent only once shared.
    await shareQuoteRequestForTest(h.app, quote);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const send = (cookies: Record<string, string> | undefined) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${quote}/pdf/send`,
      ...(cookies ? { cookies } : {}),
      payload: { recipients: ['buyer@example.com'] },
    });

  it('refuses the 11th send of one administrator within a minute, 429 in the envelope', async () => {
    // Unauthenticated attempts are answered 401 before the limiter counts them.
    for (let i = 0; i < 3; i += 1) expect((await send(undefined)).statusCode).toBe(401);
    for (let i = 1; i <= 10; i += 1) {
      const res = await send(ADMIN);
      expect(res.statusCode, `send ${i}: ${res.body}`).toBe(200);
    }
    const refused = await send(ADMIN);
    expect(refused.statusCode).toBe(429);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});
