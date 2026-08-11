import { describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import { SettingsCache } from '../../../src/kernel/settings/settings-cache.js';

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
