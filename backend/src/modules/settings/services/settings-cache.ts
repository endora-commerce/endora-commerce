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
    this.touchLru(key, value);
    await this.redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
  }

  /** Cache the "not registered" outcome so repeated typos don't hammer Postgres. */
  async setNotRegistered(code: string, channelId: string): Promise<void> {
    const key = SettingsCache.composeKey(code, channelId);
    const sentinel = { [NOT_REGISTERED]: true };
    this.touchLru(key, sentinel);
    await this.redis.set(key, JSON.stringify(sentinel), 'EX', TTL_SECONDS);
  }

  /** Drop every cached entry for a given setting code (across every channel). */
  async invalidate(code: string): Promise<void> {
    // LRU first.
    const prefix = `${KEY_PREFIX}${code}:`;
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
    // Then Redis: SCAN to avoid blocking on KEYS in production-sized DBs.
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  /** Used after group-level changes that may affect many codes. */
  async invalidateAll(): Promise<void> {
    this.lru.clear();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}*`,
        'COUNT',
        500,
      );
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
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
