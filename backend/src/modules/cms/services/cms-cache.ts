import type Redis from 'ioredis';
import type {
  CmsResolvedBlock,
  CmsResolvedHook,
  CmsResolvedPage,
} from '@b2b/contracts';

/**
 * Storefront read-through cache for the CMS module — feature 014 / T094 (R10).
 *
 * Caches the resolved payloads from `StorefrontResolver` under three key
 * families:
 *
 *   - `cms:v1:page:<slug>:<channel>:<language>`    → CmsResolvedPage
 *   - `cms:v1:block:<code>:<channel>:<language>`   → CmsResolvedBlock
 *   - `cms:v1:hook:<code>:<channel>:<language>`    → CmsResolvedHook
 *
 * TTL is fixed at 5 minutes; invalidation runs on every Page / Block /
 * Template / Hook write and on hook-attachment changes. Tests can pass a
 * custom `ttlSeconds` (or `0` to disable).
 */

export const CMS_CACHE_KEY_PREFIX = 'cms:v1:';
export const CMS_CACHE_DEFAULT_TTL_SECONDS = 5 * 60;

export interface CmsCacheOptions {
  ttlSeconds?: number;
  /** When false, get/set are short-circuit no-ops (useful for tests). */
  enabled?: boolean;
}

export class CmsCache {
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;

  constructor(private readonly redis: Redis, options: CmsCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? CMS_CACHE_DEFAULT_TTL_SECONDS;
    this.enabled = (options.enabled ?? true) && this.ttlSeconds > 0;
  }

  static pageKey(slug: string, channel: string, language: string): string {
    return `${CMS_CACHE_KEY_PREFIX}page:${encodeURIComponent(slug)}:${channel}:${language}`;
  }

  static blockKey(code: string, channel: string, language: string): string {
    return `${CMS_CACHE_KEY_PREFIX}block:${encodeURIComponent(code)}:${channel}:${language}`;
  }

  static hookKey(code: string, channel: string, language: string): string {
    return `${CMS_CACHE_KEY_PREFIX}hook:${encodeURIComponent(code)}:${channel}:${language}`;
  }

  async getPage(
    slug: string,
    channel: string,
    language: string,
  ): Promise<CmsResolvedPage | null> {
    return this.read<CmsResolvedPage>(CmsCache.pageKey(slug, channel, language));
  }

  async setPage(
    slug: string,
    channel: string,
    language: string,
    value: CmsResolvedPage,
  ): Promise<void> {
    await this.write(CmsCache.pageKey(slug, channel, language), value);
  }

  async getBlock(
    code: string,
    channel: string,
    language: string,
  ): Promise<CmsResolvedBlock | null> {
    return this.read<CmsResolvedBlock>(CmsCache.blockKey(code, channel, language));
  }

  async setBlock(
    code: string,
    channel: string,
    language: string,
    value: CmsResolvedBlock,
  ): Promise<void> {
    await this.write(CmsCache.blockKey(code, channel, language), value);
  }

  async getHook(
    code: string,
    channel: string,
    language: string,
  ): Promise<CmsResolvedHook | null> {
    return this.read<CmsResolvedHook>(CmsCache.hookKey(code, channel, language));
  }

  async setHook(
    code: string,
    channel: string,
    language: string,
    value: CmsResolvedHook,
  ): Promise<void> {
    await this.write(CmsCache.hookKey(code, channel, language), value);
  }

  /** Drop every page-keyed entry for a given slug across every channel/language. */
  async invalidatePagesBySlug(slugs: Iterable<string>): Promise<void> {
    const patterns = Array.from(slugs).map(
      (slug) => `${CMS_CACHE_KEY_PREFIX}page:${encodeURIComponent(slug)}:*`,
    );
    await this.scanDelete(patterns);
  }

  async invalidateBlocksByCode(codes: Iterable<string>): Promise<void> {
    const patterns = Array.from(codes).map(
      (code) => `${CMS_CACHE_KEY_PREFIX}block:${encodeURIComponent(code)}:*`,
    );
    await this.scanDelete(patterns);
  }

  async invalidateHooksByCode(codes: Iterable<string>): Promise<void> {
    const patterns = Array.from(codes).map(
      (code) => `${CMS_CACHE_KEY_PREFIX}hook:${encodeURIComponent(code)}:*`,
    );
    await this.scanDelete(patterns);
  }

  /**
   * Drop every cached page in the namespace. Used when a Block / Template
   * change ripples through pages that embed it; we don't track inverse
   * indices yet, so a coarse drop is acceptable at platform scale.
   */
  async invalidateAllPages(): Promise<void> {
    await this.scanDelete([`${CMS_CACHE_KEY_PREFIX}page:*`]);
  }

  /** Used in tests + as a sweep on full cache reset. */
  async invalidateAll(): Promise<void> {
    await this.scanDelete([`${CMS_CACHE_KEY_PREFIX}*`]);
  }

  private async read<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A stray non-JSON value never came from us — drop it and miss.
      await this.redis.del(key);
      return null;
    }
  }

  private async write(key: string, value: unknown): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
  }

  private async scanDelete(patterns: string[]): Promise<void> {
    if (!this.enabled || patterns.length === 0) return;
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          200,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    }
  }
}
