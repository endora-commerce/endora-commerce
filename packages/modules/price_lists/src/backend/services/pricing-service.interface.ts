// Formalized contract for the price-list pricing engine (feature 057, R4).
//
// This is the documented interface an overlay MUST satisfy to override the core
// `PricingService` for a deployment. It captures exactly the surface consumers
// depend on — `resolveEngine` and `resolveLinePrice` — so an overlay can replace
// the implementation and every consumer keeps type-checking. The core class
// `implements` this interface, so if the interface changes, a stale overlay
// stops being assignable and the build fails (contract drift = build error).

import type {
  DisplayMode,
  ListingPrice,
  ListingPriceDetail,
  ListingPriceOrderChunk,
  ListingPriceOrderQuery,
  ListingPriceViewerContext,
} from '@endora-commerce/contracts';
import type { PriceSource } from '@endora-commerce/contracts';
import type { BookExplanation } from './book-resolver.js';

/**
 * The product a price is resolved for, as this engine reads it (feature 075
 * Phase C).
 *
 * It used to be `catalog`'s `Product` **entity**, and that was two problems in
 * one specifier: this module could not compile without `catalog`, and the
 * contract an overlay decoration is written against named a class the overlay
 * had no business seeing. The engine reads exactly two fields — the id it keys
 * every row lookup on, and the attribute values a price-book attribute row
 * matches (D-287 §5.9) — so those two are what it asks for. A product carries
 * no price of its own (feature 160, FR-042).
 *
 * Narrowing is what makes this a cut rather than a rename: a `Product` entity
 * and a `CatalogProductRecord` are both assignable here, and nothing wider is
 * reachable from inside the engine.
 */
export interface PricedProductRef {
  id: string;
  /** JSONB `{ attributeKey: value }` — what an attribute row of a price book matches. */
  attributeValues: Record<string, unknown>;
}

/**
 * The buying organisation, as this engine reads it. Two fields: the id (a rule
 * dimension and part of the cache key) and the group it belongs to, which a
 * customer's own group overrides when set.
 */
export interface PricingOrganizationRef {
  id: string;
  /**
   * Optional, and it has to be: `organizations` declares the column
   * `customerGroupId?: string | null` and the published `OrganizationRecord`
   * declares it `string | null`, so the narrow shape has to admit both. Every
   * read of it here is `?? null`.
   */
  customerGroupId?: string | null;
}

/** The resolution context shared by both pricing entry points. */
export interface PricingResolutionInput {
  product: PricedProductRef;
  variantId?: string | null;
  context: {
    quantity: number;
    organization?: PricingOrganizationRef | null;
    /** Feature 040 — customer's direct group overrides the org's (R6). */
    customerGroupId?: string | null;
    /**
     * D-287 P0 — the signed-in customer account. The engine reads its own
     * customer group (when it belongs to `organization`) and applies the one
     * rule, `customerGroupId ?? account's group ?? organization's group`
     * (`effectiveCustomerGroupId`).
     */
    customerAccountId?: string | null;
    /** The request's resolved sales channel (only `id` + `defaultCurrency` read). */
    salesChannel: { id: string; defaultCurrency: string };
    currencyCode?: string;
  };
}

/**
 * One quantity tier of a resolved price, as {@link PricingEngineResult} carries
 * it: the book that priced it, its window and its amount (a 4 dp decimal
 * string). Feature 160 kept the shape `resolveEngine` callers read; the row it
 * describes is a price-book row, whose id is `matrixEntryId`.
 */
export interface PriceBracketRow {
  priceListId: string;
  productId: string;
  currencyCode: string;
  minQuantity: number;
  maxQuantity: number | null;
  amount: string;
  /** The price-book row that priced the line. */
  matrixEntryId?: string;
}

export interface PricingEngineResult {
  base: { listId: string; listName: string; bracket: PriceBracketRow | null };
  sale: { listId: string; listName: string; bracket: PriceBracketRow } | null;
  displayMode: DisplayMode;
  currencyCode: string;
  /** Feature 160 — the tier that priced the charged line (price-book engine only). */
  source?: PriceSource | null;
  /** Feature 160 — the buyer price a charged sale undercut. */
  compareAt?: string | null;
  /** Feature 160 (G9) — the catalogue price beside a lower buyer price, when `pricing.show_list_price` is on. */
  listPrice?: { amount: string; currency: string };
}

export interface PricingLineResult {
  amount: string;
  currency: string;
  priceListId: string;
  isSale: boolean;
  bracketStartQuantity: number;
  displayMode: DisplayMode;
  /**
   * Feature 148 — the price matrix entry that priced the line, when one did.
   * Absent for a line priced by a stored bracket. Internal to this module's
   * contract: the published `LinePriceResult` is deliberately not widened (D-77).
   */
  matrixEntryId?: string | null;
  /**
   * Feature 160 (D-287 P1) — which tier priced the line (FR-030); set by the
   * price-book engine. `isSale` is `source === 'sale'`.
   */
  source?: PriceSource;
  /** Feature 160 — the buyer price a charged sale undercut (FR-015). */
  compareAt?: string | null;
  /**
   * Feature 160 — why this price (FR-020): tier, cell, book, row, reference and
   * precedence version. Internal to this module's contract, like
   * `matrixEntryId`; the published `LinePriceResult` does not carry it.
   */
  explanation?: BookExplanation;
}

/**
 * The context a catalogue listing prices in. Quantity is fixed at 1 — a listing
 * card, a search hit, a comparison column and a related-product tile all quote
 * the unit price — so it is not part of the input.
 */
export interface ListingPricesInput {
  products: readonly PricedProductRef[];
  context: {
    organization?: PricingOrganizationRef | null;
    /** Feature 040 — customer's direct group overrides the org's (R6). */
    customerGroupId?: string | null;
    /** D-287 P0 — see {@link PricingResolutionInput}. */
    customerAccountId?: string | null;
    salesChannel: { id: string; defaultCurrency: string };
    currencyCode?: string;
  };
}

/** One line of {@link LinePricesInput}. */
export interface PricingLineRequest {
  /** The answer's map key; unique per call. */
  key: string;
  product: PricedProductRef;
  variantId?: string | null;
  quantity: number;
}

/**
 * D-287 P0 — many lines, each at its own quantity, for one buyer: the cart,
 * the placement drift check, a quote's reference prices, the external bulk
 * price request.
 */
export interface LinePricesInput {
  lines: readonly PricingLineRequest[];
  context: Omit<PricingResolutionInput['context'], 'quantity'>;
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
   * D-287 P0 — `resolveListingPrices` plus the base / sale / display-mode split,
   * from the same single resolution, for the surfaces that render it (product
   * detail, home-page cards, typeahead). Every requested product gets an entry.
   */
  resolveListingPriceDetails(input: ListingPricesInput): Promise<Map<string, ListingPriceDetail>>;
  /**
   * D-287 P0 — `resolveLinePrice` for many lines in one call, in a number of
   * statements that does not grow with the lines. Answers, key by key, exactly
   * what one `resolveLinePrice` per line answers
   * (`backend/test/integration/price_lists/line-prices-batch.test.ts`). Every
   * requested key gets an entry; `null` is "nothing applies".
   *
   * On this interface because it is what an overlay decorates: a deployment
   * that overrides line pricing has to override the batch too, or the cart
   * would price by the core while checkout priced by the overlay.
   */
  resolveLinePrices(input: LinePricesInput): Promise<Map<string, PricingLineResult | null>>;
  /**
   * The quantity-1 price of each product on one **named** price book, for
   * callers that use a book verbatim rather than resolving the buyer's (a
   * product feed pinned to a book — feature 067 FR-020, feature 160 FR-029):
   * the book's rows over the channel's catalogue price. Products the book does
   * not price are absent from the map.
   *
   * It exists so that reading a named book is a port call rather than a raw
   * `select` against this module's tables from another module: the port is
   * what makes an absent owner refuse instead of a feed publishing prices the
   * platform is not serving.
   */
  namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
    /** Feature 160 — the feed's channel (required on price books). */
    salesChannelId?: string;
  }): Promise<Map<string, string>>;
  /**
   * Feature 062, renamed by feature 160 (was `listBracketMinQuantities`) —
   * distinct starting quantities (ascending) of the rows and base tiers that
   * can apply to a (product, variant?, currency). The external catalog detail
   * probes `resolveLinePrice` at each returned quantity to build the caller
   * org's effective tier ladder without re-implementing resolution.
   */
  listTierStarts(productId: string, currencyCode: string, variantId?: string | null): Promise<number[]>;
  /**
   * Feature 086 — the catalogue in resolved-unit-price order, for one viewer,
   * one chunk at a time. Published as the `ListingPriceOrderPort` slice of the
   * `pricingService` container, so an overlay decoration has to satisfy it in
   * order to stay assignable here.
   *
   * The three methods below are the whole of the listing-ordering surface. They
   * read this module's own tables and know nothing about visibility, channels
   * or the buyer's category filter; the caller intersects.
   */
  orderByUnitPrice(input: ListingPriceOrderQuery): Promise<ListingPriceOrderChunk>;
  pricedProductIds(input: {
    context: ListingPriceViewerContext;
    productIds: readonly string[];
  }): Promise<ReadonlySet<string>>;
  pageDisplayMode(input: { context: ListingPriceViewerContext }): Promise<DisplayMode>;
}
