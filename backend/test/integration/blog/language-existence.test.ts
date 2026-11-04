import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 171 (US3, FR-020/FR-021, OR-7, T042) — a post or a category exists in a
 * language when that language is assigned to it. Requested in another language it is
 * a 404, and no list in that language shows it: the index, `/posts`, a category, a
 * tag, related posts, a card's category chip and a post's breadcrumb.
 */
describe('blog language existence (feature 171, T042)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bl171-${randomUUID().slice(0, 8)}`;
  let channel: { id: string; code: string };
  const ids = { posts: [] as string[], categories: [] as string[], tags: [] as string[] };
  let tagCode: string;

  async function admin(method: 'POST' | 'PUT' | 'GET', url: string, body?: unknown) {
    const res = await h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function createPost(slug: string, languages: string[], categoryIds: string[], tagIds: string[]) {
    const names: Record<string, string> = { 'pl-PL': `Wpis ${slug}`, 'en-US': `Post ${slug}` };
    const post = await admin('POST', '/api/v1/admin/blog/posts', {
      name: Object.fromEntries(languages.map((l) => [l, names[l]])),
      slug,
      salesChannelIds: [channel.id],
      languages,
      categoryIds,
    });
    ids.posts.push(post.id);
    await admin('PUT', `/api/v1/admin/blog/posts/${post.id}/tags`, { tagIds, version: post.version });
    const fresh = await admin('GET', `/api/v1/admin/blog/posts/${post.id}`);
    await admin('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: fresh.version });
    return post.id;
  }

  async function read(url: string, language: string) {
    return h.app.inject({ method: 'GET', url, headers: { 'x-sales-channel': channel.code, 'x-blog-language': language } });
  }

  const slugs = {
    polishOnly: `${run}-tylko-pl`,
    both: `${run}-oba`,
    polishCategory: `${run}-kat-pl`,
  };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-ch`,
      name: { 'pl-PL': 'Języki' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(created);
    channel = { id: created.id, code: created.code };

    const category = await admin('POST', '/api/v1/admin/blog/categories', {
      parentId: null,
      name: { 'pl-PL': 'Kategoria PL' },
      slug: slugs.polishCategory,
      salesChannelIds: [channel.id],
      languages: ['pl-PL'],
    });
    ids.categories.push(category.id);
    tagCode = `${run}-tag`;
    const tag = await admin('POST', '/api/v1/admin/blog/tags', { name: { 'pl-PL': 'Tag', 'en-US': 'Tag' }, code: tagCode });
    ids.tags.push(tag.id);

    await createPost(slugs.polishOnly, ['pl-PL'], [], [tag.id]);
    await createPost(slugs.both, ['pl-PL', 'en-US'], [category.id], [tag.id]);
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const id of ids.posts) {
      for (const table of ['blog_post_tags', 'blog_post_categories', 'blog_post_languages', 'blog_post_sales_channels']) {
        await connection.execute(`delete from ${table} where blog_post_id = ?`, [id]);
      }
      await connection.execute('delete from blog_posts where id = ?', [id]);
    }
    for (const id of ids.categories) {
      await connection.execute('delete from blog_category_languages where blog_category_id = ?', [id]);
      await connection.execute('delete from blog_category_sales_channels where blog_category_id = ?', [id]);
      await connection.execute('delete from blog_categories where id = ?', [id]);
    }
    for (const id of ids.tags) await connection.execute('delete from blog_tags where id = ?', [id]);
    await connection.execute('delete from blog_url_prefixes where sales_channel_id = ?', [channel.id]);
    await connection.execute('delete from sales_channels where id = ?', [channel.id]);
    await teardownBackendServer(h);
  });

  type Card = { slug: string };

  it('answers 404 for a post or a category requested in a language it is not assigned to', async () => {
    expect((await read(`/api/v1/blog/by-slug?slug=${slugs.polishOnly}`, 'pl-PL')).statusCode).toBe(200);
    expect((await read(`/api/v1/blog/by-slug?slug=${slugs.polishOnly}`, 'en-US')).statusCode).toBe(404);
    expect((await read(`/api/v1/blog/by-slug?slug=${slugs.polishCategory}`, 'pl-PL')).statusCode).toBe(200);
    expect((await read(`/api/v1/blog/by-slug?slug=${slugs.polishCategory}`, 'en-US')).statusCode).toBe(404);
  });

  it('lists the post in no list of another language', async () => {
    const slugsIn = async (url: string, pick: (body: unknown) => Card[]) =>
      pick((await read(url, 'en-US')).json()).map((c) => c.slug);
    const index = await slugsIn('/api/v1/blog/by-channel', (b) => (b as { data: { latestPosts: Card[] } }).data.latestPosts);
    const list = await slugsIn('/api/v1/blog/posts?perPage=24', (b) => (b as { data: Card[] }).data);
    const tag = await slugsIn(`/api/v1/blog/tag-by-code?code=${tagCode}`, (b) => (b as { data: { posts: { data: Card[] } } }).data.posts.data);
    for (const slugsSeen of [index, list, tag]) {
      expect(slugsSeen).toContain(slugs.both);
      expect(slugsSeen).not.toContain(slugs.polishOnly);
    }
    const tagPl = (await read(`/api/v1/blog/tag-by-code?code=${tagCode}`, 'pl-PL')).json() as {
      data: { posts: { data: Card[]; pagination: { totalItems: number } } };
    };
    expect(tagPl.data.posts.pagination.totalItems).toBe(2);
  });

  it('offers a category of another language as no tile, chip or breadcrumb', async () => {
    const index = (await read('/api/v1/blog/by-channel', 'en-US')).json() as { data: { topLevelCategories: Card[] } };
    expect(index.data.topLevelCategories.map((c) => c.slug)).not.toContain(slugs.polishCategory);
    const post = (await read(`/api/v1/blog/by-slug?slug=${slugs.both}`, 'en-US')).json() as {
      data: { post: { categories: Card[]; breadcrumb: Array<{ url: string }> } };
    };
    expect(post.data.post.categories).toEqual([]);
    expect(post.data.post.breadcrumb.some((c) => c.url.endsWith(slugs.polishCategory))).toBe(false);
    const list = (await read('/api/v1/blog/posts?perPage=24', 'en-US')).json() as {
      data: Array<Card & { primaryCategorySlug: string | null }>;
    };
    expect(list.data.find((c) => c.slug === slugs.both)?.primaryCategorySlug).toBeNull();
  });

  it('matches a request language to the channel language it names (en → en-US)', async () => {
    expect((await read(`/api/v1/blog/by-slug?slug=${slugs.both}`, 'en')).statusCode).toBe(200);
    expect((await read(`/api/v1/blog/by-slug?slug=${slugs.polishOnly}`, 'en')).statusCode).toBe(404);
  });
});
