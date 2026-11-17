import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';
import { SEED_ADDRESS_BILLING_ID, SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { Cart, Product } from '../../helpers/package-entities.js';

/**
 * Issue #1373 — the checkout preview judges the basket's availability in the request's scope
 * language, the one `POST /cart/items` judged its lines in and (since issue #1320)
 * `POST /api/v1/orders` places them in.
 *
 * `POST /api/v1/orders/preview-total` used to judge it in the channel language the message
 * language names. A channel language that is not a platform interface language — `de-DE` here,
 * where messages are worded in English — was therefore judged at the channel's default: the
 * channel offers `en-US` (default) and `de-DE`, the product is off at (channel, `en-US`), and
 * the preview reported a line the basket admitted in `de-DE` as `product_unavailable`.
 */
describe('Order preview-total judges availability in the request\'s scope language (issue #1373)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const channelId = randomUUID();
  const channelCode = `pv1373-${run}`.toLowerCase();
  let productId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', ?::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Preview language ${channelCode}` }), JSON.stringify(['en-US', 'de-DE'])],
    );
    // Feature 154 — the buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const sku = `PV1373-${run}`;
    const product = await createMinimumProduct(h.em(), {
      sku,
      nameEn: `Preview language ${sku}`,
      namePl: `Język podglądu ${sku}`,
      channelIds: [channelId],
    });
    productId = product.id;
    await h.em().nativeUpdate(Product, { id: productId }, { manageStock: false });
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );
  }, 120_000);

  afterAll(async () => {
    if (h) {
      await sql(`delete from carts where sales_channel_id = ?`, [channelId]);
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await removeBasePriceSql(h.em(), productId);
      await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  const headers = (acceptLanguage: string) => ({
    'x-sales-channel': channelCode,
    'accept-language': acceptLanguage,
  });

  async function addToBasketInGerman(): Promise<void> {
    await h.em().nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, salesChannelId: channelId });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: headers('de-DE'),
      cookies: CUSTOMER,
      payload: { productId, quantity: 1 },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function unavailableLines(acceptLanguage: string): Promise<string[]> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      headers: headers(acceptLanguage),
      cookies: CUSTOMER,
      payload: {
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { belowMinimumLines } = (res.json() as {
      data: { belowMinimumLines: Array<{ productId: string; kind: string }> };
    }).data;
    return belowMinimumLines.filter((line) => line.kind === 'product_unavailable').map((line) => line.productId);
  }

  it('reports no unavailable line for a basket the same request\'s add admitted in `de-DE`', async () => {
    await addToBasketInGerman();
    expect(await unavailableLines('de-DE')).toEqual([]);
  });

  it('still reports the line when the preview asks in a language where it is off', async () => {
    await addToBasketInGerman();
    expect(await unavailableLines('en-US')).toEqual([productId]);
  });
});
