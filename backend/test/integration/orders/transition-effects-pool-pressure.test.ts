import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CreditLimit, PaymentMethod } from '../../helpers/package-entities.js';

/**
 * `specs/142-order-transition-atomicity/` — FR-002 under load.
 *
 * More cancellations at once than the database pool has connections. An
 * attempt at a follow-up used to hold one pooled connection — its claim
 * transaction — open while the release opened a second one, so as soon as
 * every connection was held by a claim, no release could get one: every
 * attempt waited for the pool's acquire timeout, nothing was released, the
 * response's own reads timed out too, and a **committed** cancellation was
 * answered 500. Measured before the repair, 40 at once on a pool of 10: 120 s,
 * 30 of 40 answered 500, 0 of 80 follow-ups completed.
 *
 * An attempt now claims its row with a committed lease and holds no connection
 * across the handler, so a request needs one connection at a time and the pool
 * merely queues.
 *
 * The handlers are slowed a little so the requests really overlap; without
 * that the event loop can serialise them by accident and the test would pass
 * on the defect.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

type Method = (...args: unknown[]) => Promise<unknown>;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('more concurrent cancellations than pooled connections (spec 142, FR-002)', () => {
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

  const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await h.em().getConnection().execute(sql, params)) as T[];

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

  const slowed = (registration: string, method: string): void => {
    const object = h.container.resolve(registration) as Record<string, Method>;
    const original = object[method]!.bind(object);
    (
      vi.spyOn(object as never, method as never) as unknown as {
        mockImplementation(fn: Method): unknown;
      }
    ).mockImplementation(async (...args) => {
      await sleep(50);
      return original(...args);
    });
  };

  it('answers every one of them 200 and releases everything, without waiting on the pool', async () => {
    const pool = (
      h.em().getConnection().getKnex() as unknown as { client: { pool: { max: number } } }
    ).client.pool;
    // Well above the pool, so the old shape — two connections per attempt —
    // cannot fit however the requests interleave.
    const concurrent = pool.max * 3;
    const orders: string[] = [];
    for (let i = 0; i < concurrent; i += 1) orders.push(await place());

    slowed('inventoryReservationApplyPort', 'releaseForOrderItems');
    slowed('creditLimitService', 'releaseByOrder');

    const started = Date.now();
    const answers = await Promise.all(
      orders.map((orderId) =>
        h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/orders/${orderId}/status`,
          payload: { to: 'cancelled' },
          ...ADMIN,
        }),
      ),
    );
    const elapsedMs = Date.now() - started;

    const inList = orders.map(() => '?').join(', ');
    const [state] = await rows<{
      cancelled: number;
      effects: number;
      completed: number;
      held: number;
      active: number;
    }>(
      `select
         (select count(*)::int from "orders" where "id" in (${inList}) and "status" = 'cancelled') as "cancelled",
         (select count(*)::int from "order_transition_effects" where "order_id" in (${inList})) as "effects",
         (select count(*)::int from "order_transition_effects"
           where "order_id" in (${inList}) and "completed_at" is not null) as "completed",
         (select count(*)::int from "stock_allocations" a
            join "order_items" oi on oi."id" = a."order_item_id"
           where oi."order_id" in (${inList}) and a."released_at" is null) as "held",
         (select count(*)::int from "credit_limit_reservations"
           where "order_id" in (${inList}) and "status" = 'active') as "active"`,
      [...orders, ...orders, ...orders, ...orders, ...orders],
    );

    expect({
      answered200: answers.filter((res) => res.statusCode === 200).length,
      ...state,
    }).toEqual({
      answered200: concurrent,
      cancelled: concurrent,
      effects: concurrent * 2,
      completed: concurrent * 2,
      held: 0,
      active: 0,
    });
    // The pool's acquire timeout is a minute; a run that waited on it even
    // once cannot finish inside this bound.
    expect(elapsedMs).toBeLessThan(45_000);
  }, 300_000);
});
