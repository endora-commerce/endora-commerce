import { describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import {
  SettingsCache,
  SETTINGS_CACHE_KEY_PREFIX,
  SETTINGS_LRU_TTL_MS,
} from '../../../src/kernel/settings/settings-cache.js';

/**
 * `SettingsCache` invalidation under failure and under concurrency.
 *
 * The cache has two layers with very different lifetimes: a per-process LRU
 * and a shared Redis namespace. An invalidation that drops one and not the
 * other does not degrade to "slower but correct" — it degrades to serving the
 * pre-invalidation value from whichever layer survived, and re-pinning it into
 * the layer that was dropped. That is the shape behind the flaky
 * `test/integration/mfa/customer-oauth.test.ts` → "refuses to start when the
 * provider is disabled": the invalidation raised
 * `Error: Connection is closed.` on the shared layer, and the next read was
 * served the stale `true`.
 */

const CHANNEL = 'channel-1';

interface FakeRedisControls {
  redis: Redis;
  store: Map<string, string>;
  /** Reject every `del` with the given error until cleared. */
  failDelWith: (err: Error | null) => void;
  /** Hold every `del` until `releaseDel()` is called. */
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

describe('SettingsCache invalidation', () => {
  it('drops both layers on a healthy invalidation', async () => {
    const { redis, store } = fakeRedis();
    const cache = new SettingsCache(redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);
    expect(store.size).toBe(1);

    await cache.invalidate('mfa.storefront.google_enabled');

    expect(store.size).toBe(0);
    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
  });

  it('does not serve the pre-invalidation value while the shared drop is in flight', async () => {
    const controls = fakeRedis();
    const cache = new SettingsCache(controls.redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);

    // The EventBus dispatches `settings.value_changed` fire-and-forget, so a
    // read can land while the shared drop is still on the wire.
    controls.blockDel(true);
    const pending = cache.invalidate('mfa.storefront.google_enabled');

    const during = await cache.get('mfa.storefront.google_enabled', CHANNEL);
    expect(during).toEqual({ hit: false });

    controls.blockDel(false);
    controls.releaseDel();
    await pending;

    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
  });

  it('does not repopulate a layer from a read that raced the invalidation', async () => {
    const controls = fakeRedis();
    const cache = new SettingsCache(controls.redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);

    controls.blockDel(true);
    const pending = cache.invalidate('mfa.storefront.google_enabled');

    // A read that started before the write resolved `true` from Postgres and
    // now tries to cache it. Accepting it would re-pin the pre-invalidation
    // value into both layers.
    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);

    controls.blockDel(false);
    controls.releaseDel();
    await pending;

    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
    expect(controls.store.size).toBe(0);
  });

  it('does not serve the shared layer after its drop failed', async () => {
    const controls = fakeRedis();
    const cache = new SettingsCache(controls.redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);

    controls.failDelWith(new Error('Connection is closed.'));
    await expect(cache.invalidate('mfa.storefront.google_enabled')).rejects.toThrow(
      'Connection is closed.',
    );

    // The shared layer still holds `true`; serving it (and re-pinning it into
    // the LRU) is exactly the flake. Fail closed: read through to Postgres.
    expect(controls.store.size).toBe(1);
    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
  });

  it('resumes caching once the shared layer accepts the drop again', async () => {
    const controls = fakeRedis();
    const cache = new SettingsCache(controls.redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);
    controls.failDelWith(new Error('Connection is closed.'));
    await expect(cache.invalidate('mfa.storefront.google_enabled')).rejects.toThrow();

    // Redis is reachable again: the next read retires the outstanding drop
    // instead of leaving the code uncached for the process lifetime.
    controls.failDelWith(null);
    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
    expect(controls.store.size).toBe(0);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, false);
    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({
      hit: true,
      value: false,
    });
  });

  it('fails closed for every code after a failed invalidateAll', async () => {
    const controls = fakeRedis();
    const cache = new SettingsCache(controls.redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);
    await cache.set('shop.name', CHANNEL, 'Acme');

    controls.failDelWith(new Error('Connection is closed.'));
    await expect(cache.invalidateAll()).rejects.toThrow('Connection is closed.');

    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
    expect(await cache.get('shop.name', CHANNEL)).toEqual({ hit: false });
  });

  it('reports how many shared keys a drop deleted, so an operator clear can be counted', async () => {
    const { redis } = fakeRedis();
    const cache = new SettingsCache(redis);

    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);
    await cache.set('shop.name', CHANNEL, 'Acme');

    expect(await cache.invalidate('mfa.storefront.google_enabled')).toBe(1);
    expect(await cache.invalidateAll()).toBe(1);
    expect(await cache.invalidateAll()).toBe(0);
  });

  it('keeps the "not registered" sentinel out of the cache while an invalidation is pending', async () => {
    const controls = fakeRedis();
    const cache = new SettingsCache(controls.redis);

    controls.blockDel(true);
    await cache.set('mfa.storefront.google_enabled', CHANNEL, true);
    const pending = cache.invalidate('mfa.storefront.google_enabled');
    await cache.setNotRegistered('mfa.storefront.google_enabled', CHANNEL);

    controls.blockDel(false);
    controls.releaseDel();
    await pending;

    expect(await cache.get('mfa.storefront.google_enabled', CHANNEL)).toEqual({ hit: false });
  });
});

/**
 * The second defect behind "the operator cleared the cache and nothing
 * changed". Invalidation is a broadcast, and a broadcast can be missed — the
 * `settings.value_changed` subscriber is in-process, so a second API instance
 * only learns about a write through the shared layer. Redis expires its entries
 * after an hour; the per-process LRU had **no expiry at all** and was bounded
 * only by its 1024-entry capacity, so a process that missed an invalidation
 * served the pre-write value indefinitely.
 *
 * That is the case the "clear cache" button cannot fix, because clearing rides
 * the same in-process path that already failed. A TTL fixes it without anyone
 * pressing anything.
 */
describe('SettingsCache in-process staleness is bounded', () => {
  const CODE = 'mfa.storefront.google_enabled';
  const KEY = `${SETTINGS_CACHE_KEY_PREFIX}${CODE}:${CHANNEL}`;

  it('is bounded within a minute — long enough to absorb a request burst, short enough to self-heal', () => {
    expect(SETTINGS_LRU_TTL_MS).toBeGreaterThanOrEqual(5_000);
    expect(SETTINGS_LRU_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it('serves the in-process layer inside the window', async () => {
    const controls = fakeRedis();
    let now = 0;
    const cache = new SettingsCache(controls.redis, () => now);

    await cache.set(CODE, CHANNEL, true);
    // Another process wrote a new value; this one missed the notification.
    controls.store.set(KEY, JSON.stringify(false));

    now += SETTINGS_LRU_TTL_MS - 1;
    expect(await cache.get(CODE, CHANNEL)).toEqual({ hit: true, value: true });
  });

  it('re-reads the shared layer once the entry is older than the TTL', async () => {
    const controls = fakeRedis();
    let now = 0;
    const cache = new SettingsCache(controls.redis, () => now);

    await cache.set(CODE, CHANNEL, true);
    controls.store.set(KEY, JSON.stringify(false));

    now += SETTINGS_LRU_TTL_MS;
    expect(await cache.get(CODE, CHANNEL)).toEqual({ hit: true, value: false });
  });

  it('falls through to PostgreSQL when the entry aged out and the shared layer is empty', async () => {
    const controls = fakeRedis();
    let now = 0;
    const cache = new SettingsCache(controls.redis, () => now);

    await cache.set(CODE, CHANNEL, true);
    controls.store.delete(KEY);

    now += SETTINGS_LRU_TTL_MS;
    expect(await cache.get(CODE, CHANNEL)).toEqual({ hit: false });
  });

  it('ages out a continuously read key — the window is on the value, not on idleness', async () => {
    const controls = fakeRedis();
    let now = 0;
    const cache = new SettingsCache(controls.redis, () => now);

    await cache.set(CODE, CHANNEL, true);
    controls.store.set(KEY, JSON.stringify(false));

    // A setting read on every request is exactly the key a sliding window would
    // pin forever, which would leave the staleness unbounded for the hottest
    // values on the platform.
    for (let i = 0; i < 40; i += 1) {
      now += SETTINGS_LRU_TTL_MS / 4;
      await cache.get(CODE, CHANNEL);
    }
    expect(await cache.get(CODE, CHANNEL)).toEqual({ hit: true, value: false });
  });
});
