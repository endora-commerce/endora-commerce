import type {
  FeedFieldSourceKind,
  FeedFieldTransform,
  FeedPricePresentation,
  FeedRunIssueReason,
} from '@endora-commerce/contracts';
import type { FeedItemField } from './serializers/serializer.interface.js';

/**
 * Item field resolution SPI — feature 067 / FR-003, FR-037, FR-040–FR-045.
 *
 * This is the **overlay seam** (Principle XV): the per-field mapping from
 * catalogue data to a provider's vocabulary is the single most deployment-
 * specific piece of this module, so it is expressed as an interface a
 * deployment can replace with `tsc` as the contract gate.
 *
 * The core implementation (`item-field-resolver.ts`) is a **pure function**.
 * Every database read happens earlier, in the hydration step, and arrives here
 * as `FeedItemSource`. That is what makes the whole fallback matrix unit-
 * testable with no infrastructure, and what keeps the generation pipeline's
 * memory profile flat.
 */

/** A template field, reduced to what resolution actually needs. */
export interface ResolvableTemplateField {
  readonly outputName: string;
  readonly sourceKind: FeedFieldSourceKind;
  readonly sourceKey: string | null;
  readonly constantValue: string | null;
  readonly fallbackValue: string | null;
  readonly providerRequired: boolean;
  readonly transform: FeedFieldTransform | null;
  readonly transformArg: string | null;
}

/** A resolved money amount for one item, already net/gross-aware. */
export interface FeedItemPrice {
  readonly net: number;
  readonly gross: number;
  /**
   * False when `TaxService` fell through to `{ rate: 0, source: 'none' }`. On a
   * gross feed that is a run **warning**, not a silent zero-VAT price (R12).
   */
  readonly taxResolved: boolean;
}

/**
 * One hydrated catalogue item. Populated by the generation pipeline's batch
 * hydration step; the resolver never queries.
 */
export interface FeedItemSource {
  readonly productId: string;
  /** Non-null for a variant-granularity feed. */
  readonly variantId: string | null;
  /** The variant's SKU when this is a variant item, else the product's. */
  readonly sku: string;
  readonly slug: string;
  /** `products.type` — simple / configurable / grouped / bundle / virtual (FR-003). */
  readonly productType: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly price: FeedItemPrice | null;
  readonly salePrice: FeedItemPrice | null;
  readonly inStock: boolean | null;
  readonly stockQuantity: number | null;
  /**
   * Publicly reachable image URLs only. The hydrator drops anything that is not
   * `visibility: 'public'`, so a signed, expiring URL can never reach a feed
   * file (FR-043).
   */
  readonly imageUrls: readonly string[];
  /** How many of the product's images were dropped for not being public. */
  readonly privateImageCount: number;
  /** Localized category names, root → leaf. */
  readonly categoryPath: readonly string[];
  /**
   * The provider taxonomy node this product resolved to, or null when none did.
   * Resolved once per item by the generation pipeline from the category tree and
   * the installation-wide mapping set (FR-080, FR-084).
   */
  readonly providerCategory: string | null;
  /**
   * Why `providerCategory` is null, so the resolver can record the RIGHT
   * diagnostic: "never mapped" and "the mapped node vanished" are different
   * problems with different fixes (FR-085).
   */
  readonly providerCategoryMissReason:
    | 'unmapped_provider_category'
    | 'stale_provider_category_mapping'
    | null;
  /** Ties one product's variants together; defaults to the product id. */
  readonly groupingId: string | null;
}

export interface FeedResolutionContext {
  readonly languageCode: string;
  /** Ordered chain walked after `languageCode`, ending with the platform default. */
  readonly languageFallbacks: readonly string[];
  readonly currencyCode: string;
  readonly pricePresentation: FeedPricePresentation;
  readonly taxCountry: string | null;
  /** Storefront origin for the feed's channel; empty when none is configured. */
  readonly storefrontOrigin: string;
  readonly salesChannelId: string;
  readonly priceListId: string | null;
}

export interface ResolvedItemIssue {
  readonly severity: 'skip' | 'warning';
  readonly reason: FeedRunIssueReason;
  readonly outputName: string | null;
  readonly detail: string | null;
}

export interface ResolvedFeedItem {
  /** Output fields, in template order, with empty ones already omitted. */
  readonly fields: FeedItemField[];
  readonly issues: ResolvedItemIssue[];
  /** True when a required field could not be satisfied — the item is not emitted. */
  readonly skipped: boolean;
  readonly skipReason: FeedRunIssueReason | null;
}

export interface ResolveFeedItemInput {
  readonly fields: readonly ResolvableTemplateField[];
  readonly item: FeedItemSource;
  readonly context: FeedResolutionContext;
}

export interface ItemFieldResolverPort {
  resolve(input: ResolveFeedItemInput): ResolvedFeedItem;
}
