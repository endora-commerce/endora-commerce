import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import { StockAllocation } from '../../../src/modules/inventory/entities/stock-allocation.entity.js';

/**
 * Issue #284 — two orders sitting at the same status, told apart by who put
 * them there.
 *
 * Feature 085's second cancellation term compared the order's status to the
 * payment method's **configured** `statusOnFailure`, meaning to separate "held
 * by a decline" from "held by an operator mid-fulfilment". Phase C then made
 * `status_on_failure = 'on_hold'` the shipped default for every method, and on
 * that default the two orders are identical in every column the predicate read:
 * same `status`, same `paymentStatus`, same configured failure status. So the
 * operator's hold handed the buyer a cancel control, and cancelling releases
 * the stock a warehouse may already have picked.
 *
 * Every case in this file therefore runs on `statusOnFailure: 'on_hold'` — the
 * shipped default, where the columns cannot tell the two apart. The
 * discriminator is the order's transition history, which Phase D made exist:
 * the ingress announces itself as `{ kind: 'system', source: 'payment' }` and
 * an operator as `{ kind: 'admin', adminUserId }`, and the audit entry keeps
 * the second one's id.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

describe('who held the order decides whether the buyer may cancel it (#284)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Earlier files in this suite place orders against the same product; top
    // its default-warehouse stock up rather than assume it. Scoped to the one
    // product, so nothing else in the table moves.
    await h
      .em()
      .execute(`update "stock_levels" set "on_hand" = 1000 where "product_id" = ?`, [
        SEED_PRODUCT_101_ID,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * The shipped default, deliberately: `on_hold` is where Phase C points every
   * method's failure, and it is the configuration on which the two orders this
   * file is about are indistinguishable by column.
   */
  async function bankTransferMethod(): Promise<PaymentMethod> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `ha_${randomUUID().slice(0, 8)}`,
      name: { default: 'Hold authorship' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    await em.persistAndFlush(method);
    return method;
  }

  /** Places a one-line order as the stub buyer, which is what allocates stock. */
  async function place(method: PaymentMethod): Promise<{ orderId: string; paymentId: string }> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ...BUYER,
    });
    expect(add.statusCode).toBe(200);

    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: method.id,
      },
      ...BUYER,
    });
    expect(placed.statusCode).toBe(201);
    const orderId = (placed.json() as { data: { id: string } }).data.id;
    const payment = await h.em().findOneOrFail(Payment, { orderId });
    return { orderId, paymentId: payment.id };
  }

  /** The settlement ingress, as a gateway's callback reaches it. */
  async function decline(paymentId: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...ADMIN,
      payload: { paymentId, outcome: 'failure', failureReason: 'card declined' },
    });
    expect(res.statusCode).toBe(200);
  }

  /** An operator advancing the order through the graph, one status at a time. */
  async function advance(orderId: string, path: string[]): Promise<void> {
    for (const to of path) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/status`,
        payload: { to },
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
    }
  }

  const cancel = (orderId: string) =>
    h.app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, ...BUYER });

  const readAsBuyer = async (orderId: string) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, ...BUYER });
    return res.json() as { data: Record<string, unknown> };
  };

  const orderNow = (orderId: string): Promise<Order> =>
    h.em().findOneOrFail(Order, { id: orderId }, { refresh: true });

  async function allocationsOf(orderId: string): Promise<StockAllocation[]> {
    const em = h.em();
    const items = await em.find(OrderItem, { orderId });
    return em.find(
      StockAllocation,
      { orderItemId: { $in: items.map((i) => i.id) } },
      { refresh: true },
    );
  }

  /**
   * The live case, and the defect. Bank transfer never advances its own money
   * axis — the transfer clears out of band and the admin payment-status route
   * writes `paymentStatus` alone — so this order is `awaiting_payment` at
   * `on_hold`, which is exactly where a decline would have left it. The only
   * thing that says otherwise is that an operator wrote the hold, from
   * `processing`, to investigate something.
   */
  it('refuses an order an operator held mid-fulfilment, on the method default where the columns agree', async () => {
    const method = await bankTransferMethod();
    const { orderId } = await place(method);
    // Through `paid` because the configured graph has no `new → processing`
    // edge; the order **status** `paid` and the money axis are independent, and
    // the assertion below is that the money axis never moved.
    await advance(orderId, ['paid', 'processing', 'on_hold']);

    const order = await orderNow(orderId);
    // The premise, asserted rather than assumed: every column the shipped
    // predicate read says "held by a decline".
    expect(order.status).toBe('on_hold');
    expect(order.paymentStatus).toBe('awaiting_payment');
    expect(method.statusOnFailure).toBe(order.status);

    expect((await readAsBuyer(orderId)).data['customerCancellable']).toBe(false);
    expect((await cancel(orderId)).statusCode).toBe(409);
    expect((await orderNow(orderId)).status).toBe('on_hold');
    // The reason the refusal matters: the warehouse may already have picked
    // these goods, and cancelling releases their allocation.
    expect((await allocationsOf(orderId))[0]!.releasedAt ?? null).toBeNull();
  });

  /**
   * The other half, and the case the feature exists for. Same method, same two
   * statuses, same money axis — a declined payment put it there, so the buyer
   * keeps the exit the feature gave them.
   */
  it('still lets the buyer cancel an order the payment ingress held after a decline', async () => {
    const { orderId, paymentId } = await place(await bankTransferMethod());
    await decline(paymentId);

    const held = await orderNow(orderId);
    expect(held.status).toBe('on_hold');
    expect(held.paymentStatus).toBe('failed');

    expect((await readAsBuyer(orderId)).data['customerCancellable']).toBe(true);
    expect((await cancel(orderId)).statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('cancelled');
    expect((await allocationsOf(orderId))[0]!.releasedAt).toBeInstanceOf(Date);
  });

  /**
   * An order whose hold predates Phase D, or whose history has been trimmed:
   * nothing in the database says who moved it. Reproduced as a status write
   * that never went through the seam, which is what every payment-driven
   * status change was before Phase D.
   *
   * Refused. The question the predicate asks has no answer here, and the two
   * ways of being wrong are not symmetric: guessing "a decline held it" hands
   * a buyer a control that releases stock the shop may have committed, while
   * guessing "an operator held it" costs the buyer a button and leaves them
   * the shop, which the refusal message points them at.
   */
  it('refuses a held order with no transition history rather than guessing', async () => {
    const { orderId } = await place(await bankTransferMethod());
    // No seam, no audit entry — a pre-Phase-D hold, exactly.
    await h.em().nativeUpdate(Order, { id: orderId }, { status: 'on_hold', paymentStatus: 'failed' });

    expect(
      await h.auditLogService.query({ action: 'order.status_transition', objectId: orderId }),
    ).toHaveLength(0);

    expect((await readAsBuyer(orderId)).data['customerCancellable']).toBe(false);
    expect((await cancel(orderId)).statusCode).toBe(409);
    expect((await orderNow(orderId)).status).toBe('on_hold');
  });

  /**
   * The buyer's second click on their own completed cancellation is still a
   * success, and it is decided before the predicate runs — a cancelled order
   * has no history answer that would admit it.
   */
  it('keeps the cancelled-order idempotency ahead of the history read', async () => {
    const { orderId, paymentId } = await place(await bankTransferMethod());
    await decline(paymentId);
    expect((await cancel(orderId)).statusCode).toBe(200);

    expect((await cancel(orderId)).statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('cancelled');
  });
});
