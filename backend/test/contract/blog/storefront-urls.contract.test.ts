import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/`, FR-002, T008) — every URL a storefront
 * blog payload carries is composed by `blogPath`: under the language's path prefix
 * (feature 167) and the blog prefix, never hand-built.
 *
 * Two channels this file creates: `prefixed` prefixes its default language, `plain`
 * does not. Each channel's URLs are asserted only through that channel's requests,
 * so one channel's URL facts cannot leak into the other's answers (Constitution XII).
 */
describe('storefront blog URLs (feature 171, T008)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bu171-${randomUUID().slice(0, 8)}`;

  let prefixed: { id: string; code: string };
  let plain: { id: string; code: string };
  const categorySlug = `${run}-kat`;
  const postSlug = `${run}-wpis`;
  const tagCode = `${run}-diy`;

  const createdPostIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdTagIds: string[] = [];
  const createdChannelIds: string[] = [];

  async function createChannel(suffix: string, prefixDefaultLanguage: boolean) {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `${run}-${suffix}`,
      name: { 'pl-PL': `Blog URLs ${suffix}` },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
      prefixDefaultLanguage,
    });
    await em.persistAndFlush(channel);
    createdChannelIds.push(channel.id);
    return { id: channel.id, code: channel.code };
  }

  async function admin(method: 'POST' | 'PUT' | 'GET', url: string, body?: unknown) {
    const res = await h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function storefront(url: string, channelCode: string, language: string) {
    const res = await h.app.inject({
      method: 'GET',
      url,
      headers: { 'x-sales-channel': channelCode, 'x-blog-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Record<string, unknown> }).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    prefixed = await createChannel('pre', true);
    plain = await createChannel('pln', false);
    const channelIds = [prefixed.id, plain.id];
    const languages = ['pl-PL', 'en-US'];

    const category = await admin('POST', '/api/v1/admin/blog/categories', {
      parentId: null,
      name: { 'pl-PL': 'Kategoria', 'en-US': 'Category' },
      slug: categorySlug,
      salesChannelIds: channelIds,
      languages,
    });
    createdCategoryIds.push(category.id);

    const tag = await admin('POST', '/api/v1/admin/blog/tags', {
      name: { 'pl-PL': 'Zrób to sam', 'en-US': 'DIY' },
      code: tagCode,
    });
    createdTagIds.push(tag.id);

    const post = await admin('POST', '/api/v1/admin/blog/posts', {
      name: { 'pl-PL': 'Wpis', 'en-US': 'Post' },
      slug: postSlug,
      salesChannelIds: channelIds,
      languages,
      categoryIds: [category.id],
    });
    createdPostIds.push(post.id);
    await admin('PUT', `/api/v1/admin/blog/posts/${post.id}/tags`, { tagIds: [tag.id], version: post.version });
    const reloaded = await admin('GET', `/api/v1/admin/blog/posts/${post.id}`);
    await admin('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: reloaded.version });
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const id of createdPostIds) {
      for (const table of ['blog_post_tags', 'blog_post_categories', 'blog_post_languages', 'blog_post_sales_channels']) {
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
    for (const id of createdChannelIds) await connection.execute('delete from sales_channels where id = ?', [id]);
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    await teardownBackendServer(h);
  });

  type Card = { slug: string; url?: string };
  type Crumb = { url: string };

  /** Every URL the four storefront reads answer, in one channel and language. */
  async function urlsOf(channelCode: string, language: string): Promise<Record<string, string | undefined>> {
    const index = (await storefront('/api/v1/blog/by-channel', channelCode, language)) as {
      url?: string;
      latestPosts: Card[];
      topLevelCategories: Card[];
    };
    const list = (await h.app
      .inject({
        method: 'GET',
        url: '/api/v1/blog/posts?limit=24',
        headers: { 'x-sales-channel': channelCode, 'x-blog-language': language },
      })
      .then((r) => r.json())) as { data: Card[] };
    const post = (await storefront(`/api/v1/blog/by-slug?slug=${postSlug}`, channelCode, language)) as {
      post: { url?: string; breadcrumb: Crumb[]; tags: Card[] };
    };
    const category = (await storefront(`/api/v1/blog/by-slug?slug=${categorySlug}`, channelCode, language)) as {
      category: { url?: string; breadcrumb: Crumb[] };
      posts: { data: Card[] };
    };
    const tag = (await storefront(`/api/v1/blog/tag-by-code?code=${tagCode}`, channelCode, language)) as {
      tag: { url?: string };
      breadcrumb: Crumb[];
      posts: { data: Card[] };
    };
    return {
      index: index.url,
      indexCard: index.latestPosts.find((c) => c.slug === postSlug)?.url,
      indexTile: index.topLevelCategories.find((c) => c.slug === categorySlug)?.url,
      listCard: list.data.find((c) => c.slug === postSlug)?.url,
      post: post.post.url,
      postCrumbHome: post.post.breadcrumb[0]?.url,
      postCrumbCategory: post.post.breadcrumb[1]?.url,
      postCrumbSelf: post.post.breadcrumb.at(-1)?.url,
      postTag: post.post.tags[0]?.url,
      category: category.category.url,
      categoryCrumbSelf: category.category.breadcrumb.at(-1)?.url,
      categoryCard: category.posts.data.find((c) => c.slug === postSlug)?.url,
      tag: tag.tag.url,
      tagCrumbSelf: tag.breadcrumb.at(-1)?.url,
      tagCard: tag.posts.data.find((c) => c.slug === postSlug)?.url,
    };
  }

  function expected(base: string) {
    return {
      index: base,
      indexCard: `${base}/${postSlug}`,
      indexTile: `${base}/${categorySlug}`,
      listCard: `${base}/${postSlug}`,
      post: `${base}/${postSlug}`,
      postCrumbHome: base,
      postCrumbCategory: `${base}/${categorySlug}`,
      postCrumbSelf: `${base}/${postSlug}`,
      postTag: `${base}/tag/${tagCode}`,
      category: `${base}/${categorySlug}`,
      categoryCrumbSelf: `${base}/${categorySlug}`,
      categoryCard: `${base}/${postSlug}`,
      tag: `${base}/tag/${tagCode}`,
      tagCrumbSelf: `${base}/tag/${tagCode}`,
      tagCard: `${base}/${postSlug}`,
    };
  }

  it('prefixes every URL with the language when the channel prefixes its default language', async () => {
    expect(await urlsOf(prefixed.code, 'pl-PL')).toEqual(expected('/pl/blog'));
    expect(await urlsOf(prefixed.code, 'en-US')).toEqual(expected('/en/blog'));
  });

  it('leaves the default language unprefixed when the channel does not prefix it', async () => {
    expect(await urlsOf(plain.code, 'pl-PL')).toEqual(expected('/blog'));
    expect(await urlsOf(plain.code, 'en-US')).toEqual(expected('/en/blog'));
  });

  it('matches a request language to the channel language it names (en → en-US)', async () => {
    expect((await urlsOf(prefixed.code, 'en')).post).toBe(`/en/blog/${postSlug}`);
  });
});
