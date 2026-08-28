import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { CreditLimit, CreditLimitReservation, PaymentMethod } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * D-179.3's disclosed defect: `orders` asked `credit_limits` about every order.
 *
 * `releaseByOrder` was called unconditionally on the transition to `paid` and
 * on the transition to `cancelled`. Since !1027 that edge is `refuses-without`,
 * so with `credit_limits` off the gated port raises `ModuleDisabledError` and
 * **both transitions failed for every order** — correct for one placed against
 * a credit limit, wrong for the overwhelming majority that never drew one.
 *
 * The repair is not a `catch` (AGENTS.md composition item 7). `orders` owns the
 * fact it needs: `paymentMethodSnapshot.kind` is stamped at placement from the
 * same value that decides whether `reserve` runs at all, so an order whose kind
 * is not `credit_limit` provably holds no reservation and there is nothing to
 * release. The port is not asked.
 *
 * Both halves are asserted here, and the second is what stops the repair
 * becoming a fail-open: an order that *does* hold a reservation must still
 * refuse, because its credit cannot be given back while the owner is absent.
 *
 * The absence is driven through the real seam — `withModuleOff` flips the
 * registry cache and asserts the flip took before the body observes anything —
 * on the **operator** axis, which is the one D-179.3 made reachable again.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };

const CREDIT_LIMIT_METHOD_ID = '00000000-0000-4000-8000-0000000000f2';
/** Ordinary (bank-transfer) orders: nothing was ever reserved for either. */
const PLAIN_ORDER_TO_CANCEL_ID = '00000000-0000-4000-8000-000000000d01';
const PLAIN_ORDER_TO_PAY_ID = '00000000-0000-4000-8000-000000000d02';
/** Credit-limit orders, each holding its own active reservation. */
const CREDIT_ORDER_TO_CANCEL_ID = '00000000-0000-4000-8000-000000000d03';
const CREDIT_ORDER_TO_PAY_ID = '00000000-0000-4000-8000-000000000d04';
/**
 * The positive control's own order. It cannot share one with the refusal
 * probes: the transition engine flushes the new status *before* it runs the
 * side effect, so a refused cancellation leaves the order already `cancelled`
 * and the re-run is a no-op that releases nothing.
 */
const CREDIT_ORDER_CONTROL_ID = '00000000-0000-4000-8000-000000000d05';

interface ErrorBody {
  error: { code: string };
}

describe('orders — releasing credit is scoped to the orders that drew it (D-179.3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    em.create(PaymentMethod, {
      id: CREDIT_LIMIT_METHOD_ID,
      code: 'credit_limit',
      name: { 'en-US': 'Credit limit', 'pl-PL': 'Limit kredytowy' },
      kind: 'credit_limit',
      adapter: 'credit_limit',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'cancelled',
    });
    await em.flush();

    const limit = em.create(CreditLimit, {
      organizationId: TEST_ORGANIZATION_ID,
      grantedAmount: '10000.00',
      currency: 'PLN',
    });
    await em.persistAndFlush(limit);

    const order = (id: string, kind: 'bank_transfer' | 'credit_limit') =>
      em.create(Order, {
        id,
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: '00000000-0000-4000-8000-0000000000c1',
        status: 'processing',
        paymentStatus: kind === 'credit_limit' ? 'deferred' : 'awaiting_payment',
        deliveryAddress: {
          recipientName: 'Stub', street: 'ul. Odbioru 1', city: 'Warszawa',
          postalCode: '00-100', country: 'PL',
        },
        billingAddress: {
          recipientName: 'Stub', street: 'ul. Rozliczeń 2', city: 'Warszawa',
          postalCode: '00-101', country: 'PL',
        },
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
        paymentMethodId: kind === 'credit_limit' ? CREDIT_LIMIT_METHOD_ID : SEED_PAYMENT_METHOD_ID,
        paymentMethodSnapshot:
          kind === 'credit_limit'
            ? { code: 'credit_limit', name: 'CL', kind: 'credit_limit' }
            : { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
        subtotal: '100.00',
        taxTotal: '23.00',
        deliveryTotal: '0.00',
        total: '123.00',
        currency: 'PLN',
        placedAt: new Date(),
      });

    const orders = [
      order(PLAIN_ORDER_TO_CANCEL_ID, 'bank_transfer'),
      order(PLAIN_ORDER_TO_PAY_ID, 'bank_transfer'),
      order(CREDIT_ORDER_TO_CANCEL_ID, 'credit_limit'),
      order(CREDIT_ORDER_TO_PAY_ID, 'credit_limit'),
      order(CREDIT_ORDER_CONTROL_ID, 'credit_limit'),
    ];
    await em.persistAndFlush(orders);

    for (const orderId of [
      CREDIT_ORDER_TO_CANCEL_ID,
      CREDIT_ORDER_TO_PAY_ID,
      CREDIT_ORDER_CONTROL_ID,
    ]) {
      em.create(CreditLimitReservation, {
        creditLimitId: limit.id,
        orderId,
        reservingOrganizationId: TEST_ORGANIZATION_ID,
        amount: '123.00',
        currency: 'PLN',
        status: 'active',
      });
    }
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('cancels an ordinary order while `credit_limits` is off', async () => {
    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${PLAIN_ORDER_TO_CANCEL_ID}/status`,
        payload: { to: 'cancelled' },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  it('marks an ordinary order paid while `credit_limits` is off', async () => {
    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${PLAIN_ORDER_TO_PAY_ID}/payment-status`,
        payload: { to: 'paid' },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  it('still refuses to cancel an order that holds a reservation', async () => {
    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${CREDIT_ORDER_TO_CANCEL_ID}/status`,
        payload: { to: 'cancelled' },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    });
  });

  it('still refuses to mark an order that holds a reservation paid', async () => {
    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${CREDIT_ORDER_TO_PAY_ID}/payment-status`,
        payload: { to: 'paid' },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    });
  });

  it('releases the reservation on cancellation while `credit_limits` is on (the positive control)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${CREDIT_ORDER_CONTROL_ID}/status`,
      payload: { to: 'cancelled' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const em = h.em();
    em.clear();
    const reservation = await em.findOne(CreditLimitReservation, {
      orderId: CREDIT_ORDER_CONTROL_ID,
    });
    expect(reservation?.status).toBe('released');
    expect(reservation?.releasedReason).toBe('order_cancelled');
  });
});
