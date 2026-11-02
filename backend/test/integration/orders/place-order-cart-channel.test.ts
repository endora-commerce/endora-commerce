import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, unitPriceHalfUp } from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { Cart, CartItem, Order, OrderItem } from '../../helpers/package-entities.js';
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
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  seedTwoChannelBasket,
  type TwoChannelBasket,
} from '../../helpers/two-channel-basket-fixture.js';
import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';
import {
  OrderService,
  type OrderEventBus,
} from '../../../../packages/modules/orders/dist/backend/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../../packages/modules/payments/src/backend/adapters/built-in-adapters.js';

/**
 * `specs/154-sales-channel-access/` User Story 6, acceptance 5 and 6 — an order
 * is placed from the basket of the channel it is placed on, at that channel's
 * prices (contracts/basket-attribution.md §4).
 *
 * The product is priced on A and on B and nowhere else, so the figures say
 * which channel answered: a placement that read the wrong basket carries A's
 * price, and a price check (#345) that fell back to the system default finds no
 * price at all and refuses a line that is current on B.
 */

const BUYER = { b2b_session: 'stub-customer-session' };

describe('order placement — the basket of the order’s channel', () => {
  let h: BackendServerHandle;
  let fx: TwoChannelBasket;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await seedTwoChannelBasket(h, 'placement');
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    const carts = await em.find(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    if (carts.length > 0) {
      await em.nativeDelete(CartItem, { cartId: { $in: carts.map((c) => c.id) } });
      await em.nativeDelete(Cart, { id: { $in: carts.map((c) => c.id) } });
    }
  });

  async function add(channelCode: string, quantity: number): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
      cookies: BUYER,
      payload: { productId: fx.productId, quantity },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { id: string } }).data.id;
  }

  function place(channelCode: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
      cookies: BUYER,
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
  }

  async function basket(cartId: string): Promise<{ status: string; quantities: number[] }> {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { id: cartId });
    const items = await em.find(CartItem, { cartId });
    return { status: cart.status, quantities: items.map((i) => i.quantity) };
  }

  it('places on B from B’s basket, at B’s price, and leaves A’s basket alone', async () => {
    const basketA = await add(fx.a.code, 1);
    const basketB = await add(fx.b.code, 2);

    const res = await place(fx.b.code);
    expect(res.statusCode, res.body).toBe(201);
    const orderId = (res.json() as { data: { id: string } }).data.id;

    const em = h.em();
    em.clear();
    const order = await em.findOneOrFail(Order, { id: orderId });
    expect(order.salesChannelId).toBe(fx.b.id);
    const lines = await em.find(OrderItem, { orderId });
    expect(lines.map((l) => [l.quantity, Number(l.unitPrice).toFixed(2)])).toEqual([
      [2, fx.priceOnB],
    ]);

    expect(await basket(basketB)).toEqual({ status: 'completed', quantities: [] });
    expect(await basket(basketA)).toEqual({ status: 'active', quantities: [1] });
  });

  it('checks a stored price against B’s price, not the system default’s', async () => {
    const basketB = await add(fx.b.code, 1);
    // A line holding A's price on B's basket — stale for B.
    await h.em().nativeUpdate(CartItem, { cartId: basketB }, { unitPrice: fx.priceOnA });

    const refused = await place(fx.b.code);
    expect(refused.statusCode).toBe(409);
    const error = (refused.json() as {
      error: { code: string; details: { lines: Array<Record<string, unknown>> } };
    }).error;
    expect(error.code).toBe(ERROR_CODES.CART_PRICE_CHANGED);
    expect(error.details.lines).toEqual([
      expect.objectContaining({
        // Unit prices at four places (owner ruling of 2026-10-25).
        previousUnitPrice: unitPriceHalfUp(fx.priceOnA),
        // Priced on the system default this would be `null`: nothing prices the
        // product there.
        currentUnitPrice: unitPriceHalfUp(fx.priceOnB),
      }),
    ]);

    const placed = await place(fx.b.code);
    expect(placed.statusCode, placed.body).toBe(201);
  });

  it('refuses a basket of another channel with 422 ORDER_SALES_CHANNEL_MISMATCH, writing nothing', async () => {
    const basketA = await add(fx.a.code, 3);
    const ordersBefore = await h.em().count(Order, { organizationId: TEST_ORGANIZATION_ID });

    // The lookup returns the right basket by construction, so the refusal is
    // defence in depth: a placement port handing over A's basket for an order
    // on B is the case it exists for.
    const neighbours = orderServiceNeighbours(h.em);
    const realPlacement = neighbours.cartPlacementApply;
    const forced: typeof realPlacement = {
      readActiveForPlacement: (em, ctx) =>
        realPlacement.readActiveForPlacement(em, { ...ctx, salesChannelId: fx.a.id }),
      completeForOrder: (em, input) => realPlacement.completeForOrder(em, input),
      findPriceDrift: (em, input) => realPlacement.findPriceDrift(em, input),
      refreshLinePrices: (input) => realPlacement.refreshLinePrices(input),
      readWorkingForPlacement: (em, ctx) => realPlacement.readWorkingForPlacement(em, ctx),
      discardWorkingBasket: (input) => realPlacement.discardWorkingBasket(input),
    };
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    const service = new OrderService(
      h.em,
      new EventBus() as OrderEventBus,
      undefined,
      undefined,
      undefined,
      {
        neighbours: { ...neighbours, cartPlacementApply: forced },
        paymentAdapters: () => registry,
        orderStatusRegistry: () => new EnumOrderStatusRegistry(),
      },
    );

    await expect(
      service.placeOrder(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          salesChannelId: fx.b.id,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ORDER_SALES_CHANNEL_MISMATCH,
      details: { cartSalesChannelId: fx.a.id, requestSalesChannelId: fx.b.id },
    });

    expect(await h.em().count(Order, { organizationId: TEST_ORGANIZATION_ID })).toBe(ordersBefore);
    expect(await basket(basketA)).toEqual({ status: 'active', quantities: [3] });
  });
});
