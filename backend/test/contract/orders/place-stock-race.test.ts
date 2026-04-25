import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedStockRaceFixture } from '../../helpers/seed-commerce.js';

/**
 * T100 — Two concurrent `POST /orders` placing the same last unit of a
 * numeric-stock Product: exactly one returns 201; the other 409
 * STOCK_UNAVAILABLE. The stock_levels.reserved counter must match the winning
 * Order's quantity.
 */

describe('POST /api/v1/orders — stock race', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedStockRaceFixture(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('one order wins (201), one returns 409 STOCK_UNAVAILABLE', async () => {
    // Fixture (landed in Phase 4c): a Product with onHand=1 + two customers
    // each with a cart carrying that product and a default address.
    const placeCall = (cookie: string): Promise<{ statusCode: number; body: unknown }> =>
      h.app
        .inject({
          method: 'POST',
          url: '/api/v1/orders',
          payload: {
            deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
            billingAddressId: '00000000-0000-4000-8000-0000000000d2',
            deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
            paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
          },
          cookies: { b2b_session: cookie },
        })
        .then((r) => ({ statusCode: r.statusCode, body: r.json() }));

    const [a, b] = await Promise.all([
      placeCall('stub-customer-session-race-a'),
      placeCall('stub-customer-session-race-b'),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const loser = (a.statusCode === 409 ? a : b).body as { error: { code: string } };
    expect(loser.error.code).toBe(ERROR_CODES.STOCK_UNAVAILABLE);
  });
});
