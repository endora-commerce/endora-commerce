import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #1011 — a comparison reads its reader's language from the whole `Accept-Language`
 * header through `requestScopeLanguage`: q-weighted, each tag matched against the channel's
 * languages (exact, then base language), else the channel's default. Before, it took the
 * header's first tag alone, so `en;q=0.2, pl-PL;q=0.9` read English and `de-DE, pl;q=0.5` the
 * default.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. Product A is switched off at
 * (channel, `en-US`), so adding it succeeds in Polish only; product B is on everywhere and has a
 * (channel, `pl-PL`) name override, so the view names it in the language it was read in.
 */
describe('Comparison language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `cmp1011-${run}`;
  const polishOnlyId = randomUUID();
  const namedId = randomUUID();

  async function sql(query: string, params: unknown[] = []): Promise<unknown> {
    return h.em().getConnection().execute(query, params);
  }

  async function insertProduct(id: string, key: string, name: string): Promise<void> {
    const sku = `CMP1011-${run}-${key}`.toUpperCase();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [id, sku, sku.toLowerCase(), name],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, id]);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Comparisons Accept-Language ${run}` })],
    );
    await insertProduct(polishOnlyId, 'pl', `Polish only ${run}`);
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [polishOnlyId, channelId],
    );
    await insertProduct(namedId, 'named', 'Impact drill');
    await sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, 'name', ?, 'pl-PL', ?::jsonb, now(), now())`,
      [namedId, channelId, JSON.stringify({ v: 'Wiertarka udarowa' })],
    );
  });

  afterAll(async () => {
    if (h) {
      // Every comparison this file made is on its own channel (comparison_products cascade).
      await sql(`delete from comparisons where sales_channel_id = ?`, [channelId]);
      await sql(`delete from product_value_overrides where product_id = ?`, [namedId]);
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [polishOnlyId]);
      await sql(`delete from sales_channel_products where sales_channel_id = ?`, [channelId]);
      await sql(`delete from products where id in (?, ?)`, [polishOnlyId, namedId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /** Adds `productId` to a fresh anonymous comparison; the status and the view's names. */
  async function add(
    productId: string,
    acceptLanguage?: string,
  ): Promise<{ status: number; names: string[] }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        'x-sales-channel': channelCode,
        'content-type': 'application/json',
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
      payload: { productId },
    });
    if (res.statusCode !== 200) return { status: res.statusCode, names: [] };
    const products = (res.json() as { data: { products: Array<{ name: string }> } }).data.products;
    return { status: 200, names: products.map((product) => product.name) };
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect((await add(polishOnlyId, 'en;q=0.2, pl-PL;q=0.9')).status).toBe(200);
    expect(await add(namedId, 'en;q=0.2, pl-PL;q=0.9')).toEqual({ status: 200, names: ['Wiertarka udarowa'] });
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await add(namedId, 'pl')).toEqual({ status: 200, names: ['Wiertarka udarowa'] });
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect((await add(polishOnlyId, 'de-DE, pl;q=0.5')).status).toBe(200);
    expect(await add(namedId, 'de-DE, pl;q=0.5')).toEqual({ status: 200, names: ['Wiertarka udarowa'] });
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect((await add(polishOnlyId, 'de-DE')).status).toBe(404);
    expect(await add(namedId, 'de-DE')).toEqual({ status: 200, names: ['Impact drill'] });
  });

  it('without the header, reads in the channel default, as before', async () => {
    expect((await add(polishOnlyId)).status).toBe(404);
    expect(await add(namedId)).toEqual({ status: 200, names: ['Impact drill'] });
  });

  /**
   * The PDF export's language (`pickExportLanguage`, FR-032) is the same channel content
   * language: it picks the template's language, the channel name and the share page's
   * language prefix, so it goes through `requestScopeLanguage` too. It used to strip `;q`
   * without sorting by it, so `en;q=0.2, pl;q=0.9` exported an English PDF.
   */
  describe('PDF export language', () => {
    let cookie = '';

    beforeAll(async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/comparisons/me/products',
        headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
        payload: { productId: namedId },
      });
      expect(res.statusCode).toBe(200);
      const raw = res.headers['set-cookie'];
      cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0] ?? '';
    });

    async function exportLanguage(acceptLanguage?: string): Promise<string | undefined> {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/comparisons/me/pdf',
        headers: {
          'x-sales-channel': channelCode,
          cookie,
          ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
        },
      });
      expect(res.statusCode).toBe(200);
      const language = res.headers['content-language'];
      return typeof language === 'string' ? language : undefined;
    }

    it('honours the q-weights: `en;q=0.2, pl;q=0.9` exports in Polish', async () => {
      expect(await exportLanguage('en;q=0.2, pl;q=0.9')).toBe('pl-PL');
    });

    it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
      expect(await exportLanguage('pl')).toBe('pl-PL');
    });

    it('skips an unoffered tag for the next offered one', async () => {
      expect(await exportLanguage('de-DE, pl;q=0.5')).toBe('pl-PL');
    });

    it('exports a language the channel does not offer, or no header, in the channel default', async () => {
      expect(await exportLanguage('de-DE')).toBe('en-US');
      expect(await exportLanguage()).toBe('en-US');
    });
  });
});
