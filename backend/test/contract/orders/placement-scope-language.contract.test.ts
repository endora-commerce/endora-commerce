import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { Cart, Order, OrderItem, Product } from '../../helpers/package-entities.js';

/**
 * Issue #1320 — order placement judges the basket's availability in the same language the
 * basket's add judged it in, at checkout and at admin create.
 *
 * Since issue #1308 `OrderService.placeOrder` takes the request's scope language
 * (`languageTag`) and falls back to the message language. Two callers still handed it the
 * message language alone:
 *
 * 1. **Checkout** (`POST /api/v1/orders`). A channel language that is not a platform interface
 *    language — `de-DE` here, where messages are worded in English — was judged at placement in
 *    the channel language `en` names, the default, although `POST /cart/items` of the same
 *    request judged the line in `de-DE`. The checkout channel offers `en-US` (default) and
 *    `de-DE`, and the product is off at (channel, `en-US`): the add admitted it, the placement
 *    refused it with 404.
 * 2. **Admin create** (`POST /api/v1/admin/orders`). Its basket add names the channel and is
 *    answered in the channel's default language (N2, feature 163), but its placement judged the
 *    channel language the operator's message language names. The admin channel offers `en-US`
 *    (default) and `pl-PL`, and the product is off at (channel, `pl-PL`) only: a Polish-speaking
 *    operator's add admitted it and the placement refused it. Both steps now follow N2.
 */
describe('Order placement judges availability in the basket\'s language (issue #1320)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ADMIN = { b2b_session: 'stub-admin-session' };
  const checkoutChannelId = randomUUID();
  const checkoutChannelCode = `pl1320c-${run}`.toLowerCase();
  const adminChannelId = randomUUID();
  const adminChannelCode = `pl1320a-${run}`.toLowerCase();
  const productIds: string[] = [];
  let checkoutProductId = '';
  let adminProductId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  async function channel(id: string, code: string, languages: string[]): Promise<void> {
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', ?::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `Placement language ${code}` }), JSON.stringify(languages)],
    );
    // Feature 154 — the buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      id,
      TEST_ORGANIZATION_ID,
    ]);
  }

  /** A product on `channelId`, with no stock to reserve, switched off at (`channelId`, `offAt`). */
  async function productOffAt(channelId: string, offAt: string, sku: string): Promise<string> {
    const product = await createMinimumProduct(h.em(), {
      sku,
      nameEn: `Placement language ${sku}`,
      namePl: `Język składania ${sku}`,
      channelIds: [channelId],
    });
    productIds.push(product.id);
    await h.em().nativeUpdate(Product, { id: product.id }, { manageStock: false });
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, ?, 'inactive', now(), now())`,
      [product.id, channelId, offAt],
    );
    return product.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await channel(checkoutChannelId, checkoutChannelCode, ['en-US', 'de-DE']);
    await channel(adminChannelId, adminChannelCode, ['en-US', 'pl-PL']);
    checkoutProductId = await productOffAt(checkoutChannelId, 'en-US', `PL1320C-${run}`);
    adminProductId = await productOffAt(adminChannelId, 'pl-PL', `PL1320A-${run}`);
  }, 120_000);

  afterAll(async () => {
    if (h) {
      // The run's own rows only; the orders placed here stay until the next file's truncate.
      await sql(`delete from carts where sales_channel_id in (?, ?)`, [checkoutChannelId, adminChannelId]);
      for (const productId of productIds) {
        await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
        await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
        await removeBasePriceSql(h.em(), productId);
      }
      await sql(`delete from sales_channel_organizations where sales_channel_id in (?, ?)`, [
        checkoutChannelId,
        adminChannelId,
      ]);
      await teardownBackendServer(h);
    }
  });

  async function ordersOf(productId: string, channelId: string): Promise<string[]> {
    const em = h.em().fork();
    const items = await em.find(OrderItem, { productId }, { filters: false });
    const orders = await em.find(
      Order,
      { id: { $in: items.map((item) => item.orderId) }, salesChannelId: channelId },
      { filters: false },
    );
    return orders.map((order) => order.id);
  }

  const methodsAndAddresses = {
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
  };

  describe('checkout — POST /api/v1/orders in the request\'s scope language', () => {
    const headers = (acceptLanguage: string) => ({
      'x-sales-channel': checkoutChannelCode,
      'accept-language': acceptLanguage,
    });

    async function addToBasket(acceptLanguage: string): Promise<{ status: number; body: string }> {
      await h.em().nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, salesChannelId: checkoutChannelId });
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        headers: headers(acceptLanguage),
        cookies: CUSTOMER,
        payload: { productId: checkoutProductId, quantity: 1 },
      });
      return { status: res.statusCode, body: res.body };
    }

    it('places a basket the same request\'s add admitted in `de-DE`, a channel language messages are not worded in', async () => {
      const added = await addToBasket('de-DE');
      expect(added.status, added.body).toBe(200);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: headers('de-DE'),
        cookies: CUSTOMER,
        payload: methodsAndAddresses,
      });
      expect(res.statusCode, res.body).toBe(201);
      const orderId = (res.json() as { data: { id: string } }).data.id;
      expect(await ordersOf(checkoutProductId, checkoutChannelId)).toContain(orderId);
    });

    it('still refuses the line when the placement asks in a language where it is off', async () => {
      const added = await addToBasket('de-DE');
      expect(added.status, added.body).toBe(200);
      const before = await ordersOf(checkoutProductId, checkoutChannelId);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: headers('en-US'),
        cookies: CUSTOMER,
        payload: methodsAndAddresses,
      });
      expect(res.statusCode, res.body).toBe(404);
      expect(await ordersOf(checkoutProductId, checkoutChannelId)).toEqual(before);
    });
  });

  describe('admin create — POST /api/v1/admin/orders at the channel\'s default language (N2)', () => {
    /** An operator's message language is their stored preference (the kernel's language ladder). */
    async function create(preferredLanguage: 'pl' | 'en') {
      await sql(`update "admin_users" set "preferred_language" = ? where "id" = ?`, [preferredLanguage, TEST_ADMIN_ID]);
      return h.app
        .inject({
          method: 'POST',
          url: '/api/v1/admin/orders',
          headers: { 'accept-language': preferredLanguage },
          cookies: ADMIN,
          payload: {
            customerAccountId: TEST_CUSTOMER_ID,
            salesChannelId: adminChannelId,
            items: [{ productId: adminProductId, quantity: 1 }],
            ...methodsAndAddresses,
          },
        })
        .finally(() => sql(`update "admin_users" set "preferred_language" = null where "id" = ?`, [TEST_ADMIN_ID]));
    }

    it.each(['pl', 'en'] as const)(
      'places a product on at the default and off at `pl-PL` for an operator working in %s',
      async (preferredLanguage) => {
        const res = await create(preferredLanguage);
        expect(res.statusCode, res.body).toBe(201);
        const orderId = (res.json() as { data: { id: string } }).data.id;
        expect(await ordersOf(adminProductId, adminChannelId)).toContain(orderId);
      },
    );
  });
});
