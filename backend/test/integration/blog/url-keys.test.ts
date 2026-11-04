import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 171 (US4, FR-030…FR-034, T052/T053) — a post or a category has a URL key
 * per language. A key resolves only in its own language; a replaced key and the base
 * slug of a language that has its own key redirect (while `seo` is present); a key is
 * unique per (channel, language) across posts and categories together; a key another
 * entity holds as a redirect is taken over only on confirmation; every write is one
 * audited Command.
 */
describe('blog per-language URL keys (feature 171, T052)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bk171-${randomUUID().slice(0, 8)}`;
  let channel: { id: string; code: string };
  let other: { id: string; code: string };
  const ids = { posts: [] as string[], categories: [] as string[] };
  let postId: string;
  let categoryId: string;
  const slug = `${run}-wiertarki`;
  const categorySlug = `${run}-narzedzia`;

  async function call(method: 'POST' | 'PUT' | 'GET' | 'DELETE', url: string, body?: unknown) {
    return h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
    });
  }

  async function ok(method: 'POST' | 'PUT' | 'GET', url: string, body?: unknown) {
    const res = await call(method, url, body);
    expect(res.statusCode, res.body).toBeLessThan(300);
    return (res.json() as { data: Record<string, unknown> & { id: string; version: number } }).data;
  }

  async function createChannel(suffix: string) {
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-${suffix}`,
      name: { 'pl-PL': `Klucze ${suffix}` },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
      prefixDefaultLanguage: true,
    });
    await em.persistAndFlush(created);
    return { id: created.id, code: created.code };
  }

  async function createPost(postSlug: string, channelIds: string[]) {
    const post = await ok('POST', '/api/v1/admin/blog/posts', {
      name: { 'pl-PL': 'Wiertarki', 'en-US': 'Drills' },
      slug: postSlug,
      salesChannelIds: channelIds,
      languages: ['pl-PL', 'en-US'],
      categoryIds: [],
    });
    ids.posts.push(post.id);
    await ok('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: post.version });
    return post.id;
  }

  async function version(kind: 'posts' | 'categories', id: string) {
    return (await ok('GET', `/api/v1/admin/blog/${kind}/${id}`)).version;
  }

  async function putKeys(kind: 'posts' | 'categories', id: string, body: Record<string, unknown>) {
    return call('PUT', `/api/v1/admin/blog/${kind}/${id}/url-keys`, { ...body, version: await version(kind, id) });
  }

  async function bySlug(key: string, language: string, channelCode = channel.code) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${key}`,
      headers: { 'x-sales-channel': channelCode, 'x-blog-language': language },
    });
  }

  type Resolution = { kind: string; path?: string; post?: { id: string; url: string; alternates: unknown }; category?: { id: string } };
  const resolution = async (key: string, language: string) => {
    const res = await bySlug(key, language);
    return res.statusCode === 200 ? (res.json() as { data: Resolution }).data : res.statusCode;
  };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    channel = await createChannel('a');
    other = await createChannel('b');
    postId = await createPost(slug, [channel.id]);
    const category = await ok('POST', '/api/v1/admin/blog/categories', {
      parentId: null,
      name: { 'pl-PL': 'Narzędzia', 'en-US': 'Tools' },
      slug: categorySlug,
      salesChannelIds: [channel.id],
      languages: ['pl-PL', 'en-US'],
    });
    categoryId = category.id;
    ids.categories.push(categoryId);
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const id of [...ids.posts, ...ids.categories]) {
      await connection.execute('delete from blog_url_keys where entity_id = ?', [id]);
      await connection.execute('delete from blog_url_redirects where entity_id = ?', [id]);
    }
    for (const id of ids.posts) {
      for (const table of ['blog_post_categories', 'blog_post_languages', 'blog_post_sales_channels']) {
        await connection.execute(`delete from ${table} where blog_post_id = ?`, [id]);
      }
      await connection.execute('delete from blog_posts where id = ?', [id]);
    }
    for (const id of ids.categories) {
      await connection.execute('delete from blog_category_languages where blog_category_id = ?', [id]);
      await connection.execute('delete from blog_category_sales_channels where blog_category_id = ?', [id]);
      await connection.execute('delete from blog_categories where id = ?', [id]);
    }
    for (const c of [channel, other]) {
      await connection.execute('delete from blog_url_prefixes where sales_channel_id = ?', [c.id]);
      await connection.execute('delete from sales_channels where id = ?', [c.id]);
    }
    await teardownBackendServer(h);
  });

  it('serves a language key only in its language, and redirects the base slug of that language', async () => {
    const put = await putKeys('posts', postId, { keys: [{ languageCode: 'en-US', key: `${run}-drills` }] });
    expect(put.statusCode, put.body).toBe(200);

    const english = await resolution(`${run}-drills`, 'en-US');
    expect(english).toMatchObject({ kind: 'post', post: { id: postId, url: `/en/blog/${run}-drills` } });
    expect(await resolution(slug, 'en-US')).toEqual({ kind: 'redirect', path: `/en/blog/${run}-drills`, permanent: true });
    expect(await resolution(slug, 'pl-PL')).toMatchObject({ kind: 'post', post: { url: `/pl/blog/${slug}` } });
    expect(await resolution(`${run}-drills`, 'pl-PL')).toBe(404);
  });

  it('answers the post’s other languages as its alternates', async () => {
    const english = (await resolution(`${run}-drills`, 'en-US')) as Resolution;
    expect(english.post!.alternates).toEqual({
      languages: { 'pl-PL': `/pl/blog/${slug}`, 'en-US': `/en/blog/${run}-drills` },
      xDefault: `/blog/${slug}`,
    });
  });

  it('turns a replaced key into a redirect that never chains, and lists it', async () => {
    const put = await putKeys('posts', postId, { keys: [{ languageCode: 'en-US', key: `${run}-drills-2` }] });
    expect(put.statusCode, put.body).toBe(200);
    expect(await resolution(`${run}-drills`, 'en-US')).toEqual({ kind: 'redirect', path: `/en/blog/${run}-drills-2`, permanent: true });
    expect(await resolution(slug, 'en-US')).toEqual({ kind: 'redirect', path: `/en/blog/${run}-drills-2`, permanent: true });
    const keys = await ok('GET', `/api/v1/admin/blog/posts/${postId}/url-keys`);
    expect((keys['keys'] as unknown[])).toEqual([{ languageCode: 'en-US', key: `${run}-drills-2` }]);
    expect(((keys['redirects'] as Array<{ key: string }>) ?? []).map((r) => r.key).sort()).toEqual([`${run}-drills`, slug].sort());
  });

  it('keeps a key unique per channel and language across posts and categories', async () => {
    const taken = await putKeys('categories', categoryId, { keys: [{ languageCode: 'en-US', key: `${run}-drills-2` }] });
    expect(taken.statusCode, taken.body).toBe(409);
    expect((taken.json() as { error: { code: string } }).error.code).toBe('BLOG_URL_KEY_TAKEN');

    // The same key in another language is free.
    const polish = await putKeys('categories', categoryId, { keys: [{ languageCode: 'pl-PL', key: `${run}-drills-2` }] });
    expect(polish.statusCode, polish.body).toBe(200);

    // Another channel's post may hold it: the key is not served there.
    const elsewhere = await createPost(`${run}-inne`, [other.id]);
    const free = await putKeys('posts', elsewhere, { keys: [{ languageCode: 'en-US', key: `${run}-drills-2` }] });
    expect(free.statusCode, free.body).toBe(200);
  });

  it('takes over another entity’s redirect only on confirmation', async () => {
    const refused = await putKeys('categories', categoryId, { keys: [{ languageCode: 'en-US', key: `${run}-drills` }] });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED');

    const confirmed = await putKeys('categories', categoryId, {
      keys: [{ languageCode: 'en-US', key: `${run}-drills` }],
      confirmTakeover: [{ languageCode: 'en-US', key: `${run}-drills` }],
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await resolution(`${run}-drills`, 'en-US')).toMatchObject({ kind: 'category', category: { id: categoryId } });
  });

  it('records each write as one audited Command', async () => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as n from "audit_log_entries" where "action" = 'blog.url_keys.update' and "object_id" = ?`, [
        postId,
      ])) as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(2);
  });

  it('serves no redirect while seo is off', async () => {
    await withModuleOff('seo', 'deactivated', async () => {
      if (h.blog.cache) await h.blog.cache.invalidateAll();
      expect(await resolution(slug, 'en-US')).toBe(404);
    });
  });

  it('forgets a redirect, and answers an unknown one with 404', async () => {
    const keys = await ok('GET', `/api/v1/admin/blog/posts/${postId}/url-keys`);
    const redirect = (keys['redirects'] as Array<{ id: string; key: string }>).find((r) => r.key === slug)!;
    const removed = await call('DELETE', `/api/v1/admin/blog/posts/${postId}/url-redirects/${redirect.id}`);
    expect(removed.statusCode, removed.body).toBe(204);
    const after = await ok('GET', `/api/v1/admin/blog/posts/${postId}/url-keys`);
    expect((after['redirects'] as Array<{ id: string }>).map((r) => r.id)).not.toContain(redirect.id);
    // The base slug of a language with a key of its own still redirects (data-model §5,
    // step 4): a link from before the key existed keeps working whatever the list holds.
    expect(await resolution(slug, 'en-US')).toEqual({ kind: 'redirect', path: `/en/blog/${run}-drills-2`, permanent: true });
    const missing = await call('DELETE', `/api/v1/admin/blog/posts/${postId}/url-redirects/${redirect.id}`);
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe('BLOG_URL_REDIRECT_NOT_FOUND');
  });
});
