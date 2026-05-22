import type Redis from 'ioredis';

/**
 * Redis-backed per-cart pricing-recompute cache (feature 027 §R5).
 *
 * Stores the most recently re-resolved line prices keyed by `cartId` so
 * the mini-cart → full-cart → checkout-entry walk does not re-run the
 * `PricingService.resolveLinePrice` resolver three times within seconds.
 *
 * Cache TTL is short (30 s by default) so a price-list edit propagates to
 * the buyer's next page-open with predictable latency. Every cart-side
 * write must call `invalidate(cartId)` so the next read sees fresh
 * resolver output.
 *
 * The cache is **optional** — when Redis is unavailable the cache may be
 * disabled (set `enabled: false` in the options) and the recompute helper
 * still works (just resolves on every read).
 */

export const CART_RECOMPUTE_CACHE_KEY_PREFIX = 'b2b:cart:recompute:';
export const CART_RECOMPUTE_CACHE_DEFAULT_TTL_SECONDS = 30;

export interface CartRecomputeCacheOptions {
  ttlSeconds?: number;
  enabled?: boolean;
}

export interface CachedCartLinePrice {
  cartItemId: string;
  /** `amount: null` = resolver failed; the caller should fall back to the snapshot. */
  unitPrice: { amount: number | null; currency: string };
  resolvedAt: string;
}

export interface CachedCartRecompute {
  cartId: string;
  lines: CachedCartLinePrice[];
  /** Wall-clock when the resolver was last asked. ISO-8601. */
  resolvedAt: string;
}

export class CartRecomputeCache {
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;

  constructor(private readonly redis: Redis, options: CartRecomputeCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? CART_RECOMPUTE_CACHE_DEFAULT_TTL_SECONDS;
    this.enabled = (options.enabled ?? true) && this.ttlSeconds > 0;
  }

  static keyFor(cartId: string): string {
    return `${CART_RECOMPUTE_CACHE_KEY_PREFIX}${cartId}`;
  }

  async get(cartId: string): Promise<CachedCartRecompute | null> {
    if (!this.enabled) return null;
    const raw = await this.redis.get(CartRecomputeCache.keyFor(cartId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as CachedCartRecompute;
    } catch {
      await this.redis.del(CartRecomputeCache.keyFor(cartId));
      return null;
    }
  }

  async put(cartId: string, payload: CachedCartRecompute): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(
      CartRecomputeCache.keyFor(cartId),
      JSON.stringify(payload),
      'EX',
      this.ttlSeconds,
    );
  }

  async invalidate(cartId: string): Promise<void> {
    if (!this.enabled) return;
    await this.redis.del(CartRecomputeCache.keyFor(cartId));
  }
}
