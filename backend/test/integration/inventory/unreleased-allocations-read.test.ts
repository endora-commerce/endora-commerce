import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InventoryStockReadPort } from '@endora-commerce/contracts';
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

/**
 * `InventoryStockReadPort.unreleasedAllocationsForOrderItems`
 * (`specs/142-order-transition-atomicity/`, D9).
 *
 * `orders`' repair command has to learn which cancelled orders still hold stock
 * before it proposes to release anything, and it may not read
 * `stock_allocations` itself. This is the owner answering.
 */

const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

describe('inventoryStockReadPort.unreleasedAllocationsForOrderItems (spec 142, D9)', () => {
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

  const port = (): InventoryStockReadPort =>
    h.container.resolve('inventoryStockReadPort') as InventoryStockReadPort;

  /** Places a one-line order, which is what allocates stock; answers its item ids. */
  async function placeOrder(quantity: number): Promise<string[]> {
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
    const orderId = (placed.json() as { data: { id: string } }).data.id;
    const items = (await h
      .em()
      .getConnection()
      .execute(`select "id" from "order_items" where "order_id" = ?`, [orderId])) as Array<{
      id: string;
    }>;
    return items.map((i) => i.id);
  }

  it('answers the held allocations of the order items it is asked about', async () => {
    const mine = await placeOrder(3);
    const held = await port().unreleasedAllocationsForOrderItems(mine);

    expect(held).toHaveLength(1);
    expect(held[0]).toEqual({
      orderItemId: mine[0],
      warehouseId: expect.any(String) as unknown as string,
      quantity: 3,
    });
  });

  it('leaves out the allocations of order items it was not asked about', async () => {
    const mine = await placeOrder(1);
    const foreign = await placeOrder(2);

    const held = await port().unreleasedAllocationsForOrderItems(mine);

    expect(held.map((a) => a.orderItemId)).toEqual(mine);
    expect(held.map((a) => a.orderItemId)).not.toContain(foreign[0]);
  });

  it('leaves out an allocation that has been released', async () => {
    const mine = await placeOrder(1);
    await h
      .em()
      .getConnection()
      .execute(`update "stock_allocations" set "released_at" = now() where "order_item_id" = ?`, [
        mine[0],
      ]);

    expect(await port().unreleasedAllocationsForOrderItems(mine)).toEqual([]);
  });

  it('answers the empty list for no order items and for unknown ones', async () => {
    expect(await port().unreleasedAllocationsForOrderItems([])).toEqual([]);
    expect(await port().unreleasedAllocationsForOrderItems([randomUUID()])).toEqual([]);
  });
});
