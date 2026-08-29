import type { Redis } from 'ioredis';

/**
 * Token → published-artefact cache and its invalidator — feature 067 / FR-064,
 * research §R16.
 *
 * The public route's hot path is one indexed read on `product_feeds.token_hash`
 * plus one on the artefact. Caching it keeps a provider polling every 15
 * minutes off the database entirely.
 *
 * **The invalidation is the interesting half.** A TTL alone would mean a
 * rotated or revoked token keeps serving until it expires — which is the exact
 * thing rotation is supposed to prevent. So the cache is dropped eagerly on
 * `feed_changed`, `token_rotated` and `artefact_published`, and the TTL is only
 * the backstop for a missed event.
 *
 * Redis is optional throughout: with no Redis the cache is a no-op and every
 * request takes the two indexed reads, which is correct, merely slower. Tests
 * run this way deliberately (research §R18).
 */

/** Short by design — the eager invalidation carries the correctness, not this. */
const CACHE_TTL_SECONDS = 60;

const KEY_PREFIX = 'product_feeds:token:';

/** Everything the public route needs before it decides to open the object. */
export interface CachedFeedArtefact {
  feedId: string;
  slug: string;
  artefactId: string;
  storageBackend: 'local' | 's3' | 'gcs';
  storageLocator: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string | null;
  producedAtIso: string;
}

export interface FeedTokenCache {
  get(tokenHash: string): Promise<CachedFeedArtefact | null>;
  set(tokenHash: string, value: CachedFeedArtefact): Promise<void>;
  drop(tokenHash: string): Promise<void>;
  dropAllForFeed(feedId: string): Promise<void>;
}

/** Used whenever Redis is absent. Correct, just uncached. */
export class NoopFeedTokenCache implements FeedTokenCache {
  async get(): Promise<CachedFeedArtefact | null> {
    return null;
  }
  async set(): Promise<void> {
    /* nothing to cache into */
  }
  async drop(): Promise<void> {
    /* nothing to drop */
  }
  async dropAllForFeed(): Promise<void> {
    /* nothing to drop */
  }
}

export class RedisFeedTokenCache implements FeedTokenCache {
  /** Feed id → the token hashes cached for it, so a feed change drops them all. */
  private readonly hashesByFeed = new Map<string, Set<string>>();

  constructor(private readonly redis: Redis) {}

  async get(tokenHash: string): Promise<CachedFeedArtefact | null> {
    try {
      const raw = await this.redis.get(KEY_PREFIX + tokenHash);
      return raw ? (JSON.parse(raw) as CachedFeedArtefact) : null;
    } catch {
      // A cache read must never fail a public request; fall through to the DB.
      return null;
    }
  }

  async set(tokenHash: string, value: CachedFeedArtefact): Promise<void> {
    try {
      await this.redis.set(
        KEY_PREFIX + tokenHash,
        JSON.stringify(value),
        'EX',
        CACHE_TTL_SECONDS,
      );
      const set = this.hashesByFeed.get(value.feedId) ?? new Set<string>();
      set.add(tokenHash);
      this.hashesByFeed.set(value.feedId, set);
    } catch {
      /* caching is best-effort */
    }
  }

  async drop(tokenHash: string): Promise<void> {
    try {
      await this.redis.del(KEY_PREFIX + tokenHash);
    } catch {
      /* best-effort */
    }
  }

  async dropAllForFeed(feedId: string): Promise<void> {
    const hashes = this.hashesByFeed.get(feedId);
    if (!hashes) return;
    this.hashesByFeed.delete(feedId);
    for (const hash of hashes) await this.drop(hash);
  }
}

interface FeedChangedPayload {
  feedId?: string;
  previousTokenHash?: string | null;
}

/**
 * The three events that make a cached feed token stale. `backend.ts` registers
 * one `ctx.subscribe` per entry, so the list is the whole answer to "when is the
 * cache dropped" and adding a fourth event is one line in one place.
 */
export const FEED_CACHE_INVALIDATION_EVENTS = [
  'product_feeds.feed_changed',
  'product_feeds.token_rotated',
  'product_feeds.artefact_published',
] as const;

/**
 * Drops the cached tokens a feed write invalidates.
 *
 * The registration lives in this module's `backend.ts` and goes through
 * `ctx.subscribe`, so the cache stops being maintained when the module is
 * switched off — as it must, since the public feed routes stop answering at the
 * same moment (issue #107). These were three bare `eventBus.on` calls here.
 */
export async function invalidateFeedTokenCache(
  cache: FeedTokenCache,
  payload: unknown,
): Promise<void> {
  const { feedId, previousTokenHash } = (payload as FeedChangedPayload) ?? {};
  // The replaced hash first: rotation must stop serving the OLD URL
  // immediately, which is the whole point of having no grace window.
  if (previousTokenHash) await cache.drop(previousTokenHash);
  if (feedId) await cache.dropAllForFeed(feedId);
}
