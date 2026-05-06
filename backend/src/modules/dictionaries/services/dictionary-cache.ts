import type Redis from 'ioredis';

export const DICTIONARY_CACHE_KEY_PREFIX = 'dictionary:';
export const DICTIONARY_CACHE_DEFAULT_TTL_SECONDS = 60 * 60;

export interface DictionaryCacheOptions {
  ttlSeconds?: number;
  enabled?: boolean;
}

export class DictionaryCache {
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;

  constructor(private readonly redis: Redis, options: DictionaryCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? DICTIONARY_CACHE_DEFAULT_TTL_SECONDS;
    this.enabled = (options.enabled ?? true) && this.ttlSeconds > 0;
  }

  static registryKey(channelCode: string, locale: string): string {
    return `${DICTIONARY_CACHE_KEY_PREFIX}registry:v1:${channelCode}:${locale}`;
  }

  static byCodeKey(entryType: string, entryCode: string, locale: string): string {
    return `${DICTIONARY_CACHE_KEY_PREFIX}by-code:v1:${entryType}:${entryCode}:${locale}`;
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

  async invalidateAll(): Promise<void> {
    if (!this.enabled) return;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${DICTIONARY_CACHE_KEY_PREFIX}*:v1:*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }
}

