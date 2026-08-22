// Example deployment — the reference client override (feature 072, T066).
//
// It decorates the `pricingService` registration: it receives the
// implementation it is overriding and returns one that wraps it. Feature 057
// did this by shadowing `modules/price_lists/services/pricing-service.ts` with
// a subclass, resolved by file path. Two things changed, and only the second
// is cosmetic:
//
//   - **Delegation instead of replacement (D-28).** A subclass override stops
//     receiving core fixes to the methods it overrides — whatever core does to
//     `resolveLinePrice` next month happens in a file this deployment no longer
//     runs. A wrapper keeps core in the call path and adjusts its result, so
//     the fix arrives and the client behaviour survives it.
//   - **Named by registration, not by path.** `pricing-service.ts` here means
//     "the `pricingService` registration", not "the file at that path in
//     price_lists" — so an override no longer breaks when core moves a file,
//     and a reader can tell what is overridden without diffing two trees.

import type {
  DisplayMode,
  ListingPrice,
  ListingPriceOrderChunk,
  ListingPriceOrderQuery,
  ListingPriceViewerContext,
} from '@endora-commerce/contracts';
import type {
  ListingPricesInput,
  PricingLineResult,
  PricingResolutionInput,
  PricingServiceContract,
} from '../../../modules/price_lists/services/pricing-service.interface.js';

/**
 * Client-specific behaviour: tags every resolved line price so the override is
 * observable end-to-end. A real deployment would apply a bespoke pricing rule
 * here; delegating for everything else is what keeps core resolution intact.
 */
class ExamplePricingService implements PricingServiceContract {
  constructor(private readonly inner: PricingServiceContract) {}

  async resolveEngine(
    input: PricingResolutionInput,
  ): ReturnType<PricingServiceContract['resolveEngine']> {
    return this.inner.resolveEngine(input);
  }

  async resolveLinePrice(input: PricingResolutionInput): Promise<PricingLineResult | null> {
    const base = await this.inner.resolveLinePrice(input);
    if (base === null) return null;
    return { ...base, priceListId: `overlay:${base.priceListId}` };
  }

  async listBracketMinQuantities(productId: string, currencyCode: string): Promise<number[]> {
    return this.inner.listBracketMinQuantities(productId, currencyCode);
  }

  /**
   * Issue #132 — the catalogue-listing chain. Delegated whole, so the listing a
   * buyer browses and the line a buyer buys keep agreeing on this deployment;
   * the tag this decoration adds rides along on the `price_list` arm because
   * core builds that arm from `resolveLinePrice` above.
   */
  async resolveListingPrices(input: ListingPricesInput): Promise<Map<string, ListingPrice>> {
    return this.inner.resolveListingPrices(input);
  }

  async namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
  }): Promise<Map<string, string>> {
    return this.inner.namedListPrices(input);
  }

  /**
   * Feature 086 — the listing ordering, delegated whole, for the same reason
   * `resolveListingPrices` is: the order a buyer sorts by and the figure on the
   * card have to be the same relation, and a decoration that reordered one
   * without the other would put this deployment's own tag on a listing whose
   * positions came from somewhere else.
   */
  async orderByUnitPrice(input: ListingPriceOrderQuery): Promise<ListingPriceOrderChunk> {
    return this.inner.orderByUnitPrice(input);
  }

  async pricedProductIds(input: {
    context: ListingPriceViewerContext;
    productIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    return this.inner.pricedProductIds(input);
  }

  async pageDisplayMode(input: { context: ListingPriceViewerContext }): Promise<DisplayMode> {
    return this.inner.pageDisplayMode(input);
  }
}

export function decorate(inner: PricingServiceContract): PricingServiceContract {
  return new ExamplePricingService(inner);
}
