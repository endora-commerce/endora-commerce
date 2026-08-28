import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderTransitionPort, PaymentMethodReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import {
  ReceivePaymentHandler,
  type SettlementLogger,
} from '../../../../packages/modules/payments/src/backend/services/receive-payment-handler.js';
import type { OrderPaymentStatusApplyPort } from '../../../../packages/modules/orders/src/ports/index.js';
import { Order } from '../../helpers/package-entities.js';
import { Payment } from '../../helpers/package-entities.js';

/**
 * Gateway refunds (Dashboard- or platform-initiated, delivered via
 * `charge.refunded`) reflect onto the Payment + Order, are idempotent by the
 * cumulative amount, and never downgrade a fully-refunded payment.
 */
describe('ReceivePaymentHandler.reflectRefund', () => {
  let h: BackendServerHandle;
  let orderId: string;
  let paymentId: string;
  let paymentAmount: number;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
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
    orderId = (place.json() as { data: { id: string } }).data.id;

    // Settle the payment + order so a refund has something to act on.
    const em = h.em();
    const payment = await em.findOne(Payment, { orderId });
    payment!.status = 'paid';
    const order = await em.findOne(Order, { id: orderId });
    order!.paymentStatus = 'paid';
    await em.flush();
    paymentId = payment!.id;
    paymentAmount = Number(payment!.amount);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reflects a partial refund, then a full refund; idempotent and no downgrade', async () => {
    const quiet: SettlementLogger = { warn: () => undefined };
    const handler = new ReceivePaymentHandler(
      () => h.em(),
      h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
      // The real gated port, resolved by the literal name a consumer passes to
      // `lazyPort`: the hold a full refund puts on the order is a transition
      // like any other since feature 085 Phase D, so it is audited and its
      // side-effects run.
      h.container.resolve<OrderTransitionPort>('orderTransitionPort'),
      // The co-transactional half (feature 080, T048): the order's payment
      // status moves to `refunded` on this handler's own transaction, through
      // the port `orders` publishes for it.
      h.container.resolve<OrderPaymentStatusApplyPort>('orderPaymentStatusApplyPort'),
      quiet,
    );

    // Partial refund (cumulative 1.00).
    const partial = await handler.reflectRefund({
      paymentId,
      refundedAmount: 1,
      currency: 'PLN',
      fullyRefunded: false,
      externalRefundId: 're_partial',
    });
    expect(partial?.changed).toBe(true);
    let p = await h.em().findOne(Payment, { id: paymentId }, { refresh: true });
    expect(p!.status).toBe('partially_refunded');
    expect(Number(p!.refundedAmount)).toBeCloseTo(1, 2);
    let o = await h.em().findOne(Order, { id: orderId }, { refresh: true });
    expect(o!.paymentStatus).toBe('paid'); // partial does not flip the order

    // Full refund (cumulative = whole amount).
    const full = await handler.reflectRefund({
      paymentId,
      refundedAmount: paymentAmount,
      currency: 'PLN',
      fullyRefunded: true,
      externalRefundId: 're_full',
    });
    expect(full?.changed).toBe(true);
    p = await h.em().findOne(Payment, { id: paymentId }, { refresh: true });
    expect(p!.status).toBe('refunded');
    expect(Number(p!.refundedAmount)).toBeCloseTo(paymentAmount, 2);
    o = await h.em().findOne(Order, { id: orderId }, { refresh: true });
    expect(o!.paymentStatus).toBe('refunded');
    // A full refund also puts the order on hold for operator review.
    expect(o!.status).toBe('on_hold');
    // ...through the lifecycle since feature 085 Phase D, so the hold is
    // audited like any other status change. It was the third of the three
    // sites that assigned `order.status` and reached the orders flow nowhere.
    const audited = await h.auditLogService.query({
      action: 'order.status_transition',
      objectId: orderId,
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]?.stateAfter).toEqual({ status: 'on_hold' });

    // Re-applying the same full refund is a no-op (idempotent).
    const again = await handler.reflectRefund({
      paymentId,
      refundedAmount: paymentAmount,
      currency: 'PLN',
      fullyRefunded: true,
    });
    expect(again?.changed).toBe(false);
    p = await h.em().findOne(Payment, { id: paymentId }, { refresh: true });
    expect(p!.status).toBe('refunded');
    // And the re-delivery moved nothing: the port answers `already_there`, so
    // no second entry and no second event.
    expect(
      await h.auditLogService.query({ action: 'order.status_transition', objectId: orderId }),
    ).toHaveLength(1);
  });
});
