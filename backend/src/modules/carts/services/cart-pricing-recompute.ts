import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductReadPort,
  LinePricePort,
  OrganizationDetailsPort,
} from '@b2b/contracts';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { CartRecomputeCache, CachedCartRecompute } from './cart-recompute-cache.js';
import type { CartItem } from '../entities/cart-item.entity.js';

/**
 * Per-cart pricing-recompute helper (feature 027 §R5).
 *
 * Re-resolves the unit price of every cart line against the customer's
 * current resolved price list. The cache (when available) lets the
 * mini-cart → full-cart → checkout-entry walk reuse the same resolver
 * output for 30 s.
 *
 * Inputs: the line set is the list of `CartItem` rows for one cart.
 * Outputs: per-line `{cartItemId, amount, currency}` — `amount` is null
 * when the resolver returned null (no eligible price-list bracket for
 * this customer; the cart UI surfaces a `no_price_in_customer_list`
 * unavailability reason for the line).
 *
 * Implementation note: PricingService is per-line today (no batched
 * variant). The cache amortizes work across reads; a future optimization
 * may batch into a single PricingService call when the resolver gains a
 * batch endpoint.
 */

export interface RecomputeLineRequest {
  cartItemId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface RecomputedLinePrice {
  cartItemId: string;
  amount: number | null;
  currency: string;
}

export interface CartPricingRecomputeContext {
  cartId: string;
  organizationId: string | null;
  salesChannelId: string | null;
}

export class CartPricingRecompute {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `price_lists`' line-resolution slice (feature 075, Phase C). */
    private readonly pricingService: LinePricePort,
    private readonly cache: CartRecomputeCache,
    /** `catalog`'s product read model — the two fields the resolver reads. */
    private readonly catalogProducts: CatalogProductReadPort,
    /** `organizations`' read model — the buying org and its customer group. */
    private readonly organizations: OrganizationDetailsPort,
  ) {}

  async recompute(
    ctx: CartPricingRecomputeContext,
    lines: RecomputeLineRequest[],
  ): Promise<RecomputedLinePrice[]> {
    if (lines.length === 0) return [];

    // Cache hit returns the previously resolved prices in their original
    // order (the cache stores keyed by cartItemId so any line removed
    // since the last resolve is naturally dropped on the next read).
    // `unitPrice.amount === null` in the cache means the resolver
    // previously returned no eligible price; we propagate the null so
    // the caller falls back to the snapshot.
    const cached = await this.cache.get(ctx.cartId);
    if (cached && this.allLinesCached(cached, lines)) {
      return lines.map((line) => {
        const hit = cached.lines.find((c) => c.cartItemId === line.cartItemId);
        if (!hit) {
          return { cartItemId: line.cartItemId, amount: null, currency: 'PLN' };
        }
        return {
          cartItemId: line.cartItemId,
          amount: hit.unitPrice.amount,
          currency: hit.unitPrice.currency,
        };
      });
    }

    // Cache miss → resolve from scratch. We load the channel + org once
    // (per-cart) rather than per-line.
    const em = this.emFactory();
    const channel = await this.loadChannel(em, ctx.salesChannelId);
    const organization = ctx.organizationId
      ? await this.organizations.findById(ctx.organizationId)
      : null;

    if (!channel) {
      return lines.map((line) => ({ cartItemId: line.cartItemId, amount: null, currency: 'PLN' }));
    }

    const productIds = Array.from(new Set(lines.map((l) => l.productId)));
    const products = await this.catalogProducts.findByIds(productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    const recomputed: RecomputedLinePrice[] = [];
    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!product) {
        recomputed.push({ cartItemId: line.cartItemId, amount: null, currency: 'PLN' });
        continue;
      }
      // No `catch` (issue #84): `resolveLinePrice` already answers "no resolver
      // match" with `null`, which is the `amount: null` this loop wants, and
      // that answer then goes into the recompute cache below. A `catch` here
      // cached "no price" for the whole cart whenever `price_lists` was
      // switched off, and the TTL kept doing it after it came back.
      const resolved = await this.pricingService.resolveLinePrice({
        product,
        variantId: line.variantId ?? null,
        context: {
          quantity: line.quantity,
          ...(organization ? { organization } : {}),
          salesChannel: channel,
        },
      });
      if (!resolved) {
        recomputed.push({ cartItemId: line.cartItemId, amount: null, currency: 'PLN' });
      } else {
        recomputed.push({
          cartItemId: line.cartItemId,
          amount: Number(resolved.amount),
          currency: resolved.currency,
        });
      }
    }

    // Write the resolved set to the cache so subsequent reads within the
    // TTL skip the resolver entirely. `amount: null` is preserved so the
    // cache hit correctly signals "no resolver match — use snapshot".
    const payload: CachedCartRecompute = {
      cartId: ctx.cartId,
      lines: recomputed.map((r) => ({
        cartItemId: r.cartItemId,
        unitPrice: { amount: r.amount, currency: r.currency },
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

  private async loadChannel(em: EntityManager, channelId: string | null): Promise<SalesChannel | null> {
    if (channelId) {
      return em.findOne(SalesChannel, { id: channelId });
    }
    return em.findOne(SalesChannel, { systemDefault: true });
  }
}
