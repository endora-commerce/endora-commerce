import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export const LOCK_KEY = 'b2b:module:lifecycle:lock';
export const LOCK_TTL_SECONDS = 300; // 5 minutes
export const LOCK_REFRESH_INTERVAL_MS = 60_000; // 1 minute

/**
 * Compare-and-delete release script. Prevents the case where a stale
 * lease's TTL elapsed, the lock was acquired by someone else, and our
 * own `finally` block then deletes their key.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Compare-and-extend script. Refreshes the lease only when we still
 * own it; otherwise reports zero so the caller can stop refreshing.
 */
const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export class LifecycleLockError extends Error {
  constructor(public readonly heldBy: string | null) {
    super(
      heldBy
        ? `lifecycle lock is held by another process (lease ${heldBy})`
        : 'lifecycle lock is currently held',
    );
    this.name = 'LifecycleLockError';
  }
}

export interface LifecycleLeaseHandle {
  /** UUID identifying this acquisition. */
  readonly leaseId: string;
  /** Stops the auto-refresh timer and releases the lock if still held. */
  release(): Promise<void>;
}

/**
 * Acquire the global lifecycle lock. Returns a handle that auto-extends
 * the lease every 60 s and exposes `release()` for the caller's `finally`.
 *
 * Throws `LifecycleLockError` if the lock is currently held by someone
 * else (single attempt — the lifecycle commands surface this as exit 75
 * rather than block).
 */
export async function acquireLifecycleLock(
  redis: Redis,
  options: { ttlSeconds?: number; refreshIntervalMs?: number } = {},
): Promise<LifecycleLeaseHandle> {
  const ttl = options.ttlSeconds ?? LOCK_TTL_SECONDS;
  const refreshIntervalMs = options.refreshIntervalMs ?? LOCK_REFRESH_INTERVAL_MS;
  const leaseId = randomUUID();

  const result = await redis.set(LOCK_KEY, leaseId, 'EX', ttl, 'NX');
  if (result !== 'OK') {
    const heldBy = await redis.get(LOCK_KEY);
    throw new LifecycleLockError(heldBy);
  }

  let released = false;
  const refresh = setInterval(() => {
    if (released) return;
    void redis
      .eval(EXTEND_SCRIPT, 1, LOCK_KEY, leaseId, String(ttl))
      .catch(() => {
        /* refresh failure is silent — release() will still run */
      });
  }, refreshIntervalMs);
  // Don't keep the event loop alive on the refresh interval.
  refresh.unref?.();

  return {
    leaseId,
    async release(): Promise<void> {
      if (released) return;
      released = true;
      clearInterval(refresh);
      await redis
        .eval(RELEASE_SCRIPT, 1, LOCK_KEY, leaseId)
        .catch(() => {
          /* swallow — the lock will expire on its TTL anyway */
        });
    },
  };
}
