import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { PaymentMethod } from '../../helpers/package-entities.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

/**
 * T024 (US2) — placeOrder dispatches via the adapter framework: the order
 * status comes from the method's statusOnPending, additionalPrice is added to
 * the total, and a pending Payment is opened. The existing credit_limit path
 * is covered by its own suites and must stay green.
 */
describe('placeOrder — payment-method adapter dispatch', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
    // Configure the seed method: surcharge + a non-default pending status.
    const em = h.em();
    const method = await em.findOne(PaymentMethod, { id: SEED_PAYMENT_METHOD_ID });
    method!.additionalPrice = '5.00';
    method!.statusOnPending = 'pending';
    await em.persistAndFlush(method!);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('applies statusOnPending, adds additionalPrice, and opens a Payment', async () => {
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
    const order = (place.json() as {
      data: {
        id: string;
        status: string;
        subtotal: number;
        taxTotal: number;
        deliveryTotal: number;
        total: number;
      };
    }).data;

    // statusOnPending applied
    expect(order.status).toBe('pending');
    // additionalPrice folded into the total
    expect(order.total).toBeCloseTo(order.subtotal + order.taxTotal + order.deliveryTotal + 5);

    // a pending Payment was opened for the order
    const payment = await h.em().findOne(Payment, { orderId: order.id });
    expect(payment).not.toBeNull();
    expect(payment!.paymentMethodId).toBe(SEED_PAYMENT_METHOD_ID);
    expect(payment!.status).toBe('awaiting_payment');
  });
});
