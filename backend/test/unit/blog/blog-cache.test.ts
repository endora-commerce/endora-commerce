import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import {
  BLOG_CACHE_KEY_PREFIX,
  BlogCacheService,
} from '../../../src/modules/blog/services/blog-cache.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const samplePayload = { ok: true, slug: 'welcome' };

describe('BlogCacheService (T019)', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  afterAll(() => {
    redis.disconnect();
  });

  beforeEach(async () => {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${BLOG_CACHE_KEY_PREFIX}*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  });

  it('returns null on a miss', async () => {
    const cache = new BlogCacheService(redis);
    expect(await cache.get(BlogCacheService.composeIndexKey('default', 'en-US'))).toBeNull();
  });

  it('round-trips a payload through set + get on the index key', async () => {
    const cache = new BlogCacheService(redis);
    const key = BlogCacheService.composeIndexKey('default', 'en-US');
    await cache.set(key, samplePayload);
    expect(await cache.get(key)).toEqual(samplePayload);
  });

  it('uses the documented key-prefix scheme', () => {
    const indexKey = BlogCacheService.composeIndexKey('default', 'en-US');
    expect(indexKey).toBe(`${BLOG_CACHE_KEY_PREFIX}default:en-US:index`);

    const categoryKey = BlogCacheService.composeCategoryKey('default', 'en-US', 'guides', 1);
    expect(categoryKey).toBe(`${BLOG_CACHE_KEY_PREFIX}default:en-US:category:guides:p1`);

    const postKey = BlogCacheService.composePostKey('default', 'en-US', 'welcome');
    expect(postKey).toBe(`${BLOG_CACHE_KEY_PREFIX}default:en-US:post:welcome`);

    const tagKey = BlogCacheService.composeTagKey('default', 'en-US', 'comparison', 2);
    expect(tagKey).toBe(`${BLOG_CACHE_KEY_PREFIX}default:en-US:tag:comparison:p2`);
  });

  it('invalidateScope drops every key for one (channel, language) pair', async () => {
    const cache = new BlogCacheService(redis);
    await cache.set(BlogCacheService.composeIndexKey('default', 'en-US'), samplePayload);
    await cache.set(BlogCacheService.composeIndexKey('default', 'pl-PL'), samplePayload);
    await cache.invalidateScope('default', 'en-US');
    expect(await cache.get(BlogCacheService.composeIndexKey('default', 'en-US'))).toBeNull();
    expect(await cache.get(BlogCacheService.composeIndexKey('default', 'pl-PL'))).not.toBeNull();
  });

  it('invalidateChannel drops every key for one channel across every language', async () => {
    const cache = new BlogCacheService(redis);
    await cache.set(BlogCacheService.composeIndexKey('default', 'en-US'), samplePayload);
    await cache.set(BlogCacheService.composeIndexKey('default', 'pl-PL'), samplePayload);
    await cache.set(BlogCacheService.composeIndexKey('vip', 'en-US'), samplePayload);
    await cache.invalidateChannel('default');
    expect(await cache.get(BlogCacheService.composeIndexKey('default', 'en-US'))).toBeNull();
    expect(await cache.get(BlogCacheService.composeIndexKey('default', 'pl-PL'))).toBeNull();
    expect(await cache.get(BlogCacheService.composeIndexKey('vip', 'en-US'))).not.toBeNull();
  });

  it('invalidatePost drops the post key plus index/category/tag keys for the channel', async () => {
    const cache = new BlogCacheService(redis);
    const postKey = BlogCacheService.composePostKey('default', 'en-US', 'welcome');
    const indexKey = BlogCacheService.composeIndexKey('default', 'en-US');
    const catKey = BlogCacheService.composeCategoryKey('default', 'en-US', 'guides', 1);
    const tagKey = BlogCacheService.composeTagKey('default', 'en-US', 'news', 1);
    const otherChannelKey = BlogCacheService.composeIndexKey('vip', 'en-US');

    await cache.set(postKey, samplePayload);
    await cache.set(indexKey, samplePayload);
    await cache.set(catKey, samplePayload);
    await cache.set(tagKey, samplePayload);
    await cache.set(otherChannelKey, samplePayload);

    await cache.invalidatePost('default', 'welcome');

    expect(await cache.get(postKey)).toBeNull();
    expect(await cache.get(indexKey)).toBeNull();
    expect(await cache.get(catKey)).toBeNull();
    expect(await cache.get(tagKey)).toBeNull();
    expect(await cache.get(otherChannelKey)).not.toBeNull();
  });

  it('invalidateAll SCAN-deletes the whole namespace', async () => {
    const cache = new BlogCacheService(redis);
    await cache.set(BlogCacheService.composeIndexKey('default', 'en-US'), samplePayload);
    await cache.set(BlogCacheService.composeIndexKey('vip', 'pl-PL'), samplePayload);
    await cache.invalidateAll();
    expect(await cache.get(BlogCacheService.composeIndexKey('default', 'en-US'))).toBeNull();
    expect(await cache.get(BlogCacheService.composeIndexKey('vip', 'pl-PL'))).toBeNull();
  });

  it('disabled cache makes get/set no-ops', async () => {
    const cache = new BlogCacheService(redis, { enabled: false });
    const key = BlogCacheService.composeIndexKey('default', 'en-US');
    await cache.set(key, samplePayload);
    expect(await cache.get(key)).toBeNull();
  });
});
