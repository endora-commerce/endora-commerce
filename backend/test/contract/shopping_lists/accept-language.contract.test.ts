import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #1011 — saving a line to a shopping list and converting a list to a quote request judge
 * the product in the channel language the whole `Accept-Language` header asks for, through
 * `requestScopeLanguage`: q-weighted, each tag matched against the channel's languages (exact,
 * then base language), else the channel's default. Before, both routes passed the header's first
 * tag alone, so `en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the
 * default.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product is switched off at
 * (channel, `en-US`): available in Polish only, so it is saved there and refused with the absent
 * product's 404 elsewhere, and a list holding it converts it there and skips it elsewhere.
 */
describe('Shopping list language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `sl1011-${run}`;
  const productId = randomUUID();
  const listName = `Shopping list Accept-Language ${run}`;
  const CUSTOMER = { b2b_session: 'stub-customer-session' };

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
    const sku = `SL1011-${run}`.toUpperCase();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [productId, sku, sku.toLowerCase(), `Shopping list ${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from quote_requests where sales_channel_id = ?`, [channelId]);
      await sql(
        `delete from shopping_list_items where shopping_list_id in (select id from shopping_lists where name = ?)`,
        [listName],
      );
      await sql(`delete from shopping_lists where name = ?`, [listName]);
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
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

  async function newList(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: CUSTOMER,
      headers: headers('pl-PL'),
      payload: { name: listName },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function save(listId: string, acceptLanguage?: string): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/items`,
      cookies: CUSTOMER,
      headers: headers(acceptLanguage),
      payload: { productId, quantity: 1 },
    });
    return res.statusCode;
  }

  /** Saves the line in Polish, where it is on, then converts the list in `acceptLanguage`. */
  async function convert(acceptLanguage?: string): Promise<{ added: number; skipped: string[] }> {
    const listId = await newList();
    expect(await save(listId, 'pl-PL')).toBe(201);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/convert-to-rfq`,
      cookies: CUSTOMER,
      headers: headers(acceptLanguage),
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { added: number; skipped: Array<{ reason: string }> } }).data;
    return { added: data.added, skipped: data.skipped.map((s) => s.reason) };
  }

  async function saveTo(acceptLanguage?: string): Promise<number> {
    return save(await newList(), acceptLanguage);
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await saveTo('en;q=0.2, pl-PL;q=0.9')).toBe(201);
    expect(await convert('en;q=0.2, pl-PL;q=0.9')).toEqual({ added: 1, skipped: [] });
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await saveTo('pl')).toBe(201);
    expect(await convert('pl')).toEqual({ added: 1, skipped: [] });
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await saveTo('de-DE, pl;q=0.5')).toBe(201);
    expect(await convert('de-DE, pl;q=0.5')).toEqual({ added: 1, skipped: [] });
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect(await saveTo('de-DE')).toBe(404);
    expect(await convert('de-DE')).toEqual({ added: 0, skipped: ['product_not_found'] });
  });

  it('without the header, asks in the channel default, as before', async () => {
    expect(await saveTo()).toBe(404);
    expect(await convert()).toEqual({ added: 0, skipped: ['product_not_found'] });
  });
});
