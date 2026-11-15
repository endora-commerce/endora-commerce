import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderPlacementPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { Cart, CartItem, Order, OrderItem, Product } from '../../helpers/package-entities.js';

/**
 * Issue #1308 — one-click buy adds its line and places its order in the channel language the
 * request's `Accept-Language` asks for, as `POST /cart/items` judges a line of the same request
 * (issue #1011). Before, neither `CartWritePort.addItems` nor `OrderPlacementPort.placeOrder`
 * carried the request's scope language, so the product was asked about at the channel's default
 * language whatever the buyer browsed in.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`, and not `de-DE`. The product is
 * switched off at (channel, `en-US`): available in Polish only. So a one-click buy of it is
 * placed with `pl-PL` and refused with `de-DE`, which the channel answers in its default.
 *
 * The placement half is held on its own, through the port, from a working basket written here:
 * the HTTP case cannot tell the scope language from the message language at placement, because
 * `pl-PL`'s message language (`pl`) happens to name the same channel language. The port case
 * asks in English messages and the Polish scope.
 */
describe('One-click buy in the request language (issue #1308)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const channelId = randomUUID();
  const channelCode = `oc1308-${run}`.toLowerCase();
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';
  let productId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  const placement = () =>
    (h.container.cradle as unknown as { orderPlacementPort: OrderPlacementPort }).orderPlacementPort;

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `One-click language ${run}` })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const product = await createMinimumProduct(h.em(), {
      sku: `OC1308-${run}`,
      nameEn: `One click ${run}`,
      namePl: `Jedno kliknięcie ${run}`,
      channelIds: [channelId],
    });
    productId = product.id;
    // No stock to reserve: availability in the language is the only thing judged.
    await h.em().nativeUpdate(Product, { id: productId }, { manageStock: false });
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );

    // One-click on for the run's channel only, through the operator's write path.
    await h.settings.adminService.setValueForSubset(ONE_CLICK_ENABLED, [channelCode], true, null, {
      actorAdminUserId: null,
    });
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);
    // The buyer's defaults — the seeded methods and addresses every one-click case uses.
    const preferences = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: CUSTOMER,
      payload: {
        scope: 'customer',
        scopeId: TEST_CUSTOMER_ID,
        defaultPaymentMethodId: SEED_PAYMENT_METHOD_ID,
        defaultDeliveryMethodId: SEED_DELIVERY_METHOD_ID,
        defaultBillingAddressId: SEED_ADDRESS_BILLING_ID,
        defaultShippingAddressId: SEED_ADDRESS_DELIVERY_ID,
      },
    });
    if (preferences.statusCode !== 200) throw new Error(`preferences: ${preferences.statusCode} ${preferences.body}`);
  }, 120_000);

  afterAll(async () => {
    if (h) {
      // The run's own rows only. The orders placed here stay — with their payments, as every
      // placement leaves them — until the next file's truncate of `orders`; so do the product and
      // the channel they reference, published nowhere and assigned to nobody once this runs.
      await sql(`delete from carts where sales_channel_id = ?`, [channelId]);
      if (productId) {
        await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
        await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
        await removeBasePriceSql(h.em(), productId);
      }
      await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /** The orders of the run's channel holding the product. */
  async function ordersOfProduct(): Promise<string[]> {
    const em = h.em().fork();
    const items = await em.find(OrderItem, { productId }, { filters: false });
    const orders = await em.find(
      Order,
      { id: { $in: items.map((item) => item.orderId) }, salesChannelId: channelId },
      { filters: false },
    );
    return orders.map((order) => order.id);
  }

  /** The buyer's working baskets on the run's channel — a refused placement leaves none. */
  async function workingBaskets(): Promise<number> {
    const rows = await sql<Array<{ n: string }>>(
      `select count(*)::text as n from carts where sales_channel_id = ? and customer_account_id = ? and status = 'working'`,
      [channelId, TEST_CUSTOMER_ID],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async function oneClick(acceptLanguage: string): Promise<{ status: number; body: string; orderId?: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      headers: { 'x-sales-channel': channelCode, 'accept-language': acceptLanguage },
      cookies: CUSTOMER,
      payload: { productId, quantity: 1 },
    });
    const orderId =
      res.statusCode === 201 ? (res.json() as { data: { order: { id: string } } }).data.order.id : undefined;
    return { status: res.statusCode, body: res.body, ...(orderId ? { orderId } : {}) };
  }

  it('places the order in a language the product is on: `pl-PL`', async () => {
    const res = await oneClick('pl-PL');
    expect(res.status, res.body).toBe(201);
    expect(await ordersOfProduct()).toContain(res.orderId);
    const items = await h.em().fork().find(OrderItem, { orderId: res.orderId! }, { filters: false });
    expect(items.map((item) => [item.productId, item.quantity])).toEqual([[productId, 1]]);
  });

  it('refuses it in a language the channel does not offer: `de-DE` is answered at `en-US`, where it is off', async () => {
    const before = await ordersOfProduct();
    const res = await oneClick('de-DE');
    expect(res.status, res.body).toBe(404);
    expect(await ordersOfProduct()).toEqual(before);
    expect(await workingBaskets()).toBe(0);
  });

  describe('OrderPlacementPort.placeOrder — the scope language, apart from the message language', () => {
    /** A working basket of the buyer's on the run's channel holding the product at its base price. */
    async function workingBasket(): Promise<string> {
      const em = h.em().fork();
      const cart = em.create(Cart, {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channelId,
        status: 'working',
      });
      await em.flush();
      em.create(CartItem, {
        cartId: cart.id,
        productId,
        quantity: 1,
        unitPrice: '10.0000',
        currency: 'PLN',
      });
      await em.flush();
      return cart.id;
    }

    function place(workingBasketId: string, languageTag?: string) {
      return placement().placeOrder(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          salesChannelId: channelId,
        },
        { language: 'en', workingBasketId, ...(languageTag !== undefined ? { languageTag } : {}) },
      );
    }

    it('places a basket judged in `languageTag` `pl-PL`, whatever the message language', async () => {
      const order = await place(await workingBasket(), 'pl-PL');
      expect(order.salesChannelId).toBe(channelId);
      expect(await ordersOfProduct()).toContain(order.id);
    });

    it('refuses it without `languageTag`: the message language `en` names the default, where it is off', async () => {
      const before = await ordersOfProduct();
      await expect(place(await workingBasket())).rejects.toMatchObject({ statusCode: 404 });
      expect(await ordersOfProduct()).toEqual(before);
      expect(await workingBaskets()).toBe(0);
    });

    it('refuses it with a `languageTag` the channel does not offer: `de-DE` resolves to the default', async () => {
      const before = await ordersOfProduct();
      await expect(place(await workingBasket(), 'de-DE')).rejects.toMatchObject({ statusCode: 404 });
      expect(await ordersOfProduct()).toEqual(before);
      expect(await workingBaskets()).toBe(0);
    });
  });
});
