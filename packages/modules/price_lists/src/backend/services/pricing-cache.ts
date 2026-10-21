/**
 * In-memory LRU cache around the pricing resolver (T064).
 *
 * Keyed on the tuple documented in
 * `contracts/pricing-resolution.contract.md` § Caching:
 *   (productId, variantId?, quantity, currency, salesChannelId, organizationId?, customerGroupId?)
 *
 * TTL is the resolver's contractual upper bound (60 s) — the
 * storefront's existing 60-s revalidate window is the system of
 * record, so anything older is dropped on read regardless of LRU
 * position. Capacity bounds memory growth on busy storefronts; the
 * Map's insertion-order iteration gives O(1) LRU eviction without
 * pulling a new runtime dependency.
 *
 * Invalidation: every write path on `PriceListService` calls
 * `invalidateAll()` — through `PricingGeneration`, **after** the write
 * commits, which also announces the bump to every other process (D-287
 * P0). Coarse but correct — the resolver fans across every active list,
 * so any list mutation in principle affects every tuple, and the cache
 * is rebuilt within seconds of a quiet period.
 *
 * **A fill that began before an invalidation is not stored.** A
 * resolution reads {@link PricingCache.generation} before its first
 * statement and hands it back to `set`; if a write committed and
 * invalidated in between, the answer it read is the pre-write one, and
 * storing it would pin that price for a whole TTL. The caller still gets
 * its answer — it is what the database said when it asked.
 *
 * Tests opt out by passing `{ ttlMs: 0 }` so each call goes through.
 */

/**
 * Feature 160 (D-287 P1, research R6) — the price-book engine's key: the
 * pricing profile (which carries channel, currency, precedence version and the
 * buyer-book vector) instead of the organization and group, so buyers who meet
 * the same books share entries.
 */
export interface ProfilePricingCacheKey {
  profileKey: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface PricingCacheKey {
  productId: string;
  variantId: string | null;
  quantity: number;
  currencyCode: string;
  salesChannelId: string;
  organizationId: string | null;
  customerGroupId: string | null;
}

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

export const DEFAULT_PRICING_CACHE_TTL_MS = 60_000;
const DEFAULT_CAPACITY = 5_000;

export class PricingCache<T, K = PricingCacheKey> {
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly serialize: (key: K) => string;
  private readonly entries = new Map<string, CachedEntry<T>>();
  private hitCount = 0;
  private missCount = 0;
  #generation = 0;

  constructor(
    options: { ttlMs?: number; capacity?: number; serialize?: (key: K) => string } = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PRICING_CACHE_TTL_MS;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.serialize = options.serialize ?? stableKey;
  }

  /** Whether entries are kept at all (`ttlMs > 0`). */
  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: K): T | undefined {
    if (this.ttlMs <= 0) return undefined;
    const k = this.serialize(key);
    const entry = this.entries.get(k);
    if (!entry) {
      this.missCount += 1;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(k);
      this.missCount += 1;
      return undefined;
    }
    // Refresh LRU position by reinserting.
    this.entries.delete(k);
    this.entries.set(k, entry);
    this.hitCount += 1;
    return entry.value;
  }

  /** Bumped by every {@link invalidateAll}; see the header. */
  get generation(): number {
    return this.#generation;
  }

  /**
   * Store an answer. `generation` is the value of {@link generation} read
   * before the resolution started; an answer that straddled an
   * invalidation is dropped rather than stored.
   */
  set(key: K, value: T, generation?: number): void {
    if (this.ttlMs <= 0) return;
    if (generation !== undefined && generation !== this.#generation) return;
    const k = this.serialize(key);
    if (this.entries.has(k)) this.entries.delete(k);
    else if (this.entries.size >= this.capacity) {
      // Evict oldest insertion (Map iterates in insertion order).
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(k, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidateAll(): void {
    this.#generation += 1;
    this.entries.clear();
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.entries.size, hits: this.hitCount, misses: this.missCount };
  }
}

/**
 * The default serializer: every field of the key, in key-name order, so any
 * flat key object serializes deterministically (feature 160 — the profile key
 * and the profile memo key share the cache class with the legacy key).
 */
function stableKey(key: unknown): string {
  const record = key as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .map((name) => `${name}=${String(record[name] ?? '')}`)
    .join('|');
}
