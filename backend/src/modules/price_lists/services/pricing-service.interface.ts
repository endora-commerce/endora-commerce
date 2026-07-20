// Formalized contract for the price-list pricing engine (feature 057, R4).
//
// This is the documented interface an overlay MUST satisfy to override the core
// `PricingService` for a deployment. It captures exactly the surface consumers
// depend on — `resolveEngine` and `resolveLinePrice` — so an overlay can replace
// the implementation and every consumer keeps type-checking. The core class
// `implements` this interface, so if the interface changes, a stale overlay
// stops being assignable and the build fails (contract drift = build error).

import type { DisplayMode } from '@b2b/contracts';
import type { Product } from '../../catalog/entities/product.entity.js';
import type { Organization } from '../../organizations/entities/organization.entity.js';
import type { PriceBracketRow } from './price-bracket-resolver.js';

/** The resolution context shared by both pricing entry points. */
export interface PricingResolutionInput {
  product: Product;
  variantId?: string | null;
  context: {
    quantity: number;
    organization?: Organization | null;
    /** Feature 040 — customer's direct group overrides the org's (R6). */
    customerGroupId?: string | null;
    /** The request's resolved sales channel (only `id` + `defaultCurrency` read). */
    salesChannel: { id: string; defaultCurrency: string };
    currencyCode?: string;
  };
}

export interface PricingEngineResult {
  base: { listId: string; listName: string; bracket: PriceBracketRow | null };
  sale: { listId: string; listName: string; bracket: PriceBracketRow } | null;
  displayMode: DisplayMode;
  currencyCode: string;
}

export interface PricingLineResult {
  amount: string;
  currency: string;
  priceListId: string;
  isSale: boolean;
  bracketStartQuantity: number;
  displayMode: DisplayMode;
}

export interface PricingServiceContract {
  resolveEngine(input: PricingResolutionInput): Promise<PricingEngineResult>;
  resolveLinePrice(input: PricingResolutionInput): Promise<PricingLineResult | null>;
}
