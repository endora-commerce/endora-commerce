import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #1011 — the storefront blog reads its language from the whole `Accept-Language` header
 * through `requestScopeLanguage`: q-weighted, each tag matched against the channel's languages
 * (exact, then base language), else the channel's default. Before, it took the header's first
 * entry, so `en;q=0.2, pl-PL;q=0.9` was read as English. `x-blog-language` still wins.
 *
 * The run's own channel offers `en-US` (default) and `pl-PL`. Its post is written in `pl-PL`
 * only, and a post exists only in its languages (feature 171), so the post is found exactly when
 * the request resolves to `pl-PL`.
 */
describe('Storefront blog language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bl1011-${randomUUID().slice(0, 8)}`;
  const postSlug = `${run}-wpis`;
  let channel: { id: string; code: string } | undefined;
  let postId: string | undefined;

  async function admin(method: 'POST' | 'GET', url: string, body?: unknown) {
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

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: run,
      name: { 'en-US': `Blog Accept-Language ${run}` },
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persist(created).flush();
    channel = { id: created.id, code: created.code };

    const post = await admin('POST', '/api/v1/admin/blog/posts', {
      name: { 'pl-PL': 'Wpis' },
      slug: postSlug,
      salesChannelIds: [channel.id],
      languages: ['pl-PL'],
      categoryIds: [],
    });
    postId = post.id;
    await admin('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: post.version });
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    if (h) {
      const connection = h.em().getConnection();
      if (postId) {
        for (const table of ['blog_post_tags', 'blog_post_categories', 'blog_post_languages', 'blog_post_sales_channels']) {
          await connection.execute(`delete from ${table} where blog_post_id = ?`, [postId]);
        }
        await connection.execute('delete from blog_posts where id = ?', [postId]);
      }
      if (channel) await connection.execute('delete from sales_channels where id = ?', [channel.id]);
      if (h.blog.cache) await h.blog.cache.invalidateAll();
      await teardownBackendServer(h);
    }
  });

  async function bySlug(headers: Record<string, string>): Promise<{ statusCode: number; slug: string | undefined }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${postSlug}`,
      headers: { 'x-sales-channel': channel!.code, ...headers },
    });
    const body = res.statusCode === 200 ? (res.json() as { data: { post?: { slug: string } } }).data : undefined;
    return { statusCode: res.statusCode, slug: body?.post?.slug };
  }

  async function listed(acceptLanguage: string): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/blog/posts?limit=24',
      headers: { 'x-sales-channel': channel!.code, 'accept-language': acceptLanguage },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ slug: string }> }).data.map((card) => card.slug);
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` reads the Polish post', async () => {
    expect(await bySlug({ 'accept-language': 'en;q=0.2, pl-PL;q=0.9' })).toEqual({ statusCode: 200, slug: postSlug });
    expect(await listed('en;q=0.2, pl-PL;q=0.9')).toContain(postSlug);
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await bySlug({ 'accept-language': 'pl' })).toEqual({ statusCode: 200, slug: postSlug });
    expect(await listed('pl')).toContain(postSlug);
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await bySlug({ 'accept-language': 'de-DE, pl;q=0.5' })).toEqual({ statusCode: 200, slug: postSlug });
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect((await bySlug({ 'accept-language': 'de-DE' })).statusCode).toBe(404);
    expect(await listed('de-DE')).not.toContain(postSlug);
  });

  it('keeps `x-blog-language` ahead of `Accept-Language`', async () => {
    expect((await bySlug({ 'x-blog-language': 'en-US', 'accept-language': 'pl-PL' })).statusCode).toBe(404);
  });
});
