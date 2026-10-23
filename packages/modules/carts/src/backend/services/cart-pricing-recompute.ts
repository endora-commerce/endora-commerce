import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogProductReadPort } from '@endora-commerce/contracts';
import type { CartRecomputeCache, CachedCartRecompute } from './cart-recompute-cache.js';
import type { CartItem } from '../entities/cart-item.entity.js';
import type { CartLineAgreement, CartLinePricing } from './cart-line-pricing.js';

/**
 * Per-cart pricing-recompute helper (feature 027 §R5) — the prices
 * `GET /api/v1/cart` shows.
 *
 * **One chain with placement** (issue #168). Every line is priced through
 * `CartLinePricing.orderablePrices`, the chain order placement's drift check
 * runs and every add, merge and quantity change stores from: the agreed quote
 * price at the agreed quantity, then the price books at the line's quantity and
 * variant (feature 160 — a product has no price of its own any more, so a line
 * no book prices is unpriced and refused), and a product sold on request only
 * (display mode `none`) is refused. The read used to run a second chain — a
 * plain list price per line — so a quote-seeded line read at the list price and
 * was charged the agreed one, and a product sold on request only read as
 * orderable while placement refused it. The property
 * is `backend/test/integration/carts/cart-read-equals-placement.test.ts`.
 *
 * A line the chain refuses answers `amount: null` with its `refusal`; the
 * route reads such a line as unavailable, which is what placement does with
 * it.
 *
 * Batched (D-287 P0): every line without an agreement is priced in one
 * `resolveLinePrices` call. The Redis cache amortises repeat reads within its
 * TTL; every cart write invalidates it.
 */

export interface RecomputeLineRequest {
  cartItemId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  /** The line's agreement (a quote-seeded line), as placement reads it. */
  agreed?: CartLineAgreement | null;
}

/** Why the chain gave a line no orderable price. */
export type RecomputeRefusal = 'unpriced' | 'quote_only' | 'product_missing';

export interface RecomputedLinePrice {
  cartItemId: string;
  amount: number | null;
  currency: string;
  /** Set exactly when `amount` is `null`. */
  refusal?: RecomputeRefusal | null;
}

export interface CartPricingRecomputeContext {
  cartId: string;
  organizationId: string | null;
  /**
   * The basket's channel. Required: every basket carries the channel it is used
   * on (`specs/154-sales-channel-access/`, M3 recorded the ones that did not),
   * so the system-default fallback this used to take is gone rather than kept
   * for a case that no longer occurs.
   */
  salesChannelId: string;
  /**
   * D-287 P0 — the basket's customer, whose own customer group overrides the
   * organisation's. Absent for a guest basket.
   */
  customerAccountId?: string | null;
}

export class CartPricingRecompute {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** The chain placement prices by (issue #168) — `price_lists` behind it. */
    private readonly linePricing: CartLinePricing,
    private readonly cache: CartRecomputeCache,
    /** `catalog`'s product read model — the two fields the resolver reads. */
    private readonly catalogProducts: CatalogProductReadPort,
  ) {}

  async recompute(
    ctx: CartPricingRecomputeContext,
    lines: RecomputeLineRequest[],
  ): Promise<RecomputedLinePrice[]> {
    if (lines.length === 0) return [];

    // Cache hit returns the previously resolved prices in their original
    // order (the cache stores keyed by cartItemId so any line removed
    // since the last resolve is naturally dropped on the next read).
    const cached = await this.cache.get(ctx.cartId);
    if (cached && this.allLinesCached(cached, lines)) {
      return lines.map((line) => {
        const hit = cached.lines.find((c) => c.cartItemId === line.cartItemId);
        if (!hit) return { cartItemId: line.cartItemId, amount: null, currency: '', refusal: null };
        return {
          cartItemId: line.cartItemId,
          amount: hit.unitPrice.amount,
          currency: hit.unitPrice.currency,
          refusal: hit.refusal ?? null,
        };
      });
    }

    // Cache miss → resolve from scratch: one context (channel, organisation,
    // customer) for the cart, one batched resolution for its lines.
    const em = this.emFactory();
    const pricingCtx = await this.linePricing.contextFor(em, {
      organizationId: ctx.organizationId,
      // The viewer kind the display-mode chain reads; placement is always a
      // signed-in buyer's, and a basket with an organisation is one.
      signedIn: ctx.organizationId !== null,
      salesChannelId: ctx.salesChannelId,
      customerAccountId: ctx.customerAccountId ?? null,
    });

    const productIds = Array.from(new Set(lines.map((l) => l.productId)));
    const products = await this.catalogProducts.findByIds(productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    // No `catch` (issue #84): an absent `price_lists` throws `MODULE_DISABLED`
    // through this call, and caching "no price" for the whole cart while it was
    // switched off is exactly what the TTL then kept doing after it came back.
    const answers = await this.linePricing.orderablePrices(
      pricingCtx,
      lines.flatMap((line) => {
        const product = productById.get(line.productId);
        return product
          ? [
              {
                key: line.cartItemId,
                product,
                variantId: line.variantId ?? null,
                quantity: line.quantity,
                agreed: line.agreed ?? null,
              },
            ]
          : [];
      }),
    );

    const recomputed: RecomputedLinePrice[] = lines.map((line) => {
      const answer = answers.get(line.cartItemId);
      if (!answer) {
        return { cartItemId: line.cartItemId, amount: null, currency: '', refusal: 'product_missing' };
      }
      if (!answer.ok) {
        return { cartItemId: line.cartItemId, amount: null, currency: '', refusal: answer.reason };
      }
      return {
        cartItemId: line.cartItemId,
        amount: Number(answer.unitPrice),
        currency: answer.currency,
        refusal: null,
      };
    });

    // Write the resolved set to the cache so subsequent reads within the
    // TTL skip the resolver entirely, refusals included.
    const payload: CachedCartRecompute = {
      cartId: ctx.cartId,
      lines: recomputed.map((r) => ({
        cartItemId: r.cartItemId,
        unitPrice: { amount: r.amount, currency: r.currency },
        refusal: r.refusal ?? null,
        resolvedAt: new Date().toISOString(),
      })),
      resolvedAt: new Date().toISOString(),
    };
    await this.cache.put(ctx.cartId, payload);

    return recomputed;
  }

  /** Persist the most recently recomputed prices back onto `cart_items`. */
  async writeBackTo(em: EntityManager, items: CartItem[], prices: RecomputedLinePrice[]): Promise<void> {
    // command-coverage-ignore: writes derived (recomputed) line prices back to the
    // ephemeral cart — transient working state, not an audited domain mutation.
    const byId = new Map(prices.map((p) => [p.cartItemId, p]));
    const now = new Date();
    for (const item of items) {
      const price = byId.get(item.id);
      if (!price || price.amount === null) continue;
      item.recomputedUnitPrice = price.amount.toFixed(2);
      item.recomputedAt = now;
      item.recomputedCurrency = price.currency;
    }
    await em.flush();
  }

  private allLinesCached(cached: CachedCartRecompute, lines: RecomputeLineRequest[]): boolean {
    const cachedIds = new Set(cached.lines.map((l) => l.cartItemId));
    return lines.every((l) => cachedIds.has(l.cartItemId));
  }
}
