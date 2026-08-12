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
}

export function decorate(inner: PricingServiceContract): PricingServiceContract {
  return new ExamplePricingService(inner);
}
