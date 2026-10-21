import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductRecord,
  LinePricesPort,
  LinePriceResult,
  OrganizationDetailsPort,
  ProductDisplayModePort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * What a cart line may cost at its **current** quantity — the one answer
 * `CartService` stores when a line is added, merged or has its quantity changed,
 * and that order placement compares the stored price with before it copies that
 * price onto the order line.
 *
 * One definition, because two would drift: the stored `unit_price` is what an
 * order is placed at, so a cart that priced a line one way and a placement that
 * checked it another would refuse a basket the buyer cannot repair.
 *
 * The chain:
 *
 *  1. **An agreed price, at the agreed quantity.** A line seeded from an
 *     accepted Quote Request carries the seller's price and the quantity it was
 *     agreed for. It holds only while the line holds that quantity; at any other
 *     quantity the line is priced like any other, and it gets the agreed price
 *     back if it returns to the agreed quantity.
 *  2. **The price books**, at the line's quantity and for the line's variant —
 *     base → catalogue → buyer, then a sale when lower (feature 160). The tier
 *     that priced the line is what the line records as its price source.
 *  3. **Nothing.** A line no tier prices is not orderable (FR-018). The
 *     Product's own legacy price (`defaultPrice`) stood in here until feature
 *     160; it is not a price, and the line follows the quote-only path instead.
 *     It used to become a line at `0.00` before that.
 *
 * A product sold on request only (display mode `none`) is not orderable outside
 * an agreement either.
 *
 * Prices resolve against the basket's own sales channel — the channel it is used
 * on (`specs/154-sales-channel-access/`, contracts/basket-attribution.md §2). They
 * used to resolve against the system-default channel whatever the basket, so a
 * list targeting another store never applied to its baskets.
 */

export interface CartLineAgreement {
  quantity: number | null;
  unitPrice: string | null;
  currency: string | null;
}

export interface CartPricingContext {
  channel: { id: string; defaultCurrency: string } | null;
  organization: Awaited<ReturnType<OrganizationDetailsPort['findById']>>;
  organizationId: string | null;
  signedIn: boolean;
  /**
   * D-287 P0 — the basket's customer account, whose own customer group
   * overrides the organisation's. `price_lists` applies the rule; optional so a
   * hand-built context for a guest needs nothing.
   */
  customerAccountId?: string | null;
}

export interface CartLinePriceInput {
  product: CatalogProductRecord;
  variantId: string | null;
  quantity: number;
  agreed?: CartLineAgreement | null;
}

export type CartLinePriceAnswer =
  | {
      ok: true;
      unitPrice: string;
      currency: string;
      source: 'agreed' | 'price_list';
      /**
       * Feature 160 (FR-030) — what the line records as `cart_items.price_source`:
       * `agreed`, or the price-book tier that priced it; `null` when the engine
       * named none.
       */
      priceSource: 'agreed' | 'base' | 'catalogue' | 'buyer' | 'sale' | null;
    }
  | { ok: false; reason: 'unpriced' | 'quote_only' };

export class CartLinePricing {
  constructor(
    /**
     * D-287 P0 — the batched line slice: a basket's lines are priced in one
     * call (the placement drift check and the login/reorder reprice looped one
     * `resolveLinePrice` per line). A single line is a batch of one, so there
     * is one chain and one call shape.
     */
    private readonly pricingService: LinePricesPort,
    private readonly displayModes: ProductDisplayModePort,
    private readonly organizations: OrganizationDetailsPort,
  ) {}

  /**
   * The channel and buyer every line of one cart is priced for, resolved once.
   * `salesChannelId` is the basket's channel; there is no fallback to the system
   * default, so a basket is never priced for a store it is not used on. A
   * channel that no longer exists prices nothing — never another channel's list.
   */
  async contextFor(
    em: EntityManager,
    input: {
      organizationId: string | null;
      signedIn: boolean;
      salesChannelId: string;
      /** D-287 P0 — the customer whose own group to price on. */
      customerAccountId?: string | null;
    },
  ): Promise<CartPricingContext> {
    const channel = await em.findOne(
      SalesChannel,
      { id: input.salesChannelId },
      { fields: ['id', 'defaultCurrency'] },
    );
    const organization = input.organizationId
      ? await this.organizations.findById(input.organizationId)
      : null;
    return {
      channel: channel ? { id: channel.id, defaultCurrency: channel.defaultCurrency } : null,
      organization,
      organizationId: input.organizationId,
      signedIn: input.signedIn,
      customerAccountId: input.customerAccountId ?? null,
    };
  }

  async orderablePrice(ctx: CartPricingContext, line: CartLinePriceInput): Promise<CartLinePriceAnswer> {
    const answers = await this.orderablePrices(ctx, [{ ...line, key: 'line' }]);
    return answers.get('line')!;
  }

  /**
   * {@link orderablePrice} for many lines of one basket, keyed by the caller's
   * `key`. The list prices of every line without an agreement come from one
   * batched `resolveLinePrices` call (D-287 P0); the chain per line is
   * unchanged.
   */
  async orderablePrices(
    ctx: CartPricingContext,
    lines: ReadonlyArray<CartLinePriceInput & { key: string }>,
  ): Promise<Map<string, CartLinePriceAnswer>> {
    const out = new Map<string, CartLinePriceAnswer>();
    const toResolve: Array<CartLinePriceInput & { key: string }> = [];
    for (const line of lines) {
      const agreed = agreedUnitPriceFor(line.quantity, line.agreed ?? null);
      if (agreed) out.set(line.key, { ok: true, ...agreed, source: 'agreed', priceSource: 'agreed' });
      else toResolve.push(line);
    }
    if (toResolve.length === 0) return out;

    // No `catch` (issue #84): `null` is the engine's own "no list applies", and
    // an absent `price_lists` throws `MODULE_DISABLED` through this call.
    const resolved: Map<string, LinePriceResult | null> = ctx.channel
      ? await this.pricingService.resolveLinePrices({
          lines: toResolve.map((line) => ({
            key: line.key,
            product: line.product,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
          context: {
            ...(ctx.organization ? { organization: ctx.organization } : {}),
            ...(ctx.organization && ctx.customerAccountId
              ? { customerAccountId: ctx.customerAccountId }
              : {}),
            salesChannel: ctx.channel,
          },
        })
      : new Map();

    for (const line of toResolve) {
      const price = resolved.get(line.key) ?? null;
      // Issue #236 — the mode is read off the list price when there is one, and
      // asked for on its own when there is not.
      const displayMode =
        price?.displayMode ??
        (ctx.channel
          ? await this.displayModes.resolveDisplayMode({
              productId: line.product.id,
              organizationId: ctx.organizationId,
              salesChannelId: ctx.channel.id,
              customerKind: ctx.signedIn ? 'signed_in' : 'guest',
            })
          : null);
      if (displayMode === 'none') {
        out.set(line.key, { ok: false, reason: 'quote_only' });
        continue;
      }
      if (price) {
        out.set(line.key, {
          ok: true,
          unitPrice: Number(price.amount).toFixed(2),
          currency: price.currency,
          source: 'price_list',
          priceSource: price.source ?? null,
        });
        continue;
      }
      // Feature 160 (FR-018) — a line no tier prices is unpriced. The product's
      // legacy own price (`defaultPrice`) used to stand in here; it is not a
      // price, and the line follows the quote-only path instead.
      out.set(line.key, { ok: false, reason: 'unpriced' });
    }
    return out;
  }
}

/** The agreed price, when the line holds the quantity it was agreed for. */
export function agreedUnitPriceFor(
  quantity: number,
  agreed: CartLineAgreement | null,
): { unitPrice: string; currency: string } | null {
  if (!agreed || agreed.quantity == null || agreed.unitPrice == null || agreed.currency == null) {
    return null;
  }
  if (agreed.quantity !== quantity) return null;
  return { unitPrice: Number(agreed.unitPrice).toFixed(2), currency: agreed.currency };
}


/** Whether a stored line price is not the price the line may be ordered at now. */
export function storedPriceDiffers(
  stored: { unitPrice: string; currency: string },
  current: { unitPrice: string; currency: string } | null,
): boolean {
  if (!current) return true;
  if (stored.currency.toUpperCase() !== current.currency.toUpperCase()) return true;
  return Number(stored.unitPrice).toFixed(2) !== Number(current.unitPrice).toFixed(2);
}

/** The agreement a line carries, in the shape `CartLinePricing` reads. */
export function agreementOf(item: {
  agreedQuantity?: number | null;
  agreedUnitPrice?: string | null;
  agreedCurrency?: string | null;
}): CartLineAgreement {
  return {
    quantity: item.agreedQuantity ?? null,
    unitPrice: item.agreedUnitPrice ?? null,
    currency: item.agreedCurrency ?? null,
  };
}
