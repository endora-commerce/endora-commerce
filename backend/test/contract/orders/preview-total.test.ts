import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * The read-only preview-total endpoint and order placement share one server-side
 * computation, so the previewed total must equal the placed order's total
 * (feature 049 — no client-side pricing, no drift).
 */
describe('order preview-total', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('matches the placed order total exactly', async () => {
    const ids = {
      deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
      billingAddressId: '00000000-0000-4000-8000-0000000000d2',
      deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
    };

    // Preview first (does not mutate the cart).
    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      payload: {
        deliveryMethodId: ids.deliveryMethodId,
        paymentMethodId: ids.paymentMethodId,
        billingAddressId: ids.billingAddressId,
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(preview.statusCode).toBe(200);
    const p = (preview.json() as {
      data: { total: number; taxTotal: number; subtotal: number; deliveryTotal: number };
    }).data;

    // Then place the order with the same inputs and compare.
    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: ids,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(place.statusCode).toBe(201);
    const o = (place.json() as {
      data: { total: number; taxTotal: number; subtotal: number; deliveryTotal: number };
    }).data;

    expect(p.total).toBeCloseTo(o.total, 2);
    expect(p.taxTotal).toBeCloseTo(o.taxTotal, 2);
    expect(p.subtotal).toBeCloseTo(o.subtotal, 2);
    expect(p.deliveryTotal).toBeCloseTo(o.deliveryTotal, 2);
  });
});
