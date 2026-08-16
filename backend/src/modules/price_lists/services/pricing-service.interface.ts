// Formalized contract for the price-list pricing engine (feature 057, R4).
//
// This is the documented interface an overlay MUST satisfy to override the core
// `PricingService` for a deployment. It captures exactly the surface consumers
// depend on — `resolveEngine` and `resolveLinePrice` — so an overlay can replace
// the implementation and every consumer keeps type-checking. The core class
// `implements` this interface, so if the interface changes, a stale overlay
// stops being assignable and the build fails (contract drift = build error).

import type { DisplayMode, ListingPrice } from '@b2b/contracts';
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

/**
 * The context a catalogue listing prices in. Quantity is fixed at 1 — a listing
 * card, a search hit, a comparison column and a related-product tile all quote
 * the unit price — so it is not part of the input.
 */
export interface ListingPricesInput {
  products: readonly Product[];
  context: {
    organization?: Organization | null;
    /** Feature 040 — customer's direct group overrides the org's (R6). */
    customerGroupId?: string | null;
    salesChannel: { id: string; defaultCurrency: string };
    currencyCode?: string;
  };
}

export interface PricingServiceContract {
  resolveEngine(input: PricingResolutionInput): Promise<PricingEngineResult>;
  resolveLinePrice(input: PricingResolutionInput): Promise<PricingLineResult | null>;
  /**
   * Issue #132 — the price a catalogue listing may render, per product, keyed
   * by product id. Every requested product gets an entry; a product nothing
   * priced gets the `none` arm rather than being missing from the map, so a
   * caller cannot mistake "not asked about" for "no price".
   *
   * This is the whole chain (applicable list → the product's own price →
   * nothing) behind one call, so a listing path cannot implement a step of it
   * differently. Four of them did, which is what the issue reports.
   */
  resolveListingPrices(input: ListingPricesInput): Promise<Map<string, ListingPrice>>;
  /**
   * The lowest-quantity bracket amount on one **named** price list, per
   * product, for callers that use a list verbatim rather than resolving it
   * (a product feed pinned to a list — feature 067, FR-020). Products with no
   * bracket on that list are absent from the map.
   *
   * It exists so that reading a named list is a port call rather than a raw
   * `select` against `price_list_price_brackets` from another module: the
   * table is this module's, and the port is what makes an absent owner refuse
   * instead of a feed publishing prices the platform is not serving.
   */
  namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
  }): Promise<Map<string, string>>;
  /**
   * Feature 062 — distinct bracket start quantities (ascending) across every
   * ACTIVE price list for a (product, currency). The external catalog detail
   * probes `resolveLinePrice` at each returned quantity to build the caller
   * org's effective tier ladder without re-implementing resolution.
   */
  listBracketMinQuantities(productId: string, currencyCode: string): Promise<number[]>;
}
