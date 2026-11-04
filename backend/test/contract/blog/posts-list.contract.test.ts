import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel, resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';

/**
 * `GET /api/v1/blog/posts` — the card list behind `blog.LatestPosts`
 * (`specs/163-page-builder-marketing-pages/` T064, contracts/storefront-and-admin-api.md §3).
 *
 * The main assertions run in two channels this file creates, so posts other
 * suites left in the default channel cannot reach the top three. The default
 * channel is used only to prove that a request with no channel header resolves
 * to it and to nothing else (Constitution XII).
 */
describe('storefront blog posts list contract (feature 163, T064)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  // Standing rule 5's `pb163_` tag, hyphenated: a blog slug allows `[a-z0-9-]` only.
  const run = `pb163-${randomUUID().slice(0, 8)}`;

  let defaultChannelId: string;
  let channelA: { id: string; code: string };
  let channelB: { id: string; code: string };
  let image: { id: string; url: string };

  const createdPostIds: string[] = [];
  const createdTagIds: string[] = [];
  const tagCode = `${run}-diy`;
  const createdCategoryIds: string[] = [];
  const createdChannelIds: string[] = [];

  async function createChannel(suffix: string): Promise<{ id: string; code: string }> {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `${run}-${suffix}`,
      name: { 'en-US': `Blog list ${suffix}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['USD'],
      defaultCurrency: 'USD',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    createdChannelIds.push(channel.id);
    return { id: channel.id, code: channel.code };
  }

  async function seedAsset(): Promise<{ id: string; url: string }> {
    const id = randomUUID();
    const connection = h.em().getConnection();
    await connection.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url,
         label, visibility, created_at, updated_at)
       values (?, 'image', 'post.png', 'image/png', 2048, ?, 'Post image', 'public', now(), now())`,
      [id, `https://example.test/${id}.png`],
    );
    const [row] = await connection.execute<Array<{ content_version: string }>>(
      'select content_version from assets where id = ?',
      [id],
    );
    return { id, url: `${resolvePublicApiBaseUrl()}/assets/file/${id}?v=${row!.content_version}` };
  }

  async function createCategory(slug: string, channelIds: string[]): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': `Category ${slug}` },
        slug,
        salesChannelIds: channelIds,
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    createdCategoryIds.push(id);
    return id;
  }

  async function createPost(input: {
    slug: string;
    channelIds: string[];
    publishedAt?: string;
    mainImageAssetId?: string;
    categoryIds?: string[];
  }): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': `Post ${input.slug}` },
        slug: input.slug,
        salesChannelIds: input.channelIds,
        languages: ['en-US'],
        categoryIds: input.categoryIds ?? [],
        ...(input.mainImageAssetId ? { mainImageAssetId: input.mainImageAssetId } : {}),
      }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const post = (res.json() as { data: { id: string; version: number } }).data;
    createdPostIds.push(post.id);
    if (input.publishedAt) {
      const pub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/blog/posts/${post.id}/publish`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ version: post.version }),
      });
      expect(pub.statusCode, pub.body).toBe(200);
      // A fixed publication date makes the order deterministic.
      await h
        .em()
        .getConnection()
        .execute('update blog_posts set published_at = ? where id = ?', [input.publishedAt, post.id]);
    }
    return post.id;
  }

  async function list(query: string, channelCode?: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/posts${query}`,
      headers: {
        ...(channelCode ? { 'x-sales-channel': channelCode } : {}),
        'x-blog-language': 'en-US',
      },
    });
  }

  type Card = {
    id: string;
    slug: string;
    name: string;
    mainImageUrl: string | null;
    primaryCategorySlug: string | null;
  };

  let posts: Record<'oldest' | 'older' | 'newer' | 'newest' | 'draft' | 'onlyB' | 'onlyDefault', string>;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    channelA = await createChannel('a');
    channelB = await createChannel('b');
    image = await seedAsset();
    const categoryId = await createCategory(`${run}-news`, [channelA.id]);

    posts = {
      oldest: await createPost({
        slug: `${run}-oldest`,
        channelIds: [channelA.id],
        publishedAt: '2026-01-01T00:00:00Z',
        categoryIds: [categoryId],
      }),
      older: await createPost({
        slug: `${run}-older`,
        channelIds: [channelA.id],
        publishedAt: '2026-02-01T00:00:00Z',
      }),
      newer: await createPost({
        slug: `${run}-newer`,
        channelIds: [channelA.id],
        publishedAt: '2026-03-01T00:00:00Z',
        categoryIds: [categoryId],
      }),
      newest: await createPost({
        slug: `${run}-newest`,
        channelIds: [channelA.id],
        publishedAt: '2026-04-01T00:00:00Z',
        mainImageAssetId: image.id,
      }),
      // Never published: newest of all by creation, and it must never appear.
      draft: await createPost({ slug: `${run}-draft`, channelIds: [channelA.id] }),
      // Published later than everything, but only in the other channel.
      onlyB: await createPost({
        slug: `${run}-only-b`,
        channelIds: [channelB.id],
        publishedAt: '2026-05-01T00:00:00Z',
      }),
      // Newest of every post in the test database, in the default channel only.
      onlyDefault: await createPost({
        slug: `${run}-only-default`,
        channelIds: [defaultChannelId],
        publishedAt: '2100-01-01T00:00:00Z',
      }),
    };

    // Feature 171 — a tag on two of channel A's posts, for the `tagCode` filter.
    const tag = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/tags',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': 'DIY' }, code: tagCode }),
    });
    expect(tag.statusCode, tag.body).toBe(201);
    const tagId = (tag.json() as { data: { id: string } }).data.id;
    createdTagIds.push(tagId);
    for (const postId of [posts.older, posts.oldest]) {
      const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/blog/posts/${postId}`, cookies: adminCookie });
      const version = (read.json() as { data: { version: number } }).data.version;
      const set = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/blog/posts/${postId}/tags`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ tagIds: [tagId], version }),
      });
      expect(set.statusCode, set.body).toBe(200);
    }
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const id of createdPostIds) {
      for (const table of [
        'blog_post_tags',
        'blog_post_categories',
        'blog_post_languages',
        'blog_post_sales_channels',
      ]) {
        await connection.execute(`delete from ${table} where blog_post_id = ?`, [id]);
      }
      await connection.execute('delete from blog_posts where id = ?', [id]);
    }
    for (const id of createdCategoryIds) {
      await connection.execute('delete from blog_category_languages where blog_category_id = ?', [id]);
      await connection.execute('delete from blog_category_sales_channels where blog_category_id = ?', [id]);
      await connection.execute('delete from blog_categories where id = ?', [id]);
    }
    for (const id of createdTagIds) await connection.execute('delete from blog_tags where id = ?', [id]);
    if (image) await connection.execute('delete from assets where id = ?', [image.id]);
    for (const id of createdChannelIds) {
      await connection.execute('delete from sales_channels where id = ?', [id]);
    }
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    await teardownBackendServer(h);
  });

  it('returns the three newest published posts of the channel, newest first, with the image URL', async () => {
    const res = await list('?limit=3', channelA.code);
    expect(res.statusCode, res.body).toBe(200);
    const cards = (res.json() as { data: Card[] }).data;
    expect(cards.map((c) => c.id)).toEqual([posts.newest, posts.newer, posts.older]);
    expect(cards[0]!.mainImageUrl).toBe(image.url);
    expect(cards[1]!.mainImageUrl).toBeNull();
    expect(cards[1]!.primaryCategorySlug).toBe(`${run}-news`);
  });

  it('defaults the limit to 6 and never lists a draft or another channel’s post', async () => {
    const res = await list('', channelA.code);
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json() as { data: Card[] }).data.map((c) => c.id);
    expect(ids).toEqual([posts.newest, posts.newer, posts.older, posts.oldest]);
    expect(ids).not.toContain(posts.draft);
    expect(ids).not.toContain(posts.onlyB);
    expect(ids).not.toContain(posts.onlyDefault);
  });

  it('filters by category slug', async () => {
    const res = await list(`?limit=6&categorySlug=${run}-news`, channelA.code);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Card[] }).data.map((c) => c.id)).toEqual([posts.newer, posts.oldest]);
  });

  it('answers an unknown category with an empty list, not a 404', async () => {
    const res = await list(`?categorySlug=${run}-missing`, channelA.code);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Card[] }).data).toEqual([]);
  });

  it('refuses a limit above 24 with 400', async () => {
    const res = await list('?limit=25', channelA.code);
    expect(res.statusCode).toBe(400);
  });

  it('lists the other channel’s post only in that channel', async () => {
    const res = await list('?limit=24', channelB.code);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Card[] }).data.map((c) => c.id)).toEqual([posts.onlyB]);
  });

  it('resolves a request with no channel header to the system default channel, never to all channels', async () => {
    const res = await list('?limit=24');
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json() as { data: Card[] }).data.map((c) => c.id);
    expect(ids[0]).toBe(posts.onlyDefault);
    for (const id of [posts.newest, posts.newer, posts.older, posts.oldest, posts.onlyB, posts.draft]) {
      expect(ids).not.toContain(id);
    }
  });

  // ── Feature 171 (US2, FR-010…FR-013) — page by page ─────────────────

  type Pagination = { page: number; perPage: number; totalItems: number; totalPages: number };

  async function page(query: string) {
    const res = await list(query, channelA.code);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { data: Card[]; pagination: Pagination };
  }

  it('pages the channel’s posts newest first, none repeated, with the totals', async () => {
    const first = await page('?perPage=2&page=1');
    const second = await page('?perPage=2&page=2');
    expect(first.data.map((c) => c.id)).toEqual([posts.newest, posts.newer]);
    expect(second.data.map((c) => c.id)).toEqual([posts.older, posts.oldest]);
    expect(first.pagination).toEqual({ page: 1, perPage: 2, totalItems: 4, totalPages: 2 });
    expect(second.pagination).toEqual({ page: 2, perPage: 2, totalItems: 4, totalPages: 2 });
  });

  it('answers a page past the last with no posts and the real totals, not a 404', async () => {
    const past = await page('?perPage=2&page=3');
    expect(past.data).toEqual([]);
    expect(past.pagination).toEqual({ page: 3, perPage: 2, totalItems: 4, totalPages: 2 });
  });

  it('keeps `limit` as the page size of an existing caller, and lets `perPage` win', async () => {
    const legacy = await page('?limit=3');
    expect(legacy.data).toHaveLength(3);
    expect(legacy.pagination.perPage).toBe(3);
    expect((await page('?limit=3&perPage=2')).data).toHaveLength(2);
    expect((await page('')).pagination.perPage).toBe(6);
  });

  it('filters by tag, counting only the matching posts', async () => {
    const tagged = await page(`?tagCode=${tagCode}`);
    expect(tagged.data.map((c) => c.id)).toEqual([posts.older, posts.oldest]);
    expect(tagged.pagination.totalItems).toBe(2);
    const combined = await page(`?tagCode=${tagCode}&categorySlug=${run}-news`);
    expect(combined.data.map((c) => c.id)).toEqual([posts.oldest]);
    expect((await page(`?tagCode=${run}-missing`)).data).toEqual([]);
  });

  it('pages the blog index by the channel’s posts-per-page, with category tiles on page 1 only', async () => {
    const setting = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.posts_per_page/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ scope: 'subset', salesChannelCodes: [channelA.code], value: 2 }),
    });
    expect(setting.statusCode, setting.body).toBe(200);
    try {
      const index = async (query: string) => {
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/blog/by-channel${query}`,
          headers: { 'x-sales-channel': channelA.code, 'x-blog-language': 'en-US' },
        });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as {
          data: {
            posts: { data: Card[]; pagination: Pagination };
            latestPosts: Card[];
            topLevelCategories: unknown[];
          };
        }).data;
      };
      const first = await index('');
      expect(first.posts.data.map((c) => c.id)).toEqual([posts.newest, posts.newer]);
      expect(first.posts.pagination).toEqual({ page: 1, perPage: 2, totalItems: 4, totalPages: 2 });
      expect(first.latestPosts).toEqual(first.posts.data);
      expect(first.topLevelCategories.length).toBeGreaterThan(0);
      const second = await index('?page=2');
      expect(second.posts.data.map((c) => c.id)).toEqual([posts.older, posts.oldest]);
      expect(second.topLevelCategories).toEqual([]);
    } finally {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/blog.posts_per_page/values?salesChannelCodes=${channelA.code}`,
        cookies: adminCookie,
      });
    }
  });
});
