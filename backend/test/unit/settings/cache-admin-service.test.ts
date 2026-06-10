import { describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import {
  CacheAdminService,
  CACHE_NAMESPACES,
} from '../../../src/modules/settings/services/cache-admin.service.js';

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

describe('CacheAdminService', () => {
  it('lists every registered namespace', () => {
    const svc = new CacheAdminService(fakeRedis([]));
    const list = svc.listNamespaces();
    expect(list.map((n) => n.key)).toEqual(CACHE_NAMESPACES.map((n) => n.key));
    expect(svc.enabled).toBe(true);
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

  it('clears a literal (glob-free) namespace key', async () => {
    const redis = fakeRedis(['b2b:module:enabled-set']);
    const svc = new CacheAdminService(redis);
    const result = await svc.clear(['modules']);
    expect(result.totalDeletedKeys).toBe(1);
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
    const svc = new CacheAdminService(undefined);
    expect(svc.enabled).toBe(false);
    const result = await svc.clear('all');
    expect(result.totalDeletedKeys).toBe(0);
    expect(result.cleared.every((c) => c.deletedKeysCount === 0)).toBe(true);
  });
});
