import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { BlogCacheService } from '../../../src/modules/blog/services/blog-cache.js';

/**
 * Integration test for the storefront cache (T089 / R9). Verifies:
 *
 *   - the second hit reads from Redis (assert by checking the cached
 *     payload directly on the BlogCacheService);
 *   - publishing a Post invalidates the post key + the index;
 *   - changing a `blog.*` setting wipes the channel keyspace via the
 *     EventBus subscription (T091).
 */
describe('blog storefront cache (T089)', () => {
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
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function fetchIndex(): Promise<{ statusCode: number; body: unknown }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/blog/by-channel',
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  it('caches the index payload after the first read', async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    expect(h.blog.cache).toBeDefined();
    const indexKey = BlogCacheService.composeIndexKey(defaultChannelCode, 'en-US');
    expect(await h.blog.cache!.get(indexKey)).toBeNull();

    const first = await fetchIndex();
    expect(first.statusCode).toBe(200);

    const cached = await h.blog.cache!.get(indexKey);
    expect(cached).not.toBeNull();
  });

  it('invalidates the cache when a post is published (R9 — coarse invalidation)', async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    // Warm the index cache.
    await fetchIndex();
    const indexKey = BlogCacheService.composeIndexKey(defaultChannelCode, 'en-US');
    expect(await h.blog.cache!.get(indexKey)).not.toBeNull();

    // Publish a post.
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': `Cache Inv ${Date.now()}` },
        slug: `cache-inv-${Date.now()}`,
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

    // The index entry was wiped by the publish path (which calls
    // invalidatePost → invalidates the channel's index keys).
    expect(await h.blog.cache!.get(indexKey)).toBeNull();
  });

  it('changing a blog.* setting via the admin route wipes the cache namespace (T091)', async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    await fetchIndex();
    const indexKey = BlogCacheService.composeIndexKey(defaultChannelCode, 'en-US');
    expect(await h.blog.cache!.get(indexKey)).not.toBeNull();

    const setOff = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/blog.latest_count/value',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        scope: 'subset',
        salesChannelCodes: [defaultChannelCode],
        value: 9,
      }),
    });
    expect(setOff.statusCode).toBe(200);

    // The eventBus subscriber (R9) wipes the cache asynchronously. Give
    // the bus a microtick to flush.
    await new Promise((r) => setImmediate(r));

    expect(await h.blog.cache!.get(indexKey)).toBeNull();

    // Restore.
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/settings/blog.latest_count/values?salesChannelCodes=${defaultChannelCode}`,
      cookies: adminCookie,
    });
  });
});
