import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CreditLimit, PaymentMethod } from '../../helpers/package-entities.js';

/**
 * `specs/142-order-transition-atomicity/` — SC-002: with a failure injected at
 * every point between the commit and the last release, no cancelled order holds
 * stock or credit once the cause is removed and two sweep intervals have passed.
 *
 * Each case cancels a real order placed on credit — so it holds one stock
 * allocation and one active reservation — with one fault armed, then removes
 * the fault and runs two sweep passes with **no further request**. The
 * assertion is the same for all of them and is about the two owners' own rows:
 * nothing held.
 *
 * The points, in the order the code reaches them after the commit:
 *
 *  1. the immediate attempt cannot start at all (the claim fails);
 *  2. the stock release throws;
 *  3. the stock release happens, and the attempt dies before recording it;
 *  4. the credit release throws;
 *  5. the credit release happens, and the attempt dies before recording it;
 *  6. both releases throw;
 *  7. a release keeps failing across the first sweep as well;
 *  8. the owner is switched off under a handler that had found it present.
 *
 * Points 3 and 5 are the "ran, but nobody wrote that down" case: the release is
 * run a second time by the sweep, which is safe only because both owners'
 * releases are idempotent — and that is asserted here, on the stock counter and
 * on the available credit, rather than assumed.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

type Method = (...args: unknown[]) => Promise<unknown>;

describe('faults between the commit and the last release strand nothing (spec 142, SC-002)', () => {
  let h: BackendServerHandle;
  let creditMethodId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em.execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
      SEED_PRODUCT_101_ID,
    ]);
    const credit = em.create(PaymentMethod, {
      code: `cl_${randomUUID().slice(0, 8)}`,
      name: { default: 'Credit limit' },
      kind: 'credit_limit',
      adapter: 'credit_limit',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    em.create(CreditLimit, {
      organizationId: TEST_ORGANIZATION_ID,
      grantedAmount: '1000000.00',
      currency: 'PLN',
    });
    await em.flush();
    creditMethodId = credit.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // --- observation ------------------------------------------------------------

  const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await h.em().getConnection().execute(sql, params)) as T[];

  const heldAllocations = async (orderId: string): Promise<number> =>
    (
      await rows<{ count: number }>(
        `select count(*)::int as "count" from "stock_allocations" a
           join "order_items" oi on oi."id" = a."order_item_id"
          where oi."order_id" = ? and a."released_at" is null`,
        [orderId],
      )
    )[0]!.count;

  const reservation = async (orderId: string): Promise<string | null> =>
    (
      await rows<{ status: string }>(
        `select "status" from "credit_limit_reservations" where "order_id" = ?`,
        [orderId],
      )
    )[0]?.status ?? null;

  const reservedStock = async (): Promise<number> =>
    (
      await rows<{ reserved: number }>(
        `select coalesce(sum("reserved"), 0)::int as "reserved"
           from "stock_levels" where "product_id" = ?`,
        [SEED_PRODUCT_101_ID],
      )
    )[0]!.reserved;

  const activeCredit = async (): Promise<string> =>
    (
      await rows<{ total: string }>(
        `select coalesce(sum("amount"), 0)::text as "total"
           from "credit_limit_reservations" where "status" = 'active'`,
      )
    )[0]!.total;

  const outstanding = async (orderId: string): Promise<number> =>
    (
      await rows<{ count: number }>(
        `select count(*)::int as "count" from "order_transition_effects"
          where "order_id" = ? and "completed_at" is null`,
        [orderId],
      )
    )[0]!.count;

  // --- driving ----------------------------------------------------------------

  async function place(): Promise<string> {
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
        paymentMethodId: creditMethodId,
      },
      ...BUYER,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  const cancel = (orderId: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      ...ADMIN,
    });

  /** One pass of the background consumer, far enough ahead that every back-off has elapsed. */
  const sweep = (hoursAhead: number): Promise<unknown> =>
    withSystemScope('spec 142 test — one sweep pass', () =>
      (
        h.container.resolve('orderTransitionEffectService') as {
          sweep(now: Date): Promise<unknown>;
        }
      ).sweep(new Date(Date.now() + hoursAhead * 60 * 60 * 1000)),
    );

  const target = (registration: string): Record<string, Method> =>
    h.container.resolve(registration) as Record<string, Method>;

  /** The method throws `times` times before doing anything, then works. */
  const throwing = (registration: string, method: string, times: number, error?: Error): void => {
    const spy = vi.spyOn(target(registration) as never, method as never) as unknown as {
      mockRejectedValueOnce(e: Error): unknown;
    };
    for (let i = 0; i < times; i += 1) {
      spy.mockRejectedValueOnce(error ?? new Error(`injected: ${registration}.${method} failed`));
    }
  };

  /** The method does its work once and *then* throws — the outcome is never recorded. */
  const succeedingThenDying = (registration: string, method: string): void => {
    const object = target(registration);
    const original = object[method]!.bind(object);
    (
      vi.spyOn(object as never, method as never) as unknown as {
        mockImplementationOnce(fn: Method): unknown;
      }
    ).mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error(`injected: died after ${registration}.${method} succeeded`);
    });
  };

  const FAULTS: Array<{ point: string; arm: () => void; expectedStatus?: number }> = [
    {
      point: '1 — the immediate attempt cannot start',
      arm: () => throwing('orderTransitionEffectService', 'drainForOrder', 1),
    },
    {
      point: '2 — the stock release throws',
      arm: () => throwing('inventoryReservationApplyPort', 'releaseForOrderItems', 1),
    },
    {
      point: '3 — the stock release happens and the attempt dies before recording it',
      arm: () => succeedingThenDying('inventoryReservationApplyPort', 'releaseForOrderItems'),
    },
    {
      point: '4 — the credit release throws',
      arm: () => throwing('creditLimitService', 'releaseByOrder', 1),
    },
    {
      point: '5 — the credit release happens and the attempt dies before recording it',
      arm: () => succeedingThenDying('creditLimitService', 'releaseByOrder'),
    },
    {
      point: '6 — both releases throw',
      arm: () => {
        throwing('inventoryReservationApplyPort', 'releaseForOrderItems', 1);
        throwing('creditLimitService', 'releaseByOrder', 1);
      },
    },
    {
      point: '7 — a release keeps failing across the first sweep too',
      arm: () => throwing('creditLimitService', 'releaseByOrder', 2),
    },
    {
      point: '8 — the owner is switched off under a handler that had found it present',
      arm: () =>
        throwing('creditLimitService', 'releaseByOrder', 1, new ModuleDisabledError('credit_limits')),
      // The one remaining way to see this answer after a committed status
      // (plan D3, accepted residue). Nothing is stranded by it.
      expectedStatus: 503,
    },
  ];

  it.each(FAULTS)('fault $point', async ({ arm, expectedStatus }) => {
    const reservedBefore = await reservedStock();
    const creditBefore = await activeCredit();
    const orderId = await place();
    expect(await heldAllocations(orderId)).toBe(1);
    expect(await reservation(orderId)).toBe('active');
    arm();

    const res = await cancel(orderId);

    // The transition is committed whatever the fault did, and — except for the
    // one accepted residue — the caller is told so.
    expect(res.statusCode).toBe(expectedStatus ?? 200);
    const [order] = await rows<{ status: string }>(`select "status" from "orders" where "id" = ?`, [
      orderId,
    ]);
    expect(order!.status).toBe('cancelled');

    // The cause is gone (every injected fault was armed a fixed number of
    // times). Two sweep intervals, no further request.
    await sweep(2);
    await sweep(4);

    expect({
      heldAllocations: await heldAllocations(orderId),
      reservation: await reservation(orderId),
      outstanding: await outstanding(orderId),
    }).toEqual({ heldAllocations: 0, reservation: 'released', outstanding: 0 });
    // Released exactly once: the counter and the active credit are back where
    // they were before this order existed, also when a release ran twice.
    expect(await reservedStock()).toBe(reservedBefore);
    expect(await activeCredit()).toBe(creditBefore);
  });
});
