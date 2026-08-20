import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('storefront blog index contract (T048)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

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
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  async function createPost(slug: string): Promise<{ id: string; version: number }> {
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
        categoryIds: [],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function publish(post: { id: string; version: number }): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${post.id}/publish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: post.version }),
    });
    expect(res.statusCode).toBe(200);
  }

  it('returns urlPrefix + latestPosts + topLevelCategories with the seeded Default visible', async () => {
    const slug = `index-published-${Date.now()}`;
    const post = await createPost(slug);
    await publish(post);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/blog/by-channel',
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: {
        urlPrefix: string;
        latestPosts: Array<{ id: string; slug: string }>;
        topLevelCategories: Array<{ slug: string }>;
      };
    }).data;
    expect(body.urlPrefix).toBe('blog');
    expect(body.latestPosts.some((p) => p.id === post.id)).toBe(true);
    expect(body.latestPosts.some((p) => p.slug === slug)).toBe(true);
    expect(body.topLevelCategories.some((c) => c.slug === 'default')).toBe(true);
  });

  it('omits draft posts from the latest list', async () => {
    const post = await createPost(`index-draft-${Date.now()}`);
    // Do not publish.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/blog/by-channel',
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: { latestPosts: Array<{ id: string }> };
    }).data;
    expect(body.latestPosts.find((p) => p.id === post.id)).toBeUndefined();
  });

  it('returns 404 BLOG_DISABLED when blog.enabled is false in the channel', async () => {
    // Toggle blog.enabled = false via the public admin endpoint. The
    // route handles the audit-context + cache-invalidation dance for us.
    const setOff = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.enabled/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        scope: 'subset',
        salesChannelCodes: [defaultChannelCode],
        value: false,
      }),
    });
    if (setOff.statusCode !== 200 && setOff.statusCode !== 204) {
      throw new Error(
        `setting blog.enabled failed: ${setOff.statusCode} ${setOff.body}`,
      );
    }
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/blog/by-channel',
        headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.BLOG_DISABLED,
      );
    } finally {
      // Restore for subsequent tests.
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/blog.enabled/values?salesChannelCodes=${defaultChannelCode}`,
        cookies: adminCookie,
      });
      if (h.blog.cache) await h.blog.cache.invalidateAll();
    }
  });
});
