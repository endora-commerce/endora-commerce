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
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { PaymentMethod, type PaymentMethodRow } from '../../helpers/package-entities.js';
import { StockAllocation } from '../../helpers/package-entities.js';
import { Order, OrderItem } from '../../helpers/package-entities.js';
import { Payment } from '../../helpers/package-entities.js';

/**
 * Feature 085 Phase F (User Story 3) — the buyer cancels their own order.
 *
 * Before this there was no cancel route and no storefront control: a buyer
 * could not cancel an order in any state. The feature's held state (`on_hold`,
 * indefinite, holding stock) is only survivable because both actors the owner's
 * ruling names can act on it, and this is the buyer's half.
 *
 * The two cases that carry the design are the two the predicate's terms exist
 * for, and a rule reading one axis passes one and fails the other:
 *
 * - **A bank-transfer order the shop has already shipped is refused**, though
 *   its money axis still says the transfer never arrived. Bank transfer and
 *   cash on pickup never advance their own money axis, and the admin
 *   payment-status route writes `paymentStatus` and never `order.status`, so
 *   recording money and advancing fulfilment are independent acts. Under
 *   Phase D a cancellation here would release stock the shop has dispatched.
 * - **A freshly placed credit-limit order is refused**, though it sits at the
 *   very status every other new order sits at, because the credit was drawn
 *   inside the placement transaction — unpaid *by arrangement* is the shop
 *   acting, not waiting.
 */

/** The seeded Organization Admin — reads every order of their organisation. */
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };
/** A regular user of the same Organization, whose own orders the admin can read. */
const COLLEAGUE = { cookies: { b2b_session: 'stub-customer-session-rfq' } };
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('a buyer cancels their own order (085 Phase F)', () => {
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
   * A payment method of this file's own, so a `statusOnFailure` a case needs is
   * never a mutation of the seeded method other files place orders with.
   */
  async function bankTransferMethod(statusOnFailure = 'on_hold'): Promise<PaymentMethodRow> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `cc_${randomUUID().slice(0, 8)}`,
      name: { default: 'Customer cancel' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure,
    });
    await em.persistAndFlush(method);
    return method;
  }

  /** Places a one-line order as a stub buyer, which is what allocates stock. */
  async function place(method: PaymentMethodRow, as = BUYER): Promise<string> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ...as,
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
      ...as,
    });
    expect(placed.statusCode).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  const cancel = (orderId: string, as = BUYER) =>
    h.app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, ...as });

  const readAsBuyer = async (orderId: string, as = BUYER) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, ...as });
    return { statusCode: res.statusCode, body: res.json() as { data: Record<string, unknown> } };
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

  const transitionEntries = (orderId: string) =>
    h.auditLogService.query({ action: 'order.status_transition', objectId: orderId });

  /** Advance an order through the graph the way an operator fulfilling it would. */
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

  /**
   * US3 scenario 1 + FR-019 + FR-020. The stock release is Phase D's machinery
   * and this is its first customer-facing caller: the buyer's cancellation gets
   * it by using the seam, not by a special case of its own.
   */
  it('cancels an unpaid order, releases its stock and records the buyer as the author', async () => {
    const orderId = await place(await bankTransferMethod());

    const held = await allocationsOf(orderId);
    expect(held).toHaveLength(1);
    expect(held[0]!.releasedAt ?? null).toBeNull();

    const res = await cancel(orderId);

    expect(res.statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('cancelled');

    const released = await allocationsOf(orderId);
    // A `Date`, not `not.toBeNull()`: an unreleased row reads back `undefined`,
    // and `undefined` satisfies `not.toBeNull()`.
    expect(released[0]!.releasedAt).toBeInstanceOf(Date);

    const entries = await transitionEntries(orderId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stateBefore).toEqual({ status: 'new' });
    expect(entries[0]?.stateAfter).toEqual({ status: 'cancelled' });
    // The platform's one existing convention for a self-service customer
    // action, as `returns` established it: no admin acted, and the customer
    // account is carried on the impersonation column. The honest model is a
    // dedicated actor column; it is a separate feature (research R14) because
    // adding it here without migrating `returns` and every reader would leave
    // two conventions for one fact.
    expect(entries[0]?.actorAdminUserId ?? null).toBeNull();
    expect(entries[0]?.impersonatedCustomerAccountId).toBe(TEST_CUSTOMER_ID);
  });

  /**
   * The trap (US3 scenario 3, FR-014, research R13's worked example). A
   * money-axis-only predicate passes the case above and fails this one.
   */
  it('refuses a bank-transfer order the shop has already shipped, though the money never arrived', async () => {
    const orderId = await place(await bankTransferMethod());
    // The operator picks, packs and ships on the strength of the relationship
    // and reconciles the transfer later — ordinary B2B behaviour, and it is
    // exactly what the money axis cannot see.
    await advance(orderId, ['paid', 'processing', 'shipment_ready', 'shipment_sent']);
    expect((await orderNow(orderId)).paymentStatus).toBe('awaiting_payment');

    const res = await cancel(orderId);

    expect(res.statusCode).toBe(409);
    expect((await orderNow(orderId)).status).toBe('shipment_sent');
    // The point of the refusal: the goods are in transit and their stock stays
    // allocated against the order that dispatched them.
    expect((await allocationsOf(orderId))[0]!.releasedAt ?? null).toBeNull();
    // And the buyer's own page never offered the control.
    expect((await readAsBuyer(orderId)).body.data['customerCancellable']).toBe(false);
  });

  /**
   * US3 scenario 4 / FR-015 — and the second term does *not* do this one for
   * us: the order sits at the initial status, so `shopHasNotStarted` is true.
   * It is the allow-list on the money axis that refuses it.
   */
  it('refuses a credit-limit order minutes after placement, which the lifecycle term admits', async () => {
    const orderId = await place(await bankTransferMethod());
    const em = h.em();
    const order = await em.findOneOrFail(Order, { id: orderId });
    // Placement sets this for `kind === 'credit_limit'` inside its own
    // transaction, having already drawn the credit. Reproduced on the column
    // rather than by provisioning a credit line, because the column is what the
    // predicate reads and what the ruling is about.
    order.paymentStatus = 'deferred';
    await em.flush();

    expect((await orderNow(orderId)).status).toBe('new');
    const res = await cancel(orderId);

    expect(res.statusCode).toBe(409);
    expect((await orderNow(orderId)).status).toBe('new');
    expect((await readAsBuyer(orderId)).body.data['customerCancellable']).toBe(false);
  });

  /**
   * The distinction R13 draws — compare to the *configured* failure status, not
   * to "is the order on hold". This method is configured to fail into
   * `processing`, and an operator has put the order on hold from mid-fulfilment,
   * so `on_hold` is not where the payment flow would have left it. A set test
   * against `{initial, on_hold}` hands the buyer a cancel button here, and it is
   * wrong to.
   *
   * **The distinction is only decidable when the two statuses differ**, which
   * they do not under the shipped default: a method failing into `on_hold`
   * produces an order whose columns are identical whether a decline put it
   * there or an operator did. Telling those apart needs the order's *history*,
   * which the ruled predicate deliberately does not read — see the note in
   * `domain/customer-cancellation.ts`.
   */
  it('refuses an order held from mid-fulfilment, where the method fails elsewhere', async () => {
    const orderId = await place(await bankTransferMethod('processing'));
    await advance(orderId, ['paid', 'processing', 'on_hold']);

    const res = await cancel(orderId);

    expect(res.statusCode).toBe(409);
    expect((await orderNow(orderId)).status).toBe('on_hold');
    expect((await readAsBuyer(orderId)).body.data['customerCancellable']).toBe(false);
  });

  /** US3 scenario 2 — a paid order is the shop's to cancel, not the buyer's. */
  it('refuses a paid order and does not move it', async () => {
    const method = await bankTransferMethod();
    const orderId = await place(method);
    const paid = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payment-status`,
      payload: { to: 'paid' },
      ...ADMIN,
    });
    expect(paid.statusCode).toBe(200);

    const res = await cancel(orderId);

    expect(res.statusCode).toBe(409);
    expect((await orderNow(orderId)).status).toBe('new');
  });

  /**
   * US3 scenario 5 / FR-016 — a foreign order is a scoped-find 404, never a
   * 403, so the refusal does not disclose that the order exists. The colleague
   * is in the *same* Organization and can read the order, which is what makes
   * this a statement about the cancel scope rather than about tenancy.
   */
  it('answers 404 for a colleague cancelling a peer order they can read', async () => {
    // Placed by the regular user; read by the Organization Admin, who sees
    // every order of the organisation and placed none of them.
    const orderId = await place(await bankTransferMethod(), COLLEAGUE);

    const read = await readAsBuyer(orderId, BUYER);
    expect(read.statusCode).toBe(200);
    // Readable, and the capability says plainly that this reader cannot cancel
    // it — the control and the answer agree (FR-018).
    expect(read.body.data['customerCancellable']).toBe(false);

    const res = await cancel(orderId, BUYER);

    expect(res.statusCode).toBe(404);
    expect((await orderNow(orderId)).status).toBe('new');
  });

  /**
   * US3 scenario 6 — a second attempt changes nothing and says nothing about a
   * failure. `cancelled` is neither the initial status nor a failure status, so
   * the predicate refuses it; answering the buyer's own completed action with
   * an error would be the wrong reading of their second click.
   */
  it('is idempotent: a second cancellation succeeds, writes nothing and releases nothing twice', async () => {
    const orderId = await place(await bankTransferMethod());
    expect((await cancel(orderId)).statusCode).toBe(200);
    const releasedAt = (await allocationsOf(orderId))[0]!.releasedAt;

    const again = await cancel(orderId);

    expect(again.statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('cancelled');
    expect(await transitionEntries(orderId)).toHaveLength(1);
    expect((await allocationsOf(orderId))[0]!.releasedAt).toEqual(releasedAt);
  });

  /**
   * FR-018 / SC-006 — the control and the server never disagree. The capability
   * is computed by the platform because two of its three inputs (the configured
   * initial status, the method's configured failure status) are configuration
   * the storefront does not have.
   */
  it('carries the capability on the buyer reads, and it agrees with the answer', async () => {
    const orderId = await place(await bankTransferMethod());

    const before = await readAsBuyer(orderId);
    expect(before.body.data['customerCancellable']).toBe(true);

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/orders', ...BUYER });
    const listed = (list.json() as { data: Array<Record<string, unknown>> }).data.find(
      (o) => o['id'] === orderId,
    );
    expect(listed?.['customerCancellable']).toBe(true);

    expect((await cancel(orderId)).statusCode).toBe(200);
    // Cancelled: nothing left to offer, and the server would refuse a third
    // party. The read says so.
    expect((await readAsBuyer(orderId)).body.data['customerCancellable']).toBe(false);
  });

  /**
   * US1 → US3, the path this feature exists to open: a declined payment holds
   * the order at the method's failure status instead of cancelling it, and the
   * buyer may then either pay again or cancel. This is the second exit.
   *
   * The decline is driven **through the settlement ingress** rather than by
   * assigning the two columns. Since issue #284 the predicate asks who wrote
   * the hold, and a hold assigned in a test is a hold nobody wrote — which the
   * predicate correctly refuses, and which would have made this case pass or
   * fail on how its fixture was built rather than on what the product does.
   */
  it('lets the buyer cancel an order held after a declined payment', async () => {
    const orderId = await place(await bankTransferMethod('on_hold'));
    const payment = await h.em().findOneOrFail(Payment, { orderId });
    const declined = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...ADMIN,
      payload: { paymentId: payment.id, outcome: 'failure', failureReason: 'card declined' },
    });
    expect(declined.statusCode).toBe(200);
    const order = await orderNow(orderId);
    expect(order.status).toBe('on_hold');
    expect(order.paymentStatus).toBe('failed');

    expect((await readAsBuyer(orderId)).body.data['customerCancellable']).toBe(true);
    const res = await cancel(orderId);

    expect(res.statusCode).toBe(200);
    expect((await orderNow(orderId)).status).toBe('cancelled');
    expect((await allocationsOf(orderId))[0]!.releasedAt).toBeInstanceOf(Date);
  });
});
