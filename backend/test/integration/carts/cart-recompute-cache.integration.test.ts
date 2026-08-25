import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CartRecomputeCache,
  type CachedCartRecompute,
} from '../../../../packages/modules/carts/src/backend/services/cart-recompute-cache.js';

/**
 * T020 (feature 027) — Redis-backed CartRecomputeCache.
 *
 * Exercises the cache against a real Redis instance (Principle IV — the
 * existing `enable-restores.integration.test.ts` uses the same path).
 */

describe('CartRecomputeCache — TTL, get/put, invalidate', () => {
  let redis: Redis;
  let cache: CartRecomputeCache;
  const testCartId = '00000000-0000-4000-8000-00000000ca01';

  beforeAll(async () => {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    cache = new CartRecomputeCache(redis, { ttlSeconds: 2 });
  });

  beforeEach(async () => {
    await redis.del(CartRecomputeCache.keyFor(testCartId));
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('returns null on cold get', async () => {
    expect(await cache.get(testCartId)).toBeNull();
  });

  it('returns the stored payload after put', async () => {
    const payload: CachedCartRecompute = {
      cartId: testCartId,
      lines: [
        {
          cartItemId: '00000000-0000-4000-8000-000000000c01',
          unitPrice: { amount: 19.99, currency: 'PLN' },
          resolvedAt: new Date().toISOString(),
        },
      ],
      resolvedAt: new Date().toISOString(),
    };
    await cache.put(testCartId, payload);
    const got = await cache.get(testCartId);
    expect(got).not.toBeNull();
    expect(got?.cartId).toBe(testCartId);
    expect(got?.lines[0]?.unitPrice.amount).toBe(19.99);
  });

  it('invalidate deletes the cache entry', async () => {
    const payload: CachedCartRecompute = {
      cartId: testCartId,
      lines: [],
      resolvedAt: new Date().toISOString(),
    };
    await cache.put(testCartId, payload);
    await cache.invalidate(testCartId);
    expect(await cache.get(testCartId)).toBeNull();
  });

  it('expires the entry after the configured TTL', async () => {
    const payload: CachedCartRecompute = {
      cartId: testCartId,
      lines: [],
      resolvedAt: new Date().toISOString(),
    };
    await cache.put(testCartId, payload);
    expect(await cache.get(testCartId)).not.toBeNull();
    // TTL is 2 s in this test; wait 2.2 s.
    await new Promise((r) => setTimeout(r, 2200));
    expect(await cache.get(testCartId)).toBeNull();
  }, 5_000);

  it('cleans up corrupt cache entries on read', async () => {
    await redis.set(CartRecomputeCache.keyFor(testCartId), 'not-json{{');
    expect(await cache.get(testCartId)).toBeNull();
    // The corrupt entry was deleted.
    expect(await redis.get(CartRecomputeCache.keyFor(testCartId))).toBeNull();
  });

  it('disabled cache is a no-op', async () => {
    const disabled = new CartRecomputeCache(redis, { enabled: false });
    await disabled.put(testCartId, {
      cartId: testCartId,
      lines: [],
      resolvedAt: new Date().toISOString(),
    });
    expect(await disabled.get(testCartId)).toBeNull();
  });
});
