import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Integration test for the blog Settings precedence + url_prefix routing
 * (T087 / R7). Verifies:
 *
 *   - per-channel `blog.url_prefix` overrides the global default;
 *   - per-channel `blog.enabled = false` 404s the namespace in that
 *     channel only (other channels keep working);
 *   - resetting the per-channel value falls back to the documented
 *     default (`'blog'`).
 */
describe('blog Settings precedence + url_prefix routing (T087)', () => {
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

  async function setSubset(code: string, value: unknown): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        scope: 'subset',
        salesChannelCodes: [defaultChannelCode],
        value,
      }),
    });
    if (res.statusCode !== 200) {
      throw new Error(`set ${code} failed: ${res.statusCode} ${res.body}`);
    }
  }

  async function resetSubset(code: string): Promise<void> {
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/settings/${code}/values?salesChannelCodes=${defaultChannelCode}`,
      cookies: adminCookie,
    });
  }

  it('per-channel url_prefix overrides the global default in the resolver', async () => {
    await setSubset('blog.url_prefix', 'aktualnosci');
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/blog/by-channel',
        headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
      });
      expect(res.statusCode).toBe(200);
      const body = (res.json() as { data: { urlPrefix: string } }).data;
      expect(body.urlPrefix).toBe('aktualnosci');
    } finally {
      await resetSubset('blog.url_prefix');
      if (h.blog.cache) await h.blog.cache.invalidateAll();
    }
  });

  it('after reset, the resolver returns the documented default `blog`', async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/blog/by-channel',
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { urlPrefix: string } }).data.urlPrefix).toBe('blog');
  });

  it('per-channel blog.enabled=false returns 404 BLOG_DISABLED', async () => {
    await setSubset('blog.enabled', false);
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
      await resetSubset('blog.enabled');
      if (h.blog.cache) await h.blog.cache.invalidateAll();
    }
  });

  it('per-channel posts_per_page overrides the default page size on the category view', async () => {
    await setSubset('blog.posts_per_page', 7);
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    try {
      // Use the seeded `Default` category — it's always assigned to the
      // default channel.
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/blog/by-slug?slug=default',
        headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
      });
      expect(res.statusCode).toBe(200);
      const body = (res.json() as {
        data: { kind: string; posts: { pagination: { perPage: number } } };
      }).data;
      expect(body.kind).toBe('category');
      expect(body.posts.pagination.perPage).toBe(7);
    } finally {
      await resetSubset('blog.posts_per_page');
      if (h.blog.cache) await h.blog.cache.invalidateAll();
    }
  });
});
