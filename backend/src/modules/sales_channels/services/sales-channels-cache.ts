import type Redis from 'ioredis';
import type { SalesChannel } from '../entities/sales-channel.entity.js';

/**
 * SalesChannelsCache — feature 005 / T012.
 *
 * Two-layer read-through cache used by the resolver service so that
 * channel lookup costs <1 ms p95 even on hot paths (research R-11).
 *
 *   1. Per-process LRU (cap {@link LRU_MAX}) — absorbs intra-request
 *      bursts and removes the Redis hop entirely on warm processes.
 *   2. Redis (`sales-channels:v1:<code>`, TTL {@link TTL_SECONDS}) —
 *      cross-process consistency in multi-instance deployments.
 *
 * Invalidation flows write → drop in Redis → drop in LRU →
 * notify other processes via the EventBus subscriber (which itself
 * invalidates the LRU on each receiving process).
 *
 * Cache values are JSON-serialised. The `null` sentinel is reserved
 * for "no such channel"; absence of a key means "cache miss".
 */

const KEY_PREFIX = 'sales-channels:v1:';
const TTL_SECONDS = 5 * 60;
const LRU_MAX = 256;
const NOT_FOUND_SENTINEL = '__sales_channel_not_found__';

/** Plain serialisable view of a SalesChannel — what the resolver actually needs. */
export interface CachedChannel {
  id: string;
  code: string;
  name: Record<string, string>;
  active: boolean;
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

export class SalesChannelsCache {
  private readonly lru = new Map<string, CachedChannel | null>();

  constructor(private readonly redis: Redis) {}

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

    if (this.lru.has(key)) {
      const v = this.lru.get(key) as CachedChannel | null;
      this.touchLru(key, v);
      return { hit: true, value: v };
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
    this.touchLru(key, channel);
    await this.redis.set(key, JSON.stringify(channel), 'EX', TTL_SECONDS);
  }

  /** Cache the "no such channel" outcome so repeated typos do not hammer Postgres. */
  async setNotFound(code: string): Promise<void> {
    const key = SalesChannelsCache.composeKey(code);
    this.touchLru(key, null);
    await this.redis.set(key, NOT_FOUND_SENTINEL, 'EX', TTL_SECONDS);
  }

  /** Drop one channel's cached entry across both layers. */
  async invalidate(code: string): Promise<void> {
    const key = SalesChannelsCache.composeKey(code);
    this.lru.delete(key);
    await this.redis.del(key);
  }

  /** Drop every cached channel. Used on broad lifecycle changes. */
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

  private touchLru(key: string, value: CachedChannel | null): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, value);
    while (this.lru.size > LRU_MAX) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }
}
