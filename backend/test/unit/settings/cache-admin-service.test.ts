import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  CacheAdminService,
  CACHE_NAMESPACES,
} from '../../../src/modules/settings/services/cache-admin.service.js';
import { InProcessCacheRegistry } from '../../../src/kernel/cache/in-process-cache-registry.js';

/**
 * In-memory Redis fake implementing just the surface CacheAdminService uses:
 * `scan` (single-pass cursor) and `del`.
 */
function fakeRedis(initialKeys: string[]): Redis {
  const store = new Set(initialKeys);
  const globToRe = (pattern: string): RegExp =>
    new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
    );
  return {
    async scan(_cursor: string, _match: string, pattern: string) {
      const re = globToRe(pattern);
      const keys = [...store].filter((k) => re.test(k));
      return ['0', keys];
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n += 1;
      }
      return n;
    },
    has(k: string) {
      return store.has(k);
    },
  } as unknown as Redis;
}

/** A stand-in for a kernel cache's in-process layer. */
function fakeLayer(deletedKeys: number): {
  invalidateAll: () => Promise<number>;
  calls: number;
} {
  const layer = {
    calls: 0,
    async invalidateAll(): Promise<number> {
      layer.calls += 1;
      return deletedKeys;
    },
  };
  return layer;
}

describe('CacheAdminService', () => {
  it('lists every registered namespace', () => {
    const svc = new CacheAdminService(fakeRedis([]));
    const list = svc.listNamespaces();
    expect(list.map((n) => n.key)).toEqual(CACHE_NAMESPACES.map((n) => n.key));
    expect(svc.enabled).toBe(true);
  });

  it('no longer offers the module registry — that key is write-only and reading it is nobody’s path', () => {
    const svc = new CacheAdminService(fakeRedis([]));
    expect(svc.listNamespaces().map((n) => n.key)).not.toContain('modules');
  });

  it('clears only the selected namespace and reports the deleted count', async () => {
    const redis = fakeRedis([
      'blog:v1:pl_retail:en:index',
      'blog:v1:pl_retail:en:post:x',
      'cms:v1:page:home',
      'settings:v1:shop.name:all',
    ]);
    const svc = new CacheAdminService(redis);
    const result = await svc.clear(['blog']);
    expect(result.totalDeletedKeys).toBe(2);
    expect(result.cleared).toEqual([{ key: 'blog', deletedKeysCount: 2 }]);
    // Non-selected namespaces are untouched.
    expect((redis as unknown as { has(k: string): boolean }).has('cms:v1:page:home')).toBe(true);
    expect((redis as unknown as { has(k: string): boolean }).has('settings:v1:shop.name:all')).toBe(true);
  });

  it('clears every namespace with "all"', async () => {
    const redis = fakeRedis([
      'blog:v1:a',
      'cms:v1:b',
      'megamenu:v1:c',
      'dictionary:registry:v1:x',
    ]);
    const svc = new CacheAdminService(redis);
    const result = await svc.clear('all');
    expect(result.totalDeletedKeys).toBe(4);
  });

  it('is a no-op (disabled) when no Redis is wired', async () => {
    const svc = new CacheAdminService(undefined, new InProcessCacheRegistry());
    expect(svc.enabled).toBe(false);
    const result = await svc.clear('all');
    expect(result.totalDeletedKeys).toBe(0);
    expect(result.cleared.every((c) => c.deletedKeysCount === 0)).toBe(true);
  });
});

/**
 * Two of the eight namespaces — `settings` and `sales_channels` — keep a
 * per-process layer in front of Redis. SCAN+DEL over the Redis key space
 * leaves that layer untouched, so the operator got a green confirmation and an
 * unchanged system: every warm process kept serving the value it had already
 * resolved, and the next read re-pinned it into Redis.
 *
 * The clear therefore goes through the cache that owns the namespace, which is
 * also the only way to get the ordering right — shared layer first, the key
 * prefix marked for the whole operation so a concurrent read bypasses both
 * layers and a concurrent write cannot repopulate them (MR !449).
 */
describe('CacheAdminService — the in-process layer', () => {
  it('clears the layer that owns the namespace instead of only its Redis keys', async () => {
    const registry = new InProcessCacheRegistry();
    const settings = fakeLayer(3);
    registry.register('settings', settings);

    const redis = fakeRedis(['settings:v1:shop.name:all']);
    const svc = new CacheAdminService(redis, registry);
    const result = await svc.clear(['settings']);

    expect(settings.calls).toBe(1);
    expect(result.cleared).toEqual([{ key: 'settings', deletedKeysCount: 3 }]);
  });

  it('clears the sales-channels layer too — it has the same shape and the same defect', async () => {
    const registry = new InProcessCacheRegistry();
    const salesChannels = fakeLayer(2);
    registry.register('sales_channels', salesChannels);

    const svc = new CacheAdminService(fakeRedis([]), registry);
    await svc.clear('all');

    expect(salesChannels.calls).toBe(1);
  });

  it('falls back to SCAN+DEL when no layer is registered — the CLI runs without the modules', async () => {
    const redis = fakeRedis(['settings:v1:shop.name:all', 'settings:v1:shop.name:pl_retail']);
    const svc = new CacheAdminService(redis, new InProcessCacheRegistry());

    const result = await svc.clear(['settings']);
    expect(result.totalDeletedKeys).toBe(2);
  });

  it('surfaces a failed drop rather than reporting a clear that did not happen', async () => {
    const registry = new InProcessCacheRegistry();
    registry.register('settings', {
      invalidateAll: async () => {
        throw new Error('Connection is closed.');
      },
    });

    const svc = new CacheAdminService(fakeRedis([]), registry);
    await expect(svc.clear(['settings'])).rejects.toThrow('Connection is closed.');
  });
});
