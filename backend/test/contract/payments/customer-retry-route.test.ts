import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, paymentRetryResultSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  seedSuspendedOrganization,
  TEST_SUSPENDED_CUSTOMER_ID,
  TEST_SUSPENDED_ORGANIZATION_ID,
} from '../../helpers/seed-commerce.js';
import { PaymentMethod } from '../../helpers/package-entities.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

/**
 * `POST /api/v1/orders/:orderId/payments/retry` — the buyer's own retry
 * (issue #264).
 *
 * Every case here is about who is allowed to reach it. The endpoint is keyed on
 * an order id, so without an ownership answer it is an enumeration surface, and
 * a buyer whose Organization has been blocked must not be able to pay any more
 * than they can order.
 */
describe('customer payment retry route (#264)', () => {
  let h: BackendServerHandle;
  const buyer = { cookies: { b2b_session: 'stub-customer-session' } };
  /**
   * A colleague: same Organization, different person, and seeded by the same
   * helper as `buyer`. They are the caller who matters — the tenancy filter
   * (Principle XI) already refuses a stranger a step earlier, so the ownership
   * check below is the only thing standing between a member of a large buying
   * organisation and every order id inside it.
   */
  const colleague = { cookies: { b2b_session: 'stub-customer-session-rfq' } };
  const blockedBuyer = { cookies: { b2b_session: 'stub-customer-session-suspended' } };

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedSuspendedOrganization(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * A bank-transfer order whose only attempt has failed. `bank_transfer` is one
   * of the four adapters `payments` contributes itself, so this exercises the
   * real registry rather than a stub — its `onStorefrontOrderCreated` answers
   * `awaiting_transfer`, which is what a retry of an offline method should
   * hand back.
   */
  async function seedFailedOrder(
    over: {
      customerAccountId?: string;
      organizationId?: string;
      paymentStatus?: 'paid';
      /** Overrides where the decline left the order — see the seed below. */
      status?: string;
    } = {},
  ): Promise<{ orderId: string; paymentId: string }> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `retry_${randomUUID().slice(0, 8)}`,
      name: { default: 'Retry' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    await em.persistAndFlush(method);
    const order = em.create(Order, {
      organizationId: over.organizationId ?? TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: over.customerAccountId ?? TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
      deliveryAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: method.id,
      paymentMethodSnapshot: {
        code: method.code,
        name: 'Retry',
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
      },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      // The status the settlement ingress leaves behind after a decline. It
      // was `cancelled` for every method in the tree until feature 085 Phase C
      // made `on_hold` the shipped default — which is the whole point of the
      // feature, since `cancelled` is terminal and this route now refuses a
      // terminal order (Phase D).
      status: over.status ?? 'on_hold',
      ...(over.paymentStatus ? { paymentStatus: over.paymentStatus } : {}),
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const payment = em.create(Payment, {
      orderId: order.id,
      paymentMethodId: method.id,
      amount: '12.30',
      currency: 'PLN',
      status: over.paymentStatus === 'paid' ? 'paid' : 'failed',
      failureReason: over.paymentStatus === 'paid' ? null : 'Card declined',
    });
    await em.persistAndFlush(payment);
    return { orderId: order.id, paymentId: payment.id };
  }

  it('opens the next attempt for the buyer who placed the order', async () => {
    const { orderId, paymentId } = await seedFailedOrder();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...buyer,
    });

    expect(res.statusCode).toBe(200);
    const body = paymentRetryResultSchema.parse((res.json() as { data: unknown }).data);
    expect(body.opened).toBe(true);
    expect(body.attemptNo).toBe(2);
    expect(body.paymentId).not.toBe(paymentId);
    expect(body.nextAction.kind).toBe('awaiting_transfer');

    // The failed attempt is kept: a retry is an append, never an overwrite.
    const history = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/payments`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const attempts = (history.json() as { data: Array<{ status: string; attemptNo: number }> }).data;
    expect(attempts.map((a) => [a.attemptNo, a.status])).toEqual([
      [1, 'failed'],
      [2, 'awaiting_payment'],
    ]);
  });

  /**
   * Two clicks are one attempt and one provider session. The second call finds
   * the attempt the first opened still `awaiting_payment` and hands it back.
   */
  it('is idempotent under a double click', async () => {
    const { orderId } = await seedFailedOrder();

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...buyer,
    });
    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...buyer,
    });

    const a = paymentRetryResultSchema.parse((first.json() as { data: unknown }).data);
    const b = paymentRetryResultSchema.parse((second.json() as { data: unknown }).data);
    expect(a.opened).toBe(true);
    expect(b.opened).toBe(false);
    expect(b.paymentId).toBe(a.paymentId);
    expect(b.nextAction.kind).toBe('none');
  });

  /**
   * The ownership check itself, exercised by the one caller who gets past
   * tenancy: a colleague in the same Organization. Without it this endpoint is
   * an order-id enumeration surface for every member of a large buyer.
   */
  it('refuses a colleague`s order without opening anything', async () => {
    const { orderId } = await seedFailedOrder();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...colleague,
    });

    expect(res.statusCode).toBe(403);
    const history = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/payments`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect((history.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it('refuses an anonymous caller', async () => {
    const { orderId } = await seedFailedOrder();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses an order that is already paid', async () => {
    const { orderId } = await seedFailedOrder({ paymentStatus: 'paid' });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...buyer,
    });
    expect(res.statusCode).toBe(409);
  });

  /**
   * Feature 085 Phase D — the lifecycle term. A terminal order is always a
   * deliberate human decision now that the ingress writes no terminal status,
   * and the cancellation that produced it has already released the order's
   * stock, so paying again would be paying for goods the order no longer holds.
   *
   * The money axis says `failed` here, exactly as it does in the case that
   * succeeds; the lifecycle is what differs, which is what makes this a test of
   * the term rather than of the fixture.
   */
  it('refuses an order the lifecycle has ended', async () => {
    const { orderId } = await seedFailedOrder({ status: 'cancelled' });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...buyer,
    });

    expect(res.statusCode).toBe(409);
    // And nothing was opened on the way to being refused: a cancelled order
    // must not acquire an attempt row a later click would resume.
    const attempts = await h.em().find(Payment, { orderId });
    expect(attempts).toHaveLength(1);
  });

  /**
   * The transact guard, in the same envelope placement uses — `FORBIDDEN` alone
   * is shared with every other refusal, so the detail is the part that says
   * *why*.
   */
  it('refuses a buyer whose Organization is blocked', async () => {
    const { orderId } = await seedFailedOrder({
      customerAccountId: TEST_SUSPENDED_CUSTOMER_ID,
      organizationId: TEST_SUSPENDED_ORGANIZATION_ID,
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      ...blockedBuyer,
    });

    expect(res.statusCode).toBe(423);
    const body = res.json() as {
      error: { code: string; details?: { code?: string; status?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(body.error.details?.code).toBe('organization_cannot_transact');
    expect(body.error.details?.status).toBe('blocked');
  });
});
