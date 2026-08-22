import type { Redis } from 'ioredis';
import type { CacheNamespaceDto } from '@endora-commerce/contracts';
import {
  inProcessCaches,
  type InProcessCacheRegistry,
} from '../../../kernel/cache/in-process-cache-registry.js';
import {
  SETTINGS_CACHE_KEY_PREFIX,
  SETTINGS_CACHE_NAMESPACE,
} from '../../../kernel/settings/settings-cache.js';
import {
  SALES_CHANNELS_CACHE_KEY_PREFIX,
  SALES_CHANNELS_CACHE_NAMESPACE,
} from '../../../kernel/sales-channels/sales-channels-cache.js';

/**
 * Static registry of clearable cache namespaces. Each entry owns one or more
 * key-glob patterns; clearing a namespace SCAN+DELs every matching key.
 *
 * Patterns mirror the prefixes each module's cache service writes with:
 *   - settings:        `settings:v1:*`        (SettingsCache)
 *   - sales_channels:  `sales-channels:v2:*`  (SalesChannelsCache)
 *   - blog:            `blog:v1:*`            (BlogCacheService)
 *   - cms:             `cms:v1:*`             (CmsCache)
 *   - megamenu:        `megamenu:v1:*`        (MegamenuCache)
 *   - dictionaries:    `dictionary:*`         (DictionaryCache)
 *   - carts:           `b2b:cart:recompute:*` (CartRecomputeCache)
 *
 * The first two take their prefix from the cache itself rather than repeating
 * the literal: `sales_channels` spent from feature 053 to now pointing at
 * `sales-channels:v1:*` while the cache wrote `v2`, so the button cleared
 * nothing at all for that namespace.
 *
 * Keep this list in sync when a new Redis-backed cache prefix is introduced.
 */
interface CacheNamespace {
  key: string;
  label: string;
  description: string;
  patterns: string[];
}

export const CACHE_NAMESPACES: readonly CacheNamespace[] = [
  {
    key: SETTINGS_CACHE_NAMESPACE,
    label: 'Settings',
    description: 'Resolved platform / per-channel setting values.',
    patterns: [`${SETTINGS_CACHE_KEY_PREFIX}*`],
  },
  {
    key: SALES_CHANNELS_CACHE_NAMESPACE,
    label: 'Sales channels',
    description: 'Resolved sales-channel configuration.',
    patterns: [`${SALES_CHANNELS_CACHE_KEY_PREFIX}*`],
  },
  {
    key: 'blog',
    label: 'Blog',
    description: 'Storefront blog index, posts, categories and tag pages.',
    patterns: ['blog:v1:*'],
  },
  {
    key: 'cms',
    label: 'CMS',
    description: 'Storefront CMS pages, blocks and hook content.',
    patterns: ['cms:v1:*'],
  },
  {
    key: 'megamenu',
    label: 'Mega menu',
    description: 'Resolved storefront mega-menu trees.',
    patterns: ['megamenu:v1:*'],
  },
  {
    key: 'dictionaries',
    label: 'Dictionaries',
    description: 'Resolved dictionary registries and entries (countries, etc.).',
    patterns: ['dictionary:*'],
  },
  {
    key: 'carts',
    label: 'Cart pricing',
    description: 'Cached cart re-pricing snapshots.',
    patterns: ['b2b:cart:recompute:*'],
  },
  // No `modules` entry. It cleared `b2b:module:enabled-set`, which no code path
  // ever read: module presence is held in memory and refreshed from PostgreSQL
  // on a `b2b:module:state-changed` notification. The mirror is gone (feature
  // 073, T140), and offering an operator a button that clears a key nobody
  // reads is worse than offering nothing — it is where they look first when
  // presence is wrong.
] as const;

export interface ClearedNamespace {
  key: string;
  deletedKeysCount: number;
}

/**
 * Admin-facing cache maintenance. Lets an operator flush selected cache
 * namespaces so freshly-published content / changed settings show up without
 * waiting for TTL expiry.
 *
 * Six of the eight namespaces live only in Redis, so SCAN+DEL over their key
 * patterns is a complete clear. Two — `settings` and `sales_channels` — keep a
 * per-process layer in front of Redis, and for those the clear goes through
 * the cache that owns both layers (see {@link InProcessCacheRegistry}), which
 * is also the only way to get the ordering right: shared layer first, prefix
 * marked for the whole operation.
 *
 * The cost of that ordering is worth naming. Immediately after a clear both
 * layers are cold and the marked prefix sends reads through to PostgreSQL, so
 * a platform-wide burst of setting reads lands on the database. The queries are
 * trivial (small table, unique index on `code`), but the connection pool is
 * not: it is the scarce resource. That is acceptable for a rare,
 * operator-initiated action and unacceptable in a loop, which is why the route
 * carries its own rate limit (`routes.cache.ts`).
 */
export class CacheAdminService {
  constructor(
    private readonly redis?: Redis,
    /** Injectable so a test does not clear this process's real caches. */
    private readonly caches: InProcessCacheRegistry = inProcessCaches,
  ) {}

  get enabled(): boolean {
    return this.redis !== undefined;
  }

  listNamespaces(): CacheNamespaceDto[] {
    return CACHE_NAMESPACES.map((n) => ({
      key: n.key,
      label: n.label,
      description: n.description,
    }));
  }

  /**
   * Clear the given namespaces (or every namespace when passed `'all'`).
   * Unknown keys are ignored. Returns the per-namespace deleted-key counts.
   */
  async clear(
    namespaces: 'all' | string[],
  ): Promise<{ cleared: ClearedNamespace[]; totalDeletedKeys: number }> {
    const wanted =
      namespaces === 'all'
        ? CACHE_NAMESPACES
        : CACHE_NAMESPACES.filter((n) => namespaces.includes(n.key));

    const cleared: ClearedNamespace[] = [];
    let totalDeletedKeys = 0;
    for (const ns of wanted) {
      const deleted = await this.clearNamespace(ns);
      cleared.push({ key: ns.key, deletedKeysCount: deleted });
      totalDeletedKeys += deleted;
    }
    return { cleared, totalDeletedKeys };
  }

  /**
   * Prefer the owning cache when this process has one: it drops the shared
   * layer and its own in-memory layer as one marked operation. A process that
   * registered none — the `cache:clear` CLI, a worker without the module —
   * has no in-memory layer to be stale, so clearing the Redis keys is the
   * whole job.
   */
  private async clearNamespace(ns: CacheNamespace): Promise<number> {
    if (this.caches.has(ns.key)) {
      return (await this.caches.clear(ns.key)) ?? 0;
    }
    if (!this.redis) return 0;
    let deleted = 0;
    for (const pattern of ns.patterns) {
      deleted += await this.scanDelete(pattern);
    }
    return deleted;
  }

  private async scanDelete(pattern: string): Promise<number> {
    const redis = this.redis;
    if (!redis) return 0;
    // A glob-free pattern is a single literal key — delete it directly.
    if (!/[*?[\]]/.test(pattern)) {
      return redis.del(pattern);
    }
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) deleted += await redis.del(...keys);
    } while (cursor !== '0');
    return deleted;
  }
}
