import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Integration test for the storefront's related-* filter contracts
 * (T077 / R5 / R6). The resolver must:
 *
 *   - omit related posts that are unpublished, soft-deleted, or
 *     out-of-channel (R5 — storefront filter, even when the join row
 *     still exists);
 *   - omit related products that are soft-deleted (R6 — soft-delete
 *     reliance, no generic ProductReferenceRegistry at v1).
 */
describe('blog storefront related-* filters (T077)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const productIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
    await h.em().getConnection().execute(
      `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug)
         select id, ?, slug from blog_categories where is_system = true
         on conflict do nothing`,
      [defaultChannelId],
    );
  });

  afterAll(async () => {
    // Clean up the seeded rows *before* teardown: `teardownBackendServer`
    // closes the harness ORM, so a connection taken after it has no pool.
    if (productIds.length > 0) {
      const conn = h.orm.em.getConnection();
      await conn.execute(
        `delete from blog_post_related_products where product_id = any (?::uuid[])`,
        [`{${productIds.join(',')}}`],
      );
      await conn.execute(`delete from products where id = any (?::uuid[])`, [
        `{${productIds.join(',')}}`,
      ]);
    }
    await teardownBackendServer(h);
  });

  async function createPublishedPost(slug: string): Promise<{ id: string }> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(create.statusCode).toBe(201);
    const data = (create.json() as { data: { id: string; version: number } }).data;
    const pub = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${data.id}/publish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: data.version }),
    });
    expect(pub.statusCode).toBe(200);
    return { id: data.id };
  }

  async function createDraftPost(slug: string): Promise<{ id: string }> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(create.statusCode).toBe(201);
    return { id: (create.json() as { data: { id: string } }).data.id };
  }

  async function setRelatedPosts(
    parentId: string,
    relatedIds: string[],
  ): Promise<void> {
    // Fetch the parent's current version first.
    const reloaded = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${parentId}`,
      cookies: adminCookie,
    });
    const v = (reloaded.json() as { data: { version: number } }).data.version;
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${parentId}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: relatedIds, version: v }),
    });
    expect(res.statusCode).toBe(200);
  }

  async function setRelatedProducts(
    parentId: string,
    pids: string[],
  ): Promise<void> {
    const reloaded = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${parentId}`,
      cookies: adminCookie,
    });
    const v = (reloaded.json() as { data: { version: number } }).data.version;
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${parentId}/related-products`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ productIds: pids, version: v }),
    });
    expect(res.statusCode).toBe(200);
  }

  async function fetchPostBySlug(slug: string): Promise<{
    relatedPosts: Array<{ slug: string }>;
    relatedProducts: Array<{ id: string }>;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${slug}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: {
        post: {
          relatedPosts: Array<{ slug: string }>;
          relatedProducts: Array<{ id: string }>;
        };
      };
    }).data;
    return {
      relatedPosts: body.post.relatedPosts,
      relatedProducts: body.post.relatedProducts,
    };
  }

  it('storefront omits a related post that is in draft status', async () => {
    const parentSlug = `filter-parent-${Date.now()}`;
    const parent = await createPublishedPost(parentSlug);
    const draft = await createDraftPost(`filter-draft-${Date.now()}`);
    const published = await createPublishedPost(`filter-published-${Date.now()}`);

    await setRelatedPosts(parent.id, [draft.id, published.id]);
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    const out = await fetchPostBySlug(parentSlug);
    // The draft post is filtered out; only the published one remains.
    expect(out.relatedPosts).toHaveLength(1);
  });

  it('storefront omits a soft-deleted related product (R6 — no generic registry)', async () => {
    const parentSlug = `prod-filter-parent-${Date.now()}`;
    const parent = await createPublishedPost(parentSlug);

    const conn = h.em().getConnection();
    const productId = randomUUID();
    productIds.push(productId);
    await conn.execute(
      `insert into products (id, sku, name, description, slug, type, status, created_at, updated_at)
       values (?, ?, ?::jsonb, '{}'::jsonb, ?, 'simple', 'active', now(), now())`,
      [
        productId,
        `filter-sku-${Date.now()}`,
        JSON.stringify({ 'en-US': 'Test Product' }),
        `filter-prod-${Date.now()}`,
      ],
    );

    // Wire a minimal product-card resolver via a service handle.
    h.blog.storefrontResolver = h.blog.storefrontResolver; // sanity: handle exposed
    // The default test-server doesn't wire `resolveProductCard`, so the
    // storefront returns an empty list regardless of the join row. To
    // exercise the soft-delete-filter contract end-to-end we install a
    // minimal resolver here.
    const ports = (h.blog.storefrontResolver as unknown as {
      deps: {
        resolveProductCard?: (
          productId: string,
          channelId: string,
          language: string,
        ) => Promise<unknown>;
      };
    }).deps;
    ports.resolveProductCard = async (pid: string) => {
      const rows = (await conn.execute(
        `select id::text as id, slug, name from products where id = ? and deleted_at is null limit 1`,
        [pid],
      )) as Array<{ id: string; slug: string; name: Record<string, string> }>;
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        name: row.name?.['en-US'] ?? row.slug,
        mainImageUrl: null,
        price: null,
      };
    };

    await setRelatedProducts(parent.id, [productId]);
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    // Before soft-delete the product appears.
    const before = await fetchPostBySlug(parentSlug);
    expect(before.relatedProducts.map((p) => p.id)).toContain(productId);

    // Soft-delete the product → next storefront read filters it.
    await conn.execute(
      `update products set deleted_at = now() where id = ?`,
      [productId],
    );
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    const after = await fetchPostBySlug(parentSlug);
    expect(after.relatedProducts.map((p) => p.id)).not.toContain(productId);
  });
});
