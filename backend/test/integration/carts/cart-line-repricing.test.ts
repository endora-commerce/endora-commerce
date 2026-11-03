import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';

import { CartItem } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { TEST_CUSTOMER_EMPTY_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  createTieredProduct,
  createUnpricedProduct,
  TIER_UNIT_PRICE,
  TIER_VOLUME_PRICE,
} from '../../helpers/tiered-product-fixture.js';
import { emptyCustomerBasket } from '../../helpers/customer-basket.js';

/**
 * A cart line is ordered at its stored unit price, so that price is the price
 * for the line's **current** quantity: re-resolved when a merge or a quantity
 * change moves the quantity across a quantity-tier bracket, held at an agreed
 * price only at the agreed quantity, and never invented for a product nobody
 * priced.
 */
describe('cart line repricing', () => {
  let h: BackendServerHandle;
  let productId: string;
  /** The basket a request naming no channel uses — the system default's. */
  let customer: { customerAccountId: string; organizationId: string; salesChannelId: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    productId = await createTieredProduct(h, `cart-${Date.now()}`);
    customer = {
      customerAccountId: TEST_CUSTOMER_EMPTY_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(h.em()),
    };
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function storedLine(itemId: string): Promise<{ quantity: number; unitPrice: string }> {
    const em = h.em();
    em.clear();
    const row = await em.findOneOrFail(CartItem, { id: itemId });
    return { quantity: row.quantity, unitPrice: Number(row.unitPrice).toFixed(2) };
  }

  async function add(anon: string, quantity: number, product = productId) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: product, quantity },
      cookies: { b2b_cart_anon: anon },
    });
  }

  it('a quantity change out of the volume bracket stores the price for the new quantity', async () => {
    const anon = `anon-reprice-down-${randomUUID()}`;
    const added = await add(anon, 100);
    expect(added.statusCode).toBe(200);
    const itemId = (added.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;
    expect(await storedLine(itemId)).toEqual({ quantity: 100, unitPrice: TIER_VOLUME_PRICE });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 1 },
      cookies: { b2b_cart_anon: anon },
    });
    expect(patched.statusCode).toBe(200);
    expect(await storedLine(itemId)).toEqual({ quantity: 1, unitPrice: TIER_UNIT_PRICE });
  });

  it('adding the same product again stores the price for the merged quantity', async () => {
    const anon = `anon-reprice-merge-${randomUUID()}`;
    const first = await add(anon, 1);
    const itemId = (first.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;
    expect(await storedLine(itemId)).toEqual({ quantity: 1, unitPrice: TIER_UNIT_PRICE });

    const second = await add(anon, 99);
    expect(second.statusCode).toBe(200);
    expect(await storedLine(itemId)).toEqual({ quantity: 100, unitPrice: TIER_VOLUME_PRICE });
  });

  it('an agreed price holds at the agreed quantity only, and returns with it', async () => {
    const seeded = await cartWritePortOf(h).replaceItemsForCustomer(
      customer,
      [{ productId, quantity: 10, unitPrice: '5.00', currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    const itemId = seeded.items[0]!.id;
    const cartService = h.cartService()!;

    await cartService.updateItem({ customer }, itemId, 11);
    expect(await storedLine(itemId)).toEqual({ quantity: 11, unitPrice: TIER_UNIT_PRICE });

    await cartService.updateItem({ customer }, itemId, 10);
    expect(await storedLine(itemId)).toEqual({ quantity: 10, unitPrice: '5.00' });

    await emptyCustomerBasket(h, customer);
  });

  it('a seed without an agreement — a reorder — stores the current price, not the copied one', async () => {
    const seeded = await cartWritePortOf(h).replaceItemsForCustomer(customer, [
      { productId, quantity: 10, unitPrice: '5.00', currency: 'PLN' },
    ]);
    expect(await storedLine(seeded.items[0]!.id)).toEqual({ quantity: 10, unitPrice: TIER_UNIT_PRICE });

    await emptyCustomerBasket(h, customer);
  });

  it('refuses a product no price list and no price of its own applies to', async () => {
    const unpriced = await createUnpricedProduct(h, `cart-${Date.now()}`);
    const res = await add(`anon-unpriced-${randomUUID()}`, 1, unpriced);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CART_PRODUCT_UNPRICED,
    );
  });
});
