import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { releaseOrderAllocations } from '../../../../packages/modules/orders/dist/backend/services/order-allocation-release.js';

/**
 * `specs/142-order-transition-atomicity/` — two stock releases of one order
 * that **overlap**.
 *
 * The follow-up queue keeps attempts apart with a lease, and a lease expires:
 * a release that is merely slow can still be running when a second attempt
 * claims the row. `inventory`'s release takes no row lock of its own, so
 * without anything else the second run reads the allocation as still held —
 * the first has not committed — and then decrements a counter the first has
 * already decremented. `releaseOrderAllocations` therefore locks the order row
 * for its own short transaction; the second run waits there, and by the time
 * it reads, the allocation is stamped released.
 *
 * The interleaving is forced rather than hoped for. The first run is held
 * between its reads and its flush; the second starts meanwhile and is held
 * between reading the allocations and reading the stock level, so that —
 * without the lock — it reads the allocation *before* the first commits and
 * the counter *after*. A second order keeps its stock throughout, so the
 * counter is above zero and a doubled decrement cannot hide behind the clamp.
 */

const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ReleasePort = Parameters<typeof releaseOrderAllocations>[1];

describe('overlapping stock releases of one order (spec 142)', () => {
  let h: BackendServerHandle;
  let emFactory: () => EntityManager;

  beforeAll(async () => {
    h = await setupBackendServer();
    emFactory = h.container.resolve('emFactory') as () => EntityManager;
    await h
      .em()
      .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
        SEED_PRODUCT_101_ID,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await h.em().getConnection().execute(sql, params)) as T[];

  const reserved = async (): Promise<number> =>
    (
      await rows<{ reserved: number }>(
        `select coalesce(sum("reserved"), 0)::int as "reserved"
           from "stock_levels" where "product_id" = ?`,
        [SEED_PRODUCT_101_ID],
      )
    )[0]!.reserved;

  async function place(quantity: number): Promise<string> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity },
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
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      ...BUYER,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  /**
   * `inventory`'s own release, with one pause inserted on the transaction's
   * `EntityManager`: before the flush (the first run) or before the stock-level
   * read that follows the allocation read (the second).
   */
  function pausing(at: 'before-flush' | 'before-level-read', ms: number): ReleasePort {
    const real = h.container.resolve('inventoryReservationApplyPort') as ReleasePort;
    return {
      ...real,
      releaseForOrderItems: async (em, input) => {
        const tx = em as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        const method = at === 'before-flush' ? 'flush' : 'findOne';
        const original = tx[method]!.bind(em);
        let paused = false;
        tx[method] = async (...args: unknown[]) => {
          if (!paused) {
            paused = true;
            await sleep(ms);
          }
          return original(...args);
        };
        return real.releaseForOrderItems.call(real, em, input);
      },
    } as ReleasePort;
  }

  it('releases once: the second run waits for the first and then finds nothing to release', async () => {
    await place(2); // a live order that keeps its stock
    const orderId = await place(3);
    const before = await reserved();
    expect(before).toBeGreaterThanOrEqual(5);

    const first = releaseOrderAllocations(emFactory, pausing('before-flush', 400), orderId);
    await sleep(100);
    const second = releaseOrderAllocations(emFactory, pausing('before-level-read', 700), orderId);

    const results = await Promise.all([first, second]);

    // Three units given back, once — not six.
    expect(await reserved()).toBe(before - 3);
    expect(results).toEqual([{ released: 1 }, { released: 0 }]);
  });
});
