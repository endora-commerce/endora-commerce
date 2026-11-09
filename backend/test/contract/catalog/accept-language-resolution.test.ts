import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Category, Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #397 — the catalogue's request language is resolved from the whole
 * `Accept-Language` header, the way the rest of the platform reads it: q-weighted,
 * each tag matched against the sales channel's languages (exact, then the base
 * language, `pl` → `pl-PL`), else the channel's default. Before, the public and the
 * external catalogue routes took the first entry verbatim, `;q=` included.
 *
 * The channel offers `en-US` (default) and `pl-PL`. The product's Polish name is its
 * (channel, `pl-PL`) override; its category's name is a per-language blob that also
 * carries a `de-DE` entry the channel does not offer.
 */
describe('Catalogue request language from Accept-Language (issue #397)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelCode = `al397-${run}`;
  const slug = `al397-drill-${run}`;
  let channelId: string;
  let productId: string;
  let categoryId: string;
  let apiKey: string;

  async function sql(query: string, params: unknown[] = []): Promise<unknown> {
    return h.em().getConnection().execute(query, params);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: channelCode,
      name: { 'en-US': `Accept-Language ${run}` },
      defaultLanguage: 'en-US',
      languages: ['en-US', 'pl-PL'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
      active: true,
    });
    const category = em.create(Category, {
      name: { 'en-US': 'Drills', 'pl-PL': 'Wiertarki', 'de-DE': 'Bohrer' },
      slug: `al397-drills-${run}`,
    });
    const product = em.create(Product, {
      sku: `AL397-${run}`,
      slug,
      type: 'simple',
      status: 'active',
      name: 'Impact drill',
      description: '',
      visibility: 'public',
      allowedOrganizationIds: [],
      manageStock: false,
      attributeValues: {},
    });
    await em.persistAndFlush([channel, category, product]);
    await h.salesChannels.cache.invalidate(channelCode);
    channelId = channel.id;
    productId = product.id;
    categoryId = category.id;
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await sql(`insert into sales_channel_categories (sales_channel_id, category_id) values (?, ?)`, [
      channelId,
      categoryId,
    ]);
    await sql(`insert into product_categories (product_id, category_id) values (?, ?)`, [productId, categoryId]);
    await sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, 'name', ?, 'pl-PL', ?::jsonb, now(), now())`,
      [productId, channelId, JSON.stringify({ v: 'Wiertarka udarowa' })],
    );

    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { name: `Accept-Language reader ${run}`, scopes: ['catalog:read'] },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    apiKey = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from product_value_overrides where product_id = ?`, [productId]);
      await sql(`delete from product_categories where product_id = ?`, [productId]);
      await sql(`delete from sales_channel_categories where category_id = ?`, [categoryId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      await sql(`delete from categories where id = ?`, [categoryId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  type Detail = { name: string; categories: Array<{ id: string; name: string }> };

  async function read(surface: 'public' | 'external', acceptLanguage: string): Promise<{ name: string; category: string }> {
    const res = await h.app.inject({
      method: 'GET',
      url:
        surface === 'public'
          ? `/api/v1/catalog/products/${slug}`
          : `/api/v1/external/catalog/products/${slug}`,
      headers: {
        'x-sales-channel': channelCode,
        'accept-language': acceptLanguage,
        ...(surface === 'external' ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = (res.json() as { data: Detail }).data;
    const category = detail.categories.find((c) => c.id === categoryId);
    expect(category, 'the product lists its category').toBeDefined();
    return { name: detail.name, category: category!.name };
  }

  describe.each(['public', 'external'] as const)('the %s product read', (surface) => {
    it('honours the q-weights: `en;q=0.1, pl-PL;q=0.9` is Polish', async () => {
      expect(await read(surface, 'en;q=0.1, pl-PL;q=0.9')).toEqual({ name: 'Wiertarka udarowa', category: 'Wiertarki' });
    });

    it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
      expect(await read(surface, 'pl')).toEqual({ name: 'Wiertarka udarowa', category: 'Wiertarki' });
    });

    it('answers a language the channel does not offer in the channel default', async () => {
      expect(await read(surface, 'de-DE')).toEqual({ name: 'Impact drill', category: 'Drills' });
    });

    it('skips an unoffered tag for the next offered one', async () => {
      expect(await read(surface, 'de-DE, pl;q=0.5')).toEqual({ name: 'Wiertarka udarowa', category: 'Wiertarki' });
    });
  });

  it('lists the product under its name in the resolved language', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(`AL397-${run}`)}&limit=10`,
      headers: { 'x-sales-channel': channelCode, 'accept-language': 'en;q=0.1, pl-PL;q=0.9' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: Array<{ slug: string; name: string }> }).data;
    expect(items.find((item) => item.slug === slug)?.name).toBe('Wiertarka udarowa');
  });
});
