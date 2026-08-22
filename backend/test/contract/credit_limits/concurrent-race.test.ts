import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitRaceFixture } from '../../helpers/seed-credit-limit.js';

/**
 * T207 — SC-011 zero-silent-breach: two concurrent POST /orders that together
 * exceed grantedAmount must produce exactly one Order and one
 * CreditLimitReservation; the loser receives 409 LIMIT_INSUFFICIENT.
 *
 * Tests the SELECT … FOR UPDATE discipline (R-10) on credit_limits.
 */

describe('credit-limit concurrent reservation race', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitRaceFixture(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('exactly one order wins, the other returns 409 LIMIT_INSUFFICIENT', async () => {
    // Fixture: each customer's cart total is more than half of the grant —
    // sum of two carts > grantedAmount, so only one can succeed.
    const place = (cookie: string) =>
      h.app
        .inject({
          method: 'POST',
          url: '/api/v1/orders',
          payload: {
            deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
            billingAddressId: '00000000-0000-4000-8000-0000000000d2',
            deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
            // Credit-limit payment method — fixture-seeded (see seed-credit-limit.ts).
            paymentMethodId: '00000000-0000-4000-8000-0000000000f2',
          },
          cookies: { b2b_session: cookie },
        })
        .then((r) => ({ statusCode: r.statusCode, body: r.json() }));

    const [a, b] = await Promise.all([
      place('stub-customer-session-cl-a'),
      place('stub-customer-session-cl-b'),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const loser = (a.statusCode === 409 ? a : b).body as { error: { code: string } };
    expect(loser.error.code).toBe(ERROR_CODES.LIMIT_INSUFFICIENT);
  });
});
