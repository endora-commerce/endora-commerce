import { describe, it, expect } from 'vitest';
import {
  acquireLifecycleLock,
  LifecycleLockError,
  LOCK_KEY,
} from '../../../src/modules/_lifecycle/services/lock.js';

/**
 * Minimal Redis stub. Implements only the four operations the lock uses
 * (`set`/`get`/`eval` for compare-and-delete and compare-and-extend).
 * Sufficient for unit-testing the lock semantics; the integration suite
 * exercises the real ioredis path against a live server.
 */
function makeStubRedis(): {
  set(key: string, value: string, exFlag: 'EX', ttl: number, nxFlag: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  eval(
    script: string,
    numKeys: number,
    key: string,
    ...args: string[]
  ): Promise<number>;
  __dump(): Map<string, string>;
  __forceExpire(key: string): void;
} {
  const store = new Map<string, string>();
  return {
    async set(key, value, _exFlag, _ttl, _nxFlag) {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async eval(script, _numKeys, key, expectedValue, _ttl) {
      // The lock uses two scripts. Distinguish by what they reference.
      if (script.includes('del')) {
        if (store.get(key) === expectedValue) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
      if (script.includes('expire')) {
        return store.get(key) === expectedValue ? 1 : 0;
      }
      return 0;
    },
    __dump() {
      return new Map(store);
    },
    __forceExpire(key) {
      store.delete(key);
    },
  };
}

describe('acquireLifecycleLock', () => {
  it('acquires a cold lock and returns a lease handle', async () => {
    const r = makeStubRedis() as unknown as Parameters<typeof acquireLifecycleLock>[0];
    const lease = await acquireLifecycleLock(r);
    expect(lease.leaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect((r as unknown as ReturnType<typeof makeStubRedis>).__dump().get(LOCK_KEY)).toBe(
      lease.leaseId,
    );
    await lease.release();
    expect((r as unknown as ReturnType<typeof makeStubRedis>).__dump().has(LOCK_KEY)).toBe(false);
  });

  it('refuses to acquire a contended lock and reports the holder', async () => {
    const r = makeStubRedis() as unknown as Parameters<typeof acquireLifecycleLock>[0];
    const first = await acquireLifecycleLock(r);
    await expect(acquireLifecycleLock(r)).rejects.toBeInstanceOf(LifecycleLockError);
    try {
      await acquireLifecycleLock(r);
    } catch (err) {
      expect(err).toBeInstanceOf(LifecycleLockError);
      expect((err as LifecycleLockError).heldBy).toBe(first.leaseId);
    }
    await first.release();
  });

  it('release() with the right lease frees the key; double-release is a no-op', async () => {
    const r = makeStubRedis() as unknown as Parameters<typeof acquireLifecycleLock>[0];
    const lease = await acquireLifecycleLock(r);
    await lease.release();
    expect((r as unknown as ReturnType<typeof makeStubRedis>).__dump().has(LOCK_KEY)).toBe(false);
    // Second release does nothing — no throw, no error.
    await lease.release();
  });

  it('a stale lease cannot release a freshly-acquired lock', async () => {
    const r = makeStubRedis() as unknown as Parameters<typeof acquireLifecycleLock>[0];
    const lease1 = await acquireLifecycleLock(r);
    const stub = r as unknown as ReturnType<typeof makeStubRedis>;
    // Simulate the lease's TTL expiring and a different process acquiring.
    stub.__forceExpire(LOCK_KEY);
    const lease2 = await acquireLifecycleLock(r);
    expect(lease2.leaseId).not.toBe(lease1.leaseId);
    // lease1.release() must NOT free the key now held by lease2.
    await lease1.release();
    expect(stub.__dump().get(LOCK_KEY)).toBe(lease2.leaseId);
    await lease2.release();
  });
});
