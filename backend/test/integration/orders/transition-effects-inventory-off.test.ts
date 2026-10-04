import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * `specs/142-order-transition-atomicity/` — User Story 2, FR-008: a
 * switched-off `inventory` **delays** a cancellation's stock release; it does
 * not lose it.
 *
 * Before this feature the release was skipped in silence while the module was
 * off, and — because repeating a cancellation is a no-op once the order is
 * cancelled — nothing ever ran it afterwards: reserved stock no order would
 * ship, until somebody edited the rows by hand. `orders`' manifest promised
 * the opposite ("releases none until the module is switched back on").
 *
 * What is asserted is `inventory`'s own tables, byte for byte, across the
 * whole off window: switching a module off is non-destructive (Principle
 * XVII), so nothing of its may be written while it is off — not by the
 * cancellation, not by a sweep pass.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

describe('cancelling while `inventory` is off (spec 142, US2, FR-008)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
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

  /** Every row of the two tables a release writes, as the database holds them. */
  const inventoryTables = async (): Promise<string> =>
    JSON.stringify({
      allocations: await rows(
        `select "id", "order_item_id", "warehouse_id", "quantity", "released_at"
           from "stock_allocations" order by "id"`,
      ),
      levels: await rows(
        `select "id", "on_hand", "reserved", "updated_at" from "stock_levels" order by "id"`,
      ),
    });

  const reservedForProduct = async (): Promise<number> =>
    (
      await rows<{ reserved: number }>(
        `select coalesce(sum("reserved"), 0)::int as "reserved"
           from "stock_levels" where "product_id" = ?`,
        [SEED_PRODUCT_101_ID],
      )
    )[0]!.reserved;

  const stockEffect = async (orderId: string) =>
    (
      await rows<{ blocked_on: string | null; attempts: number; completed: boolean; result: unknown }>(
        `select "blocked_on", "attempts", ("completed_at" is not null) as "completed", "result"
           from "order_transition_effects" where "order_id" = ? and "effect" = 'stock.release'`,
        [orderId],
      )
    )[0];

  const sweep = (): Promise<unknown> =>
    withSystemScope('spec 142 test — one sweep pass', () =>
      (
        h.container.resolve('orderTransitionEffectService') as {
          sweep(now: Date): Promise<unknown>;
        }
      ).sweep(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    );

  it('writes no `inventory` row while off, leaves the release waiting, and releases within one sweep of the module returning', async () => {
    const orderId = await place(3);
    const reservedWhileHeld = await reservedForProduct();

    await withModuleOff('inventory', 'deactivated', async () => {
      const before = await inventoryTables();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/status`,
        payload: { to: 'cancelled' },
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { status: string } }).data.status).toBe('cancelled');

      // The release is recorded as waiting on the module — not attempted, so
      // not a failed attempt either.
      expect(await stockEffect(orderId)).toEqual({
        blocked_on: 'inventory', attempts: 0, completed: false, result: null,
      });
      // ...and a sweep pass while the module is still off does nothing to it.
      await sweep();
      expect(await stockEffect(orderId)).toMatchObject({ attempts: 0, completed: false });

      expect(await inventoryTables()).toBe(before);
    });

    // Switched back on: one sweep pass releases what the order held.
    await sweep();

    expect(await stockEffect(orderId)).toEqual({
      blocked_on: null, attempts: 0, completed: true, result: { released: 1 },
    });
    expect(await reservedForProduct()).toBe(reservedWhileHeld - 3);
    const [allocation] = await rows<{ released_at: Date | null }>(
      `select a."released_at" from "stock_allocations" a
         join "order_items" oi on oi."id" = a."order_item_id" where oi."order_id" = ?`,
      [orderId],
    );
    expect(allocation!.released_at).not.toBeNull();
  });

  it('an order that holds nothing completes its release as a no-op', async () => {
    // Placed while `inventory` is off, so nothing was ever reserved for it.
    const orderId = await withModuleOff('inventory', 'deactivated', () => place(1));

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      ...ADMIN,
    });

    expect(res.statusCode).toBe(200);
    expect(await stockEffect(orderId)).toEqual({
      blocked_on: null, attempts: 0, completed: true, result: { released: 0 },
    });
  });
});
