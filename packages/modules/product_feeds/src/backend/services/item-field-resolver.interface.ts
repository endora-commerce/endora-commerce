import type {
  ChannelUrlFacts,
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

/**
 * A feed item's price: decimal strings — the resolver's amount as `price_lists`
 * answers it, and the gross computed from it by `grossAmountHalfUp` — written
 * to the file at two places by `roundAmountHalfUp` (review 2, finding 1 of
 * release 0.108.0). Never a JS number: that is how binary rounding got in.
 *
 * A net with more than two significant places is not written that way: it is
 * published as the price of a pack (issue #430, `feed-pack.ts`), whose gross is
 * computed from the pack's net at `taxRatePercent`.
 */
export interface FeedItemPrice {
  readonly net: string;
  readonly gross: string;
  /**
   * False when `TaxService` fell through to `{ rate: 0, source: 'none' }`. On a
   * gross feed that is a run **warning**, not a silent zero-VAT price (R12).
   */
  readonly taxResolved: boolean;
  /**
   * The rate `gross` was computed at, in percent (`23`); `null` on a net feed
   * and when no tax rule matched (`gross` is then the net).
   */
  readonly taxRatePercent: number | null;
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
  /**
   * The product's URL key in the feed's language — its effective key at (channel,
   * language) from `catalogProductUrlKeyReadPort`, else the global slug (feature 167,
   * FR-033).
   */
  readonly slug: string;
  /** `products.type` — simple / configurable / grouped / bundle / virtual (FR-003). */
  readonly productType: string;
  /** 168-shim: the Global texts; S2 feeds the effective texts at the feed's (C, L) (`effectiveTexts`). */
  readonly name: string;
  readonly description: string | null;
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
  /**
   * The channel's URL-language facts (feature 167): the `link` is the prefixed
   * product path in the feed's language, composed by `productPath`.
   */
  readonly channelUrl: ChannelUrlFacts;
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
  /**
   * The whole template, when `fields` is only part of it — the editor preview
   * resolves one field at a time. Whether a sub-cent price can be published as
   * a pack depends on the template binding a `pack_quantity` field and on every
   * price it publishes (issue #430). Defaults to `fields`.
   */
  readonly templateFields?: readonly ResolvableTemplateField[];
  readonly item: FeedItemSource;
  readonly context: FeedResolutionContext;
}

export interface ItemFieldResolverPort {
  resolve(input: ResolveFeedItemInput): ResolvedFeedItem;
}
