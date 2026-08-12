import type Redis from 'ioredis';
import { SharedDropMarks } from '../cache/shared-drop-marks.js';
import type { SalesChannel } from './sales-channel.entity.js';

/**
 * SalesChannelsCache — feature 005 / T012.
 *
 * Two-layer read-through cache used by the resolver service so that
 * channel lookup costs <1 ms p95 even on hot paths (research R-11).
 *
 *   1. Per-process LRU (cap {@link LRU_MAX}, entries older than
 *      {@link SALES_CHANNELS_LRU_TTL_MS} ignored) — absorbs intra-request
 *      bursts and removes the Redis hop entirely on warm processes.
 *   2. Redis (`sales-channels:v2:<code>`, TTL {@link TTL_SECONDS}) —
 *      cross-process consistency in multi-instance deployments.
 *
 * Invalidation flows write → drop in Redis → drop in LRU → notify this
 * process's subscriber. It is the same two-layer shape as `SettingsCache` and
 * carries the same two obligations, for the same reasons (see
 * {@link SharedDropMarks} and the TTL note there):
 *
 *   - the shared layer is dropped **first** and the prefix stays marked for
 *     the whole operation, so a read that lands mid-invalidation cannot
 *     re-pin the pre-drop value from Redis into the LRU, and a failed shared
 *     drop leaves reads failing closed to PostgreSQL rather than to a value
 *     the invalidation was supposed to remove;
 *   - the local layer expires, because the notification is in-process: a
 *     second instance that missed it would otherwise serve the pre-change
 *     channel until capacity evicted it.
 *
 * Cache values are JSON-serialised. The `null` sentinel is reserved
 * for "no such channel"; absence of a key means "cache miss".
 */

// v2 (feature 053): `isPublic` added to the cached shape so storefront
// consumers read price-visibility off the resolved channel instead of
// re-querying. Bumped from v1 so entries cached without the field are ignored.
/** Shared with the operator-facing cache-clear surface, so the two cannot drift. */
export const SALES_CHANNELS_CACHE_KEY_PREFIX = 'sales-channels:v2:';
export const SALES_CHANNELS_CACHE_NAMESPACE = 'sales_channels';

/** Maximum age of an entry in the per-process layer; see `SETTINGS_LRU_TTL_MS`. */
export const SALES_CHANNELS_LRU_TTL_MS = 30_000;

const KEY_PREFIX = SALES_CHANNELS_CACHE_KEY_PREFIX;
const TTL_SECONDS = 5 * 60;
const LRU_MAX = 256;
const NOT_FOUND_SENTINEL = '__sales_channel_not_found__';

/** Plain serialisable view of a SalesChannel — what the resolver actually needs. */
export interface CachedChannel {
  id: string;
  code: string;
  name: Record<string, string>;
  active: boolean;
  /** Price-visibility flag (display concern, distinct from resolution). */
  isPublic: boolean;
  systemDefault: boolean;
  defaultLanguage: string;
  defaultCurrency: string;
  themeCode: string | null;
  logoAssetId: string | null;
  languages: string[];
  currencies: string[];
  version: number;
}

export function toCachedChannel(channel: SalesChannel): CachedChannel {
  return {
    id: channel.id,
    code: channel.code,
    name: channel.name,
    active: channel.active,
    isPublic: channel.isPublic,
    systemDefault: channel.systemDefault,
    defaultLanguage: channel.defaultLanguage,
    defaultCurrency: channel.defaultCurrency,
    themeCode: channel.themeCode ?? null,
    logoAssetId: channel.logoAssetId ?? null,
    languages: [...channel.languages],
    currencies: [...channel.currencies],
    version: channel.version,
  };
}

interface LruEntry {
  readonly value: CachedChannel | null;
  /** When the value was read from the shared layer or written here. */
  readonly storedAt: number;
}

export class SalesChannelsCache {
  private readonly lru = new Map<string, LruEntry>();
  private readonly marks = new SharedDropMarks();

  constructor(
    private readonly redis: Redis,
    /** Injectable so a test can advance the TTL window without a real clock. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  private static composeKey(code: string): string {
    return `${KEY_PREFIX}${code}`;
  }

  /**
   * Returns:
   *   - { hit: true; value: CachedChannel } when the channel is cached
   *   - { hit: true; value: null } when the cache positively knows it does not exist
   *   - { hit: false } when the caller must fall through to Postgres
   */
  async get(
    code: string,
  ): Promise<{ hit: false } | { hit: true; value: CachedChannel | null }> {
    const key = SalesChannelsCache.composeKey(code);
    if (await this.isBypassed(key)) return { hit: false };

    const entry = this.lru.get(key);
    if (entry !== undefined) {
      if (this.now() - entry.storedAt < SALES_CHANNELS_LRU_TTL_MS) {
        // Touch for eviction order only — the window is on the value's age, so
        // a channel resolved on every request still ages out.
        this.lru.delete(key);
        this.lru.set(key, entry);
        return { hit: true, value: entry.value };
      }
      this.lru.delete(key);
    }

    const raw = await this.redis.get(key);
    if (raw === null) return { hit: false };

    if (raw === NOT_FOUND_SENTINEL) {
      this.touchLru(key, null);
      return { hit: true, value: null };
    }

    const decoded = JSON.parse(raw) as CachedChannel;
    this.touchLru(key, decoded);
    return { hit: true, value: decoded };
  }

  async set(code: string, channel: CachedChannel): Promise<void> {
    const key = SalesChannelsCache.composeKey(code);
    // A read that started before the change resolved the pre-change row from
    // Postgres. Caching it now would undo the invalidation in flight.
    if (await this.isBypassed(key)) return;
    this.touchLru(key, channel);
    await this.redis.set(key, JSON.stringify(channel), 'EX', TTL_SECONDS);
  }

  /** Cache the "no such channel" outcome so repeated typos do not hammer Postgres. */
  async setNotFound(code: string): Promise<void> {
    const key = SalesChannelsCache.composeKey(code);
    if (await this.isBypassed(key)) return;
    this.touchLru(key, null);
    await this.redis.set(key, NOT_FOUND_SENTINEL, 'EX', TTL_SECONDS);
  }

  /**
   * Drop one channel's cached entry across both layers. Returns how many
   * shared keys were deleted.
   */
  async invalidate(code: string): Promise<number> {
    return this.drop(SalesChannelsCache.composeKey(code), true);
  }

  /**
   * Drop every cached channel. Used on broad lifecycle changes and by the
   * operator-facing cache clear. Returns how many shared keys were deleted.
   */
  async invalidateAll(): Promise<number> {
    return this.drop(KEY_PREFIX, false);
  }

  /**
   * Drop both layers, shared layer first, with the prefix marked for the whole
   * operation. `exact` distinguishes the two shapes: one channel's key is
   * deleted directly (a SCAN on `<key>*` would also take every channel whose
   * code extends it), while the namespace drop scans.
   */
  private async drop(prefix: string, exact: boolean): Promise<number> {
    this.marks.begin(prefix);
    try {
      const deleted = exact
        ? await this.redis.del(prefix)
        : await this.dropShared(prefix);
      this.marks.retireFailedUnder(prefix);
      return deleted;
    } catch (err) {
      // Fail closed: Redis may still serve the pre-invalidation value to this
      // process, so keep reads off the cache until a later drop succeeds.
      this.marks.markFailed(prefix);
      throw err;
    } finally {
      this.dropLocal(prefix);
      this.marks.finish(prefix);
    }
  }

  /** SCAN + DEL, to avoid blocking on KEYS in production-sized databases. */
  private async dropShared(prefix: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        500,
      );
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }

  private dropLocal(prefix: string): void {
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
  }

  /**
   * True when neither layer may be trusted for this key: a drop is in flight,
   * or an earlier drop failed and Redis was never cleaned. In the failed case
   * the drop is retried here, so a transient outage costs the affected channels
   * their caching until Redis answers again — not for the process lifetime.
   */
  private async isBypassed(key: string): Promise<boolean> {
    if (this.marks.isClean) return false;
    if (this.marks.isDraining(key)) return true;
    const failed = this.marks.failedPrefixFor(key);
    if (failed === undefined) return false;
    try {
      await this.drop(failed, failed !== KEY_PREFIX);
    } catch {
      // Still unreachable — stay off the cache and read through to Postgres.
    }
    return true;
  }

  private touchLru(key: string, value: CachedChannel | null): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, { value, storedAt: this.now() });
    while (this.lru.size > LRU_MAX) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }
}
