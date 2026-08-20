import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * End-to-end reference-protection smoke test (T106).
 *
 * Verifies all five protection paths in one suite — a meta-test that
 * proves they compose correctly when exercised through the actual HTTP
 * layer. Each individual path is also covered by a focused unit /
 * contract test elsewhere in the blog suite; this file is the single
 * "everything together" smoke that closes Phase 10's verification.
 *
 * Paths:
 *   1. Tag delete with referencing posts → 409 BLOG_TAG_IN_USE.
 *   2. Category delete with referencing posts → 409 BLOG_CATEGORY_IN_USE.
 *   3. Category delete with child rows → 409 BLOG_CATEGORY_HAS_CHILDREN.
 *   4. Seeded `Default` Category delete → 409 BLOG_CATEGORY_PROTECTED.
 *   5. Library Asset soft-delete while referenced from a Category's
 *      `main_image_asset_id` → AssetReferenceRegistry surfaces the
 *      blog category as a referencing entity.
 */
describe('blog reference-protection smoke (T106)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const seededAssets: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
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
    if (seededAssets.length > 0) {
      const conn = h.orm.em.getConnection();
      await conn.execute(
        `update blog_categories set main_image_asset_id = null where main_image_asset_id = any (?::uuid[])`,
        [`{${seededAssets.join(',')}}`],
      );
      await conn.execute(`delete from assets where id = any (?::uuid[])`, [
        `{${seededAssets.join(',')}}`,
      ]);
    }
    await teardownBackendServer(h);
  });

  async function createPost(slug: string, overrides: Record<string, unknown> = {}): Promise<{
    id: string;
    version: number;
  }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        ...overrides,
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function createCategory(
    slug: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        enabled: true,
        ...overrides,
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('Tag delete is refused while attached to a post (BLOG_TAG_IN_USE)', async () => {
    const code = `t-protect-${Date.now()}`;
    const tag = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/tags',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': code }, code }),
    });
    expect(tag.statusCode).toBe(201);
    const tagData = (tag.json() as { data: { id: string; version: number } }).data;
    const post = await createPost(`t-protect-post-${Date.now()}`);
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${post.id}/tags`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ tagIds: [tagData.id], version: post.version }),
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/tags/${tagData.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: tagData.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_TAG_IN_USE,
    );
  });

  it('Category delete is refused while a Post references it (BLOG_CATEGORY_IN_USE)', async () => {
    const cat = await createCategory(`cat-in-use-${Date.now()}`);
    await createPost(`cat-in-use-post-${Date.now()}`, { categoryIds: [cat.id] });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/categories/${cat.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: cat.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_IN_USE,
    );
  });

  it('Category delete is refused while it has children (BLOG_CATEGORY_HAS_CHILDREN)', async () => {
    const parent = await createCategory(`cat-parent-${Date.now()}`);
    await createCategory(`cat-child-${Date.now()}`, { parentId: parent.id });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/categories/${parent.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: parent.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_HAS_CHILDREN,
    );
  });

  it('seeded Default Category delete is refused (BLOG_CATEGORY_PROTECTED)', async () => {
    const conn = h.em().getConnection();
    const rows = (await conn.execute(
      `select id::text as id, version from blog_categories where is_system = true limit 1`,
    )) as Array<{ id: string; version: number }>;
    const def = rows[0]!;
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/categories/${def.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: def.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_PROTECTED,
    );
  });

  it('Library Asset soft-delete surfaces the blog category as a reference holder', async () => {
    const conn = h.em().getConnection();
    const assetId = randomUUID();
    seededAssets.push(assetId);
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'test.png', 'image/png', 1024, 'local:test-key', now(), now())`,
      [assetId],
    );
    const cat = await createCategory(`asset-ref-${Date.now()}`, {
      mainImageAssetId: assetId,
    });
    void cat;

    const refs = await h.assetsLibrary.referenceRegistry.findReferences(assetId);
    const blogRefs = refs.filter((r) => r.kind === 'blog_category_main_image');
    expect(blogRefs.length).toBeGreaterThan(0);
  });
});
