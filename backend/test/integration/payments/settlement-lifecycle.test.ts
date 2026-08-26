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
import { PaymentMethod, type PaymentMethodRow } from '../../helpers/package-entities.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import { StockAllocation } from '../../helpers/package-entities.js';

/**
 * Feature 085 Phase D — what the settlement ingress does to an order's
 * lifecycle now that it goes through `orderTransitionPort` instead of assigning
 * `order.status`.
 *
 * The two cases that open this file are the defect the feature exists to close,
 * and both are red on the tree before Phase D:
 *
 * - **A cancelled order kept its stock forever.** `releaseAllocations` has one
 *   call site in the whole tree, inside the transition's side-effects hook, and
 *   the ingress reached it at no point. `cancelled` is terminal, so no later
 *   transition could run either: there was no path in the product that could
 *   repair an affected order (research R7, issue #273).
 * - **No payment-driven status change had ever been audited.** An operator's
 *   cancellation writes an `order.status_transition` entry; the ingress's
 *   cancellation of the same order wrote nothing (research R3, SC-004).
 *
 * The orders are placed through the storefront route rather than assembled with
 * `em.create`, because the stock allocation is what one of the cases is about
 * and only placement creates it.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

interface PlacedOrder {
  orderId: string;
  paymentId: string;
}

describe('payment settlement moves the order through the lifecycle (085 Phase D)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // The suite shares one database and earlier files place orders against this
    // product, so top its default-warehouse stock up rather than assume it.
    // Scoped to the one product; nothing else in the table is touched.
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
   * A payment method of this file's own, so a `status_on_failure` a case needs
   * is never a mutation of the seeded method other files place orders with.
   */
  async function methodWith(statuses: {
    statusOnSuccess?: string;
    statusOnFailure?: string;
  }): Promise<PaymentMethodRow> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `sl_${randomUUID().slice(0, 8)}`,
      name: { default: 'Settlement lifecycle' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: statuses.statusOnSuccess ?? 'paid',
      statusOnFailure: statuses.statusOnFailure ?? 'on_hold',
    });
    await em.persistAndFlush(method);
    return method;
  }

  /** Places a one-line order as the stub buyer, which is what allocates stock. */
  async function place(method: PaymentMethodRow): Promise<PlacedOrder> {
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
  async function settle(
    paymentId: string,
    outcome: 'success' | 'failure',
    failureReason?: string,
  ): Promise<{ statusCode: number; orderStatus: string | null }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...ADMIN,
      payload: { paymentId, outcome, ...(failureReason ? { failureReason } : {}) },
    });
    const body = res.json() as { data?: { orderStatus: string | null } };
    return { statusCode: res.statusCode, orderStatus: body.data?.orderStatus ?? null };
  }

  async function allocationsOf(orderId: string): Promise<StockAllocation[]> {
    const em = h.em();
    const items = await em.find(OrderItem, { orderId });
    return em.find(
      StockAllocation,
      { orderItemId: { $in: items.map((i) => i.id) } },
      { refresh: true },
    );
  }

  const orderNow = async (orderId: string): Promise<Order> =>
    h.em().findOneOrFail(Order, { id: orderId }, { refresh: true });

  const transitionEntries = async (orderId: string) =>
    h.auditLogService.query({ action: 'order.status_transition', objectId: orderId });

  /**
   * Issue #273 / US2 scenario 1 — the defect, in the configuration that reaches
   * it. Phase C made `on_hold` the shipped default, but `status_on_failure` is
   * operator-configurable and an operator may point it at `cancelled`; before
   * Phase C every method in the tree did.
   *
   * The assertion is on the **allocation**, not on the status: the order going
   * to `cancelled` was never in doubt — it is the stock it kept while it did.
   */
  it('releases the stock allocation when a decline cancels the order', async () => {
    const method = await methodWith({ statusOnFailure: 'cancelled' });
    const { orderId, paymentId } = await place(method);

    const held = await allocationsOf(orderId);
    expect(held).toHaveLength(1);
    expect(held[0]!.releasedAt ?? null).toBeNull();

    const res = await settle(paymentId, 'failure', 'card declined');

    expect(res.statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('cancelled');
    const released = await allocationsOf(orderId);
    expect(released).toHaveLength(1);
    // A `Date`, not `not.toBeNull()`: an unreleased row reads back `undefined`
    // rather than `null` here, and `undefined` satisfies `not.toBeNull()` — the
    // assertion this case is about would have passed on the unrepaired tree.
    expect(released[0]!.releasedAt).toBeInstanceOf(Date);
  });

  /**
   * SC-004 — one audit entry per status change, whoever made it. The ingress
   * wrote none, ever, for any payment outcome.
   */
  it('audits the status change a declined payment causes', async () => {
    const method = await methodWith({ statusOnFailure: 'on_hold' });
    const { orderId, paymentId } = await place(method);

    await settle(paymentId, 'failure', 'insufficient funds');

    const entries = await transitionEntries(orderId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stateBefore).toEqual({ status: 'new' });
    expect(entries[0]?.stateAfter).toEqual({ status: 'on_hold' });
  });

  /**
   * US1 acceptance 1 — the shipped default, and the half that must *not* move:
   * a declined card leaves the order alive and its stock exactly where it was,
   * so the buyer can pay again for goods the order still holds.
   */
  it('holds the order and keeps its stock on the shipped default', async () => {
    const method = await methodWith({ statusOnFailure: 'on_hold' });
    const { orderId, paymentId } = await place(method);

    const res = await settle(paymentId, 'failure', 'declined');

    expect(res.statusCode).toBe(200);
    const order = await orderNow(orderId);
    expect(order.status).toBe('on_hold');
    expect(order.paymentStatus).toBe('failed');
    const allocations = await allocationsOf(orderId);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.releasedAt ?? null).toBeNull();
  });

  /**
   * FR-010 — the happy path, through the graph for the first time. `new → paid`
   * is the edge Phase A added: placement puts the order at the method's
   * `status_on_pending` (seeded `new`) and a first success asks for
   * `status_on_success` (seeded `paid`), a pair that was in neither the
   * explicit nor the universal set. The ingress got away with it only because
   * it never asked.
   */
  it('moves a first successful payment from new to paid, and audits it', async () => {
    const method = await methodWith({ statusOnSuccess: 'paid' });
    const { orderId, paymentId } = await place(method);

    const res = await settle(paymentId, 'success');

    expect(res.statusCode).toBe(200);
    expect(res.orderStatus).toBe('paid');
    const order = await orderNow(orderId);
    expect(order.status).toBe('paid');
    expect(order.paymentStatus).toBe('paid');
    expect(await transitionEntries(orderId)).toHaveLength(1);
  });

  /**
   * US2 scenario 4 / FR-009 — the architect's ruling, in the one shape that is
   * live today: `status_on_failure` is validated for **existence** only, so an
   * operator may point it at a status the order cannot reach from where it
   * sits. `shipment_sent` is a configured status with no edge from `new`.
   *
   * Three things have to hold together, and each of them alone would be the
   * wrong answer: the order keeps its status (dragging a fulfilling order
   * backwards is worse than not moving it), nothing is audited (nothing moved),
   * and the provider is answered **200** — a webhook that 4xx's is retried
   * forever.
   */
  it('keeps the status, records nothing and still answers 200 when the target is unreachable', async () => {
    const method = await methodWith({ statusOnFailure: 'shipment_sent' });
    const { orderId, paymentId } = await place(method);

    const res = await settle(paymentId, 'failure', 'declined');

    expect(res.statusCode).toBe(200);
    expect(res.orderStatus).toBe('new');
    const order = await orderNow(orderId);
    expect(order.status).toBe('new');
    // The money axis still records the decline: the refusal is about the
    // lifecycle, and the buyer's retry reads this.
    expect(order.paymentStatus).toBe('failed');
    expect(await h.em().findOneOrFail(Payment, { id: paymentId }, { refresh: true })).toMatchObject({
      status: 'failed',
    });
    expect(await transitionEntries(orderId)).toHaveLength(0);
    const allocations = await allocationsOf(orderId);
    expect(allocations[0]!.releasedAt ?? null).toBeNull();
  });

  /**
   * FR-006 — a second failure on an order already at the failure status is a
   * no-op on the lifecycle and still records the attempt. `already_there` is
   * the port's answer, and it writes no second audit entry.
   */
  it('writes no second audit entry when a second decline finds the order already held', async () => {
    const method = await methodWith({ statusOnFailure: 'on_hold' });
    const { orderId, paymentId } = await place(method);

    await settle(paymentId, 'failure', 'first');
    const retry = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payments/retry`,
      ...ADMIN,
    });
    expect(retry.statusCode).toBe(201);
    const secondAttempt = (retry.json() as { data: { id: string } }).data.id;

    const res = await settle(secondAttempt, 'failure', 'second');

    expect(res.statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('on_hold');
    expect(await transitionEntries(orderId)).toHaveLength(1);
  });
});
