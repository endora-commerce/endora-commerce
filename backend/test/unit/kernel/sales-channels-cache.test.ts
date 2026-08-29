import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  SalesChannelsCache,
  SALES_CHANNELS_CACHE_KEY_PREFIX,
  SALES_CHANNELS_LRU_TTL_MS,
  type CachedChannel,
} from '../../../src/kernel/sales-channels/sales-channels-cache.js';

/**
 * `SalesChannelsCache` is the second of the two caches that keep a per-process
 * layer in front of Redis, and it carried both defects the settings cache was
 * fixed for:
 *
 *   - `invalidateAll()` dropped the **local** layer first and the shared layer
 *     second, unmarked. A read landing in between re-pinned the pre-drop value
 *     from Redis into the LRU, so the invalidation undid itself — and a failed
 *     Redis drop left the shared layer holding the stale value with nothing
 *     recording that fact;
 *   - the LRU had no expiry, so a process that missed the
 *     `sales_channels.*_changed` notification served the pre-change channel
 *     until capacity evicted it.
 *
 * Both matter more now that the operator-facing cache clear reaches this cache
 * instead of only its Redis keys.
 */

const CODE = 'pl_retail';
const KEY = `${SALES_CHANNELS_CACHE_KEY_PREFIX}${CODE}`;

function channel(name: string): CachedChannel {
  return {
    id: 'ch-1',
    code: CODE,
    name: { en: name },
    active: true,
    isPublic: true,
    systemDefault: true,
    defaultLanguage: 'en',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    languages: ['en'],
    currencies: ['PLN'],
    version: 1,
  };
}

interface FakeRedisControls {
  redis: Redis;
  store: Map<string, string>;
  failDelWith: (err: Error | null) => void;
  blockDel: (blocked: boolean) => void;
  releaseDel: () => void;
}

function fakeRedis(): FakeRedisControls {
  const store = new Map<string, string>();
  let delError: Error | null = null;
  let blocked = false;
  let release: (() => void) | null = null;

  const redis = {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<'OK'> {
      store.set(key, value);
      return 'OK';
    },
    async scan(
      _cursor: string,
      _match: 'MATCH',
      pattern: string,
      _count: 'COUNT',
      _n: number,
    ): Promise<[string, string[]]> {
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...store.keys()].filter((k) => k.startsWith(prefix))];
    },
    async del(...keys: string[]): Promise<number> {
      if (blocked) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (delError) throw delError;
      let n = 0;
      for (const k of keys) if (store.delete(k)) n += 1;
      return n;
    },
  } as unknown as Redis;

  return {
    redis,
    store,
    failDelWith: (err) => {
      delError = err;
    },
    blockDel: (b) => {
      blocked = b;
    },
    releaseDel: () => {
      release?.();
      release = null;
    },
  };
}

describe('SalesChannelsCache invalidation', () => {
  it('drops both layers on a healthy invalidation and counts the shared keys', async () => {
    const { redis, store } = fakeRedis();
    const cache = new SalesChannelsCache(redis);

    await cache.set(CODE, channel('Retail'));
    expect(store.size).toBe(1);

    expect(await cache.invalidate(CODE)).toBe(1);
    expect(store.size).toBe(0);
    expect(await cache.get(CODE)).toEqual({ hit: false });
  });

  it('does not repopulate a layer from a read that raced the invalidation', async () => {
    const controls = fakeRedis();
    const cache = new SalesChannelsCache(controls.redis);

    await cache.set(CODE, channel('Retail'));

    controls.blockDel(true);
    const pending = cache.invalidateAll();

    // A read that resolved the pre-change row from Postgres and now tries to
    // cache it. Accepting it re-pins the value the operator just dropped.
    await cache.set(CODE, channel('Retail'));
    expect(await cache.get(CODE)).toEqual({ hit: false });

    controls.blockDel(false);
    controls.releaseDel();
    await pending;

    expect(await cache.get(CODE)).toEqual({ hit: false });
    expect(controls.store.size).toBe(0);
  });

  it('does not serve the shared layer after its drop failed', async () => {
    const controls = fakeRedis();
    const cache = new SalesChannelsCache(controls.redis);

    await cache.set(CODE, channel('Retail'));
    controls.failDelWith(new Error('Connection is closed.'));
    await expect(cache.invalidateAll()).rejects.toThrow('Connection is closed.');

    // Redis still holds the pre-invalidation channel; serving it is the defect.
    expect(controls.store.size).toBe(1);
    expect(await cache.get(CODE)).toEqual({ hit: false });

    // Redis is reachable again: the next read retires the outstanding drop
    // instead of leaving the channel uncached for the process lifetime.
    controls.failDelWith(null);
    expect(await cache.get(CODE)).toEqual({ hit: false });
    expect(controls.store.size).toBe(0);
  });

  it('keeps the "not found" sentinel out of the cache while an invalidation is pending', async () => {
    const controls = fakeRedis();
    const cache = new SalesChannelsCache(controls.redis);

    await cache.set(CODE, channel('Retail'));
    controls.blockDel(true);
    const pending = cache.invalidateAll();
    await cache.setNotFound(CODE);

    controls.blockDel(false);
    controls.releaseDel();
    await pending;

    expect(await cache.get(CODE)).toEqual({ hit: false });
  });
});

describe('SalesChannelsCache in-process staleness is bounded', () => {
  it('is bounded within a minute', () => {
    expect(SALES_CHANNELS_LRU_TTL_MS).toBeGreaterThanOrEqual(5_000);
    expect(SALES_CHANNELS_LRU_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it('serves the in-process layer inside the window', async () => {
    const controls = fakeRedis();
    let now = 0;
    const cache = new SalesChannelsCache(controls.redis, () => now);

    await cache.set(CODE, channel('Retail'));
    controls.store.set(KEY, JSON.stringify(channel('Renamed')));

    now += SALES_CHANNELS_LRU_TTL_MS - 1;
    const hit = await cache.get(CODE);
    expect(hit.hit && hit.value?.name['en']).toBe('Retail');
  });

  it('re-reads the shared layer once the entry is older than the TTL', async () => {
    const controls = fakeRedis();
    let now = 0;
    const cache = new SalesChannelsCache(controls.redis, () => now);

    await cache.set(CODE, channel('Retail'));
    controls.store.set(KEY, JSON.stringify(channel('Renamed')));

    now += SALES_CHANNELS_LRU_TTL_MS;
    const hit = await cache.get(CODE);
    expect(hit.hit && hit.value?.name['en']).toBe('Renamed');
  });
});
