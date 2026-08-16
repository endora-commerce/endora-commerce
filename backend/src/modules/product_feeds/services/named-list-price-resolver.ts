/**
 * Reading a **named** price list, through the port that owns it (issue #132).
 *
 * A feed pinned to a price list uses that list verbatim (FR-020) — no rule
 * evaluation, no fall-through. That read used to be a `select` against
 * `price_list_price_brackets` issued from this module, which put another
 * module's table in this module's SQL (Principle I) and, worse, bypassed the
 * gate on its registration: a feed could publish prices while the platform was
 * refusing to serve them, because nothing on the path could raise
 * `MODULE_DISABLED`.
 *
 * Nothing here catches. A switched-off `price_lists` must reach the feed run
 * and fail it; swallowing that is how fail-closed turns into fail-open.
 */

/** The slice of the `pricingService` port a named-list read needs. */
export interface NamedListPricePort {
  namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
  }): Promise<Map<string, string>>;
}

export interface NamedListPriceResolvers {
  /** One product's amount on the list, or `null` when the list does not price it. */
  one(input: {
    priceListId: string;
    productId: string;
    currencyCode: string;
  }): Promise<number | null>;
  /** The same read for a batch; unpriced products are absent from the map. */
  many(input: {
    priceListId: string;
    productIds: readonly string[];
    currencyCode: string;
  }): Promise<Map<string, number>>;
}

export function createNamedListPriceResolver(
  pricing: NamedListPricePort,
): NamedListPriceResolvers {
  async function many(input: {
    priceListId: string;
    productIds: readonly string[];
    currencyCode: string;
  }): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (input.productIds.length === 0) return out;
    const amounts = await pricing.namedListPrices({
      priceListId: input.priceListId,
      currencyCode: input.currencyCode,
      productIds: input.productIds,
    });
    // `Number(amount)` and not a truthiness test: a list amount of `0` is a
    // price, and dropping it here would republish the product as unpriced.
    for (const [productId, amount] of amounts) out.set(productId, Number(amount));
    return out;
  }

  return {
    many,
    async one(input) {
      const amounts = await many({
        priceListId: input.priceListId,
        productIds: [input.productId],
        currencyCode: input.currencyCode,
      });
      const amount = amounts.get(input.productId);
      return amount === undefined ? null : amount;
    },
  };
}
