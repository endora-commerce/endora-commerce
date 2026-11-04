import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SeoProductMetaWritePort } from '@endora-commerce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T057; FR-013 round-6 exceptions,
 * US10 #4, `contracts/readers.md` §1 `seo` row) — the derived metadata at (C, L) is the
 * product's effective text there (C×L → C → G, `effectiveTexts`), not its Global text; and an
 * empty SEO title or description override yields the derived value, never a blank tag.
 */
describe('172 — derived SEO metadata at (C, L) [integration]', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const productId = randomUUID();
  const channelId = randomUUID();
  const admin = { b2b_session: 'stub-admin-session' };
  const metaAt = async (query: string) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/product/${productId}${query}`, cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { resolved: { title: string; description: string }; sources: Record<string, string> } }).data;
  };

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency, active, created_at, updated_at)
       values (?, ?, '{"en-US":"172 derived meta"}'::jsonb, 'pl-PL', '["pl-PL","en-US"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, `sc170d-${run}`],
    );
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', 'Drill Global', 'Global description', now(), now())`,
      [productId, `SEO170D-${run}`, `seo-derived-${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/scoped-values?channelId=${channelId}&languageCode=pl-PL`,
      cookies: admin,
    });
    expect(read.statusCode, read.body).toBe(200);
    const version = (read.json() as { data: { version: string } }).data.version;
    const save = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/scoped-values`,
      cookies: admin,
      payload: {
        scope: { channelId, languageCode: 'pl-PL' },
        version,
        changes: { name: 'Wiertarka C x L', description: 'Opis C x L' },
      },
    });
    expect(save.statusCode, save.body).toBe(200);
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
    await teardownBackendServer(h);
  });

  it('derives the title and description from the (C, L) text, and from the Global text at Global', async () => {
    const cl = await metaAt(`?channelId=${channelId}&languageCode=pl-PL`);
    expect(cl.resolved.title).toBe('Wiertarka C x L');
    expect(cl.resolved.description).toBe('Opis C x L');
    expect(cl.sources['title']).toBe('derived');

    // English in the same channel has no own text: C → G.
    const en = await metaAt(`?channelId=${channelId}&languageCode=en-US`);
    expect(en.resolved.title).toBe('Drill Global');

    const g = await metaAt('');
    expect(g.resolved.title).toBe('Drill Global');
    expect(g.resolved.description).toBe('Global description');
  });

  it('an empty SEO title or description override yields the derived value at (C, L)', async () => {
    const port = h.container.resolve<SeoProductMetaWritePort<EntityManager>>('seoProductMetaWritePort');
    await h.em().fork().transactional(async (em) => {
      await port.applyWithin(em, {
        productId,
        scope: { level: 'channel_language', channelId, languageCode: 'pl-PL' },
        changes: { title: { op: 'empty' }, description: { op: 'empty' } },
      });
    });
    const cl = await metaAt(`?channelId=${channelId}&languageCode=pl-PL`);
    expect(cl.sources['title']).toBe('set_empty');
    expect(cl.resolved.title).toBe('Wiertarka C x L');
    expect(cl.resolved.description).toBe('Opis C x L');
  });
});
