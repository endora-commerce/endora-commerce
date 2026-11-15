import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { removeBasePriceSql } from '../../helpers/price-book-sql.js';

/**
 * Issue #1293 — converting a shopping list to the basket judges its lines in the channel
 * language the request's `Accept-Language` asks for, as `POST /cart/items` does (issue #1011).
 * Before, `CartWritePort.addItems` carried no language, so every line was asked about at the
 * channel's default language whatever the buyer browsed in.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product is switched off at
 * (channel, `en-US`): available in Polish only, so a list holding it (saved in Polish) converts
 * it there and skips it as the absent product elsewhere.
 */
describe('Shopping list convert-to-cart in the request language (issue #1293)', () => {
  let h: BackendServerHandle;
  const run = minimumFixtureRun();
  const channelId = randomUUID();
  const channelCode = `sl1293-${run}`.toLowerCase();
  const listName = `Shopping list basket language ${run}`;
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
      [channelId, channelCode, JSON.stringify({ 'en-US': listName })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const product = await createMinimumProduct(h.em(), {
      sku: `SL1293-${run}`,
      nameEn: `Shopping list ${run}`,
      namePl: `Lista zakupowa ${run}`,
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

  function headers(acceptLanguage: string | undefined): Record<string, string> {
    return {
      'x-sales-channel': channelCode,
      ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
    };
  }

  /**
   * A new list holding the product (saved in Polish, where it is on), converted to the buyer's
   * basket on the run's channel — removed first, so every conversion starts from no basket.
   */
  async function convert(acceptLanguage?: string): Promise<{ added: number; skipped: string[] }> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: CUSTOMER,
      headers: headers('pl-PL'),
      payload: { name: listName },
    });
    expect(create.statusCode, create.body).toBe(201);
    const listId = (create.json() as { data: { id: string } }).data.id;
    const save = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/items`,
      cookies: CUSTOMER,
      headers: headers('pl-PL'),
      payload: { productId, quantity: 1 },
    });
    expect(save.statusCode, save.body).toBe(201);
    await sql(`delete from carts where sales_channel_id = ? and customer_account_id = ?`, [channelId, TEST_CUSTOMER_ID]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/convert-to-cart`,
      cookies: CUSTOMER,
      headers: headers(acceptLanguage),
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { added: number; skipped: Array<{ reason: string }> } }).data;
    return { added: data.added, skipped: data.skipped.map((s) => s.reason) };
  }

  it('converts the product in a language it is on: `pl-PL`', async () => {
    expect(await convert('pl-PL')).toEqual({ added: 1, skipped: [] });
  });

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await convert('en;q=0.2, pl-PL;q=0.9')).toEqual({ added: 1, skipped: [] });
  });

  it('skips it as unavailable in a language the channel does not offer: `de-DE`', async () => {
    expect(await convert('de-DE')).toEqual({ added: 0, skipped: ['product_not_found'] });
  });

  it('without the header, asks in the channel default, as before', async () => {
    expect(await convert()).toEqual({ added: 0, skipped: ['product_not_found'] });
  });
});
