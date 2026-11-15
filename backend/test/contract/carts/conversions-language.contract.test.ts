import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';

/**
 * Issue #1293 — the basket's two conversion routes, `POST /cart/from-quote-request/:id` and
 * `POST /cart/from-shopping-list/:id`, judge the lines they add in the channel language the
 * request's `Accept-Language` asks for, as `POST /cart/items` does (issue #1011). Before, both
 * reached the basket's batch add without the request's language, so every line was asked about
 * at the channel's default language whatever the buyer browsed in.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product is switched off at
 * (channel, `en-US`): available in Polish only. The quote request and the shopping list holding
 * it are made in Polish, where it is on; converting them appends it there and drops it as the
 * absent product elsewhere.
 */
describe('Basket conversions in the request language (issue #1293)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const channelId = randomUUID();
  const channelCode = `cc1293-${run}`.toLowerCase();
  const listName = `Basket conversion language ${run}`;
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  let productId = '';
  let quoteRequestId = '';
  let shoppingListId = '';

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  function headers(acceptLanguage: string | undefined): Record<string, string> {
    return {
      'x-sales-channel': channelCode,
      ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': listName })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const product = await createMinimumProduct(h.em(), {
      sku: `CC1293-${run}`,
      nameEn: `Conversion ${run}`,
      namePl: `Konwersja ${run}`,
      channelIds: [channelId],
    });
    productId = product.id;
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );

    const quote = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      headers: headers('pl-PL'),
      payload: { items: [{ productId, quantity: 1 }] },
    });
    if (quote.statusCode !== 201) throw new Error(`quote request: ${quote.statusCode} ${quote.body}`);
    quoteRequestId = (quote.json() as { data: { id: string } }).data.id;

    const list = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: CUSTOMER,
      headers: headers('pl-PL'),
      payload: { name: listName },
    });
    if (list.statusCode !== 201) throw new Error(`shopping list: ${list.statusCode} ${list.body}`);
    shoppingListId = (list.json() as { data: { id: string } }).data.id;
    const save = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${shoppingListId}/items`,
      cookies: CUSTOMER,
      headers: headers('pl-PL'),
      payload: { productId, quantity: 1 },
    });
    if (save.statusCode !== 201) throw new Error(`shopping list item: ${save.statusCode} ${save.body}`);
  }, 120_000);

  afterAll(async () => {
    if (h) {
      await sql(`delete from carts where sales_channel_id = ?`, [channelId]);
      await sql(`delete from quote_requests where sales_channel_id = ?`, [channelId]);
      await sql(
        `delete from shopping_list_items where shopping_list_id in (select id from shopping_lists where name = ?)`,
        [listName],
      );
      await sql(`delete from shopping_lists where name = ?`, [listName]);
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

  /** A conversion into the buyer's basket on the run's channel, from no basket. */
  async function convert(
    from: 'quote-request' | 'shopping-list',
    acceptLanguage?: string,
  ): Promise<{ appended: number; dropped: string[] }> {
    await sql(`delete from carts where sales_channel_id = ? and customer_account_id = ?`, [channelId, TEST_CUSTOMER_ID]);
    const id = from === 'quote-request' ? quoteRequestId : shoppingListId;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/from-${from}/${id}`,
      cookies: CUSTOMER,
      headers: headers(acceptLanguage),
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (
      res.json() as { data: { appendedLineCount: number; droppedLines: Array<{ reason: string }> } }
    ).data;
    return { appended: data.appendedLineCount, dropped: data.droppedLines.map((line) => line.reason) };
  }

  it('appends a quote request’s product in a language it is on, and drops it elsewhere', async () => {
    expect(await convert('quote-request', 'pl-PL')).toEqual({ appended: 1, dropped: [] });
    expect(await convert('quote-request', 'en;q=0.2, pl-PL;q=0.9')).toEqual({ appended: 1, dropped: [] });
    expect(await convert('quote-request', 'de-DE')).toEqual({ appended: 0, dropped: ['not_purchasable'] });
    expect(await convert('quote-request')).toEqual({ appended: 0, dropped: ['not_purchasable'] });
  });

  it('appends a shopping list’s product in a language it is on, and drops it elsewhere', async () => {
    expect(await convert('shopping-list', 'pl-PL')).toEqual({ appended: 1, dropped: [] });
    expect(await convert('shopping-list', 'en;q=0.2, pl-PL;q=0.9')).toEqual({ appended: 1, dropped: [] });
    expect(await convert('shopping-list', 'de-DE')).toEqual({ appended: 0, dropped: ['not_purchasable'] });
    expect(await convert('shopping-list')).toEqual({ appended: 0, dropped: ['not_purchasable'] });
  });
});
