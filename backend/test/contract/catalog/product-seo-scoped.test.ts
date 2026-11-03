import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 163, Phase 18 (T115) — the product page's metadata per sales channel ×
 * language (`specs/163-product-data-scopes/contracts/seo-media-attachments.md` §1;
 * research R13, owner decision Q-A; FR-075, FR-111, US8 #1, plan *Intended
 * behaviour changes* 4).
 *
 * - the PDP's `seo` block is `seo`'s answer for the request's (C, L): C×L → C → L →
 *   the page's derived values, per field;
 * - a per-language override written before this feature is now served (Q-A);
 * - with `seo` off the block is the derived one, and the override rows persist.
 */
describe('PDP metadata per channel × language (spec 163, T115)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
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

  const putMeta = async (payload: Record<string, unknown>): Promise<void> => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/seo/meta/product/${productId}`,
      ...admin,
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
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
    // Pre-163 shape: a per-language override, no channel (Q-A: served from now on).
    await sql(
      `insert into seo_meta_overrides (id, entity_type, entity_id, locale, title, description, created_at, updated_at)
       values (?, 'product', ?, 'pl-PL', 'Wiertarka — sklep', 'Opis PL z SEO', now(), now())`,
      [randomUUID(), productId],
    );
    await putMeta({ channelId: b2b.id, locale: 'pl-PL', title: 'Wiertarka dla firm' });
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

  it('serves B2B × Polish its own title and inherits the language description (US8 #1)', async () => {
    expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({
      metaTitle: 'Wiertarka dla firm',
      metaDescription: 'Opis PL z SEO',
    });
  });

  it('serves a pre-existing per-language override where no channel row applies (Q-A)', async () => {
    expect(await pdpSeo(b2c, 'pl-PL')).toMatchObject({
      metaTitle: 'Wiertarka — sklep',
      metaDescription: 'Opis PL z SEO',
    });
  });

  it('derives the rest from the product where no override applies', async () => {
    expect(await pdpSeo(b2c, 'en-US')).toMatchObject({ metaTitle: 'Impact drill', metaDescription: 'A drill.' });
  });

  it('answers the derived metadata while seo is off, and serves the overrides again after', async () => {
    await withModuleOff('seo', 'deactivated', async () => {
      expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({
        metaTitle: 'Wiertarka udarowa',
        metaDescription: 'Wiertarka.',
      });
    });
    expect(await pdpSeo(b2b, 'pl-PL')).toMatchObject({ metaTitle: 'Wiertarka dla firm' });
  });
});
