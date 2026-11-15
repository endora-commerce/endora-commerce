import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #1011 — the two places `price_lists` reads a language off a request.
 *
 * 1. The storefront pricing routes ask `catalog` whether the product is available at the
 *    request's (channel, language). That language is now `requestScopeLanguage` over the whole
 *    `Accept-Language` header: q-weighted, each tag matched against the channel's languages
 *    (exact, then base language), else the channel's default. Before, it was the header's first
 *    tag alone, so `en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the
 *    default. The run's channel offers `en-US` (default) and `pl-PL`; the product is switched
 *    off at (channel, `en-US`), so it is available in Polish only and a 404 tells the two apart.
 *
 * 2. The admin price-book routes pick display labels in the operator's language. That is now
 *    `request.responseLanguage()` — the admin's stored preference, the language the admin SPA
 *    renders in and the error envelope translates into — not the first tag of the browser's
 *    `Accept-Language`, which the SPA does not set. An explicit `?lang=` still wins.
 */
describe('price_lists request language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `pl1011-${run}`;
  const productId = randomUUID();
  const attributeKey = `pl1011_finish_${run}`;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function sql(query: string, params: unknown[] = []): Promise<unknown> {
    return h.em().getConnection().execute(query, params);
  }

  async function setPreferredLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: adminCookie,
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Price lists Accept-Language ${run}` })],
    );
    const sku = `PL1011-${run}`.toUpperCase();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [productId, sku, sku.toLowerCase(), `Price lists ${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );

    const attribute = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: adminCookie,
      payload: {
        key: attributeKey,
        label: { 'en-US': 'Finish', 'pl-PL': 'Wykończenie' },
        labelDefault: 'Finish (default)',
        type: 'select',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        isPriceRule: true,
        options: [{ value: 'matt', labelDefault: 'Matt', isDefault: true }],
      },
    });
    expect(attribute.statusCode, attribute.body).toBe(201);
  });

  afterAll(async () => {
    if (h) {
      // The seeded admin goes back to the platform default, so no later file inherits it.
      await setPreferredLanguage(null);
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/attributes/${attributeKey}`, cookies: adminCookie });
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  describe('storefront: the product is available in the channel language Accept-Language asks for', () => {
    async function displayMode(acceptLanguage?: string): Promise<number> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/pricing/display-mode/${productId}`,
        headers: {
          'x-sales-channel': channelCode,
          ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
        },
      });
      return res.statusCode;
    }

    async function resolvedPrice(acceptLanguage: string): Promise<number> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/products/${productId}/resolved-price`,
        headers: { 'x-sales-channel': channelCode, 'accept-language': acceptLanguage },
      });
      return res.statusCode;
    }

    it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish, where the product is on', async () => {
      expect(await displayMode('en;q=0.2, pl-PL;q=0.9')).toBe(200);
      expect(await resolvedPrice('en;q=0.2, pl-PL;q=0.9')).toBe(200);
    });

    it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
      expect(await displayMode('pl')).toBe(200);
    });

    it('skips an unoffered tag for the next offered one', async () => {
      expect(await displayMode('de-DE, pl;q=0.5')).toBe(200);
    });

    it('answers a language the channel does not offer in the channel default, where the product is off', async () => {
      expect(await displayMode('de-DE')).toBe(404);
    });

    it('without the header, asks in the channel default, as before', async () => {
      expect(await displayMode()).toBe(404);
    });
  });

  describe('admin: price-book labels follow the operator language', () => {
    async function label(headers: Record<string, string>, query = ''): Promise<string | undefined> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/price-books/targets/attributes${query}`,
        cookies: adminCookie,
        headers,
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as { data: { items: Array<{ key: string; label: string }> } }).data.items;
      return items.find((item) => item.key === attributeKey)?.label;
    }

    it("labels in the admin's stored language, whatever the browser's header says", async () => {
      await setPreferredLanguage('pl');
      expect(await label({ 'accept-language': 'en-US,en;q=0.9' })).toBe('Wykończenie');
      await setPreferredLanguage('en');
      expect(await label({ 'accept-language': 'pl-PL,pl;q=0.9' })).toBe('Finish');
    });

    it('lets an explicit `?lang=` win', async () => {
      await setPreferredLanguage('en');
      expect(await label({}, '?lang=pl-PL')).toBe('Wykończenie');
    });
  });
});
