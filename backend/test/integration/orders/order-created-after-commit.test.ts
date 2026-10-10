import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

/**
 * `order.created.v1` announces an order that exists (issue #171).
 *
 * The storefront checkout route calls `OrderService.placeOrder` outside any
 * Command Bus event scope, so the bus runs subscribers the moment the event is
 * emitted. Emitted from inside the placing transaction, that was before the
 * commit: a subscriber on a connection of its own could not read the order,
 * and a placement that failed after the emit had already been announced — to
 * the webhook bridge among others, which enqueues a delivery to an external
 * system that has no way to learn the order was rolled back.
 *
 * Both tests go through `POST /api/v1/orders` and the composed event bus, and
 * observe the composed webhook bridge through the queue it enqueues on.
 */
describe('orders — order.created.v1 is announced after the placement commits', () => {
  let h: BackendServerHandle;
  let enqueue: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);

    // A platform-wide subscription, so the bridge has somebody to enqueue for.
    const hook = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks',
      cookies: ADMIN,
      payload: {
        name: 'issue 171',
        url: 'https://receiver.example.com/issue-171',
        eventTypes: ['order.created.v1'],
      },
    });
    expect(hook.statusCode, hook.body).toBe(201);

    const queue = (h.container.cradle as unknown as { webhookQueue: { add: (...args: unknown[]) => Promise<unknown> } })
      .webhookQueue;
    enqueue = vi.spyOn(queue, 'add').mockResolvedValue(undefined);
  });

  afterEach(() => {
    enqueue.mockClear();
  });

  afterAll(async () => {
    enqueue.mockRestore();
    await teardownBackendServer(h);
  });

  const placeFromStorefront = async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(added.statusCode, added.body).toBe(200);
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
  };

  const orderCount = async (): Promise<number> => {
    const rows = await h.em().execute<Array<{ id: string }>>(`select "id" from "orders"`);
    return rows.length;
  };

  /**
   * Record, for every `eventName` event delivered while `act` runs, whether
   * the order was readable on a connection of the subscriber's own at the
   * moment of delivery. Subscribed last, so by the time it runs the bridge
   * registered at composition has already handled the same event.
   */
  const deliveries = async <T>(
    act: () => Promise<T>,
    settleMs: number,
    eventName: 'order.created.v1' | 'promotion.used.v1' = 'order.created.v1',
  ) => {
    const seen: Array<{ orderId: string; readable: boolean }> = [];
    const off = h.eventBus.on(eventName as never, async (payload: unknown) => {
      const orderId = (payload as { orderId: string }).orderId;
      const rows = await h.em().execute<unknown[]>(`select 1 from "orders" where "id" = ?`, [orderId]);
      seen.push({ orderId, readable: rows.length === 1 });
    });
    try {
      const result = await act();
      // Outside a scope the bus dispatches without being awaited by the
      // emitter: give the chain time to reach this subscriber, or to show
      // that nothing was dispatched at all.
      const deadline = Date.now() + settleMs;
      while (Date.now() < deadline && seen.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { result, seen };
    } finally {
      off();
    }
  };

  /**
   * Install a deferred constraint trigger on `orders` for the length of `act`.
   * A deferred constraint is checked by COMMIT, after every statement of the
   * transaction has succeeded, so its body runs at the latest point a
   * placement can still be slowed down or refused.
   */
  const atCommit = async <T>(body: string, act: () => Promise<T>): Promise<T> => {
    await h.em().execute(`
      create function issue_171_at_commit() returns trigger language plpgsql as $$
      begin
        ${body}
      end $$;
      create constraint trigger issue_171_at_commit
        after insert on "orders"
        deferrable initially deferred
        for each row execute function issue_171_at_commit();
    `);
    try {
      return await act();
    } finally {
      await h.em().execute(`
        drop trigger issue_171_at_commit on "orders";
        drop function issue_171_at_commit();
      `);
    }
  };

  it('a subscriber with an EntityManager of its own can read the order when the event is delivered', async () => {
    // A commit that takes a second: the window between the last statement of
    // the placement and its commit is otherwise a few milliseconds wide, and a
    // subscriber that lost the race only sometimes would make this a test of
    // the machine's load.
    const { result, seen } = await atCommit(`perform pg_sleep(1); return null;`, () =>
      deliveries(placeFromStorefront, 10_000),
    );
    expect(result.statusCode, result.body).toBe(201);
    const order = (result.json() as { data: { id: string } }).data;

    expect(seen).toEqual([{ orderId: order.id, readable: true }]);
    // The control for the next test: a placement that commits does enqueue.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({
      eventType: 'order.created.v1',
      payload: { orderId: order.id },
    });
  });

  it('a placement that fails at commit announces nothing and enqueues no webhook delivery', async () => {
    const before = await orderCount();
    const { result, seen } = await atCommit(`raise exception 'issue 171: forced failure at commit';`, () =>
      deliveries(placeFromStorefront, 1_500),
    );
    expect(result.statusCode, result.body).toBe(500);
    expect(await orderCount()).toBe(before);

    expect(seen).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  /**
   * `promotion.used.v1` leaves the same placement by the same road, and it has
   * no subscriber in the tree to notice if it stopped doing so.
   */
  describe('promotion.used.v1, for an order a promotion was applied to', () => {
    let promotionId: string;

    beforeAll(async () => {
      const promotion = await promotionServiceFor(h).upsert({
        name: 'issue 171 — automatic 10% off',
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'all' },
      });
      promotionId = promotion.id;
    });

    it('is delivered once the order it names can be read', async () => {
      const { result, seen } = await atCommit(`perform pg_sleep(1); return null;`, () =>
        deliveries(placeFromStorefront, 10_000, 'promotion.used.v1'),
      );
      expect(result.statusCode, result.body).toBe(201);
      const order = (result.json() as { data: { id: string } }).data;
      const applied = await h
        .em()
        .execute<Array<{ promotion_id: string }>>(
          `select "promotion_id" from "order_applied_promotions" where "order_id" = ?`,
          [order.id],
        );
      expect(applied.map((row) => row.promotion_id)).toEqual([promotionId]);

      expect(seen).toEqual([{ orderId: order.id, readable: true }]);
    });

    it('is not delivered for a placement that fails at commit', async () => {
      const before = await orderCount();
      const { result, seen } = await atCommit(`raise exception 'issue 171: forced failure at commit';`, () =>
        deliveries(placeFromStorefront, 1_500, 'promotion.used.v1'),
      );
      expect(result.statusCode, result.body).toBe(500);
      expect(await orderCount()).toBe(before);

      expect(seen).toEqual([]);
    });
  });
});
