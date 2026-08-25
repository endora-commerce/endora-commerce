import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { Tax } from '../../helpers/package-entities.js';

/**
 * placeOrder resolves VAT from the tax rules (per product tax class / country /
 * org VAT status) instead of a hardcoded 23%. A single non-23% default rule
 * proves the order total tracks the resolved rate.
 */
describe('placeOrder — per-product VAT', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
    // Set the resolved VAT to a distinctive non-23% rate so the order total
    // demonstrably tracks the tax rules rather than a hardcoded 23%.
    const em = h.em();
    const def = await em.findOne(Tax, { isDefault: true });
    if (def) {
      def.rate = '0.0800';
      await em.flush();
    } else {
      em.create(Tax, { code: 'order-test-vat', name: 'Order test VAT 8%', rate: '0.0800', isDefault: true });
      await em.flush();
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('taxes the order at the resolved rate, not a flat 23%', async () => {
    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(place.statusCode).toBe(201);
    const order = (place.json() as { data: { subtotal: number; taxTotal: number } }).data;

    // 8% of the net subtotal — and decisively NOT the old flat 23%.
    expect(order.taxTotal).toBeCloseTo(Math.round(order.subtotal * 0.08 * 100) / 100, 2);
    expect(order.taxTotal).not.toBeCloseTo(Math.round(order.subtotal * 0.23 * 100) / 100, 2);
  });
});
