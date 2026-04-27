import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T098 — `POST /orders` with an empty Cart must return 409 CART_EMPTY and
 * create no Order row.
 */

describe('POST /api/v1/orders — empty cart', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 409 CART_EMPTY', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.CART_EMPTY);
  });
});
