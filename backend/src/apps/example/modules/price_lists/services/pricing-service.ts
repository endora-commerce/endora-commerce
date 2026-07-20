// Example deployment overlay — overrides the core pricing engine (feature 057).
//
// This is the reference service override: it shadows
// `backend/src/modules/price_lists/services/pricing-service.ts` when the build
// runs with DEPLOYMENT=example. It `extends` the core class (delegating to it)
// and satisfies `PricingServiceContract` by construction, so the standard tsc
// build is the contract gate. It is inert for any other deployment / bare core.

// Overlay files are dynamically imported at runtime, so they use relative
// `.js` specifiers (the codebase convention) — a tsconfig path alias like
// `@core/*` resolves under tsc/tsx but NOT under `node dist/` in production.
import { PricingService as CorePricingService } from '../../../../../modules/price_lists/services/pricing-service.js';
import type {
  PricingLineResult,
  PricingResolutionInput,
} from '../../../../../modules/price_lists/services/pricing-service.interface.js';

/**
 * Client-specific behavior: tags every resolved line price so the overlay is
 * observable end-to-end. Real deployments would apply a bespoke pricing rule
 * here; delegating to `super` keeps the core resolution intact.
 */
export class PricingService extends CorePricingService {
  override async resolveLinePrice(
    input: PricingResolutionInput,
  ): Promise<PricingLineResult | null> {
    const base = await super.resolveLinePrice(input);
    if (base === null) return null;
    return { ...base, priceListId: `overlay:${base.priceListId}` };
  }
}
