import type { Redis } from 'ioredis';

/**
 * Storefront read-through cache for the Blog module — feature 016 / T020.
 *
 * Mirrors feature 014's `CmsCache` and feature 015's `MegamenuCache` shape
 * exactly: same key-prefix scheme, same default TTL, same SCAN-based
 * coarse invalidation. Keys live under `blog:v1:<channelCode>:<language>`.
 *
 * Per `research.md` § R9 the cache holds four kinds of entry:
 *
 *   blog:v1:<channel>:<language>:index
 *   blog:v1:<channel>:<language>:category:<slug>:p<page>
 *   blog:v1:<channel>:<language>:post:<slug>
 *   blog:v1:<channel>:<language>:tag:<code>:p<page>
 *
 * Invalidation is per-write (publishing a Post invalidates that post's
 * key, every category page that contained it, every tag page that
 * contained it, and the index for every channel the post is in). Settings
 * writes invalidate the whole channel keyspace via `invalidateChannel`.
 */

export const BLOG_CACHE_KEY_PREFIX = 'blog:v1:';
export const BLOG_CACHE_DEFAULT_TTL_SECONDS = 5 * 60;

export interface BlogCacheOptions {
  ttlSeconds?: number;
  /** When false, get/set are short-circuit no-ops (useful for tests). */
  enabled?: boolean;
}

function channelLanguagePrefix(channelCode: string, language: string): string {
  return `${BLOG_CACHE_KEY_PREFIX}${channelCode}:${language}`;
}

export class BlogCacheService {
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;

  constructor(private readonly redis: Redis, options: BlogCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? BLOG_CACHE_DEFAULT_TTL_SECONDS;
    this.enabled = (options.enabled ?? true) && this.ttlSeconds > 0;
  }

  static composeIndexKey(channelCode: string, language: string): string {
    return `${channelLanguagePrefix(channelCode, language)}:index`;
  }

  static composeCategoryKey(
    channelCode: string,
    language: string,
    slug: string,
    page: number,
  ): string {
    return `${channelLanguagePrefix(channelCode, language)}:category:${slug}:p${page}`;
  }

  static composePostKey(channelCode: string, language: string, slug: string): string {
    return `${channelLanguagePrefix(channelCode, language)}:post:${slug}`;
  }

  static composeTagKey(
    channelCode: string,
    language: string,
    code: string,
    page: number,
  ): string {
    return `${channelLanguagePrefix(channelCode, language)}:tag:${code}:p${page}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  async set<T>(key: string, payload: T): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(key, JSON.stringify(payload), 'EX', this.ttlSeconds);
  }

  /** Drop one key (used after the post-by-slug write). */
  async invalidateKey(key: string): Promise<void> {
    if (!this.enabled) return;
    await this.redis.del(key);
  }

  /** Drop every key under a channel + language scope. */
  async invalidateScope(channelCode: string, language: string): Promise<void> {
    await this.scanDelete(`${channelLanguagePrefix(channelCode, language)}:*`);
  }

  /** Drop every key under a channel (covers every language). Used on settings writes. */
  async invalidateChannel(channelCode: string): Promise<void> {
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*`);
  }

  /** Drop the entire blog keyspace. Used by tests and by global config changes. */
  async invalidateAll(): Promise<void> {
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}*`);
  }

  /** Drop every entry that mentions a specific category slug across every language of a channel. */
  async invalidateCategory(channelCode: string, slug: string): Promise<void> {
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*:category:${slug}:*`);
  }

  /** Drop every entry that mentions a specific post slug across every language of a channel. */
  async invalidatePost(channelCode: string, slug: string): Promise<void> {
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*:post:${slug}`);
    // Indices and category/tag pages may include the post — coarsely drop them.
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*:index`);
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*:category:*`);
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*:tag:*`);
  }

  /** Drop every entry that mentions a specific tag code across every language of a channel. */
  async invalidateTag(channelCode: string, code: string): Promise<void> {
    await this.scanDelete(`${BLOG_CACHE_KEY_PREFIX}${channelCode}:*:tag:${code}:*`);
  }

  private async scanDelete(pattern: string): Promise<void> {
    if (!this.enabled) return;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }
}
