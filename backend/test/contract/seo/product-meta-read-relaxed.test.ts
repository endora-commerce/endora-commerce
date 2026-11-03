import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T120; FR-093, `contracts/seo-ports.md` §4,
 * research R9, R21):
 *
 * - `GET /api/v1/admin/seo/meta/product/:id` is a static route on `catalog:read`, at G, C and C×L,
 *   and wins over the parametric route; a language without a channel, a channel the product is not
 *   sold in, or a language the channel does not offer is `422`;
 * - the category and CMS-page reads stay on `catalog:write` (a `catalog:read` admin gets `403`);
 * - the generic `PUT` / `DELETE …/seo/meta/product/:id` is refused `422 VALIDATION_FAILED`:
 *   product SEO is written only through catalog's save (one audit path, FR-094).
 */
describe('170 — the product SEO read on catalog:read [contract]', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const READER = `stub-seo-catalog-reader-${run}`;
  const ADMIN = { b2b_session: 'stub-admin-session' };
  const productId = randomUUID();
  const channelId = randomUUID();
  const otherChannelId = randomUUID();
  let categoryId = '';
  const reader = { b2b_session: READER };
  const url = (query = '') => `/api/v1/admin/seo/meta/product/${productId}${query}`;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const role = em.create(AdminRole, { code: `seo_reader_${run}`, name: `seo reader ${run}`, permissions: ['catalog:read'] });
    await em.persistAndFlush(role);
    const admin = em.create(AdminUser, {
      email: `seo-reader-${run}@seo.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Seo',
      lastName: 'Reader',
    });
    await em.persistAndFlush(admin);
    ADMIN_COOKIES[READER] = { adminUserId: admin.id };

    for (const [id, code] of [
      [channelId, `sc170r-${run}`],
      [otherChannelId, `sc170o-${run}`],
    ] as const) {
      await sql(
        `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency, active, created_at, updated_at)
         values (?, ?, '{"en-US":"170 seo read"}'::jsonb, 'pl-PL', '["pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
        [id, code],
      );
    }
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', 'Seo read', 'Derived description', now(), now())`,
      [productId, `SEO170R-${run}`, `seo-read-${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await sql(
      `insert into seo_meta_overrides (id, entity_type, entity_id, locale, sales_channel_id, title, created_at, updated_at)
       values (?, 'product', ?, null, null, 'Global SEO title', now(), now()),
              (?, 'product', ?, 'pl-PL', ?, 'Tytul C x L', now(), now())`,
      [randomUUID(), productId, randomUUID(), productId, channelId],
    );
    const [category] = await sql<Array<{ id: string }>>(`select id from categories where deleted_at is null and is_active limit 1`);
    categoryId = category!.id;
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
    await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
    await sql(`delete from products where id = ?`, [productId]);
    await sql(`delete from sales_channels where id in (?, ?)`, [channelId, otherChannelId]);
    await teardownBackendServer(h);
  });

  it('answers a catalog:read admin at Global, Channel and Channel x language', async () => {
    const global = await h.app.inject({ method: 'GET', url: url(), cookies: reader });
    expect(global.statusCode, global.body).toBe(200);
    const g = (global.json() as { data: { scoped: Record<string, { effective: unknown; source: string }> } }).data;
    expect(g.scoped['title']).toMatchObject({ source: 'set' });

    const channel = await h.app.inject({ method: 'GET', url: url(`?channelId=${channelId}`), cookies: reader });
    expect(channel.statusCode, channel.body).toBe(200);
    const c = (channel.json() as { data: { scoped: Record<string, { source: string }> } }).data;
    expect(c.scoped['title']).toMatchObject({ source: 'inherited_global' });

    const cl = await h.app.inject({ method: 'GET', url: url(`?channelId=${channelId}&languageCode=pl-PL`), cookies: reader });
    expect(cl.statusCode, cl.body).toBe(200);
    const body = (cl.json() as { data: { scoped: Record<string, { source: string }>; resolved: { title: string } } }).data;
    expect(body.scoped['title']).toMatchObject({ source: 'set' });
    expect(body.resolved.title).toBe('Tytul C x L');
  });

  it.each([
    ['a language without a channel', '?languageCode=pl-PL'],
    ['a channel the product is not sold in', `?channelId=${otherChannelId}`],
    ['a language the channel does not offer', `?channelId=${channelId}&languageCode=de-DE`],
  ])('refuses %s with 422', async (_name, query) => {
    const res = await h.app.inject({ method: 'GET', url: url(query), cookies: reader });
    expect(res.statusCode, res.body).toBe(422);
  });

  it('keeps the category and CMS page reads on catalog:write', async () => {
    const category = await h.app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/category/${categoryId}`, cookies: reader });
    expect(category.statusCode, category.body).toBe(403);
    const page = await h.app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/cms_page/${randomUUID()}`, cookies: reader });
    expect(page.statusCode, page.body).toBe(403);
    const asWriter = await h.app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/category/${categoryId}`, cookies: ADMIN });
    expect(asWriter.statusCode, asWriter.body).toBe(200);
  });

  it('refuses the generic product PUT and DELETE with 422 VALIDATION_FAILED and writes nothing', async () => {
    const before = await sql(`select id, title from seo_meta_overrides where entity_id = ? order by id`, [productId]);
    const put = await h.app.inject({ method: 'PUT', url: url(), cookies: ADMIN, payload: { title: 'Bypass' } });
    expect(put.statusCode, put.body).toBe(422);
    expect(put.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    const del = await h.app.inject({ method: 'DELETE', url: url(), cookies: ADMIN });
    expect(del.statusCode, del.body).toBe(422);
    expect(del.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await sql(`select id, title from seo_meta_overrides where entity_id = ? order by id`, [productId])).toEqual(before);
  });
});
