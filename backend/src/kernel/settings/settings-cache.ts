import type Redis from 'ioredis';

/**
 * Read-through cache for `SettingsService.get` — feature 004 / US3 (T050).
 *
 * Two layers, in this order on read:
 *   1. Per-process LRU (cheap; absorbs intra-request bursts).
 *   2. Redis (`settings:v1:<code>:<channelId>`, TTL 1h; survives restarts).
 *
 * Invalidation goes the other way: write → drop in Redis → drop in LRU →
 * notify other processes via the EventBus subscriber (`SettingsCacheInvalidator`).
 *
 * Dropping the shared layer first is deliberate: it is the layer that outlives
 * this process and would otherwise be re-pulled into every other process's
 * LRU. Dropping it is also the step that can fail (network, closed
 * connection), and a half-done invalidation must degrade to "slower but
 * correct", never to "fast and wrong". Two guards enforce that:
 *
 *   - while a drop is in flight, reads for the affected codes bypass both
 *     layers and writes do not repopulate them — the EventBus dispatches
 *     `settings.value_changed` fire-and-forget, so a read routinely lands
 *     mid-invalidation;
 *   - when the shared drop throws, the affected prefix stays marked, so reads
 *     keep bypassing the cache (and keep retrying the drop) instead of being
 *     served a pre-invalidation value that survived in Redis.
 *
 * Stored values are JSON-serialised so structured types (objects, arrays)
 * survive the Redis hop. The `null` sentinel is never stored — absence of a
 * key means "cache miss"; falsy values like `false`, `0`, `""` are valid.
 */

const KEY_PREFIX = 'settings:v1:';
const TTL_SECONDS = 60 * 60;
const LRU_MAX = 1024;
const NOT_REGISTERED = '__settings_not_registered__';

export class SettingsCache {
  private readonly lru = new Map<string, unknown>();
  /** Key prefixes whose shared drop is on the wire right now, by depth. */
  private readonly draining = new Map<string, number>();
  /** Key prefixes whose shared drop threw; Redis may still hold a stale value. */
  private readonly undrained = new Set<string>();

  constructor(private readonly redis: Redis) {}

  private static composeKey(code: string, channelId: string): string {
    return `${KEY_PREFIX}${code}:${channelId}`;
  }

  /**
   * Returns:
   *   - { hit: true; value: unknown } when the value (or "not registered" sentinel) is cached
   *   - { hit: false } when the caller must fall through to Postgres
   * The "not registered" sentinel is encoded as `{ __settings_not_registered__: true }`.
   */
  async get(
    code: string,
    channelId: string,
  ): Promise<{ hit: false } | { hit: true; value: unknown; notRegistered?: boolean }> {
    const key = SettingsCache.composeKey(code, channelId);
    if (await this.isBypassed(key)) return { hit: false };

    if (this.lru.has(key)) {
      const v = this.lru.get(key);
      // Touch the LRU.
      this.lru.delete(key);
      this.lru.set(key, v);
      if (this.isNotRegisteredSentinel(v)) {
        return { hit: true, value: undefined, notRegistered: true };
      }
      return { hit: true, value: v };
    }

    const raw = await this.redis.get(key);
    if (raw === null) return { hit: false };

    const decoded = JSON.parse(raw) as unknown;
    this.touchLru(key, decoded);
    if (this.isNotRegisteredSentinel(decoded)) {
      return { hit: true, value: undefined, notRegistered: true };
    }
    return { hit: true, value: decoded };
  }

  async set(code: string, channelId: string, value: unknown): Promise<void> {
    const key = SettingsCache.composeKey(code, channelId);
    // A read that started before the write resolved the pre-invalidation value
    // from Postgres. Caching it now would undo the invalidation in flight.
    if (await this.isBypassed(key)) return;
    this.touchLru(key, value);
    await this.redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
  }

  /** Cache the "not registered" outcome so repeated typos don't hammer Postgres. */
  async setNotRegistered(code: string, channelId: string): Promise<void> {
    const key = SettingsCache.composeKey(code, channelId);
    if (await this.isBypassed(key)) return;
    const sentinel = { [NOT_REGISTERED]: true };
    this.touchLru(key, sentinel);
    await this.redis.set(key, JSON.stringify(sentinel), 'EX', TTL_SECONDS);
  }

  /** Drop every cached entry for a given setting code (across every channel). */
  async invalidate(code: string): Promise<void> {
    await this.drop(`${KEY_PREFIX}${code}:`, 200);
  }

  /** Used after group-level changes that may affect many codes. */
  async invalidateAll(): Promise<void> {
    await this.drop(KEY_PREFIX, 500);
  }

  /**
   * Drop both layers for a key prefix, shared layer first. The prefix is
   * marked for the whole operation so concurrent reads and writes cannot
   * observe or restore the pre-invalidation state; the mark is only released
   * once the shared layer is known to be clean.
   */
  private async drop(prefix: string, scanCount: number): Promise<void> {
    this.draining.set(prefix, (this.draining.get(prefix) ?? 0) + 1);
    try {
      await this.dropShared(prefix, scanCount);
      // A successful drop also retires any narrower outstanding failure.
      for (const p of this.undrained) {
        if (p.startsWith(prefix)) this.undrained.delete(p);
      }
    } catch (err) {
      // Fail closed: Redis may still serve the pre-invalidation value to this
      // process, so keep reads off the cache until a later drop succeeds.
      this.undrained.add(prefix);
      throw err;
    } finally {
      this.dropLocal(prefix);
      const depth = (this.draining.get(prefix) ?? 1) - 1;
      if (depth <= 0) this.draining.delete(prefix);
      else this.draining.set(prefix, depth);
    }
  }

  /** SCAN + DEL, to avoid blocking on KEYS in production-sized databases. */
  private async dropShared(prefix: string, scanCount: number): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        scanCount,
      );
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  private dropLocal(prefix: string): void {
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
  }

  /**
   * True when neither layer may be trusted for this key: a drop is in flight,
   * or an earlier drop failed and Redis was never cleaned. In the failed case
   * the drop is retried here, so a transient outage costs the affected codes
   * their caching until Redis answers again — not for the process lifetime.
   */
  private async isBypassed(key: string): Promise<boolean> {
    if (this.draining.size === 0 && this.undrained.size === 0) return false;
    for (const prefix of this.draining.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    for (const prefix of [...this.undrained]) {
      if (!key.startsWith(prefix)) continue;
      try {
        await this.drop(prefix, 200);
      } catch {
        // Still unreachable — stay off the cache and read through to Postgres.
      }
      return true;
    }
    return false;
  }

  private touchLru(key: string, value: unknown): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, value);
    while (this.lru.size > LRU_MAX) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }

  private isNotRegisteredSentinel(v: unknown): boolean {
    return (
      typeof v === 'object' &&
      v !== null &&
      Object.prototype.hasOwnProperty.call(v, NOT_REGISTERED) &&
      (v as Record<string, unknown>)[NOT_REGISTERED] === true
    );
  }
}
