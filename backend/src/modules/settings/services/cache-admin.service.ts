import type Redis from 'ioredis';
import type { CacheNamespaceDto } from '@b2b/contracts';

/**
 * Static registry of clearable Redis cache namespaces. Each entry owns one or
 * more key-glob patterns; clearing a namespace SCAN+DELs every matching key.
 *
 * Patterns mirror the prefixes each module's cache service writes with:
 *   - settings:        `settings:v1:*`        (SettingsCache)
 *   - sales_channels:  `sales-channels:v1:*`  (SalesChannelsCache)
 *   - blog:            `blog:v1:*`            (BlogCacheService)
 *   - cms:             `cms:v1:*`             (CmsCache)
 *   - megamenu:        `megamenu:v1:*`        (MegamenuCache)
 *   - dictionaries:    `dictionary:*`         (DictionaryCache)
 *   - carts:           `b2b:cart:recompute:*` (CartRecomputeCache)
 *   - modules:         `b2b:module:enabled-set` (lifecycle registry cache)
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
    key: 'settings',
    label: 'Settings',
    description: 'Resolved platform / per-channel setting values.',
    patterns: ['settings:v1:*'],
  },
  {
    key: 'sales_channels',
    label: 'Sales channels',
    description: 'Resolved sales-channel configuration.',
    patterns: ['sales-channels:v1:*'],
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
  {
    key: 'modules',
    label: 'Module registry',
    description: 'Cached enabled-module set used by the lifecycle gate.',
    patterns: ['b2b:module:enabled-set'],
  },
] as const;

export interface ClearedNamespace {
  key: string;
  deletedKeysCount: number;
}

/**
 * Admin-facing cache maintenance. Lets an operator flush selected Redis cache
 * namespaces so freshly-published content / changed settings show up without
 * waiting for TTL expiry.
 */
export class CacheAdminService {
  constructor(private readonly redis?: Redis) {}

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
      let deleted = 0;
      if (this.redis) {
        for (const pattern of ns.patterns) {
          deleted += await this.scanDelete(pattern);
        }
      }
      cleared.push({ key: ns.key, deletedKeysCount: deleted });
      totalDeletedKeys += deleted;
    }
    return { cleared, totalDeletedKeys };
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
