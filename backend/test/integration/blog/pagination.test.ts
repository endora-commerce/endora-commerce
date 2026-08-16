import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Pagination correctness integration test (T107 / SC-007).
 *
 * For a Category with N published Posts and `posts_per_page = X`, every
 * `?page=K` (1 ≤ K ≤ ⌈N/X⌉) returns the right slice — newest first, no
 * duplicates, no skips between adjacent pages.
 *
 * We seed 7 published posts, set `posts_per_page = 3`, and verify pages
 * 1, 2, 3 carry the right ids in the right order.
 */
describe('blog pagination correctness (T107)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  let categorySlug: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const postIdsNewestFirst: string[] = [];

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

    // Create the category.
    categorySlug = `page-cat-${Date.now()}`;
    const cat = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': 'Page Cat' },
        slug: categorySlug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        enabled: true,
      }),
    });
    expect(cat.statusCode).toBe(201);
    const catId = (cat.json() as { data: { id: string } }).data.id;

    // Set posts_per_page = 3 for the default channel.
    const setPP = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.posts_per_page/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        scope: 'subset',
        salesChannelCodes: [defaultChannelCode],
        value: 3,
      }),
    });
    expect(setPP.statusCode).toBe(200);

    // Create 7 published posts. Each post's `published_at` advances by
    // 1 second so the newest-first ordering is deterministic. We track
    // them in newest-first order (last-created first).
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const slug = `page-post-${Date.now()}-${i}`;
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
          categoryIds: [catId],
        }),
      });
      const data = (create.json() as { data: { id: string; version: number } }).data;
      const pub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${data.id}/publish`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ version: data.version }),
      });
      expect(pub.statusCode).toBe(200);
      ids.push(data.id);
      // Sleep 5 ms so the next post's published_at is strictly later.
      await new Promise((r) => setTimeout(r, 5));
    }
    postIdsNewestFirst.push(...ids.reverse());

    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function fetchPage(page: number): Promise<{
    pagination: { page: number; perPage: number; totalPages: number; totalItems: number };
    ids: string[];
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${categorySlug}&page=${page}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: {
        kind: string;
        posts: {
          data: Array<{ id: string }>;
          pagination: {
            page: number;
            perPage: number;
            totalPages: number;
            totalItems: number;
          };
        };
      };
    }).data;
    expect(body.kind).toBe('category');
    return {
      pagination: body.posts.pagination,
      ids: body.posts.data.map((p) => p.id),
    };
  }

  it('reports the correct pagination metadata (3 pages of 3 + 1)', async () => {
    const p1 = await fetchPage(1);
    expect(p1.pagination.totalItems).toBe(7);
    expect(p1.pagination.totalPages).toBe(3);
    expect(p1.pagination.perPage).toBe(3);
  });

  it('returns 7 unique ids in newest-first order across pages 1, 2, 3', async () => {
    const p1 = (await fetchPage(1)).ids;
    const p2 = (await fetchPage(2)).ids;
    const p3 = (await fetchPage(3)).ids;
    const allIds = [...p1, ...p2, ...p3];
    expect(p1).toHaveLength(3);
    expect(p2).toHaveLength(3);
    expect(p3).toHaveLength(1);
    expect(new Set(allIds).size).toBe(7);

    // The order is newest-first by published_at.
    expect(allIds).toEqual(postIdsNewestFirst);
  });

  it('out-of-range page returns an empty data array (not a 404)', async () => {
    const p = await fetchPage(99);
    expect(p.ids).toHaveLength(0);
    expect(p.pagination.totalItems).toBe(7);
  });
});
