import { raw } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../entities/product.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import { Category } from '../entities/category.entity.js';
import { AttributeSet } from '../entities/attribute-set.entity.js';
import type {
  CatalogAttributeReadService,
  CatalogAttributeView,
} from './catalog-attribute-read.service.js';
import { GalleryItem } from '../entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';
import { ProductAttachment } from '../entities/product-attachment.entity.js';
import { AttachmentType } from '../entities/attachment-type.entity.js';
import type { ProductLinkService } from './product-link.service.js';

import { GroupedItem } from '../entities/grouped-item.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';
import { BundleSlot } from '../entities/bundle-slot.entity.js';
import { BundleSlotOption } from '../entities/bundle-slot-option.entity.js';
import { resolvePrimaryAssetUrls } from './primary-asset-url.js';
import { effectiveGallery, loadGalleryChannelOverrides } from './gallery-scopes.js';
import { loadAttachmentsHiddenInChannel } from './attachment-packaging-scopes.js';
import { viewerOrganizationFor } from './viewer-organization.js';
import { channelUrlFactsOf } from './channel-url-facts.js';
import {
  effectiveAttributeValues,
  effectiveSystemText,
  loadChannelOverridesByProduct,
  overrideLanguages,
  type StorefrontOverrideContext,
} from './storefront-value-overrides.js';
import {
  availabilityCondition,
  type ListingCondition,
} from './product-availability.sql.js';
import {
  effectiveAttributeSql,
  effectiveTextSql,
  type EffectiveValueScope,
  type SqlExpression,
} from './effective-value.sql.js';
import {
  availableAmong,
  globalScopeFields,
  isAvailableWith,
  loadChannelScopeRows,
  toScopeChannel,
  type PageAvailabilityScope,
  type ChannelScopeRows,
  type ScopedProduct,
} from './product-availability.service.js';
import { uuidArrayLiteral } from './sql-id-arrays.js';
import { findCurrentKeyHolder, loadEffectiveKeys } from './url-key-resolution.service.js';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  ERROR_CODES,
  compareDecimal,
  productDefaultPath,
  productPath,
  decimalText,
  formatUnits,
  isOrderMinimumEligibleType,
  effectiveOrderRules,
  normaliseAmount,
  effectiveAudience,
  isPriceSort,
  isProductVisibleTo,
  listingPriceChannelContext,
  resolveScopeLanguage,
  listingPriceMoney,
  translationAt,
  effectivePackagingUnitName,
  type AssetReadPort,
  type AssetRecord,
  type CategoryNode,
  type CategoryPageContent,
  type CustomFieldDefinitionReadPort,
  type FilterDefinition,
  type GalleryLabel,
  type ListingPriceOrderCursor,
  type ListingPriceOrderPort,
  type ListingPrice,
  type ListingPriceDetail,
  type ListingPriceDetailPort,
  type ListingPriceViewerContext,
  type OrganizationDetailsPort,
  type OverrideRow,
  type ProductAudience,
  type ProductDetail,
  type ProductListSort,
  type ProductPagePaths,
  type ProductSummary,
  type ProductVariant as VariantDto,
  type SeoProductMetaValues,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { encodeCursor, decodeCursor } from '@endora-commerce/platform/http';
import { productSummaryText } from './product-summary-text.js';

/** A uuid as the database spells one — anything else is a 404 or a discarded cursor, not a query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A category id as the database spells one — anything else is a 404, not a query. */
const CATEGORY_ID_RE = UUID_RE;

/** The deepest ancestor chain {@link CatalogQueryService.getCategoryPageContent} walks. */
const MAX_CATEGORY_DEPTH = 64;

/**
 * Whether a Page Builder document would render anything: a block at the top
 * level, or in a legacy `zones` bucket. An editor that was opened and saved
 * untouched stores a document with neither.
 */
export function hasPageBuilderBlocks(tree: Record<string, unknown>): boolean {
  if (Array.isArray(tree['content']) && tree['content'].length > 0) return true;
  const zones = tree['zones'];
  if (zones && typeof zones === 'object') {
    return Object.values(zones).some((zone) => Array.isArray(zone) && zone.length > 0);
  }
  return false;
}

function encodeObjectCursor(value: object): string {
  return encodeCursor(JSON.stringify(value));
}

function decodeObjectCursor<T>(cursor: string): T | null {
  const raw = decodeCursor(cursor);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUuidText(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * A price a cursor carries, normalised to four places, or `null` when it is not
 * one. Read with the contracts' own decimal parser — the grammar
 * `compareDecimal` reads and the price order writes — rather than with a
 * second pattern that can drift from it (review 3 of release 0.108.0, A4).
 */
function cursorAmount(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return normaliseAmount(value);
  } catch {
    return null;
  }
}

/**
 * Catalog read-path service (US1). Consumed by the storefront and by external
 * integrations pulling `/catalog/products?changedSince=...`.
 *
 * Sales-channel awareness: each public endpoint reads the channel the canonical
 * resolver chose for the request and narrows to what that channel sells. Who
 * sees a price is the display-mode chain's decision (`price_lists`), applied in
 * the resolution: a viewer whose mode is `none` is sent no amount (issue #491),
 * which is also how a channel hides prices until sign-in (issue #492).
 *
 * For MVP, text search is Postgres ILIKE on the multilingual `name`/`description`
 * blobs. The Meilisearch-backed query path lives in the `search` module
 * (tasks T067/T068); this service falls back to it transparently when available.
 */

/**
 * The request's sales channel, resolved once by the canonical resolver
 * middleware (feature 053 / FR-002). The catalog reads it from the request
 * context instead of re-resolving from the raw header.
 */
export interface CatalogResolvedChannel {
  id: string;
  code: string;
  defaultCurrency: string;
  defaultLanguage: string;
  /**
   * Feature 163 — the channel's content languages, from the resolved channel
   * record (never from the client). The scope language "L" of a read is the
   * request's `Accept-Language` pick resolved against this list
   * (`resolveScopeLanguage`). Optional only for fixtures that predate it: an
   * absent list is the channel's default language alone, so such a caller is
   * answered for the default language and never for a language the channel
   * may not offer.
   */
  languages?: readonly string[] | undefined;
  /**
   * Feature 167 — whether the channel prefixes its default language in storefront
   * URLs, from the resolved record. Optional only for fixtures that predate it; an
   * absent value is the column default, on (OR-1).
   */
  prefixDefaultLanguage?: boolean | undefined;
}


export interface CatalogQueryContext {
  /** The request's resolved sales channel (from `getResolvedChannel()`). */
  resolvedChannel: CatalogResolvedChannel;
  /**
   * Who is asking (issue #227). Every read in this service applies
   * {@link isProductVisibleTo} with it, next to the channel filter that was
   * already here — `visibility` and `allowed_organization_ids` were read by no
   * query on this surface, so an anonymous `GET` of a product an operator
   * marked `organization_restricted` returned it in full.
   *
   * **Required, not defaulted.** A default would have to be the anonymous
   * audience to fail closed, and a route that forgot to resolve its caller
   * would then quietly stop serving the buyer their own restricted catalogue —
   * a bug that reads as "the operator's allow-list does not work" and is found
   * by nobody. Two route files pass it; `tsc` names the third.
   */
  audience: ProductAudience;
  /**
   * Language preference — BCP-47. Used to pick the right string out of the
   * multilingual JSONB blobs. Falls back to the Sales Channel's default language,
   * then to any available key.
   */
  preferredLanguage?: string | undefined;
  /**
   * The currency this read is priced in (issue #249), already resolved by the
   * route against the channel's own list (`resolveListingCurrency`). Absent
   * means the channel's default. Every price, price ordering and price range on
   * this service reads it through {@link CatalogQueryService.#viewerPricingContext},
   * so a page cannot be priced in one currency and ordered in another.
   */
  currency?: string | undefined;
}

/**
 * The two reads a listing card needs beyond the product row and its price:
 * which image represents the product, and which category slugs it carries.
 *
 * Both are resolved for the whole page and keyed by product id, because both
 * used to run once per card — and neither varies by viewer or by sales channel,
 * so there is no dimension the page-wide key drops. (The channel decides
 * whether the product is on the page at all, and the audience decides whether
 * the caller may see it; both are settled before either read.)
 */
export interface ListingCardReads {
  /** Product id -> the T096 chain's answer, `null` when nothing represents it. */
  assetUrlByProduct: Map<string, string | null>;
  /** Product id -> its category slugs, in `product_categories` primary-key order. */
  categorySlugsByProduct: Map<string, string[]>;
  /**
   * Issue #384 — product id -> its `product_value_overrides` rows for the
   * request's sales channel only. The rows do not vary by viewer either; the
   * request's language legs pick among them when the card is built.
   */
  overridesByProduct: Map<string, OverrideRow[]>;
  /**
   * Feature 163 (R28) — product id -> its effective URL key at the request's
   * (channel, language): every storefront link a card carries is built on it.
   * Read page-wide like the rest; the language is the request's, not the viewer's.
   */
  effectiveKeyByProduct: Map<string, string>;
  /**
   * Feature 163 (FR-100) — product id -> its minimum order quantity in the
   * request's sales channel (the channel row's, else the global one).
   */
  minOrderQuantityByProduct: Map<string, number | null>;
}

export interface ListProductsParams {
  q?: string | undefined;
  /**
   * Issue #590 — restrict the listing to these products (the contract's
   * `productListIdsSchema`: validated, de-duplicated, at most
   * `PRODUCT_LIST_MAX_IDS`). A narrowing like the others: availability, the
   * text and attribute filters and the viewer's pricing all still apply.
   */
  ids?: readonly string[] | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: ProductListSort | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
  changedSince?: string | undefined;
  /** Feature 086 — inclusive bounds on the viewer's own resolved unit price. */
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
}

/**
 * How many source rows a price-ordered or price-filtered page may read before it
 * returns short — FR-019, stated as the specification requires and **not** as a
 * setting (research §R13).
 *
 * Eight times the page size. On the reference corpus it never bound: the first
 * page of 50 cost 213 source rows against a budget of 400. It binds only where
 * an operator restricts most of a catalogue from most viewers, and the answer
 * there is a short page — the two price paths narrow each chunk they fetch by
 * channel and audience, where the default path has those in its statement
 * (issue #151) — rather than an unbounded scan. A short page, even an empty
 * one, has `hasMore: true` and a cursor at the position its scan reached, so
 * the budget shortens pages and never ends a walk.
 *
 * A setting was rejected because nobody has the number yet: the value it should
 * take is a function of how much of a catalogue a deployment hides, and shipping
 * an operator knob for a guess is the shape Constitution IV refuses. The `warn`
 * below is what turns the question into evidence; adding the setting afterwards
 * is additive.
 */
export const PRICE_PAGE_SCAN_BUDGET_MULTIPLE = 8;

/**
 * What a price walk seals its cursors with (issue #497): the platform's
 * `cursorSeal` value, in the narrow shape this module uses.
 *
 * Every cursor the two price walks issue is sealed — opaque and tamper-proof —
 * rather than base64 of its position. A page cut by the scan budget continues
 * from where its scan stopped (review 3 of release 0.108.0, A1), and that row
 * can be one the viewer may not see: filtered out by visibility, channel,
 * status or archival, or one whose price the viewer's display mode withholds.
 * Under a price sort the position holds that product's resolved price and its
 * id, and a full page ends on its last card, whose price may be withheld while
 * the order still ranks it. Sealing keeps the position exactly where it is, so
 * the walk keeps every guarantee it had — a budget makes a page short or empty
 * and never ends the walk, and the walk always moves forward — and a client can
 * neither read a position nor forge one to probe the order with.
 *
 * Resuming from the last visible card plus a count of rows to skip was the
 * alternative that needs no key, and it was rejected: the skip grows with every
 * page a run of hidden rows empties, and is re-read on each, so the budget
 * stops bounding a page; and a count is not a position — a row added or removed
 * behind it moves every later page by one, which repeats or loses a product the
 * keyset never does.
 */
export interface CatalogCursorSeal {
  seal(purpose: string, payload: string): string;
  /** `null` for anything not sealed for `purpose` with this instance's key. */
  open(purpose: string, token: string): string | null;
}

/** The seal purpose of every cursor a price-sorted listing issues (issue #497). */
export const PRICE_WALK_CURSOR_PURPOSE = 'catalog.listing.price-walk';

/**
 * The seal purpose of every cursor a price-filtered listing under another sort
 * issues (issue #497): its budget can stop it on a hidden product too, and that
 * position names the product's id. A purpose of its own, so neither walk reads
 * the other's cursor.
 */
export const PRICE_RANGE_WALK_CURSOR_PURPOSE = 'catalog.listing.price-range-walk';

/**
 * The cursor a price-ordered listing issues, sealed ({@link CatalogCursorSeal})
 * before it leaves this service: a client can neither read it nor forge it.
 *
 * `unordered` is a walk begun while no price order existed for the viewer
 * (`contracts/price-surface.md` §3): it was served in the default order, and
 * it carries that listing's own cursor so the walk continues in the order it
 * began — even once the surface has been built — and ends.
 *
 * `rest` is the opposite transition: a walk begun on a price order whose
 * surface then went missing. It carries the last price served (`amount`,
 * `productId`, the price order's own keyset) and the default listing's keyset
 * (`after`): see `#listRemainder`.
 *
 * Every field is checked when the cursor is read (`#priceCursor`): a cursor that
 * does not open or parse, or names a value of the wrong shape, is discarded and
 * the walk starts at its first page — what the default listing does with a
 * cursor it cannot read — rather than reaching a statement as a value the
 * database refuses. That includes a cursor of the readable format issued before
 * the seal (issue #497): a link held across the upgrade shows its first page
 * again, once, rather than an error.
 */
type PriceListingCursor =
  | { stream: 'priced'; amount: string; productId: string }
  | { stream: 'tail'; createdAt: string; id: string }
  | { stream: 'unordered'; cursor: string }
  | { stream: 'rest'; amount: string; productId: string; after: ListingKeysetCursor };

/**
 * A price range's bounds as four-place decimal strings — the one conversion
 * every price path reads them through (review 3 of release 0.108.0, B3).
 *
 * An amount has four places, so the exact bound is the minimum rounded **up**
 * and the maximum rounded **down** to four places: `minPrice=9.04504` keeps
 * 9.0451 and not 9.0450, which is what comparing with the number as typed
 * answers. `toFixed(4)` rounded the double instead, and the range walk under
 * any other sort compared `Number(amount)` with the bound as typed, so the same
 * filter selected different products under different sorts.
 */
interface AmountRange {
  min?: string;
  max?: string;
}

function amountBound(value: number, side: 'min' | 'max'): string {
  const [whole = '0', fraction = ''] = decimalText(value).split('.');
  let units = BigInt(whole) * 10_000n + BigInt(fraction.slice(0, 4).padEnd(4, '0'));
  if (side === 'min' && /[1-9]/.test(fraction.slice(4))) units += 1n;
  return formatUnits(units);
}

/** Whether a resolved amount lies in the range, compared as decimals; an amount that does not parse does not. */
function withinAmountRange(amount: string, range: AmountRange | undefined): boolean {
  if (range === undefined) return true;
  try {
    if (range.min !== undefined && compareDecimal(amount, range.min) < 0) return false;
    if (range.max !== undefined && compareDecimal(amount, range.max) > 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * What a price walk reads once per page for its viewer: the pricing context
 * every price of the page is resolved with, and the category filter's product
 * ids (`null` without a category filter).
 */
/** A listing price that is a figure: the `price_list` arm. */
type PricedListingPrice = Extract<ListingPrice, { source: 'price_list' }>;

interface PriceWalkScope {
  context: ListingPriceViewerContext;
  categoryIds: ReadonlySet<string> | null;
  /**
   * The products the price surface is asked about, at its source: the category
   * filter's products, the named ones (`?ids=`, issue #590), or the named ones
   * in the category; `undefined` for the whole surface. Narrowing only page-side
   * would let a walk spend its scan budget on products nobody asked for and
   * answer an empty page that "has more" (review of #594).
   */
  restrictToProductIds: readonly string[] | undefined;
  /** Feature 163 — the read's availability scope, applied to every chunk of the walk. */
  availability: PageAvailabilityScope;
  /** Feature 163 — the free-text and attribute filters over effective values, likewise. */
  filters: ListingFilters;
}

/**
 * The cursor a listing that pages by a keyset issues. Opaque to every caller,
 * and **shaped by the ordering it was issued under** — see `#keysetFor`.
 */
type ListingKeysetCursor = { createdAt: string; id: string } | { name: string; id: string };

/**
 * A keyset: how to name the last row of a chunk, and how to ask for the rows
 * that sort strictly after it.
 */
interface ListingKeyset {
  /**
   * The cursor payload for a row a chunk ended on. Under a name ordering it
   * carries the row's **effective** name (feature 163, D6), which `nameOf`
   * answers — the value the statement sorted on, by the parity of
   * `effectiveTextSql` with #384's walk.
   */
  of(product: Product, nameOf: (productId: string) => string | undefined): ListingKeysetCursor;
  /** Whether {@link of} needs the effective name. */
  readonly byName: boolean;
  /**
   * The decoded cursor, or `null` when it was issued under another ordering.
   * Discarding it is the existing behaviour for a cursor that does not parse,
   * and it is what a keyset over the wrong column has to do rather than
   * reinterpret one column's value as another's.
   */
  parse(decoded: unknown): ListingKeysetCursor | null;
  /**
   * The `where` fragment selecting everything strictly after that row. Under a
   * name ordering it holds a `raw()` key, so it is called **in the expression
   * that executes it**, like every other fragment in this file.
   */
  after(cursor: ListingKeysetCursor): Record<string, unknown>;
  /** The ordering — a `raw()` key under a name ordering; same rule as {@link after}. */
  orderBy(): Record<string, 'asc' | 'desc'>;
}

/**
 * Feature 163 — what narrows a listing beside availability: statement
 * conditions and their page-side twin (`#listingFilters`).
 */
interface ListingFilters {
  readonly conditions: ListingCondition[];
  passes(em: EntityManager, products: readonly Product[]): Promise<Set<string>>;
}

/**
 * The "everything strictly after this row" predicate, over whichever column the
 * cursor names and in the direction that column is ordered in.
 *
 * One implementation for both shapes rather than one per keyset: they differ
 * only in the column, and a second copy of this predicate is how it and the
 * ordering came apart in the first place.
 */
function afterKeysetCursor(
  cursor: ListingKeysetCursor,
  op: '$gt' | '$lt',
): Record<string, unknown> {
  if (!('createdAt' in cursor)) {
    throw new Error('afterKeysetCursor: a name cursor is the name keyset\'s own (`#keysetFor`).');
  }
  const at = new Date(cursor.createdAt);
  return { $or: [{ createdAt: { [op]: at } }, { createdAt: at, id: { [op]: cursor.id } }] };
}

/**
 * JavaScript's `String(n)` for a `numeric` SQL expression.
 *
 * The attribute filter has always compared `String(value)`, and for a number
 * that is not the text PostgreSQL stores: `jsonb` keeps `1e21` as a 22-digit
 * integer where JavaScript prints `1e+21`, and keeps a hand-written `1.50` as
 * written where JavaScript prints `1.5`. So the number is rendered the way
 * JavaScript would render the double it parses to:
 *
 *  - beyond a double's range it is `Infinity`, and below its smallest
 *    subnormal it is `0` — `JSON.parse`'s answers, and the two casts that would
 *    otherwise fail the statement;
 *  - at or above 1e21 and below 1e-6 JavaScript uses exponent notation, and so
 *    does `float8`'s shortest round-trip output, which differs only in padding
 *    the exponent to two digits (`1e-07`);
 *  - from 1e-4 up to 1e15 both print the same plain shortest round-trip
 *    decimal, which is what turns `1.50` into `1.5` and `2.0` into `2`;
 *  - in the two bands between, `float8` has already switched to exponent
 *    notation and JavaScript has not, so the stored digits are printed plain
 *    with trailing zeros removed. That is exact for any value JavaScript wrote
 *    and is the one place a value written by something else can differ: a
 *    number in [1e15, 1e21) or [1e-6, 1e-4) carrying more than 17 significant
 *    digits.
 */
function jsStringOfNumeric(n: string): string {
  return (
    `(case ` +
    `when abs(${n}) > 1.7976931348623157e308 then (case when ${n} < 0 then '-' else '' end) || 'Infinity' ` +
    `when abs(${n}) < 3e-324 then '0' ` +
    `when abs(${n}) >= 1e21 or abs(${n}) < 1e-6 ` +
    `then regexp_replace((${n})::float8::text, 'e([+-])0', 'e\\1') ` +
    `when abs(${n}) >= 1e15 or abs(${n}) < 1e-4 then trim_scale(${n})::text ` +
    `else (${n})::float8::text end)`
  );
}

/**
 * JavaScript's `String(value)` for a `jsonb` SQL expression, as the attribute
 * filter needs it.
 *
 * A string or a boolean is its own text, a number is
 * {@link jsStringOfNumeric}, a JSON `null` reads `'null'` and an object reads
 * `[object Object]`. An **array** — a multiselect — joins its elements with a
 * comma, each rendered the same way except that a `null` element is empty,
 * which is `Array.prototype.join`'s rule.
 *
 * One kind is not reproduced: an array **nested inside** an array. JavaScript
 * flattens it into the join (`[[1, 2], 3]` reads `1,2,3`); here the inner array
 * contributes its JSON text. No attribute type stores one.
 */
function jsStringOfJsonb(value: string): string {
  const scalar = (v: string, nullText: string): string =>
    `(case jsonb_typeof(${v}) ` +
    `when 'null' then '${nullText}' ` +
    `when 'object' then '[object Object]' ` +
    `when 'number' then (select ${jsStringOfNumeric('num.n')} ` +
    `from (select (${v} #>> '{}')::numeric as n) num) ` +
    `else ${v} #>> '{}' end)`;
  return (
    `(case jsonb_typeof(${value}) ` +
    `when 'array' then (` +
    `select coalesce(string_agg(${scalar('el.value', '')}, ',' order by el.position), '') ` +
    `from jsonb_array_elements(${value}) with ordinality as el(value, position)) ` +
    `else ${scalar(value, 'null')} end)`
  );
}

/**
 * Feature 163 (R13, FR-075) — `seo`'s product metadata at (channel, language),
 * each field walked channel × language → channel → language → `fallback`.
 * `null` when `seo` is not effectively present: the page then shows its derived
 * metadata (the declared `degrades-without` edge on `seoProductMetaPort`).
 */
export type ResolveSeoProductMeta = (input: {
  productId: string;
  channelId: string;
  languageCode: string;
  fallback: SeoProductMetaValues;
}) => Promise<SeoProductMetaValues | null>;

export interface ListResult<T> {
  data: T[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

export class CatalogQueryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 002 US4 — optional link provider so the PDP `productDetail`
     * carries the pre-grouped Related/Up-sell/Cross-sell links. Optional
     * so tests/composition that don't wire it stay green; when undefined,
     * `productDetail.links` is omitted from the response.
     */
    private readonly productLinkService?: ProductLinkService,
    /**
     * Feature 055 (US4) — optional custom-field definition source. When wired,
     * Category custom fields flagged `config.filterable === true` are merged into
     * the storefront filter set. The catalog interprets the opaque `config` here;
     * the custom-fields core stays unaware of catalog (Principle XIV / FR-006).
     */
    private readonly customFieldDefinitions?: CustomFieldDefinitionReadPort,
    /**
     * Feature 061 — composed attribute read model. Required for every
     * attribute-metadata read (filters, PDP visible attributes, promo-rule and
     * comparable key ports); optional in the signature so product-only
     * fixtures keep constructing the service without attribute wiring.
     */
    private readonly attributeRead?: CatalogAttributeReadService,
    /**
     * Issue #132 — the pricing engine, resolved through the `pricingService`
     * port. Every storefront-facing price this service emits comes from here;
     * the catalogue no longer projects its own legacy default-price attribute,
     * because that figure is not a price any price list stands behind.
     *
     * Optional only in the signature, and unwiring it is not a fallback: a
     * listing asked to render a price without it fails loudly, the same way an
     * unwired attribute read model does. `null` from the port is the engine's
     * own "nothing applies" answer and is rendered as an absence.
     */
    private readonly listingPrices?: ListingPriceDetailPort,
    /**
     * Feature 075 — `assets_library`'s read port, where six raw
     * `join assets a on a.id = …` clauses and an `em.find(Asset, …)` used to
     * be. The bridge rows are still this module's; only the asset row is asked
     * of its owner.
     *
     * Optional only in the signature, for the same reason the two above are:
     * a fixture that renders no image never reaches it. A PDP that does and
     * finds it unwired fails loudly rather than silently dropping every image.
     */
    private readonly assets?: AssetReadPort,
    /**
     * Issue #185 — the kernel's channel-membership accessor, where the
     * hand-written `select product_id from sales_channel_products …` in
     * {@link filterByChannel} used to be. Constitution XII says the
     * `sales_channel_*` bridges are read and written only through this service;
     * the query here named the table itself, which crosses the boundary while
     * naming no import specifier.
     *
     * Optional only in the signature, and unwiring it is not a fallback: the
     * channel filter fails loudly rather than quietly answering the full
     * cross-channel set, which is the one degrade Principle XII rules out.
     */
    private readonly channelMembership?: SalesChannelMembershipPort,
    /**
     * `organizations`' read model, for the one field the pricing engine needs
     * beyond the viewer's organisation id: the customer group a group-targeted
     * price list is selected by. Without it a buyer's catalogue card and their
     * own cart line would resolve against different lists and quote different
     * figures for one product.
     *
     * Optional only in the signature, and unwiring it is not a fallback: a
     * listing asked to price a signed-in buyer without it fails loudly, the
     * same way the two ports above do. An **anonymous** listing never reaches
     * it, which is what keeps the fixtures that construct this service with no
     * organisation wiring working unchanged.
     */
    private readonly organizationDetails?: OrganizationDetailsPort,
    /**
     * Feature 086 — the `ListingPriceOrderPort` slice of the same
     * `pricingService` container {@link listingPrices} resolves.
     *
     * A separate constructor argument rather than a widened type on that one,
     * because every fixture that builds this service with a listing-price stub
     * would otherwise stop compiling for a capability it does not exercise. It
     * is the same container, the same gate and the same declared edge — the port
     * doc block says so, and `check:port-shape` compares it against the
     * registration.
     *
     * Optional only in the signature, and unwiring it is not a fallback: a
     * price-ordered listing asked for without it fails loudly rather than
     * silently serving the default ordering under a `sort=price` the buyer
     * chose.
     */
    private readonly listingPriceOrder?: ListingPriceOrderPort,
    /**
     * Feature 086 — where the scan budget says it bound.
     *
     * The budget is a constant rather than a setting because nobody has the
     * number yet (research §R13), and this line is what turns the question into
     * evidence instead of leaving it a guess: a deployment whose pages come back
     * short says so in its own log, and the setting can be added afterwards
     * without changing anything else. Optional, because a fixture that never
     * binds never reaches it.
     */
    private readonly log?: { warn(obj: object, msg: string): void },
    /**
     * Issue #497 — what every cursor of a price walk is sealed with. Optional
     * only in the signature, like the ordering port: a price walk asked for
     * without it fails loudly rather than issue a cursor a client can read.
     */
    private readonly cursorSeal?: CatalogCursorSeal,
    /**
     * Feature 163 — the product page's metadata through `seo` (R13). Optional: a
     * composition without it, like `seo` off, serves the derived metadata.
     */
    private readonly seoProductMeta?: ResolveSeoProductMeta,
  ) {}

  #requireCursorSeal(): CatalogCursorSeal {
    if (!this.cursorSeal) {
      throw new Error(
        'CatalogQueryService: the cursor seal is not wired — a price walk cannot issue a cursor ' +
          'without handing the client the position its scan stopped at.',
      );
    }
    return this.cursorSeal;
  }

  /** A price walk's cursor, sealed for `purpose`. */
  #sealCursor(purpose: string, value: object): string {
    return this.#requireCursorSeal().seal(purpose, JSON.stringify(value));
  }

  /** What a cursor sealed for `purpose` holds, or `null` when it does not open or parse. */
  #openCursor(purpose: string, cursor: string): unknown {
    const opened = this.#requireCursorSeal().open(purpose, cursor);
    if (opened === null) return null;
    try {
      return JSON.parse(opened) as unknown;
    } catch {
      return null;
    }
  }

  #requireChannelMembership(): SalesChannelMembershipPort {
    if (!this.channelMembership) {
      throw new Error(
        'CatalogQueryService: the channel-membership port is not wired — a channel-scoped ' +
          'listing cannot be answered without leaking the cross-channel set.',
      );
    }
    return this.channelMembership;
  }

  /**
   * Feature 163 — where a read asks availability (FR-001): the request's
   * resolved channel (Constitution XII), its scope language L, the audience the
   * route took from the session, and one `now` for every statement and every
   * page-side check of the read, so a window edge cannot fall between two of
   * them.
   */
  #availabilityScope(ctx: CatalogQueryContext, now: Date = new Date()): PageAvailabilityScope {
    const channel = toScopeChannel(ctx.resolvedChannel);
    return {
      channel,
      languageCode: resolveScopeLanguage(channel, ctx.preferredLanguage),
      audience: ctx.audience,
      now,
    };
  }

  /** {@link availabilityCondition} for this scope — a description; the caller makes the `raw()` key. */
  #availabilityNarrowing(scope: PageAvailabilityScope): ListingCondition {
    return availabilityCondition(
      {
        channelId: scope.channel.id,
        languageCode: scope.languageCode,
        channelLanguages: scope.channel.languages,
        audience: scope.audience,
        now: scope.now,
      },
      this.#requireChannelMembership(),
    );
  }

  /**
   * The pure rule over rows already held — the defence in depth behind every
   * statement that carried {@link availabilityCondition}, and the whole check
   * where a read could not carry it. `membersKnown` when the statement already
   * held the kernel's membership subquery.
   */
  #availableAmong(
    em: EntityManager,
    products: readonly Product[],
    scope: PageAvailabilityScope,
    membersKnown: boolean,
  ): Promise<Set<string>> {
    return availableAmong(em, this.#requireChannelMembership(), products, scope, { membersKnown });
  }

  /**
   * Feature 163 — the ids of `productIds` available to this request at (C, L),
   * for a seam that holds ids and answers its own single not-found (bundle
   * configuration options, FR-004).
   */
  async filterAvailableForRequest(
    productIds: readonly string[],
    ctx: CatalogQueryContext,
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const em = this.emFactory();
    const products = await em.find(Product, { id: { $in: [...new Set(productIds)] } });
    return this.#availableAmong(em, products, this.#availabilityScope(ctx), false);
  }

  #requireAssets(): AssetReadPort {
    if (!this.assets) {
      throw new Error(
        'CatalogQueryService: the asset read port is not wired — product images are unavailable.',
      );
    }
    return this.assets;
  }

  #requireAttributeRead(): CatalogAttributeReadService {
    if (!this.attributeRead) {
      throw new Error(
        'CatalogQueryService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    return this.attributeRead;
  }

  #requireListingPrices(): ListingPriceDetailPort {
    if (!this.listingPrices) {
      throw new Error(
        'CatalogQueryService: the pricing port is not wired — a listing cannot be priced.',
      );
    }
    return this.listingPrices;
  }

  #requireListingPriceOrder(): ListingPriceOrderPort {
    if (!this.listingPriceOrder) {
      throw new Error(
        'CatalogQueryService: the pricing ordering port is not wired — a price sort or a ' +
          'price range cannot be answered, and answering it with another ordering would be ' +
          'a sort control that silently does nothing.',
      );
    }
    return this.listingPriceOrder;
  }

  #requireOrganizationDetails(): OrganizationDetailsPort {
    if (!this.organizationDetails) {
      throw new Error(
        'CatalogQueryService: the organization read port is not wired — a signed-in buyer cannot be priced.',
      );
    }
    return this.organizationDetails;
  }

  /**
   * The chain's answer for a batch of products, keyed by product id, **for the
   * viewer in front of the page**.
   *
   * Whether the viewer is shown a price is the display-mode chain's answer,
   * applied inside the resolution: a viewer whose mode is `none` gets the
   * withheld arm (issue #491). The channel has no say of its own any more
   * (issue #492) — a channel that hides prices until sign-in does so through
   * its `pricing.unauthenticated_display_mode`.
   *
   * The organisation is the whole of this method's share of the owner's ruling
   * — an anonymous visitor sees the channel price, a signed-in buyer sees their
   * organisation's. It is resolved once per page rather than per card, and it
   * is `null` for every caller {@link viewerOrganizationFor} answers `null`
   * for, so the anonymous request issues exactly the resolution it issued
   * before and lands on exactly the cache entry it landed on before.
   */
  async #listingPricesFor(
    products: readonly Product[],
    ctx: CatalogQueryContext,
    /** The viewer's pricing context, when the caller has built it already for this request. */
    context?: ListingPriceViewerContext,
  ): Promise<Map<string, ListingPriceDetail>> {
    if (products.length === 0) return new Map();
    // D-287 P0 — the details call: one resolution answers both `price` and
    // `resolvedPrice` (base / sale / display mode), so the product page and the
    // home page's cards need no second, per-product resolution.
    return this.#requireListingPrices().resolveListingPriceDetails({
      products,
      context: context ?? (await this.#viewerPricingContext(ctx)),
    });
  }

  /**
   * The viewer, as every pricing seam on this service reads them: the resolved
   * channel and the buying organisation, or no organisation at all.
   *
   * Extracted so the page's prices and the page's **ordering** are resolved for
   * one viewer rather than two — a card priced for the buyer and an order
   * computed for somebody else is the exact failure feature 086 exists to
   * prevent, and it would be one forgotten argument away if each seam built its
   * own context.
   */
  async #viewerPricingContext(ctx: CatalogQueryContext): Promise<ListingPriceViewerContext> {
    const { audience } = ctx;
    const organization =
      audience.organizationId === null
        ? null
        : await viewerOrganizationFor(this.#requireOrganizationDetails(), audience);
    return {
      // Issue #249 — the currency the route resolved, or the channel default.
      ...listingPriceChannelContext(ctx.resolvedChannel, ctx.currency),
      organization,
      // D-287 P0 — the customer's own group overrides the organisation's; the
      // engine resolves it from the account. Named only beside the account's
      // organisation, so an anonymous page asks exactly what it asked before.
      ...(organization && audience.customerAccountId
        ? { customerAccountId: audience.customerAccountId }
        : {}),
    };
  }

  /**
   * `ProductSummary.price` for one resolved chain answer. A product absent from
   * the map renders `null`, and so does the chain's `none` arm — the wire field
   * has one spelling for "no price".
   */
  #summaryPrice(
    resolved: Map<string, ListingPriceDetail>,
    productId: string,
  ): { amount: number; currency: string } | null {
    const detail = resolved.get(productId);
    return detail === undefined ? null : listingPriceMoney(detail.price);
  }

  /**
   * `ProductSummary.resolvedPrice` — base, sale and display mode from the same
   * resolution as `price` (D-287 P0), and the list price beside a lower buyer
   * price when the engine answered one (161 G14). `null` where the product was
   * not resolved. One mapping for the listing cards and the product detail.
   */
  #summaryResolvedPrice(
    resolved: Map<string, ListingPriceDetail>,
    productId: string,
  ): ProductSummary['resolvedPrice'] {
    const detail = resolved.get(productId);
    if (detail === undefined) return null;
    return {
      basePrice: detail.basePrice,
      salePrice: detail.salePrice,
      displayMode: detail.displayMode,
      ...(detail.listPrice ? { listPrice: { amount: detail.listPrice.amount, currency: detail.listPrice.currency } } : {}),
    };
  }

  /**
   * {@link ListingCardReads} for a page, in a fixed number of statements
   * regardless of how many cards it holds (issue #263).
   *
   * `resolvePrimaryAssetUrls` has taken an id list since feature 075 and needs
   * no change — it was simply never handed more than one id from here, which is
   * MR !793's finding repeating itself: a helper that batches in signature
   * batches in practice only where the *page* is what calls it.
   *
   * The slug read carries an explicit `order by pc.product_id, pc.category_id`.
   * That is not a new ordering: `product_categories` is keyed on exactly that
   * pair, so the per-card `where pc.product_id = ?` was already answered from
   * that index in that order. Writing it down is what keeps the array the same
   * array now that a page-wide `in (…)` may reach the rows by another plan.
   */
  async #listingCardReadsFor(
    em: EntityManager,
    products: readonly Product[],
    /** The request: its resolved sales channel (override rows and keys are read for it alone) and language. */
    ctx: CatalogQueryContext,
    /**
     * What a single-product caller (the product page) has already read for its one
     * product: its scope rows in the channel and its keys per channel language — not
     * read again (checkpoint C code review, N1).
     */
    preloaded?: { scopeRows: ChannelScopeRows; keysByLanguage: ReadonlyMap<string, string> },
  ): Promise<ListingCardReads> {
    const channelId = ctx.resolvedChannel.id;
    const productIds = products.map((p) => p.id);
    const categorySlugsByProduct = new Map<string, string[]>();
    if (productIds.length === 0) {
      return {
        assetUrlByProduct: new Map(),
        categorySlugsByProduct,
        overridesByProduct: new Map(),
        effectiveKeyByProduct: new Map(),
        minOrderQuantityByProduct: new Map(),
      };
    }

    // Primary asset — for listings prefer the gallery's Thumbnail (US3),
    // then Base Image, then any first gallery item, finally the legacy
    // product_assets row. Resolution chain pinned by T096; run over the gallery as
    // the request's channel shows it (feature 163, FR-076).
    const assetUrlByProduct = await resolvePrimaryAssetUrls(em, this.#requireAssets(), productIds, channelId);

    const ids = [...productIds];
    const catRows = await em.execute<{ product_id: string; slug: string }[]>(
      `select pc.product_id::text as product_id, c.slug
         from product_categories pc
         join categories c on c.id = pc.category_id
        where pc.product_id in (${ids.map(() => '?').join(',')})
        order by pc.product_id, pc.category_id`,
      ids,
    );
    for (const row of catRows) {
      const slugs = categorySlugsByProduct.get(row.product_id) ?? [];
      slugs.push(row.slug);
      categorySlugsByProduct.set(row.product_id, slugs);
    }

    const overridesByProduct = await loadChannelOverridesByProduct(em, ids, channelId);
    const effectiveKeyByProduct = preloaded
      ? this.#keysAtScopeLanguage(products, preloaded.keysByLanguage, ctx)
      : await this.#effectiveKeysAt(em, products, ctx);
    // Feature 163 (FR-100) — the channel's minimum, read page-wide with its scope rows.
    const scopeRows = preloaded?.scopeRows ?? (await loadChannelScopeRows(em, ids, channelId));
    const minOrderQuantityByProduct = new Map(
      products.map((product) => [
        product.id,
        effectiveOrderRules(
          { minOrderQuantity: product.minOrderQuantity ?? null, returnable: product.returnable },
          scopeRows.channelRows.get(product.id),
        ).minOrderQuantity,
      ]),
    );

    return {
      assetUrlByProduct,
      categorySlugsByProduct,
      overridesByProduct,
      effectiveKeyByProduct,
      minOrderQuantityByProduct,
    };
  }

  /** The one product's key at the request's language, from keys already read (N1). */
  #keysAtScopeLanguage(
    products: ReadonlyArray<{ id: string; slug: string }>,
    keysByLanguage: ReadonlyMap<string, string>,
    ctx: CatalogQueryContext,
  ): Map<string, string> {
    const { languageCode } = this.#availabilityScope(ctx);
    return new Map(products.map((product) => [product.id, keysByLanguage.get(languageCode) ?? product.slug]));
  }

  /**
   * Feature 163 (R28) — each product's effective URL key at the request's
   * (channel, language), in one statement for the set.
   */
  async #effectiveKeysAt(
    em: EntityManager,
    products: ReadonlyArray<{ id: string; slug: string }>,
    ctx: CatalogQueryContext,
  ): Promise<Map<string, string>> {
    const { channel, languageCode } = this.#availabilityScope(ctx);
    const keys = await loadEffectiveKeys(em, products, { id: channel.id, languages: [languageCode] });
    const out = new Map<string, string>();
    for (const product of products) out.set(product.id, keys.get(product.id)?.get(languageCode) ?? product.slug);
    return out;
  }

  // ------------------------------------------------------------------
  // Products
  // ------------------------------------------------------------------

  async listProducts(
    params: ListProductsParams,
    ctx: CatalogQueryContext,
  ): Promise<ListResult<ProductSummary>> {
    // A price walk that began in the default order, for want of a price order,
    // continues in it to its end — the default listing's page, so nothing the
    // price path would read first is read (review 2, finding 7).
    const priceCursor = isPriceSort(params.sort) && params.cursor ? this.#priceCursor(params.cursor, ctx) : null;
    if (priceCursor?.stream === 'unordered') return this.#listUnordered(params, ctx, priceCursor.cursor);
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    // --- Filter validation: any filter[attr.<key>] where the attribute is
    // not filterable must return 400 FILTER_NOT_ALLOWED (FR-005, T043).
    let attributeViews: CatalogAttributeView[] = [];
    if (params.attributeFilters) {
      const keys = Object.keys(params.attributeFilters);
      if (keys.length > 0) {
        const views = await this.#requireAttributeRead().listAll();
        attributeViews = views;
        const byKey = new Map(views.map((a) => [a.key, a]));
        for (const k of keys) {
          const a = byKey.get(k);
          if (!a || !a.isFilterable) {
            throw new HttpError(
              400,
              ERROR_CODES.FILTER_NOT_ALLOWED,
              `Attribute "${k}" is not filterable.`,
              [{ path: `filter[attr.${k}]`, issue: 'attribute is not filterable' }],
            );
          }
        }
      }
    }

    // Feature 163 — status, window, membership and audience are one condition,
    // `availabilityCondition`, applied in every statement below; no status
    // value is tested here (FR-002).
    const where: Record<string, unknown> = {
      deletedAt: null,
    };
    const scope = this.#availabilityScope(ctx);
    // Feature 163 (FR-017 b) — free text and attribute filters over the
    // effective values a card shows at (channel, language), as conditions of
    // every statement below (issue #151), with their page-side twin.
    const filters = await this.#listingFilters(params, ctx, attributeViews);
    if (params.changedSince) {
      where['updatedAt'] = { $gt: new Date(params.changedSince) };
    }

    // Feature 086 — the two paths that read the viewer's own price. Both are
    // chunked and both are bounded; everything else takes the single fetch it
    // always took.
    if (isPriceSort(params.sort)) {
      return this.#listByViewerPrice(em, params, ctx, where, params.sort, priceCursor, scope, filters);
    }
    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      return this.#listWithPriceRange(em, params, ctx, where, scope, filters);
    }

    // Cursor decoding — over the keyset this ordering pages by, which is
    // `{ createdAt, id }` for the default sort and `{ name, id }` (the effective
    // name, feature 163 D6) for `name`. Decoded here; its `where` fragment is
    // made in the statement below, because under `name` it is a `raw()` key.
    const keyset = this.#keysetFor(params.sort, ctx);
    const decodedCursor = params.cursor
      ? keyset.parse(decodeObjectCursor<unknown>(params.cursor))
      : null;

    // Issue #151 — everything that decides whether a row is on the listing is
    // part of the statement the page is cut from. See `#listingNarrowing`.
    const narrowing = await this.#listingNarrowing(em, params, scope);
    if (narrowing === null) {
      // The category names nothing a storefront may browse, so no row matches
      // and there is no statement worth issuing.
      return { data: [], pagination: { cursor: null, hasMore: false, limit: params.limit } };
    }

    // Over-fetch by one to detect hasMore — one more **matching** row, which is
    // what makes `hasMore` a statement about the listing rather than about the
    // table.
    //
    // The `raw()` keys are created here, in the expression that hands them to
    // the statement, and nowhere earlier. MikroORM registers a fragment in a
    // process-wide cache the moment it is used as a key and releases it when a
    // statement consumes it, so one created on a path that then returns without
    // querying is held for the life of the process — which an anonymous caller
    // could repeat at will. Nothing may sit between the two: no `await`, no
    // early return, nothing that can throw.
    const products = await em.find(
      Product,
      {
        $and: [
          where,
          ...(decodedCursor ? [keyset.after(decodedCursor)] : []),
          ...[...narrowing, ...filters.conditions].map((c) => ({ [raw(c.sql, c.params)]: [] })),
        ],
      },
      { limit: params.limit + 1, orderBy: keyset.orderBy() },
    );

    const hasMore = products.length > params.limit;
    const page = hasMore ? products.slice(0, params.limit) : products;
    const lastOfPage = page[page.length - 1];
    const nextCursor =
      hasMore && lastOfPage
        ? encodeObjectCursor(keyset.of(lastOfPage, await this.#cursorNames(em, keyset, [lastOfPage], ctx)))
        : null;

    // The availability and attribute predicates once more, over the rows the
    // statement returned — kept deliberately, as defence in depth.
    // `isProductEffectivelyAvailable` is the platform's one answer to "may this
    // caller see this product here, now" and the SQL above is a restatement of
    // it; a restatement that admits a row the rule refuses must not be what
    // decides a disclosure. The case that exists today is a stored allow-list
    // that is not an array: the statement reads it as "no allow-list", the
    // predicate does not. It costs the page's two scope-row reads, and while the
    // two agree it removes nothing — which is what the parity test holds them
    // to (`availability-parity.test.ts`).
    const available = await this.#availableAmong(em, page, scope, true);
    const passing = await filters.passes(em, page);
    const priceable = page.filter((p) => available.has(p.id) && passing.has(p.id));

    // Build the summaries. The page is resolved **once** — `toSummary` used to
    // ask `price_lists` for a batch of one, so a 50-card page made 50 calls and
    // paid the resolution's fixed cost (the active lists, the settings pair, the
    // organisation's chain) 50 times over. Resolving the page here and handing
    // the map down is what makes `resolveListingPrices` a batch in practice
    // rather than only in signature.
    //
    // Its asset and its category slugs are resolved the same way and for the
    // same reason (issue #263): both helpers took an id list already, and both
    // were being handed one id at a time from inside the loop.
    const resolvedPrices = await this.#listingPricesFor(priceable, ctx);
    const cardReads = await this.#listingCardReadsFor(em, priceable, ctx);
    const summaries = priceable.map((p) =>
      this.toSummary(p, channel, ctx.preferredLanguage, resolvedPrices, cardReads),
    );

    return {
      data: summaries,
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * What narrows the default listing, as conditions **of the statement its page
   * is cut from** (issue #151) — or `null` when the category filter names
   * nothing, so no row can match.
   *
   * These four were applied to the page after `limit + 1` rows had been fetched
   * and `hasMore` and the cursor read off that cut. A page whose rows were all
   * narrowed away was answered `data: []` with `hasMore: true`; one where some
   * were was short. With two sales channels and the newest hundred products on
   * one of them, the other's first page of a hundred was empty.
   *
   *  - **availability** (feature 163) is `availabilityCondition`: channel
   *    membership through the kernel's accessor
   *    ({@link SalesChannelMembershipPort.entityIdsInChannelSubquery} — the
   *    bridge is still not named here, Constitution XII), the effective status
   *    at (C, L), the effective window at `now` and the effective audience rule
   *    (`isProductVisibleTo` restated over the channel's rule);
   *  - **the category** is an `exists` over this module's own
   *    `product_categories`, against the tree's ids rather than against every
   *    product id the tree holds, which is what the page-side test loaded;
   *  - **each attribute filter** is `#passesPageFilters`' string comparison
   *    restated — see `#attributeCondition`.
   *
   * **No `raw()` fragment is created here** — these are descriptions, and the
   * caller turns them into keys in the expression that executes them. A
   * fragment is registered process-wide when it becomes a key and released
   * only by the statement that consumes it, so this method, which can answer
   * `null` and awaits a read that can fail, is the wrong place to make one.
   */
  async #listingNarrowing(
    em: EntityManager,
    params: ListProductsParams,
    scope: PageAvailabilityScope,
  ): Promise<ListingCondition[] | null> {
    // First, because it is the one part that can end the request: an unknown,
    // inactive or deleted category means no row matches.
    let categoryIds: string[] | null = null;
    if (params.categorySlug) {
      categoryIds = await this.#categoryTreeIds(em, params.categorySlug);
      if (categoryIds.length === 0) return null;
    }

    const conditions: ListingCondition[] = [this.#availabilityNarrowing(scope)];

    if (categoryIds !== null) {
      const ids = categoryIds;
      conditions.push({
        sql: (alias) =>
          `exists (select 1 from product_categories pc ` +
          `where pc.product_id = ${alias}.id ` +
          `and pc.category_id in (${ids.map(() => '?').join(',')}))`,
        params: ids,
      });
    }

    return conditions;
  }

  /**
   * One `filter[attr.<key>]`, as SQL: the product's value for `key`, rendered
   * the way `#passesPageFilters` renders it, is one of the requested values.
   *
   * That method compares `String(value)`, so this is `String` restated for the
   * JSON kinds a stored value can take — see {@link jsStringOfJsonb}. A key the
   * product does not carry is SQL `NULL` throughout and matches nothing, which
   * is the method's `undefined` arm.
   *
   * The comparison is deliberately not improved here. A multiselect holding two
   * options matches neither of them alone, on either side of this change; that
   * is a question about what the filter means, and answering it in the
   * statement only would make the page-side predicate disagree with it.
   */
  #attributeCondition(value: SqlExpression, values: readonly string[]): ListingCondition {
    const wanted = values.map((v) => String(v));
    if (wanted.length === 0) return { sql: () => 'false', params: [] };
    return {
      sql: (alias) =>
        `(select ${jsStringOfJsonb('val.v')} ` +
        `from (select ${value.sql(alias)} as v) val) ` +
        `in (${wanted.map(() => '?').join(',')})`,
      params: [...value.params, ...wanted],
    };
  }

  /**
   * Feature 163 (FR-017 b) — what narrows a listing beside availability and the
   * category: the free-text match and each `filter[attr.<key>]`, over the
   * **effective** values a card shows at the request's (channel, language)
   * (#384's walk, `effective-value.sql.ts`). `conditions` go into every
   * statement a page is cut from; `passes` is their page-side twin over the
   * same walk in TypeScript (`effectiveAttributeValues`), kept as defence in
   * depth like the availability one.
   */
  async #listingFilters(
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    attributeViews: readonly CatalogAttributeView[],
  ): Promise<ListingFilters> {
    const channel = ctx.resolvedChannel;
    const effective: EffectiveValueScope = this.#overrideContext(channel, ctx.preferredLanguage);
    const conditions: ListingCondition[] = [];
    // Issue #590 — a read by id is one more condition of every statement a
    // page is cut from, so the price orderings and the range walk honour it as
    // the default order does; its page-side twin is in `passes` below.
    const ids = params.ids && params.ids.length > 0 ? [...params.ids] : null;
    if (ids) {
      conditions.push({
        sql: (alias) => `${alias}.id in (${ids.map(() => '?').join(',')})`,
        params: ids,
      });
    }
    if (params.q) conditions.push(await this.#textSearchCondition(params.q, ctx, effective));
    const scopeOf = new Map(
      attributeViews.map((a) => [a.key, { channelScoped: a.channelScoped, languageScoped: a.languageScoped }]),
    );
    const notScoped = { channelScoped: false, languageScoped: false };
    const attributeFilters = Object.entries(params.attributeFilters ?? {});
    for (const [key, values] of attributeFilters) {
      conditions.push(
        this.#attributeCondition(effectiveAttributeSql(key, scopeOf.get(key) ?? notScoped, effective), values),
      );
    }
    return {
      conditions,
      passes: async (em, all) => {
        const out = new Set<string>();
        const named = ids ? new Set(ids) : null;
        const products = named ? all.filter((p) => named.has(p.id)) : all;
        if (attributeFilters.length === 0) {
          for (const p of products) out.add(p.id);
          return out;
        }
        if (products.length === 0) return out;
        const overrides = await loadChannelOverridesByProduct(em, products.map((p) => p.id), channel.id);
        for (const product of products) {
          const values = await effectiveAttributeValues(
            product.attributeValues ?? {},
            overrides.get(product.id),
            effective,
            async () => scopeOf,
          );
          const ok = attributeFilters.every(([key, wanted]) => {
            const v = values[key];
            return v !== undefined && wanted.map((w) => String(w)).includes(String(v));
          });
          if (ok) out.add(product.id);
        }
        return out;
      },
    };
  }

  /**
   * The free-text match (FR-017 b): the SKU, the effective Name, and the
   * effective value of every searchable attribute, case-insensitive substring.
   */
  async #textSearchCondition(
    q: string,
    ctx: CatalogQueryContext,
    effective: EffectiveValueScope,
  ): Promise<ListingCondition> {
    const searchable = await this.#requireAttributeRead().listByFlag('isSearchable');
    const like = `%${q}%`;
    const name = this.#effectiveNameExpr(ctx);
    const attributes = searchable.map((a) =>
      effectiveAttributeSql(a.key, { channelScoped: a.channelScoped, languageScoped: a.languageScoped }, effective),
    );
    return {
      sql: (alias) =>
        `(${alias}.sku ilike ? or ${name.sql(alias)} ilike ?` +
        attributes.map((e) => ` or (${e.sql(alias)} #>> '{}') ilike ?`).join('') +
        `)`,
      params: [like, ...name.params, like, ...attributes.flatMap((e) => [...e.params, like])],
    };
  }

  /** The two range bounds as four-place decimal strings ({@link amountBound}), for every price path. */
  #amountRange(params: ListProductsParams): AmountRange | undefined {
    if (params.minPrice === undefined && params.maxPrice === undefined) return undefined;
    return {
      ...(params.minPrice !== undefined ? { min: amountBound(params.minPrice, 'min') } : {}),
      ...(params.maxPrice !== undefined ? { max: amountBound(params.maxPrice, 'max') } : {}),
    };
  }

  /**
   * The listing ordered by **the viewer's own** resolved unit price (feature
   * 086, US1/US2/US4).
   *
   * Two streams, in this order and never the other way round:
   *
   *  1. the **priced** stream, which `price_lists` answers in resolved-price
   *     order over its own tables. This service intersects every chunk with
   *     channel membership, `isProductVisibleTo` and the attribute filters
   *     before a row can reach the page, the cursor or a count — the port
   *     cannot do it, says so in its own contract, and a chunk from it may name
   *     products the viewer must never see;
   *  2. the **tail**: visible products no applicable price list prices. They
   *     appear, at the end, **in both directions**, ordered among themselves by
   *     the listing's default ordering. "No price" is not a large number or a
   *     small one — it is the absence of the value being ordered by — so a tail
   *     that flipped with the direction would lead "most expensive first" with
   *     the products nobody has priced, which reads as a bug on every shop that
   *     has one.
   *
   * **The tail is excluded by a price range** (FR-012): a range is a claim about
   * a number, and a product with no number does not satisfy it. That is the one
   * place the answer is exclusion, and it is exclusion from a filter the buyer
   * typed rather than from the catalogue.
   *
   * **A product has no price of its own** (feature 160, FR-042): the priced
   * stream is the price surface — every price a book gives this viewer — and
   * everything else is the tail.
   */
  async #listByViewerPrice(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    where: Record<string, unknown>,
    sort: 'price' | '-price',
    /** The request's cursor as `#priceCursor` read it: `null` starts the walk. */
    decoded: PriceListingCursor | null,
    availability: PageAvailabilityScope,
    filters: ListingFilters,
  ): Promise<ListResult<ProductSummary>> {
    const channel = ctx.resolvedChannel;
    const direction = sort === 'price' ? 'asc' : 'desc';
    // The viewer's pricing context and the category tree, read once for the
    // page and handed to whichever walk serves it — every chunk of it (review
    // 3, A5). An `unordered` walk is decided earlier, in `listProducts`, and
    // reads neither (review 2, finding 7).
    const scope = await this.#priceWalkScope(em, params, ctx, availability, filters);
    const { context } = scope;
    // A walk whose price order went missing carries on in the default order
    // from the last price it served, to its end.
    if (decoded?.stream === 'rest') {
      return this.#listRemainder(em, params, ctx, where, direction, scope, decoded, decoded.after);
    }
    const amountRange = this.#amountRange(params);
    const { restrictToProductIds } = scope;

    // A cursor issued under another sort is discarded rather than
    // reinterpreted: the existing behaviour for a cursor that does not parse.
    const startInTail = decoded?.stream === 'tail';
    let priceCursor: ListingPriceOrderCursor | null =
      decoded?.stream === 'priced' ? { amount: decoded.amount, productId: decoded.productId } : null;
    let tailCursor: { createdAt: string; id: string } | null =
      decoded?.stream === 'tail' ? { createdAt: decoded.createdAt, id: decoded.id } : null;

    const budget = PRICE_PAGE_SCAN_BUDGET_MULTIPLE * params.limit;
    // Over-fetch by one, exactly as the default path does, so a full page and
    // its `hasMore` come out of **one** chunk. Asking for `limit` instead costs
    // a second round trip on every full page — measured at four extra
    // statements, and invisible to a ceiling expressed as an absolute number.
    const target = params.limit + 1;
    const chunkSize = params.limit + 1;
    let spent = 0;
    let bound = false;

    const collected: Product[] = [];
    const cursors: PriceListingCursor[] = [];
    let pricedExhausted = startInTail;
    // The price order went missing after this page had collected from it.
    let orderLost = false;

    // --- the priced stream -------------------------------------------------
    while (!pricedExhausted && collected.length < target) {
      if (spent >= budget) {
        bound = true;
        break;
      }
      const chunk = await this.#requireListingPriceOrder().orderByUnitPrice({
        context,
        direction,
        after: priceCursor,
        limit: chunkSize,
        ...(restrictToProductIds !== undefined ? { restrictToProductIds } : {}),
        ...(amountRange ? { amountRange } : {}),
      });
      // Feature 160 (`specs/160-pricing-model-v2/contracts/price-surface.md` §3)
      // — no price order exists yet for this channel and currency, and none is
      // built for a request: the page is served in the default order, cards
      // priced live, until the worker has built one. Its cursor is the default
      // listing's, wrapped so the next page continues that walk.
      //
      // Review 2, finding 6 — a walk that is already **on** the price order
      // (a `priced` cursor, or a chunk of this page) and finds it gone does not
      // start again: page 1 of the default order would repeat what it served.
      // It carries on from the last price read (`#listRemainder`); a page that
      // has collected some rows ends with them, its cursor naming the last.
      if (chunk.unordered) {
        if (collected.length > 0) {
          orderLost = true;
          break;
        }
        if (priceCursor === null) return this.#listUnordered(params, ctx, null);
        return this.#listRemainder(em, params, ctx, where, direction, scope, priceCursor, null);
      }
      spent += Math.max(chunk.sourceRowsRead, chunk.rows.length);
      pricedExhausted = chunk.exhausted;
      if (chunk.rows.length === 0) {
        if (!chunk.exhausted) continue;
        break;
      }
      const last = chunk.rows[chunk.rows.length - 1]!;
      priceCursor = { amount: last.amount, productId: last.productId };

      const byId = await this.#visibleProductsInOrder(
        em,
        chunk.rows.map((row) => row.productId),
        where,
        scope.availability,
        scope.filters,
      );
      for (const row of chunk.rows) {
        const product = byId.get(row.productId);
        if (!product) continue;
        collected.push(product);
        cursors.push({ stream: 'priced', amount: row.amount, productId: row.productId });
        if (collected.length >= target) break;
      }
    }

    // --- the unpriced tail -------------------------------------------------
    // Skipped entirely under a range filter (FR-012), and only entered once the
    // priced stream is genuinely over — `exhausted`, which a short chunk does
    // not imply, because the provider may have stopped on its own bound.
    const wantsTail = amountRange === undefined && pricedExhausted && !bound;
    if (wantsTail) {
      const categoryIds = scope.categoryIds;
      while (collected.length < target) {
        if (spent >= budget) {
          bound = true;
          break;
        }
        const tailAfter = tailCursor
          ? [
              {
                $or: [
                  { createdAt: { $lt: new Date(tailCursor.createdAt) } },
                  { createdAt: new Date(tailCursor.createdAt), id: { $lt: tailCursor.id } },
                ],
              },
            ]
          : [];
        // Feature 163 — availability in the chunk's own statement (issue #151);
        // the `raw()` key is made in the expression that executes it.
        const narrowing = this.#availabilityNarrowing(scope.availability);
        const rows = await em.find(
          Product,
          {
            $and: [
              where,
              ...tailAfter,
              ...[narrowing, ...filters.conditions].map((c) => ({ [raw(c.sql, c.params)]: [] })),
            ],
          },
          {
            limit: chunkSize,
            // The listing's own default ordering, in both directions: the tail is
            // not ordered by a price it does not have.
            orderBy: { createdAt: 'desc', id: 'desc' },
          },
        );
        spent += rows.length;
        if (rows.length === 0) break;
        const lastRow = rows[rows.length - 1]!;
        tailCursor = { createdAt: lastRow.createdAt.toISOString(), id: lastRow.id };

        const priced = await this.#requireListingPriceOrder().pricedProductIds({
          context,
          productIds: rows.map((r) => r.id),
        });
        const candidates = rows.filter(
          (r) => !priced.has(r.id) && (categoryIds === null || categoryIds.has(r.id)),
        );
        const visibleIds = await this.#availableAmong(em, candidates, scope.availability, true);
        const passing = await scope.filters.passes(em, candidates);
        for (const product of candidates) {
          if (!visibleIds.has(product.id)) continue;
          if (!passing.has(product.id)) continue;
          collected.push(product);
          cursors.push({
            stream: 'tail',
            createdAt: product.createdAt.toISOString(),
            id: product.id,
          });
          if (collected.length >= target) break;
        }
        if (rows.length < chunkSize) break;
      }
    }

    if (bound) {
      this.log?.warn(
        { budget, spent, limit: params.limit, sort },
        'catalog: price-ordered page hit its scan budget and is returning short',
      );
    }

    // A page cut by the scan budget continues from where its scan stopped —
    // in the tail once the tail has been read, else in the priced stream,
    // whose exhaustion the next page then finds and goes on into the tail —
    // never from its last card, and never ends the walk (review 3 of release
    // 0.108.0, A1). That row may be one the viewer may not see, and its price
    // is in the position, so the cursor is sealed (issue #497).
    const page = collected.slice(0, params.limit);
    let resumeAt: PriceListingCursor | null = null;
    if (collected.length > params.limit || orderLost) resumeAt = cursors[page.length - 1] ?? null;
    else if (bound && tailCursor) resumeAt = { stream: 'tail', ...tailCursor };
    else if (bound && priceCursor) resumeAt = { stream: 'priced', ...priceCursor };
    const hasMore = resumeAt !== null;
    const nextCursor = resumeAt === null ? null : this.#sealCursor(PRICE_WALK_CURSOR_PURPOSE, resumeAt);

    const resolvedPrices = await this.#listingPricesFor(page, ctx, context);
    const cardReads = await this.#listingCardReadsFor(em, page, ctx);
    return {
      data: page.map((p) =>
        this.toSummary(p, channel, ctx.preferredLanguage, resolvedPrices, cardReads),
      ),
      // No total count, no rank, no "showing 51–100 of 4 213" (FR-015): an
      // aggregate over the priced set is an aggregate over rows the viewer may
      // not be allowed to see.
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * What every chunk of a price walk reads for the same viewer: built once per
   * page and passed down, never per chunk (review 3 of release 0.108.0, A5 — a
   * page reads up to eight chunks, and each used to look the organization up
   * again and, on the remainder, re-read the category tree).
   */
  async #priceWalkScope(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    availability: PageAvailabilityScope,
    filters: ListingFilters,
  ): Promise<PriceWalkScope> {
    const categoryIds = params.categorySlug ? await this.productIdsInCategoryTree(em, params.categorySlug) : null;
    const named = params.ids && params.ids.length > 0 ? params.ids : null;
    const restrictToProductIds = named
      ? named.filter((id) => categoryIds === null || categoryIds.has(id))
      : categoryIds
        ? [...categoryIds]
        : undefined;
    return {
      context: await this.#viewerPricingContext(ctx),
      categoryIds,
      restrictToProductIds,
      availability,
      filters,
    };
  }

  /**
   * The cursor of a price-sorted page, every field checked, or `null` — which
   * starts the walk at its first page, as the default listing does with a
   * cursor it cannot read (review 3 of release 0.108.0, A4). A price is read
   * with the contracts' decimal parser, an id must be a uuid and a position
   * the default listing's keyset; an `unordered` cursor wraps the default
   * listing's own, which that listing checks.
   */
  #priceCursor(cursor: string, ctx: CatalogQueryContext): PriceListingCursor | null {
    const decoded = this.#openCursor(PRICE_WALK_CURSOR_PURPOSE, cursor);
    if (!isRecord(decoded)) return null;
    const keyset = this.#keysetFor(undefined, ctx);
    switch (decoded['stream']) {
      case 'priced': {
        const amount = cursorAmount(decoded['amount']);
        const productId = decoded['productId'];
        return amount !== null && isUuidText(productId) ? { stream: 'priced', amount, productId } : null;
      }
      case 'tail': {
        const at = keyset.parse(decoded);
        return at !== null && 'createdAt' in at ? { stream: 'tail', createdAt: at.createdAt, id: at.id } : null;
      }
      case 'rest': {
        const amount = cursorAmount(decoded['amount']);
        const productId = decoded['productId'];
        const after = keyset.parse(decoded['after']);
        return amount !== null && isUuidText(productId) && after !== null
          ? { stream: 'rest', amount, productId, after }
          : null;
      }
      case 'unordered':
        return typeof decoded['cursor'] === 'string' ? { stream: 'unordered', cursor: decoded['cursor'] } : null;
      default:
        return null;
    }
  }

  /**
   * A price-sorted page served in the default order, because no price order
   * exists for the viewer yet (`contracts/price-surface.md` §3): the default
   * listing's page, with its cursor wrapped as an `unordered` price cursor so
   * the walk pages through every product once and ends (review finding 3 of
   * release 0.108.0 — dropping the cursor served page 1 forever).
   */
  async #listUnordered(
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    cursor: string | null,
  ): Promise<ListResult<ProductSummary>> {
    const { sort: _sort, cursor: _cursor, ...rest } = params;
    const page = await this.listProducts(cursor ? { ...rest, cursor } : rest, ctx);
    const next = page.pagination.cursor;
    return {
      ...page,
      pagination: {
        ...page.pagination,
        cursor: next
          ? this.#sealCursor(PRICE_WALK_CURSOR_PURPOSE, { stream: 'unordered', cursor: next } satisfies PriceListingCursor)
          : null,
      },
    };
  }

  /**
   * A price **range** under an ordering that is not a price ordering (research
   * §R12).
   *
   * The ordering is this module's own and the price is a predicate it cannot
   * spell, so the page is walked in chunks and each chunk is narrowed by the
   * prices it was **already going to resolve** — `resolveListingPrices` is
   * called for the page whatever the sort, so in the common case this costs no
   * additional query at all. The failure mode is a short page under a highly
   * selective range, which is this listing's existing behaviour rather than a
   * new one, and it is bounded by the same scan budget.
   *
   * A product no applicable list prices is excluded, exactly as it is under a
   * price ordering: the chain's `none` and `product` arms are both absences of
   * a price-list figure, and a range is a claim about one.
   */
  async #listWithPriceRange(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    where: Record<string, unknown>,
    scope: PageAvailabilityScope,
    filters: ListingFilters,
  ): Promise<ListResult<ProductSummary>> {
    const range = this.#amountRange(params);
    // The chunk walk and the page it hands back page by the same keyset, and
    // that keyset is the one this ordering sorts on — `keysetFor`.
    const keyset = this.#keysetFor(params.sort, ctx);
    return this.#walkKeepingByPrice(em, params, ctx, where, await this.#priceWalkScope(em, params, ctx, scope, filters), {
      sort: params.sort,
      start: params.cursor ? keyset.parse(this.#openCursor(PRICE_RANGE_WALK_CURSOR_PURPOSE, params.cursor)) : null,
      keep: (price) => price !== null && withinAmountRange(price.amount, range),
      // Sealed (issue #497): a page cut by the budget names the row its scan
      // stopped at, which may be a product the viewer may not see.
      cursorOf: (after) => this.#sealCursor(PRICE_RANGE_WALK_CURSOR_PURPOSE, after),
      what: 'price-filtered',
    });
  }

  /**
   * The rest of a price-ordered walk whose price order went missing midway
   * (review 2, finding 6 of release 0.108.0): the surface was retired or is
   * being rebuilt, and nothing on this request can rebuild it
   * (`contracts/price-surface.md` §3).
   *
   * What the walk has served is, by price, every priced product up to the last
   * price it served, `boundary`, in the walk's direction and `(amount,
   * productId)` keyset — the price order's own — and none of the unpriced
   * tail, which comes after every priced product. So the rest is every product
   * the listing shows whose live price (the figure its card is rendered with,
   * and the one the order is built from) sorts **after** `boundary`, and every
   * unpriced one unless a price range excludes them (FR-012), walked in the
   * default order — the order of the rest is the one thing there is no
   * surface to give.
   *
   * **The guarantee, stated honestly** (review 3 of release 0.108.0, A2): the
   * boundary is a price the order held, compared with a price resolved now.
   * A product whose price changed while the walk was under way — and an order
   * usually goes missing *because* pricing changed — can sort onto the other
   * side of the boundary, so it may be met twice or not at all. That is true
   * of any keyset walk over a live price, the surface walk included: the
   * surface follows a repricing too. Every product whose price did not change
   * is met exactly once, scan budget or not (`#walkKeepingByPrice`).
   *
   * Chosen over answering "the order changed, start again" because neither the
   * listing contract nor the storefront can carry that signal: `pagination` is
   * `{ cursor, hasMore, limit }`, the storefront's pages are server-rendered
   * links that hold only the cursor, and a restart is a repeat by definition.
   * Continuing from the last served position needs no wire change, and a walk
   * started this way stays on it to its end, like an `unordered` one.
   */
  async #listRemainder(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    where: Record<string, unknown>,
    direction: 'asc' | 'desc',
    scope: PriceWalkScope,
    boundary: ListingPriceOrderCursor,
    after: ListingKeysetCursor | null,
  ): Promise<ListResult<ProductSummary>> {
    const range = this.#amountRange(params);
    const sign = direction === 'asc' ? 1 : -1;
    const afterBoundary = (amount: string, productId: string): boolean => {
      const byAmount = compareDecimal(amount, boundary.amount);
      const byId = productId < boundary.productId ? -1 : productId > boundary.productId ? 1 : 0;
      return sign * (byAmount || byId) > 0;
    };
    return this.#walkKeepingByPrice(em, params, ctx, where, scope, {
      sort: undefined,
      start: after,
      keep: (price, product) => {
        if (price === null) return range === undefined;
        return withinAmountRange(price.amount, range) && afterBoundary(price.amount, product.id);
      },
      cursorOf: (next) =>
        this.#sealCursor(PRICE_WALK_CURSOR_PURPOSE, {
          stream: 'rest',
          amount: boundary.amount,
          productId: boundary.productId,
          after: next,
        } satisfies PriceListingCursor),
      what: 'price-ordered (order lost)',
    });
  }

  /**
   * A listing walked in a keyset ordering, chunk by chunk, each chunk narrowed
   * by everything a page is narrowed by and then by the live listing price its
   * cards are rendered with — `keep` decides on that price. Bounded by the scan
   * budget; a bound answers a short, possibly empty, page whose cursor
   * continues from the scan position. `cursorOf` seals it: that position may
   * be a product the viewer may not see (issue #497).
   */
  async #walkKeepingByPrice(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    where: Record<string, unknown>,
    scope: PriceWalkScope,
    walk: {
      sort: ListProductsParams['sort'];
      start: ListingKeysetCursor | null;
      /** `price` is `null` for a product no price book prices for this viewer. */
      keep: (price: PricedListingPrice | null, product: Product) => boolean;
      cursorOf: (after: ListingKeysetCursor) => string;
      what: string;
    },
  ): Promise<ListResult<ProductSummary>> {
    const channel = ctx.resolvedChannel;
    const categoryFilteredIds = scope.categoryIds;
    const filters = scope.filters;
    const keyset = this.#keysetFor(walk.sort, ctx);
    let cursor: ListingKeysetCursor | null = walk.start;
    const budget = PRICE_PAGE_SCAN_BUDGET_MULTIPLE * params.limit;
    const target = params.limit + 1;
    // Over-fetch by one, for the same reason the price path does: a full page
    // and its `hasMore` should come out of one chunk.
    const chunkSize = params.limit + 1;
    let spent = 0;
    let bound = false;

    const collected: Product[] = [];
    const prices = new Map<string, ListingPriceDetail>();

    while (collected.length < target) {
      if (spent >= budget) {
        bound = true;
        break;
      }
      // Feature 163 — availability in the chunk's own statement (issue #151);
      // the `raw()` key is made in the expression that executes it.
      const narrowing = this.#availabilityNarrowing(scope.availability);
      const rows = await em.find(
        Product,
        {
          $and: [
            where,
            ...(cursor ? [keyset.after(cursor)] : []),
            ...[narrowing, ...filters.conditions].map((c) => ({ [raw(c.sql, c.params)]: [] })),
          ],
        },
        {
          limit: chunkSize,
          orderBy: keyset.orderBy(),
        },
      );
      spent += rows.length;
      if (rows.length === 0) break;
      const lastRow = rows[rows.length - 1]!;
      cursor = keyset.of(lastRow, await this.#cursorNames(em, keyset, [lastRow], ctx));

      const visibleIds = await this.#availableAmong(em, rows, scope.availability, true);
      const passing = await filters.passes(em, rows);
      const candidates = rows.filter(
        (r) =>
          visibleIds.has(r.id) &&
          passing.has(r.id) &&
          (categoryFilteredIds === null || categoryFilteredIds.has(r.id)),
      );
      // The walk decides on the viewer's own price — the figure the price
      // order is made of. It asks the resolution directly, not through
      // `#listingPricesFor`, which once answered no price at all on a channel
      // that withheld prices; that read here as "no detail" and dropped every
      // product, priced and unpriced alike (review 3 of release 0.108.0, A3).
      const chunkPrices =
        candidates.length === 0
          ? new Map<string, ListingPriceDetail>()
          : await this.#requireListingPrices().resolveListingPriceDetails({
              products: candidates,
              context: scope.context,
            });
      for (const product of candidates) {
        const detail = chunkPrices.get(product.id);
        const price = detail?.price.source === 'price_list' ? detail.price : null;
        if (!walk.keep(price, product)) continue;
        collected.push(product);
        if (detail !== undefined) prices.set(product.id, detail);
        if (collected.length >= target) break;
      }
      if (rows.length < chunkSize) break;
    }

    if (bound) {
      this.log?.warn(
        { budget, spent, limit: params.limit, sort: params.sort ?? 'relevance' },
        `catalog: ${walk.what} page hit its scan budget and is returning short`,
      );
    }

    // A page cut by the scan budget has more after it, and continues from
    // where its scan stopped — not from its last card, which would read the
    // same rows again — so a budget makes a page short, or empty, but never
    // ends the walk (review 3 of release 0.108.0, A1). The scan moves forward
    // by at least one chunk a page, so the walk still ends.
    const full = collected.length > params.limit;
    const page = collected.slice(0, params.limit);
    const last = page[page.length - 1];
    const resumeAt =
      full && last ? keyset.of(last, await this.#cursorNames(em, keyset, [last], ctx)) : bound ? cursor : null;
    const hasMore = resumeAt !== null;
    const nextCursor = resumeAt === null ? null : walk.cursorOf(resumeAt);
    const cardReads = await this.#listingCardReadsFor(em, page, ctx);
    return {
      data: page.map((p) =>
        this.toSummary(p, channel, ctx.preferredLanguage, prices, cardReads),
      ),
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * The products behind an ordered chunk of ids, narrowed by everything this
   * module narrows a page by, keyed by id.
   *
   * The order comes from the caller, not from here: `em.find` with an `in (…)`
   * answers in whatever order it likes, and the ordering being reproduced is the
   * price one.
   */
  async #visibleProductsInOrder(
    em: EntityManager,
    productIds: readonly string[],
    where: Record<string, unknown>,
    scope: PageAvailabilityScope,
    filters: ListingFilters,
  ): Promise<Map<string, Product>> {
    const out = new Map<string, Product>();
    if (productIds.length === 0) return out;
    // Feature 163 — the `raw()` key is made in the expression that executes it.
    const narrowing = this.#availabilityNarrowing(scope);
    const rows = await em.find(Product, {
      $and: [
        where,
        { id: { $in: [...productIds] } },
        ...[narrowing, ...filters.conditions].map((c) => ({ [raw(c.sql, c.params)]: [] })),
      ],
    });
    const visibleIds = await this.#availableAmong(em, rows, scope, true);
    const passing = await filters.passes(em, rows);
    for (const product of rows) {
      if (!visibleIds.has(product.id)) continue;
      if (!passing.has(product.id)) continue;
      out.set(product.id, product);
    }
    return out;
  }

  /**
   * Whether `product` may be shown to this request at (C, L), as the product page
   * answers it — the one decision both the page and the key resolution
   * (`UrlKeyResolutionService`) ask, so a key can never resolve to a product the
   * page would refuse. Throws `404 PRODUCT_NOT_FOUND` or `410 PRODUCT_ARCHIVED`;
   * answers the product's scope rows on the channel for a caller that reads on.
   */
  async assertReachable(product: Product, ctx: CatalogQueryContext): Promise<ChannelScopeRows> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    const notFound = (): HttpError =>
      new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    if (product.deletedAt) throw notFound();

    // Membership and the audience come first, for every product including an
    // archived one: a caller outside the channel, or outside the product's
    // effective audience there, may not learn the row exists — not even that
    // it existed (feature 163, one answer for "unavailable" and "absent").
    // Through the kernel's accessor (Constitution XII).
    const scope = this.#availabilityScope(ctx);
    const scopeRows = await loadChannelScopeRows(em, [product.id], channel.id);
    const isMember = (await this.filterByChannel([product.id], channel)).has(product.id);
    if (!isMember) throw notFound();
    if (!isProductVisibleTo(effectiveAudience(globalScopeFields(product), scopeRows.channelRows.get(product.id)), ctx.audience)) {
      throw notFound();
    }

    // FR-005, O-3 (T156t) — 410 iff archived: `archived_at` alone says "gone"
    // (archiving is its own action, owner decision Q1); the status never does.
    // Otherwise 404 unless effectively available at (C, L) — a product switched
    // off globally, in the channel or in the language is not reachable by its URL.
    //
    // The 410 says "this was here and is gone", so it is answered only where
    // the product would be available to this buyer with the archive taken away —
    // `archived_at` cleared and the global status read as `active`, while every
    // channel and channel × language status, membership, the channel's languages,
    // the window and the audience still apply (security review, checkpoint B). An archived
    // product that is also switched off in this channel or language, or
    // outside its window, answers the absent product's 404: its existence
    // here is not this caller's to learn.
    if (product.archivedAt) {
      const asIfLive: ScopedProduct = {
        id: product.id,
        status: 'active',
        deletedAt: null,
        archivedAt: null,
        publishFrom: product.publishFrom ?? null,
        publishUntil: product.publishUntil ?? null,
        visibility: product.visibility,
        allowedOrganizationIds: product.allowedOrganizationIds,
        minOrderQuantity: product.minOrderQuantity ?? null,
        returnable: product.returnable,
      };
      if (!isAvailableWith(asIfLive, scopeRows, true, scope)) throw notFound();
      throw new HttpError(410, ERROR_CODES.PRODUCT_ARCHIVED, 'Product is archived.');
    }
    const available = await availableAmong(em, this.#requireChannelMembership(), [product], scope, {
      membersKnown: true,
      rows: scopeRows,
    });
    if (!available.has(product.id)) throw notFound();
    return scopeRows;
  }

  /**
   * Feature 163 (FR-074, `contracts/url-keys-and-redirects.md` §6) — the page's
   * canonical at the request's (C, L) and its alternate-language paths, built with
   * `productPath()` here because only catalog knows the channel's URL languages
   * and where the product is available. An alternate is listed only for a channel
   * language where the product is available to the **anonymous** audience,
   * whoever is asking: `hreflang` tells a crawler what it may open.
   */
  #pagePaths(
    product: Product,
    scopeRows: ChannelScopeRows,
    ctx: CatalogQueryContext,
    /** The product's effective key per channel language, already read by the page. */
    keys: ReadonlyMap<string, string>,
  ): ProductPagePaths {
    const scope = this.#availabilityScope(ctx);
    const channel = scope.channel;
    const urlFacts = channelUrlFactsOf(ctx.resolvedChannel);
    const pathAt = (languageCode: string): string =>
      productPath({
        key: keys.get(languageCode) ?? product.slug,
        languageCode,
        channel: urlFacts,
      });
    const alternates = channel.languages
      .filter((languageCode) =>
        isAvailableWith(product, scopeRows, true, {
          ...scope,
          languageCode,
          audience: ANONYMOUS_PRODUCT_AUDIENCE,
        }),
      )
      .map((languageCode) => ({ languageCode, path: pathAt(languageCode) }));
    // Feature 167 (url-shape §8) — `x-default` is the unprefixed URL of the key at the
    // channel's default language, in both setting states.
    const xDefault = productDefaultPath(keys.get(channel.defaultLanguage) ?? product.slug);
    return { canonical: pathAt(scope.languageCode), alternates, xDefault };
  }

  /**
   * The product page's read (R28): an id; else a **current** key of the request's
   * language L (any channel's key of L counts — `findCurrentKeyHolder`); else a
   * product's global key, the stable handle CMS product blocks store. Never a
   * redirect: the storefront resolves a URL through `resolve` and reads by id.
   */
  async getProductByIdOrSlug(idOrSlug: string, ctx: CatalogQueryContext): Promise<ProductDetail> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const product = isUuid
      ? await em.findOne(Product, { id: idOrSlug })
      : ((await findCurrentKeyHolder(em, idOrSlug, this.#availabilityScope(ctx).languageCode)) ??
        (await em.findOne(Product, { slug: idOrSlug })));
    if (!product || product.deletedAt) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const scopeRows = await this.assertReachable(product, ctx);
    // The product's keys in every channel language, read once for the card's link and
    // the page's canonical and alternates (checkpoint C code review, N1).
    const keysByLanguage =
      (await loadEffectiveKeys(em, [product], this.#availabilityScope(ctx).channel)).get(product.id) ??
      new Map<string, string>();

    const cardReads = await this.#listingCardReadsFor(em, [product], ctx, { scopeRows, keysByLanguage });
    const summary = this.toSummary(
      product,
      channel,
      ctx.preferredLanguage,
      await this.#listingPricesFor([product], ctx),
      cardReads,
    );
    // Issue #384 — the product's override rows, already read for the summary.
    const overrides = cardReads.overridesByProduct.get(product.id);
    const overrideCtx = this.#overrideContext(channel, ctx.preferredLanguage);

    // Categories
    const categoryRows = await em.execute<{ category_id: string }[]>(
      `select category_id from product_categories where product_id = ?`,
      [product.id],
    );
    const categoryIds = categoryRows.map((r) => r.category_id);
    // Feature 068 — the PDP breadcrumb/category list is customer-facing: skip
    // deactivated categories, and deleted ones (never filtered here before).
    const categories = await em.find(Category, {
      id: { $in: categoryIds },
      deletedAt: null,
      isActive: true,
    });

    // Assets
    const assetRows = await em.execute<{ asset_id: string; position: number }[]>(
      `select asset_id, position from product_assets where product_id = ? order by position asc`,
      [product.id],
    );
    const assetIds = assetRows.map((r) => r.asset_id);
    const allAssets = await this.#requireAssets().findByIds(assetIds);

    // Variants
    const variants = product.type === 'configurable' ? await em.find(ProductVariant, { parentProductId: product.id }) : [];

    // Feature 002 — Attribute Set wired to this Product. Pulled in a
    // single findOne so PDP renders include the set's localized name
    // without a follow-up call.
    const attributeSetEntity = await em.findOne(AttributeSet, {
      id: product.attributeSetId,
    });

    // Feature 002 US3 — eager-load gallery + attachments for the PDP.
    // Gallery: items + label bridge zipped per item; Asset urls
    // resolved into a flat shape the storefront can render directly.
    // Feature 163 (FR-076, R14) — the gallery as the request's channel shows it:
    // hidden items dropped, each role at its channel holder (`effectiveGallery`).
    const storedGalleryItems = await em.find(
      GalleryItem,
      { productId: product.id },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const galleryLabels = storedGalleryItems.length > 0
      ? await em.find(GalleryItemLabel, { productId: product.id })
      : [];
    const globalLabelsByItem = new Map<string, GalleryLabel[]>();
    for (const l of galleryLabels) {
      const existing = globalLabelsByItem.get(l.galleryItemId) ?? [];
      existing.push(l.label);
      globalLabelsByItem.set(l.galleryItemId, existing);
    }
    const galleryOverrides =
      storedGalleryItems.length > 0
        ? (await loadGalleryChannelOverrides(em, [product.id], channel.id)).get(product.id)
        : undefined;
    const galleryItems = effectiveGallery(
      storedGalleryItems.map((item) => ({ id: item.id, item, labels: globalLabelsByItem.get(item.id) ?? [] })),
      galleryOverrides,
    );
    const labelsByItem = new Map(galleryItems.map((g) => [g.id, g.labels]));
    const galleryAssetIds = galleryItems.map((g) => g.item.assetId);
    const galleryAssetsById = new Map<string, AssetRecord>();
    if (galleryAssetIds.length > 0) {
      const galleryAssets = await this.#requireAssets().findByIds(galleryAssetIds);
      for (const a of galleryAssets) galleryAssetsById.set(a.id, a);
    }
    // An image hidden in the channel stays hidden when a legacy `product_assets` row
    // names the same asset.
    const hiddenAssetIds = new Set(
      storedGalleryItems.filter((item) => galleryOverrides?.hidden.has(item.id)).map((item) => item.assetId),
    );
    const assets = allAssets.filter((asset) => !hiddenAssetIds.has(asset.id));
    // FR-077 (R15) — the product's own alt text at the scope language, else the
    // asset's alt text through the existing pick.
    const scopeLanguage = this.#availabilityScope(ctx).languageCode;
    const altTextOf = (item: GalleryItem, asset: AssetRecord): string | null =>
      translationAt(item.altText, scopeLanguage) ??
      (asset.altText ? this.pickLang(asset.altText, ctx.preferredLanguage, channel) : null);

    // Attachments + their types, eager-loaded in two queries.
    // Feature 163 (FR-078, R16) — an attachment hidden in the request's channel is
    // neither listed nor named here (its asset is not even read).
    const storedAttachmentRows = await em.find(
      ProductAttachment,
      { productId: product.id },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const hiddenAttachments =
      storedAttachmentRows.length > 0
        ? await loadAttachmentsHiddenInChannel(em, product.id, channel.id)
        : new Set<string>();
    const attachmentRows = storedAttachmentRows.filter((row) => !hiddenAttachments.has(row.id));
    const attachmentTypeIds = [...new Set(attachmentRows.map((a) => a.attachmentTypeId))];
    const attachmentTypesById = new Map<string, AttachmentType>();
    if (attachmentTypeIds.length > 0) {
      const types = await em.find(AttachmentType, { id: { $in: attachmentTypeIds } });
      for (const t of types) attachmentTypesById.set(t.id, t);
    }
    const attachmentAssetIds = [...new Set(attachmentRows.map((a) => a.assetId))];
    const attachmentAssetsById = new Map<string, AssetRecord>();
    if (attachmentAssetIds.length > 0) {
      const aAssets = await this.#requireAssets().findByIds(attachmentAssetIds);
      for (const a of aAssets) attachmentAssetsById.set(a.id, a);
    }

    const descriptionText = effectiveSystemText(
      overrides,
      'description',
      overrideCtx,
      product.description,
      this.pickLang(product.description, ctx.preferredLanguage, channel),
    );
    // The summary's name went through the same resolution.
    const nameText = summary.name;

    // Issue #384 — channel-scoped user attributes carry their override for
    // this (channel, language); the scope lookup runs only when the product
    // has a user-attribute override row at all. The attribute views are read
    // at most once for this page, and only by whichever step needs them first.
    let attributeViews: Promise<CatalogAttributeView[]> | undefined;
    const listAttributeViews = (): Promise<CatalogAttributeView[]> =>
      (attributeViews ??= this.#requireAttributeRead().listAll());
    const attributeValues = await effectiveAttributeValues(
      product.attributeValues ?? {},
      overrides,
      overrideCtx,
      async () =>
        new Map(
          (await listAttributeViews()).map((a) => [
            a.key,
            { channelScoped: a.channelScoped, languageScoped: a.languageScoped },
          ]),
        ),
    );

    // Feature 012 / FR-030 — "Parametry produktu" tab projection.
    // Resolve every attribute that is flagged isVisibleOnProductPage
    // AND has a non-empty value on this product. Render the value per
    // the active locale (option label for select / enum / multiselect,
    // formatted scalar otherwise). Sorted by AttributeSetAttribute
    // position when assigned, by attribute key otherwise.
    const visibleAttributes = await this.buildVisibleAttributesProjection(
      em,
      product,
      attributeValues,
      ctx.preferredLanguage,
      channel,
      listAttributeViews,
    );

    // T097 — OG image prefers gallery Base Image (then Thumbnail, then
    // primaryAssetUrl). Base Image is the marketer's hero shot, so social
    // shares should land on it.
    const labelled = (label: 'base_image' | 'thumbnail'): AssetRecord | null =>
      galleryItems
        .map((g) => ({ asset: galleryAssetsById.get(g.item.assetId) ?? null, labels: labelsByItem.get(g.id) ?? [] }))
        .find((g) => g.asset && g.labels.includes(label))?.asset ?? null;
    const derivedSeo: SeoProductMetaValues = {
      title: nameText,
      description: descriptionText.slice(0, 160),
      ogTitle: nameText,
      ogDescription: descriptionText.slice(0, 240),
      ogImageUrl:
        labelled('base_image')?.storageUrl ?? labelled('thumbnail')?.storageUrl ?? summary.primaryAssetUrl,
    };
    // Feature 163 (R13, Q-A) — the operator's overrides at (C, L), field by
    // field, over the derived values; the derived ones alone while `seo` is off.
    const seoMeta =
      (await this.seoProductMeta?.({
        productId: product.id,
        channelId: channel.id,
        languageCode: this.#availabilityScope(ctx).languageCode,
        fallback: derivedSeo,
      })) ?? derivedSeo;

    const detail: ProductDetail = {
      ...summary,
      description: descriptionText,
      attributeValues: this.coerceAttributeValues(attributeValues),
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.storageUrl,
        altText: a.altText ? this.pickLang(a.altText, ctx.preferredLanguage, channel) : null,
      })),
      variants: variants.map<VariantDto>((v) => ({
        id: v.id,
        sku: v.sku,
        variantAttributeValues: v.variantAttributeValues,
        stockLevel: v.stockLevel ?? null,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
      })),
      paths: this.#pagePaths(product, scopeRows, ctx, keysByLanguage),
      seo: {
        metaTitle: seoMeta.title,
        metaDescription: seoMeta.description,
        openGraph: {
          title: seoMeta.ogTitle,
          description: seoMeta.ogDescription,
          imageUrl: seoMeta.ogImageUrl,
        },
      },
      structuredDataJsonLd: {
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: nameText,
        sku: product.sku,
        description: descriptionText,
        ...(summary.price
          ? {
              offers: {
                '@type': 'Offer',
                price: summary.price.amount,
                priceCurrency: summary.price.currency,
                availability:
                  summary.stockIndicator === 'out_of_stock'
                    ? 'https://schema.org/OutOfStock'
                    : 'https://schema.org/InStock',
              },
            }
          : {}),
      },
      ...(attributeSetEntity
        ? {
            attributeSet: {
              id: attributeSetEntity.id,
              code: attributeSetEntity.code,
              name: attributeSetEntity.name,
            },
          }
        : {}),
      gallery: galleryItems.flatMap((g) => {
        const a = galleryAssetsById.get(g.item.assetId);
        if (!a) return [];
        return [
          {
            id: g.id,
            position: g.item.position,
            labels: [...g.labels].sort(),
            asset: { id: a.id, kind: a.kind, url: a.storageUrl },
            altText: altTextOf(g.item, a),
          },
        ];
      }),
      attachments: attachmentRows.flatMap((row) => {
        const t = attachmentTypesById.get(row.attachmentTypeId);
        const a = attachmentAssetsById.get(row.assetId);
        if (!t || !a) return [];
        return [
          {
            id: row.id,
            position: row.position,
            // Feature 163 (FR-078) — the text at the scope language, else the global one.
            name: translationAt(row.nameTranslations, scopeLanguage) ?? row.name,
            description: translationAt(row.descriptionTranslations, scopeLanguage) ?? row.description ?? null,
            type: { id: t.id, code: t.code, name: t.name },
            asset: {
              id: a.id,
              kind: a.kind,
              url: a.storageUrl,
              filename: a.filename,
              sizeBytes: Number(a.sizeBytes),
              mimeType: a.mimeType,
            },
          },
        ];
      }),
      visibleAttributes,
    };

    // Feature 002 US4 — pre-grouped Product Links. Inactive targets and
    // channel-restricted ones are filtered by listForStorefront. Default
    // page sizes per spec.md US4 Assumptions: related=8, up-sell=4,
    // cross-sell=4.
    if (this.productLinkService) {
      const linkRows = await this.productLinkService.listForStorefront(
        product.id,
        {
          resolvedChannel: ctx.resolvedChannel,
          audience: ctx.audience,
          ...(ctx.preferredLanguage ? { preferredLanguage: ctx.preferredLanguage } : {}),
        },
      );
      const sliced = (rows: typeof linkRows, n: number): typeof linkRows =>
        rows.slice(0, n);
      detail.links = {
        related: sliced(
          linkRows.filter((l) => l.kind === 'related'),
          8,
        ),
        upSell: sliced(
          linkRows.filter((l) => l.kind === 'up_sell'),
          4,
        ),
        crossSell: sliced(
          linkRows.filter((l) => l.kind === 'cross_sell'),
          4,
        ),
      };
    }

    // Feature 002 US5 — type-discriminated composite payload. Only the
    // branch matching `product.type` is populated; other branches are
    // omitted so the response stays compact and the storefront can do a
    // simple type switch.
    if (product.type === 'grouped') {
      const items = await em.find(
        GroupedItem,
        { parentProductId: product.id },
        { orderBy: { position: 'asc', id: 'asc' } },
      );
      const childIds = items.map((i) => i.childProductId);
      const summaries = await this.summariesForIds(em, childIds, ctx, channel);
      detail.groupedItems = items.flatMap((i) => {
        const summary = summaries.get(i.childProductId);
        if (!summary) return [];
        return [{ id: i.id, position: i.position, quantity: i.quantity, product: summary }];
      });
    } else if (product.type === 'bundle') {
      const slots = await em.find(
        BundleSlot,
        { parentProductId: product.id },
        { orderBy: { position: 'asc', id: 'asc' } },
      );
      const slotIds = slots.map((s) => s.id);
      const options =
        slotIds.length > 0
          ? await em.find(
              BundleSlotOption,
              { slotId: { $in: slotIds } },
              { orderBy: { position: 'asc', id: 'asc' } },
            )
          : [];
      const optsBySlot = new Map<string, BundleSlotOption[]>();
      for (const opt of options) {
        const list = optsBySlot.get(opt.slotId) ?? [];
        list.push(opt);
        optsBySlot.set(opt.slotId, list);
      }
      const optionProductIds = [...new Set(options.map((o) => o.optionProductId))];
      const summaries = await this.summariesForIds(em, optionProductIds, ctx, channel);
      detail.bundleSlots = slots.map((s) => ({
        id: s.id,
        name: s.name,
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        position: s.position,
        options: (optsBySlot.get(s.id) ?? []).flatMap((o) => {
          const summary = summaries.get(o.optionProductId);
          if (!summary) return [];
          return [
            {
              id: o.id,
              defaultQuantity: o.defaultQuantity,
              position: o.position,
              product: summary,
            },
          ];
        }),
      }));
    } else if (product.type === 'virtual') {
      detail.virtual = {
        downloadAssetId: product.downloadAssetId ?? null,
        downloadUrl: product.downloadUrl ?? null,
      };
    }

    // Feature 043 — packaging units (only meaningful for the eligible types,
    // which are also the only ones that can have rows).
    if (product.type === 'simple' || product.type === 'configurable') {
      const packagingUnits = await em.find(
        ProductPackagingUnit,
        { productId: product.id },
        { orderBy: { position: 'asc', name: 'asc' } },
      );
      if (packagingUnits.length > 0) {
        detail.packagingUnits = packagingUnits.map((u) => ({
          id: u.id,
          // Feature 163 (FR-079) — the name at the scope language, else the global name.
          name: effectivePackagingUnitName(u, scopeLanguage),
          baseQuantity: u.baseQuantity,
          position: u.position,
          isDefault: u.isDefault,
          // Feature 155 (FR-016) — the unit's own minimum; `null` = none.
          minOrderUnits: u.minOrderUnits ?? null,
        }));
      }
    }

    return detail;
  }

  /**
   * Resolve a batch of products into storefront-shape summaries (id, sku,
   * slug, localized name, primary asset url via gallery thumb chain,
   * price honoring sales-channel public flag). Used by US5 composite
   * eager-load — keeps the per-product fanout to a constant 3-4 queries
   * regardless of how many children/options a parent has.
   */
  private async summariesForIds(
    em: EntityManager,
    ids: string[],
    ctx: CatalogQueryContext,
    channel: CatalogResolvedChannel,
  ): Promise<
    Map<
      string,
      {
        id: string;
        sku: string;
        slug: string;
        name: string;
        primaryAssetUrl: string | null;
        price: { amount: number; currency: string } | null;
      }
    >
  > {
    const result = new Map<string, {
      id: string;
      sku: string;
      slug: string;
      name: string;
      primaryAssetUrl: string | null;
      price: { amount: number; currency: string } | null;
    }>();
    if (ids.length === 0) return result;
    // Feature 163 — a child or option off at (C, L), outside its window or
    // outside the audience is not offered through its parent (edge case
    // *child off*): it is left out of the composite, as an absent one is.
    const candidates = await em.find(Product, { id: { $in: ids } });
    const available = await this.#availableAmong(em, candidates, this.#availabilityScope(ctx), false);
    const products = candidates.filter((p) => available.has(p.id));

    // Primary asset url via gallery thumb chain -> base_image -> first item
    // -> legacy product_assets first row. One helper, shared with `toSummary`
    // and `ProductLinkService`, so the chain and the port call have one home.
    const assetUrlByProduct = await resolvePrimaryAssetUrls(em, this.#requireAssets(), ids, channel.id);

    const resolvedPrices = await this.#listingPricesFor(products, ctx);
    // Issue #384 — one statement for every child's override rows on this channel.
    const overridesByProduct = await loadChannelOverridesByProduct(em, ids, channel.id);
    const overrideCtx = this.#overrideContext(channel, ctx.preferredLanguage);
    // Feature 163 (R28) — a child's link is its effective key at (C, L).
    const effectiveKeys = await this.#effectiveKeysAt(em, products, ctx);
    for (const p of products) {
      const price = this.#summaryPrice(resolvedPrices, p.id);
      result.set(p.id, {
        id: p.id,
        sku: p.sku,
        slug: effectiveKeys.get(p.id) ?? p.slug,
        name: effectiveSystemText(
          overridesByProduct.get(p.id),
          'name',
          overrideCtx,
          p.name,
          this.pickLang(p.name, ctx.preferredLanguage, channel),
        ),
        primaryAssetUrl: assetUrlByProduct.get(p.id) ?? null,
        price,
      });
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Categories
  // ------------------------------------------------------------------

  async getCategoryTree(ctx: CatalogQueryContext): Promise<CategoryNode[]> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    // Feature 068 — an inactive category is invisible to customers, and so is
    // everything under it: its children never reach `build()` because only
    // roots seed the walk.
    const rows = await em.find(
      Category,
      { deletedAt: null, isActive: true },
      { orderBy: { sortOrder: 'asc' } },
    );

    // Directly-assigned products per category that this caller may see.
    const directSets = await this.directProductSetsByCategory(em, channel, this.#availabilityScope(ctx));

    const byParent = new Map<string | null, Category[]>();
    for (const row of rows) {
      const key = row.parentCategoryId ?? null;
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    // Roll up to a *distinct* product count over each category's whole subtree
    // (self + descendants). A parent category — e.g. the catalog root — would
    // otherwise show 0 because products are assigned to its leaf categories,
    // not to it directly. Counting a Set de-duplicates products that sit in
    // more than one branch of the subtree.
    const subtreeCounts = new Map<string, number>();
    const collectSubtree = (categoryId: string): Set<string> => {
      const acc = new Set<string>(directSets.get(categoryId) ?? []);
      for (const child of byParent.get(categoryId) ?? []) {
        for (const pid of collectSubtree(child.id)) acc.add(pid);
      }
      subtreeCounts.set(categoryId, acc.size);
      return acc;
    };
    for (const root of byParent.get(null) ?? []) collectSubtree(root.id);

    const build = (parentId: string | null): CategoryNode[] => {
      const children = byParent.get(parentId) ?? [];
      return children.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
        sortOrder: c.sortOrder,
        productCount: subtreeCounts.get(c.id) ?? 0,
        children: build(c.id),
      }));
    };
    return build(null);
  }

  /**
   * The Page Builder document the storefront renders on one category's page,
   * resolved to a language.
   *
   * **Visibility is the tree's, and it is checked here rather than trusted to
   * the caller.** {@link getCategoryTree} lists a category only when it is
   * live, active, and hangs off a chain of live, active ancestors — an
   * inactive category hides its whole branch. A category that fails any of
   * those answers 404, so its content is not reachable by id while its page
   * is not reachable by link.
   *
   * **The language is resolved like the name** ({@link pickLang}): the
   * caller's, then the channel's default, then English, then whatever exists.
   * A language whose document holds no block is skipped, because an operator
   * who opened the Polish tab and saved it empty did not ask for the English
   * text to disappear from the Polish storefront.
   */
  async getCategoryPageContent(
    categoryId: string,
    ctx: CatalogQueryContext,
  ): Promise<CategoryPageContent> {
    const notFound = (): HttpError =>
      new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
    if (!CATEGORY_ID_RE.test(categoryId)) throw notFound();
    const em = this.emFactory();
    const category = await em.findOne(
      Category,
      { id: categoryId, deletedAt: null, isActive: true },
      { populate: ['content'] },
    );
    if (!category) throw notFound();

    // The ancestor chain, bounded: the write path forbids a cycle, but a
    // corrupt `parent_category_id` must end in a 404 and not in a hung request.
    const seen = new Set<string>([category.id]);
    let parentId = category.parentCategoryId ?? null;
    while (parentId !== null) {
      if (seen.has(parentId) || seen.size > MAX_CATEGORY_DEPTH) throw notFound();
      seen.add(parentId);
      const parent: Category | null = await em.findOne(Category, {
        id: parentId,
        deletedAt: null,
        isActive: true,
      });
      if (!parent) throw notFound();
      parentId = parent.parentCategoryId ?? null;
    }

    const languages = category.content?.languages ?? {};
    const candidates = [
      ctx.preferredLanguage,
      ctx.resolvedChannel.defaultLanguage,
      'en-US',
      'en',
      ...Object.keys(languages),
    ].filter((v): v is string => typeof v === 'string');
    for (const language of candidates) {
      const tree = languages[language];
      if (tree !== undefined && hasPageBuilderBlocks(tree)) {
        return { categoryId: category.id, language, content: tree };
      }
    }
    return { categoryId: category.id, language: null, content: null };
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  async getFilterDefinitions(ctx: CatalogQueryContext): Promise<FilterDefinition[]> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    const attrs = await this.#requireAttributeRead().listByFlag('isFilterable');

    // Build option / range facets by scanning Products available in the
    // channel. Issue #227 — a facet count is a disclosure too. "Brass (3)" on a
    // catalogue holding two brass products the caller may see is the third
    // one, named by arithmetic; feature 163 extends that to a product off at
    // (C, L) or outside its window. Availability is in the statement and then
    // the rule's own word on each row; the `raw()` key is made in the
    // expression that executes it.
    const scope = this.#availabilityScope(ctx);
    const narrowing = this.#availabilityNarrowing(scope);
    const products = await em.find(Product, {
      $and: [{ deletedAt: null }, { [raw(narrowing.sql, narrowing.params)]: [] }],
    });
    const visibleIds = await this.#availableAmong(em, products, scope, true);
    const visible = products.filter((p) => visibleIds.has(p.id));
    // Feature 163 (FR-017 b) — counts over the effective values a card shows at
    // (channel, language): #384's walk over this channel's override rows.
    const effective = this.#overrideContext(channel, ctx.preferredLanguage);
    const scopeOf = new Map(
      attrs.map((a) => [a.key, { channelScoped: a.channelScoped, languageScoped: a.languageScoped }]),
    );
    const overrides = await loadChannelOverridesByProduct(em, visible.map((p) => p.id), channel.id);
    const valuesOf = new Map<string, Record<string, unknown>>();
    for (const p of visible) {
      valuesOf.set(
        p.id,
        await effectiveAttributeValues(p.attributeValues ?? {}, overrides.get(p.id), effective, async () => scopeOf),
      );
    }

    const definitions = attrs.map((a) => {
      const label = this.pickLang(a.label, ctx.preferredLanguage, channel);
      const def: FilterDefinition = {
        attributeKey: a.key,
        label,
        valueType: a.valueType,
        filterPosition: a.filterPosition,
      };
      if (
        a.valueType === 'enum' ||
        a.valueType === 'select' ||
        a.valueType === 'multiselect' ||
        a.valueType === 'boolean' ||
        a.valueType === 'string'
      ) {
        const optionCounts = new Map<string, number>();
        for (const p of visible) {
          const v = valuesOf.get(p.id)?.[a.key];
          if (v === undefined || v === null) continue;
          // multiselect carries an array of selected option values.
          if (Array.isArray(v)) {
            for (const item of v) {
              const key = String(item);
              optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
            }
          } else {
            const key = String(v);
            optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
          }
        }
        def.options = Array.from(optionCounts.entries()).map(([value, count]) => ({
          value,
          label: value,
          count,
        }));
      } else if (a.valueType === 'number' || a.valueType === 'price' || a.valueType === 'date') {
        let min: number | undefined;
        let max: number | undefined;
        for (const p of visible) {
          const raw = valuesOf.get(p.id)?.[a.key];
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) continue;
          if (min === undefined || n < min) min = n;
          if (max === undefined || n > max) max = n;
        }
        if (min !== undefined && max !== undefined) {
          def.range = { min, max };
        }
      }
      return def;
    });

    // Feature 012 / FR-029 — omit filters that have zero values across
    // every visible product. Option-style filters with an empty options
    // array (no facet hits) are skipped; range-style filters with no
    // resolved min/max are also skipped.
    const nonEmpty = definitions.filter((d) => {
      if (d.options !== undefined) return d.options.length > 0;
      if (d.range !== undefined) return true;
      return false;
    });

    // Feature 055 (US4) — merge Category custom fields flagged `config.filterable`.
    // These are category-level filters whose options come from the field
    // definition, not from a product-facet scan, so they are appended AFTER the
    // product-facet `nonEmpty` drop. The catalog interprets the opaque `config`
    // (FR-006); the generic custom-fields core is unaware of catalog.
    const customFilters = await this.buildCustomFieldFilters(ctx, channel);

    const merged = [...nonEmpty, ...customFilters];

    // Feature 012 / FR-027 + FR-028 — pre-sort by filterPosition ASC,
    // then by resolved label ASC. Storefront consumes the order verbatim.
    merged.sort((a, b) => {
      if (a.filterPosition !== b.filterPosition) return a.filterPosition - b.filterPosition;
      return a.label.localeCompare(b.label);
    });

    return merged;
  }

  /**
   * Feature 055 (US4) — resolve the filterable Category custom fields into
   * {@link FilterDefinition}s. Returns `[]` when no definition source is wired.
   * Select/multiselect fields carry their defined options; scalar fields carry
   * neither options nor range (they render as a keyword/value filter client-side).
   */
  private async buildCustomFieldFilters(
    ctx: CatalogQueryContext,
    channel: CatalogQueryContext['resolvedChannel'],
  ): Promise<FilterDefinition[]> {
    if (!this.customFieldDefinitions) return [];
    const defs = await this.customFieldDefinitions.listForEntity('category');
    const out: FilterDefinition[] = [];
    for (const { definition, options } of defs) {
      if (definition.config?.['filterable'] !== true) continue;
      const label =
        this.pickLang(definition.label, ctx.preferredLanguage, channel) || definition.labelDefault;
      const isSelect = definition.valueType === 'select' || definition.valueType === 'multiselect';
      const def: FilterDefinition = {
        // Namespaced so a custom field cannot collide with a product attribute key.
        attributeKey: `cf.${definition.key}`,
        label,
        valueType: definition.valueType === 'text' ? 'string' : definition.valueType,
        filterPosition: definition.sortOrder,
        ...(isSelect
          ? {
              options: options.map((o) => ({
                value: o.value,
                label:
                  this.pickLang(o.label, ctx.preferredLanguage, channel) || o.labelDefault,
                count: 0,
              })),
            }
          : {}),
      };
      out.push(def);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Feature 012 / FR-030 — build the "Parametry produktu" tab payload
   * for one product. Returns every attribute that meets BOTH:
   *   1. attribute.isVisibleOnProductPage === true
   *   2. product.attributeValues[attribute.key] is non-null + non-empty
   *
   * For select / enum / multiselect types `valueRendered` is the
   * resolved per-locale option label (with fallback to labelDefault);
   * for boolean types it's 'Yes' / 'No'; for number / price / string
   * types it's the value coerced to string.
   *
   * Sorted by AttributeSetAttribute.position when the product has an
   * Attribute Set, else by attribute key ASC for determinism.
   */
  private async buildVisibleAttributesProjection(
    em: EntityManager,
    product: Product,
    /** The product's effective attribute values for the request (issue #384). */
    values: Record<string, unknown>,
    preferredLanguage: string | undefined,
    channel: CatalogResolvedChannel,
    /** The page's attribute-view read, shared with the override step (issue #384). */
    listAttributeViews: () => Promise<CatalogAttributeView[]>,
  ): Promise<Array<{ key: string; label: string; valueType: CatalogAttributeView['valueType']; valueRendered: string }>> {
    const valueKeys = Object.keys(values).filter((k) => {
      const v = values[k];
      return v !== undefined && v !== null && v !== '';
    });
    if (valueKeys.length === 0) return [];

    // Feature 061 — attribute metadata + options come from the composed view.
    const valueKeySet = new Set(valueKeys);
    const allViews = await listAttributeViews();
    const attrs = allViews.filter((a) => valueKeySet.has(a.key) && a.isVisibleOnProductPage);
    if (attrs.length === 0) return [];

    const optionLabelByAttrAndValue = new Map<
      string,
      Map<string, { label: Record<string, string>; labelDefault: string }>
    >();
    for (const a of attrs) {
      if (a.options.length === 0) continue;
      const bucket = new Map<string, { label: Record<string, string>; labelDefault: string }>();
      for (const o of a.options) {
        bucket.set(o.value, { label: o.label ?? {}, labelDefault: o.labelDefault });
      }
      optionLabelByAttrAndValue.set(a.id, bucket);
    }

    const renderOptionLabel = (attrId: string, value: string): string => {
      const bucket = optionLabelByAttrAndValue.get(attrId);
      const meta = bucket?.get(value);
      if (!meta) return value;
      return this.pickLang(meta.label, preferredLanguage, channel) || meta.labelDefault;
    };

    // Pull the AttributeSetAttribute positions for sort determinism
    // (membership is definition-keyed since feature 061).
    let positionByKey = new Map<string, number>();
    if (product.attributeSetId) {
      const posRows = (await em.execute<
        Array<{ custom_field_definition_id: string; position: number }>
      >(
        `select custom_field_definition_id, position
         from attribute_set_attributes
         where attribute_set_id = ?`,
        [product.attributeSetId],
      )) as Array<{ custom_field_definition_id: string; position: number }>;
      const keyByDefinitionId = new Map(
        allViews.map((v) => [v.customFieldDefinitionId, v.key]),
      );
      positionByKey = new Map(
        posRows
          .map((r) => [keyByDefinitionId.get(r.custom_field_definition_id), r.position] as const)
          .filter((pair): pair is [string, number] => pair[0] !== undefined),
      );
    }

    const items = attrs.map((a) => {
      const raw = values[a.key];
      let valueRendered = '';
      if (Array.isArray(raw)) {
        // multiselect — comma-separated joined option labels
        valueRendered = raw
          .map((item) => renderOptionLabel(a.id, String(item)))
          .filter((s) => s !== '')
          .join(', ');
      } else if (a.valueType === 'select' || a.valueType === 'enum') {
        valueRendered = renderOptionLabel(a.id, String(raw));
      } else if (a.valueType === 'boolean') {
        valueRendered = raw === true || raw === 'true' ? 'Yes' : 'No';
      } else {
        valueRendered = String(raw);
      }
      const label = this.pickLang(a.label, preferredLanguage, channel) || a.labelDefault;
      return {
        key: a.key,
        label,
        valueType: a.valueType,
        valueRendered,
      };
    });

    items.sort((x, y) => {
      const px = positionByKey.get(x.key) ?? Number.MAX_SAFE_INTEGER;
      const py = positionByKey.get(y.key) ?? Number.MAX_SAFE_INTEGER;
      if (px !== py) return px - py;
      return x.key.localeCompare(y.key);
    });

    return items;
  }

  /**
   * Feature 007 — list of attribute keys flagged `is_comparable=true`,
   * sorted alphabetically. Consumed by the comparisons module's
   * comparison-page projection (`ComparableAttributeProjection`). Public
   * because it crosses a module boundary (Constitution I — comparisons
   * MUST consume catalog through a documented service port, not by
   * importing internals).
   */
  async comparableAttributeKeys(): Promise<string[]> {
    // listByFlag orders by key ASC (legacy parity).
    const attrs = await this.#requireAttributeRead().listByFlag('isComparable');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 012 / US8 — list of attribute keys flagged `is_promo_rule=true`,
   * sorted alphabetically. Consumed by the promotions module's rule-target
   * picker endpoint and by the promotion-rule resolver's skip-on-toggle
   * check (FR-039). Public because it crosses a module boundary
   * (Constitution I — promotions MUST consume catalog through a documented
   * service port, not by importing internals).
   */
  async promoRuleAttributeKeys(): Promise<string[]> {
    // listByFlag orders by key ASC (legacy parity).
    const attrs = await this.#requireAttributeRead().listByFlag('isPromoRule');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 012 / US8 — load one attribute by key with its option list
   * inline. Returns `null` when the attribute does not exist. The option
   * list is empty for non-select-style types. Used by:
   *   - Promotion-rule editor (criterion picker payload)
   *   - PromotionRuleService.matches() to validate option values
   *     against the attribute's authoritative option set.
   */
  async getAttributeWithOptions(key: string): Promise<{
    id: string;
    key: string;
    label: Record<string, string>;
    labelDefault: string;
    valueType: CatalogAttributeView['valueType'];
    isPromoRule: boolean;
    options: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
  } | null> {
    const attr = await this.#requireAttributeRead().getByIdOrKey(key);
    if (!attr) return null;
    const options = [...attr.options]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((o) => ({
        value: o.value,
        label: o.label ?? {},
        labelDefault: o.labelDefault,
      }));
    return {
      id: attr.id,
      key: attr.key,
      label: attr.label ?? {},
      labelDefault: attr.labelDefault,
      valueType: attr.valueType,
      isPromoRule: attr.isPromoRule,
      options,
    };
  }

  /**
   * The keyset a listing pages by — **derived from the ordering it serves**,
   * never assumed. The ordering and the "everything after this row" predicate
   * are one decision, and they had come apart once: the `after` predicate was
   * written over `created_at` whatever the ordering, so under `sort=name` the
   * walk both repeated products and skipped the ones between the repeats.
   *
   * Feature 163 (D6) — the name ordering is the **effective** name a card shows
   * at the request's (channel, language), `effectiveTextSql`, with `id` as the
   * tie-break (the name is not unique). It replaced an ordering by `slug`.
   */
  #keysetFor(sort: ListProductsParams['sort'], ctx: CatalogQueryContext): ListingKeyset {
    if (sort === 'name' || sort === '-name') {
      const direction = sort === 'name' ? 'asc' : 'desc';
      const cmp = direction === 'asc' ? '>' : '<';
      const name = this.#effectiveNameExpr(ctx);
      return {
        byName: true,
        of: (product, nameOf) => ({ name: nameOf(product.id) ?? '', id: product.id }),
        parse: (decoded) =>
          isRecord(decoded) && typeof decoded['name'] === 'string' && isUuidText(decoded['id'])
            ? { name: decoded['name'], id: decoded['id'] }
            : null,
        after: (cursor) => {
          if (!('name' in cursor)) return {};
          return {
            [raw(
              (alias: string) =>
                `(${name.sql(alias)} ${cmp} ? or (${name.sql(alias)} = ? and ${alias}.id ${cmp} ?))`,
              [...name.params, cursor.name, ...name.params, cursor.name, cursor.id],
            )]: [],
          };
        },
        orderBy: () => ({ [raw((alias: string) => name.sql(alias), name.params)]: direction, id: direction }),
      };
    }
    // The default ordering is `createdAt desc, id desc`, in every sort that
    // reaches here.
    return {
      byName: false,
      of: (product) => ({ createdAt: product.createdAt.toISOString(), id: product.id }),
      // The id is compared with a uuid column: a cursor naming anything else is
      // discarded here rather than refused by the database as a 500.
      parse: (decoded) =>
        isRecord(decoded) &&
        typeof decoded['createdAt'] === 'string' &&
        isUuidText(decoded['id']) &&
        !Number.isNaN(new Date(decoded['createdAt']).getTime())
          ? { createdAt: decoded['createdAt'], id: decoded['id'] }
          : null,
      after: (cursor) => afterKeysetCursor(cursor, '$lt'),
      orderBy: () => ({ createdAt: 'desc', id: 'desc' }),
    };
  }

  /**
   * Feature 163 (FR-017 b) — the effective Name a card shows at the request's
   * (channel, language), as SQL: the value the listing searches and sorts on.
   * The same two language chains `toSummary` uses (`#overrideContext` and
   * `pickLang`).
   */
  #effectiveNameExpr(ctx: CatalogQueryContext): SqlExpression {
    const channel = ctx.resolvedChannel;
    return effectiveTextSql(
      'name',
      this.#overrideContext(channel, ctx.preferredLanguage),
      [ctx.preferredLanguage, channel.defaultLanguage, 'en-US', 'en'].filter(
        (v): v is string => typeof v === 'string',
      ),
    );
  }

  /**
   * The names a name cursor carries — **the statement's own sort key**, read by
   * the same `effectiveTextSql` expression the ordering and the `after`
   * predicate use (`#keysetFor`), so the cursor can never disagree with the
   * order it continues (code review W4). It used to be recomputed by the
   * TypeScript walk, which is held equal to the SQL by a parity test but is a
   * second implementation: when the two diverged, a walk repeated and skipped
   * rows. One keyed statement over the page's last row — the read it replaces
   * cost the same — and nothing when the keyset does not need it.
   */
  async #cursorNames(
    em: EntityManager,
    keyset: ListingKeyset,
    products: readonly Product[],
    ctx: CatalogQueryContext,
  ): Promise<(productId: string) => string | undefined> {
    if (!keyset.byName || products.length === 0) return () => undefined;
    const name = this.#effectiveNameExpr(ctx);
    const rows = await em.execute<Array<{ id: string; name: string | null }>>(
      `select p.id::text as id, ${name.sql('p')} as name from products p where p.id = any(?::uuid[])`,
      [...name.params, uuidArrayLiteral(products.map((p) => p.id))],
    );
    const names = new Map(rows.map((row) => [row.id, row.name ?? '']));
    return (productId) => names.get(productId);
  }

  private async filterByChannel(
    productIds: string[],
    channel: CatalogResolvedChannel,
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    // Feature 053 / Principle XII: a channel is ALWAYS resolved, so the catalog
    // constrains to the resolved channel's membership and fails closed to an
    // empty set — never the full cross-channel set. Through the kernel's
    // accessor since issue #185; this was a `select … from
    // sales_channel_products` written here, which is the clause's own
    // counter-example.
    const visible = await this.#requireChannelMembership().filterEntityIdsInChannel(
      channel.id,
      'product',
      productIds,
    );
    return new Set(visible);
  }

  private async productIdsInCategoryTree(
    em: EntityManager,
    categorySlug: string,
  ): Promise<Set<string>> {
    const all = await this.#categoryTreeIds(em, categorySlug);
    if (all.length === 0) return new Set();

    const rows = await em.execute<{ product_id: string }[]>(
      `select product_id from product_categories where category_id in (${all.map(() => '?').join(',')})`,
      all,
    );
    return new Set(rows.map((r) => r.product_id));
  }

  /**
   * The category a slug names and every active descendant of it — empty when
   * the slug names nothing a storefront may browse.
   */
  async #categoryTreeIds(em: EntityManager, categorySlug: string): Promise<string[]> {
    // Feature 068 — an inactive category narrows to nothing, and an inactive
    // branch contributes no products to an active ancestor.
    const root = await em.findOne(Category, {
      slug: categorySlug,
      deletedAt: null,
      isActive: true,
    });
    if (!root) return [];

    // Collect descendant ids (BFS).
    const all: string[] = [root.id];
    let frontier: string[] = [root.id];
    while (frontier.length > 0) {
      const children = await em.find(Category, {
        parentCategoryId: { $in: frontier },
        deletedAt: null,
        isActive: true,
      });
      const nextIds = children.map((c) => c.id);
      all.push(...nextIds);
      frontier = nextIds;
    }
    return all;
  }

  /**
   * Set of channel-visible product ids directly assigned to each category
   * (i.e. via a `product_categories` row). Subtree roll-up to ancestors is
   * done by the caller, which has the parent map to walk.
   */
  private async directProductSetsByCategory(
    em: EntityManager,
    channel: CatalogResolvedChannel,
    scope: PageAvailabilityScope,
  ): Promise<Map<string, Set<string>>> {
    const base = await em.execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories`,
    );
    if (base.length === 0) return new Map();

    // Channel membership.
    const memberIds = await this.filterByChannel(
      base.map((r) => r.product_id),
      channel,
    );
    // Issue #227 / feature 163 — and availability, which needs the columns
    // this path never loaded: `product_categories` carries ids and nothing
    // else, so the rows come back here rather than the predicate going down
    // there. The category tree publishes a `productCount` per node, and a count
    // is the one field a restricted, switched-off or out-of-window product can
    // still move.
    const members = await em.find(Product, { id: { $in: [...memberIds] } });
    const visibleIds = await this.#availableAmong(em, members, scope, true);
    const sets = new Map<string, Set<string>>();
    for (const row of base) {
      if (!visibleIds.has(row.product_id)) continue;
      let set = sets.get(row.category_id);
      if (!set) {
        set = new Set<string>();
        sets.set(row.category_id, set);
      }
      set.add(row.product_id);
    }
    return sets;
  }

  /**
   * One product's listing summary.
   *
   * Every input is the **page's**, resolved by the caller, and all of them are
   * required rather than optional. This method used to resolve its own price,
   * its own primary asset and its own category slugs, which meant every listing
   * path that mapped over a page paid all three once per card — 150 of the ~158
   * statements a 50-item page cost after the price was hoisted (issue #263).
   * Making the parameters mandatory is what stops the next caller from quietly
   * re-opening that.
   *
   * It takes no `EntityManager` and is synchronous for the same reason: with
   * nothing to query through and nothing to await, a per-card read cannot be
   * added back here without the change being the point of the diff.
   */
  private toSummary(
    product: Product,
    channel: CatalogResolvedChannel,
    preferredLanguage: string | undefined,
    resolvedPrices: Map<string, ListingPriceDetail>,
    cardReads: ListingCardReads,
  ): ProductSummary {
    // Price — the pricing engine's answer for this product on this channel
    // (issue #132), read out of the page's resolution — a figure a price book
    // stands behind, or nothing where the viewer's display mode withholds it.
    const price = this.#summaryPrice(resolvedPrices, product.id);

    // Issue #384 — the channel's override when one applies, else the baseline
    // language pick, out of the page's pre-read override rows.
    const nameText = effectiveSystemText(
      cardReads.overridesByProduct.get(product.id),
      'name',
      this.#overrideContext(channel, preferredLanguage),
      product.name,
      this.pickLang(product.name, preferredLanguage, channel),
    );

    // Feature 163 (R-16) — the card's summary, from the description this row
    // already holds, through the same override and language pick as the PDP's.
    const descriptionText = effectiveSystemText(
      cardReads.overridesByProduct.get(product.id),
      'description',
      this.#overrideContext(channel, preferredLanguage),
      product.description,
      this.pickLang(product.description, preferredLanguage, channel),
    );

    return {
      id: product.id,
      sku: product.sku,
      type: product.type,
      name: nameText,
      // Feature 163 (R28) — the effective key at the request's (channel, language).
      slug: cardReads.effectiveKeyByProduct.get(product.id) ?? product.slug,
      summary: productSummaryText(descriptionText),
      categorySlugs: cardReads.categorySlugsByProduct.get(product.id) ?? [],
      primaryAssetUrl: cardReads.assetUrlByProduct.get(product.id) ?? null,
      price,
      stockIndicator: null,
      stockLevel: null,
      // Feature 155 (FR-014) — emitted for the types the minimum applies to only.
      // Feature 163 (FR-100) — the request channel's minimum.
      minOrderQuantity: isOrderMinimumEligibleType(product.type)
        ? (cardReads.minOrderQuantityByProduct.has(product.id)
            ? (cardReads.minOrderQuantityByProduct.get(product.id) ?? null)
            : (product.minOrderQuantity ?? null))
        : null,
      resolvedPrice: this.#summaryResolvedPrice(resolvedPrices, product.id),
      ...this.#summaryPriceBookFields(resolvedPrices, product.id),
    };
  }

  /**
   * Feature 160 (FR-024, FR-025) — the compare-at price of a charged sale and
   * the "from" flag of a product whose variants differ, from the same
   * resolution as `price`. Present only when the price books answered them.
   */
  #summaryPriceBookFields(
    resolved: Map<string, ListingPriceDetail>,
    productId: string,
  ): Pick<ProductSummary, 'compareAtPrice' | 'priceVariesByVariant'> {
    const price = resolved.get(productId)?.price;
    if (!price || price.source !== 'price_list') return {};
    const compareAt = price.compareAtAmount !== undefined ? Number(price.compareAtAmount) : null;
    return {
      ...(compareAt !== null && Number.isFinite(compareAt)
        ? { compareAtPrice: { amount: compareAt, currency: price.currency } }
        : {}),
      ...(price.variesByVariant ? { priceVariesByVariant: true } : {}),
    };
  }

  /**
   * Issue #384 — the language chain an override is walked over: exactly the
   * legs `pickLang` walks over the baseline (request language, channel
   * default, `en-US`, `en`), so a (channel, language) override answers for
   * whichever language the baseline text would have come from and never for
   * a later one.
   */
  #overrideContext(
    channel: CatalogResolvedChannel,
    preferredLanguage: string | undefined,
  ): StorefrontOverrideContext {
    return {
      channelId: channel.id,
      languages: overrideLanguages(preferredLanguage, channel.defaultLanguage),
    };
  }

  private pickLang(
    blob: Record<string, string>,
    preferred?: string,
    channel?: CatalogResolvedChannel,
  ): string {
    const preferredLangs = [preferred, channel?.defaultLanguage, 'en-US', 'en'].filter(
      (v): v is string => typeof v === 'string',
    );
    for (const lang of preferredLangs) {
      const hit = blob[lang];
      if (hit) return hit;
    }
    const anyKey = Object.keys(blob)[0];
    return anyKey ? (blob[anyKey] ?? '') : '';
  }

  private coerceAttributeValues(v: Record<string, unknown>): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out[k] = val;
      } else if (val !== null && val !== undefined) {
        out[k] = String(val);
      }
    }
    return out;
  }
}
