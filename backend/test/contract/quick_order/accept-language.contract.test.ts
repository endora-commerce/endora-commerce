import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #1011 — the quick-order type-ahead and the buyer's build to a quote request read the
 * buyer's language from the whole `Accept-Language` header through `requestScopeLanguage`:
 * q-weighted, each tag matched against the channel's languages (exact, then base language), else
 * the channel's default. Before, both took the header's first tag alone, so
 * `en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the default.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The product is switched off at
 * (channel, `en-US`): available in Polish only, so the type-ahead finds it there and not
 * elsewhere, and a build to a quote request is accepted there and refused with the absent
 * product's 404 elsewhere.
 */
describe('Quick order language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `qo1011-${run}`;
  const productId = randomUUID();
  const sku = `QO1011-${run}`.toUpperCase();
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
      [channelId, channelCode, JSON.stringify({ 'en-US': `Quick order Accept-Language ${run}` })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [productId, sku, sku.toLowerCase(), `Quick order ${run}`],
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

  /** Whether the type-ahead finds the product. */
  async function found(acceptLanguage?: string): Promise<boolean> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quick-order/search?q=${encodeURIComponent(sku)}`,
      headers: headers(acceptLanguage),
      cookies: CUSTOMER,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ productId: string }> }).data.some((hit) => hit.productId === productId);
  }

  /** The status of a build to a quote request naming the product. */
  async function build(acceptLanguage?: string): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      headers: headers(acceptLanguage),
      cookies: CUSTOMER,
      payload: { target: 'quote_request', items: [{ productId, quantity: 1 }] },
    });
    return res.statusCode;
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await found('en;q=0.2, pl-PL;q=0.9')).toBe(true);
    expect(await build('en;q=0.2, pl-PL;q=0.9')).toBe(200);
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await found('pl')).toBe(true);
    expect(await build('pl')).toBe(200);
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await found('de-DE, pl;q=0.5')).toBe(true);
    expect(await build('de-DE, pl;q=0.5')).toBe(200);
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect(await found('de-DE')).toBe(false);
    expect(await build('de-DE')).toBe(404);
  });

  it('without the header, asks in the channel default, as before', async () => {
    expect(await found()).toBe(false);
    expect(await build()).toBe(404);
  });
});
