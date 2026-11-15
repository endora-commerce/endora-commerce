import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';

/**
 * Issue #1293 — a quick-order build to the basket judges its lines in the channel language the
 * request's `Accept-Language` asks for, as `POST /cart/items` does (issue #1011). Before,
 * `CartWritePort.addItems` carried no language, so every line was asked about at the channel's
 * default language whatever the buyer browsed in.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product is switched off at
 * (channel, `en-US`): available in Polish only, so a build naming it is added there and refused
 * with the absent product's 404 elsewhere.
 */
describe('Quick order build to the basket in the request language (issue #1293)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const channelId = randomUUID();
  const channelCode = `qo1293-${run}`.toLowerCase();
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  let productId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Quick order basket language ${run}` })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const product = await createMinimumProduct(h.em(), {
      sku: `QO1293-${run}`,
      nameEn: `Quick order ${run}`,
      namePl: `Szybkie zamówienie ${run}`,
      channelIds: [channelId],
    });
    productId = product.id;
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from carts where sales_channel_id = ?`, [channelId]);
      if (productId) {
        await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
        await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
        await removeBasePriceSql(h.em(), productId);
        await sql(`delete from products where id = ?`, [productId]);
      }
      await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /** A build to the basket naming the product, from no basket on the run's channel. */
  async function build(acceptLanguage?: string): Promise<{ status: number; body: string }> {
    await sql(`delete from carts where sales_channel_id = ? and customer_account_id = ?`, [channelId, TEST_CUSTOMER_ID]);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      headers: {
        'x-sales-channel': channelCode,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
      cookies: CUSTOMER,
      payload: { target: 'cart', items: [{ productId, quantity: 1 }] },
    });
    return { status: res.statusCode, body: res.body };
  }

  /** The quantity of the product in the buyer's basket on the run's channel. */
  async function inBasket(): Promise<number> {
    const rows = await sql<Array<{ quantity: number }>>(
      `select ci.quantity from cart_items ci join carts c on c.id = ci.cart_id
        where c.sales_channel_id = ? and c.customer_account_id = ? and ci.product_id = ?`,
      [channelId, TEST_CUSTOMER_ID, productId],
    );
    return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
  }

  it('adds the product in a language it is on: `pl-PL`', async () => {
    const res = await build('pl-PL');
    expect(res.status, res.body).toBe(200);
    expect(await inBasket()).toBe(1);
  });

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    const res = await build('en;q=0.2, pl-PL;q=0.9');
    expect(res.status, res.body).toBe(200);
    expect(await inBasket()).toBe(1);
  });

  it('refuses it as unavailable in a language the channel does not offer: `de-DE`', async () => {
    const res = await build('de-DE');
    expect(res.status, res.body).toBe(404);
    expect(await inBasket()).toBe(0);
  });

  it('without the header, asks in the channel default, as before', async () => {
    const res = await build();
    expect(res.status, res.body).toBe(404);
  });
});
