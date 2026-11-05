import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 174, US10 (T122; FR-020, FR-090…FR-092; `contracts/seo-ports.md` §1) — the product page's
 * metadata on the three-level model, rewritten from 163's T115 (which asserted the Language level
 * 174 removes):
 *
 * - the PDP's `seo` block is `seo`'s answer for the request's (C, L), per field along
 *   C×L → C → G, then the page's derived values (from the Global name and description);
 * - a field whose effective source is an empty override takes the derived value (owner round 6);
 * - with `seo` off the block is the derived one, and the override rows persist.
 *
 * Rows are seeded in `seo_meta_overrides` directly: product metadata is written only through
 * catalog's save (FR-094), and `seo`'s generic product `PUT` is refused from T121 on.
 */
describe('PDP metadata at Global, Channel and Channel × language (spec 174, T122)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channels: Array<{ id: string; code: string }> = [];
  let productId: string;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function insertChannel(label: string): Promise<{ id: string; code: string }> {
    const id = randomUUID();
    const code = `ps163-${run}-${label}`;
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `163 pdp seo ${label}` })],
    );
    const channel = { id, code };
    channels.push(channel);
    return channel;
  }

  async function pdpSeo(channel: { code: string }, language: string) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productId}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as {
      data: { seo: { metaTitle: string; metaDescription: string; openGraph: { title: string; description: string } } };
    }).data.seo;
  }

  /** One `seo_meta_overrides` row: `channelId` null = Global, `locale` null = Channel. */
  const seedMeta = async (
    channelId: string | null,
    locale: string | null,
    values: { title?: string | null; description?: string | null },
  ): Promise<void> => {
    await sql(
      `insert into seo_meta_overrides (id, entity_type, entity_id, sales_channel_id, locale, title, description, created_at, updated_at)
       values (?, 'product', ?, ?, ?, ?, ?, now(), now())`,
      [randomUUID(), productId, channelId, locale, values.title ?? null, values.description ?? null],
    );
  };

  let b2b: { id: string; code: string };
  let b2c: { id: string; code: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel('b2b');
    b2c = await insertChannel('b2c');
    productId = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, visibility, allowed_organization_ids,
                             created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', 'Impact drill',
               'A drill.', 'public', '[]'::jsonb, now(), now())`,
      [productId, `PS163-${run}`, `pdp-seo-${run}`],
    );
    for (const channel of [b2b, b2c]) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel.id, productId]);
    }
    await seedMeta(b2b.id, 'pl-PL', { title: 'Wiertarka dla firm' });
    await seedMeta(b2b.id, null, { title: '', description: 'Opis B2B' });
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      for (const channel of channels) await sql(`delete from sales_channels where id = ?`, [channel.id]);
      await teardownBackendServer(h);
    }
  });

  it('serves the C\u00d7L title and the Channel description at B2B \u00d7 Polish (C\u00d7L \u2192 C)', async () => {
    expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({
      metaTitle: 'Wiertarka dla firm',
      metaDescription: 'Opis B2B',
    });
  });

  it('derives a field whose effective value is an empty override, and inherits the Channel description', async () => {
    expect(await pdpSeo(b2b, 'en-US')).toMatchObject({ metaTitle: 'Impact drill', metaDescription: 'Opis B2B' });
  });

  it('derives the rest from the product where no override applies', async () => {
    expect(await pdpSeo(b2c, 'pl-PL')).toMatchObject({ metaTitle: 'Impact drill', metaDescription: 'A drill.' });
  });

  it('serves the Global row on every channel and language no C or C\u00d7L row overrides', async () => {
    await seedMeta(null, null, { title: 'Wiertarka (G)', description: 'Opis globalny' });
    expect(await pdpSeo(b2c, 'en-US')).toMatchObject({ metaTitle: 'Wiertarka (G)', metaDescription: 'Opis globalny' });
    expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({ metaTitle: 'Wiertarka dla firm', metaDescription: 'Opis B2B' });
  });

  it('answers the derived metadata while seo is off, and serves the overrides again after', async () => {
    await withModuleOff('seo', 'deactivated', async () => {
      expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({ metaTitle: 'Impact drill', metaDescription: 'A drill.' });
    });
    expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({ metaTitle: 'Wiertarka dla firm' });
  });
});
