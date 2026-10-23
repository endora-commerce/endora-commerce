import { z } from 'zod';
import type { ProductResolvedPrice } from './catalog.js';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';
import { priceSourceSchema, type PriceSource } from './price-books.js';

/**
 * Pricing contracts — what every consumer of a price reads.
 *
 * Feature 160 (D-287 P1) replaced the feature-011 engine with price books:
 * the book, its rows, its sets and the explanation are in `price-books.ts`;
 * this file keeps what a *price* looks like to its readers — the listing and
 * line answers, the ports that produce them, the display-mode chain, the price
 * ordering, and the price-list read port. The Application-rule tree and its
 * evaluator, the bracket and roster shapes, the matrix-entry v1 shapes and the
 * `priceListAdminPort` were removed with the old model (`priceBookWritePort`, in
 * `price-books.ts`, replaces the last).
 */

const CURRENCY = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
const POSITIVE_INT = z.number().int().positive();
const DECIMAL_STRING = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'decimal as string with up to 4 fractional digits');

// --- Display modes ----------------------------------------------------------

export const displayModeSchema = z.enum([
  'gross_only',
  'net_only',
  'both',
  'none',
]);
export type DisplayMode = z.infer<typeof displayModeSchema>;

/**
 * Feature 160 (FR-029, owner ruling 2026-10-23) — why a price book pinned to a
 * product feed publishes no prices now. A feed is fetched by a provider, which
 * is nobody's buyer, so a pinned book publishes only while it would price an
 * anonymous buyer on the feed's channel: `active` or `scheduled` and inside its
 * schedule window (`outside_schedule`, else `not_active`), bound to that
 * channel with the channel offering its currency (`not_on_channel`; a base book
 * is channel-independent), and for everyone (`audience_restricted`). A book in
 * another currency than the feed's (`currency_mismatch`) or one that does not
 * exist (`not_found`) prices nothing either.
 */
export const pinnedPriceBookUnpublishableReasonSchema = z.enum([
  'not_found',
  'currency_mismatch',
  'not_active',
  'outside_schedule',
  'not_on_channel',
  'audience_restricted',
]);
export type PinnedPriceBookUnpublishableReason = z.infer<typeof pinnedPriceBookUnpublishableReasonSchema>;

/** Whether a pinned price book publishes prices now, and why not. */
export type PinnedPriceBookPublishability =
  | { publishable: true }
  | { publishable: false; reason: PinnedPriceBookUnpublishableReason };

/**
 * `productResolvedPriceSchema` (in `catalog.ts`, which this file imports and so
 * cannot import back) spells the display modes out; this keeps the two lists
 * identical at compile time.
 */
const displayModesAgree: [ProductResolvedPrice['displayMode']] extends [DisplayMode]
  ? [DisplayMode] extends [ProductResolvedPrice['displayMode']]
    ? true
    : never
  : never = true;
void displayModesAgree;

export const displayModeOverrideScopeSchema = z.enum([
  'organization',
  'category',
  'product',
]);
export type DisplayModeOverrideScope = z.infer<typeof displayModeOverrideScopeSchema>;

export const displayModeOverrideSchema = z.object({
  scope: displayModeOverrideScopeSchema,
  targetId: uuidSchema,
  mode: displayModeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DisplayModeOverride = z.infer<typeof displayModeOverrideSchema>;

export const upsertDisplayModeOverrideRequestSchema = z.object({
  mode: displayModeSchema.or(z.literal('inherit')),
});

// --- Resolved price (storefront/cart consumer) ------------------------------

export const resolvedPriceEngineSchema = z.object({
  baseListId: uuidSchema,
  basePrice: moneySchema,
  saleListId: uuidSchema.nullable(),
  salePrice: moneySchema.nullable(),
  displayMode: displayModeSchema,
  currencyCode: CURRENCY,
  quantityBracket: z.object({
    minQuantity: POSITIVE_INT,
    maxQuantity: POSITIVE_INT.nullable(),
  }),
  /** Feature 160 — which tier priced the charged line; `null` when nothing did. */
  source: priceSourceSchema.nullable().optional(),
  /** Feature 160 — the buyer price a charged sale undercut. */
  compareAt: z.string().nullable().optional(),
  /** Feature 160 (G9) — the catalogue price beside a lower buyer price, when shown. */
  listPrice: z.object({ amount: z.string(), currency: CURRENCY }).optional(),
});
export type ResolvedPriceEngine = z.infer<typeof resolvedPriceEngineSchema>;

// --- Listing price (catalogue listing / search / compare / links) -----------

/**
 * What a catalogue listing may show as a product's price — issue #132.
 *
 * Two arms:
 *
 *   `price_list` — a price book priced this product for this buyer (the base
 *                  book, an everyone book of the channel, a buyer book or a
 *                  sale; `priceSource` names the tier);
 *   `none`       — nothing prices it, and the listing renders no price.
 *
 * Feature 160 removed the third arm, `product` — the price assigned directly
 * to the Product (the legacy `defaultPrice` attribute): a product has no price
 * of its own any more (FR-042).
 *
 * The `none` arm carries **no `amount` field**, following the `ResolvedTax`
 * precedent (issue #124): a listing showing nothing and a listing offering a
 * free product are different pages, so a caller has to narrow on `source`
 * before it can read a figure. A product priced at zero comes back as
 * `{ source: 'price_list', amount: '0.00' }` and renders as zero — `amount` is
 * never a falsy sentinel for absence.
 *
 * As with `ResolvedTax`, "the `price_lists` module is absent" is deliberately
 * not an arm: absence is not a value, and the port gate throws
 * `MODULE_DISABLED` before a resolution runs.
 */
export const listingPriceSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('price_list'),
    amount: DECIMAL_STRING,
    currency: CURRENCY,
    priceListId: uuidSchema,
    isSale: z.boolean(),
    /**
     * Feature 160 (D-287 P1) — which tier of the price-book resolution priced
     * the card. Named `priceSource` because `source` is this union's
     * discriminant.
     */
    priceSource: priceSourceSchema.optional(),
    /** Feature 160 — the buyer price, struck through, when a sale is charged (FR-025). */
    compareAtAmount: DECIMAL_STRING.optional(),
    /** Feature 160 — the variants of the product resolve to different prices (FR-024). */
    variesByVariant: z.boolean().optional(),
    /** Feature 160 — the highest variant price; `amount` is the lowest ("from"). */
    maxAmount: DECIMAL_STRING.optional(),
  }),
  z.object({ source: z.literal('none') }),
]);
export type ListingPrice = z.infer<typeof listingPriceSchema>;

/**
 * The money a listing renders for one resolved chain answer, or `null` when the
 * chain ended in `none`.
 *
 * The narrowing is the point: `null` here means "there is no price", which the
 * `ProductSummary.price` wire field already spells `null`. A resolved `0` comes
 * back as `{ amount: 0 }` and survives every caller, because nothing on this
 * path tests an amount for truthiness.
 */
export function listingPriceMoney(
  price: ListingPrice,
): { amount: number; currency: string } | null {
  if (price.source === 'none') return null;
  const amount = Number(price.amount);
  return Number.isFinite(amount) ? { amount, currency: price.currency } : null;
}

/** The little of a Product a listing resolution reads. */
export interface ListingPriceProduct {
  id: string;
  attributeValues: Record<string, unknown>;
}

/**
 * Container name: `pricingService`. Owner: `price_lists`.
 *
 * The slice of the `pricingService` port a catalogue listing path resolves.
 *
 * Declared here rather than in each consumer so the catalogue, search,
 * comparisons and product links ask for the same thing in the same words, and
 * declared as a *shape* rather than imported from `price_lists` so none of them
 * reaches into the owning module (Principle I). The owner's
 * `PricingServiceContract` is a superset and satisfies it structurally.
 *
 * **`organization` is the viewer, and it is optional because the viewer may
 * have none.** Every caller supplies it *conditionally* — the asking buyer's
 * own organisation for a signed-in reader, nothing at all for an anonymous one
 * — so the field is absent in the case it describes rather than absent because
 * a caller forgot it, which is the distinction an always-supplied optional
 * parameter fails.
 *
 * The catalogue listing, the product detail, the search results and the
 * product-link strip omitted it until the owner ruled otherwise: an anonymous
 * visitor sees the channel price, a signed-in buyer sees their organisation's.
 * The ruling waited on MR !793, which batched this resolution — a 50-item page
 * went from 502 statements to 158 — because the argument against
 * personalisation had been the pricing cache, whose hit rate per-organisation
 * pricing largely destroys (99.0% anonymous, 5.3% at 50 organisations,
 * measured). Once the page no longer needs that cache to absorb a per-card
 * loop, the cost of missing it is four statements.
 *
 * **What that costs the *page* cache is the caller's problem, not this port's,
 * and it is not nothing.** A priced response that names an organisation is
 * private: it must not enter a shared cache, and
 * `markPersonalisedPricing` in `backend/src/http/product-audience.ts` is where
 * the storefront routes say so. The anonymous answer is unchanged, uncached-by-
 * this-change and still the one a crawler indexes (Principle VII).
 *
 * Widening this slice rather than publishing a second one is deliberate: the
 * engine's own `ListingPricesInput` has carried an organisation all along, and
 * the whole point of issue #132 was that the listing chain has **one**
 * implementation — a second port over the same container method is the second
 * chain arriving by another door.
 *
 * **Owner off:** the seam fails closed — resolving the port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`. A listing
 * that invented a figure would be worse than one that refuses, which is the
 * same reasoning {@link LinePricePort} states for a cart line.
 */
export interface ListingPricePort {
  resolveListingPrices(input: ListingPriceInput): Promise<Map<string, ListingPrice>>;
}

/** The input both listing slices take. */
export interface ListingPriceInput {
  products: readonly ListingPriceProduct[];
  context: {
    salesChannel: { id: string; defaultCurrency: string };
    currencyCode?: string;
    /** The buying organisation, when the viewer has one. */
    organization?: PriceOrganization | null;
    /**
     * D-287 P0 — the signed-in customer account, when the viewer is one. The
     * engine resolves the account's own customer group, which overrides the
     * organisation's (feature 040 R6) — see {@link PricingBuyerContext}.
     */
    customerAccountId?: string | null;
  };
}

/**
 * What a storefront surface renders for one product, from **one** resolution:
 * the listing chain's answer (`price`, what `ProductSummary.price` is built
 * from) and the base / sale / display-mode split a product page, a home-page
 * card and a typeahead suggestion show (D-287 P0).
 */
export interface ListingPriceDetail extends ProductResolvedPrice {
  price: ListingPrice;
  /**
   * Feature 160 (G9 of `specs/161-price-book-editor/`) — the catalogue price
   * beside a lower buyer price: present only while `pricing.show_list_price`
   * is on and the channel's everyone price is above the price charged.
   */
  listPrice?: { amount: string; currency: string };
  /**
   * Feature 160 (D-287 P1) — the amount of each tier of the price-book
   * resolution that produced `price`, where the tier priced anything. Absent on
   * an answer of the pre-160 engine.
   */
  tiers?: {
    base: { amount: string; currency: string } | null;
    catalogue: { amount: string; currency: string } | null;
    buyer: { amount: string; currency: string } | null;
    sale: { amount: string; currency: string } | null;
  };
}

/**
 * Container name: `pricingService`. Owner: `price_lists`.
 *
 * `ListingPricePort`'s sibling for a surface that renders the base / sale /
 * display-mode split as well as the price — the product detail, the catalogue
 * cards behind the home page, the typeahead. One call answers both, so such a
 * surface resolves its products once rather than once for `price` and again
 * through `resolveEngine` per product (D-287 P0,
 * `specs/pricing/read-paths-and-performance.md` §2.1, §2.3).
 *
 * A separate slice rather than a widened `ListingPricePort`, for the reason
 * `OrgLinePricePort` states: every consumer types a structural stub of the
 * port it names, and a caller that needs both asks for both by name.
 *
 * **Owner off:** fails closed, like `ListingPricePort`.
 */
export interface ListingPriceDetailPort {
  resolveListingPriceDetails(input: ListingPriceInput): Promise<Map<string, ListingPriceDetail>>;
}

/**
 * The buying organisation, as a price resolution reads it: the id, which is a
 * rule dimension and part of the cache key, and the group it belongs to, which
 * a customer's own group overrides. The same two fields the engine's own
 * `PricingOrganizationRef` names.
 *
 * Both slices take it. A cart line always has a buyer; a listing has one only
 * where the surface knows who is reading — today, the comparison — and the
 * *same* two fields have to travel either way, or a buyer's comparison column
 * and their cart line would resolve against different price lists and disagree
 * on the same product.
 */
export interface PriceOrganization {
  id: string;
  customerGroupId?: string | null;
}

/**
 * Container name: `pricingService`. Owner: `price_lists`.
 *
 * The slice a **listing ordering** asks for (feature 086): the catalogue in
 * resolved-unit-price order, for one viewer, one chunk at a time.
 *
 * A slice of the same container `ListingPricePort` and `LinePricePort` are
 * slices of, rather than a second registration, and that is the design decision
 * here. `catalog` already resolves `pricingService` and already acknowledges the
 * edge; a second port over the same relation would be the second implementation
 * of the resolution chain arriving by another door — the failure
 * `listingPriceFrom` was extracted to end (issue #132, four listing paths
 * rendering a figure no price list supported).
 *
 * ## What the ordering is
 *
 * For each product in scope the row is the resolution the card renders at
 * quantity 1: the sale partition when it wins, else the base partition, from the
 * highest-priority applicable price list that has a quantity-1 bracket in the
 * response currency. "Applicable" and "highest-priority" mean exactly what
 * `resolveListingPrices` means by them, including the FR-031 fall-through to the
 * next candidate when a list has no usable bracket. That is a **contract
 * obligation, not an implementation note**: the provider's own test asserts,
 * product by product, that this port lists exactly what resolving every product
 * with `resolveListingPrices` and sorting the amounts lists.
 *
 * The order is **total**: `(amount, productId)` ascending for `'asc'`, both
 * descending for `'desc'`, so a keyset walk can neither repeat nor skip.
 *
 * ## What is not in the relation
 *
 * A product no candidate list prices has **no row** here. It is not returned
 * with a null amount and it is not returned last. The caller learns the priced
 * stream is over from `exhausted` and composes the unpriced tail itself, from
 * data it owns — "there is no price for this viewer" is `catalog`'s question to
 * answer about `catalog`'s products, and a placeholder row would be this
 * provider making a listing decision it cannot see the consequences of.
 *
 * ## What this port does **not** do
 *
 * It does not filter by sales channel, product visibility, organisation
 * allow-list, product status, archival, soft-deletion, category or attribute
 * value. Those are `catalog`'s facts about `catalog`'s rows, in `catalog`'s
 * tables, and `price_lists` may not name them — `check:module-boundary` reads a
 * table identifier out of a SQL statement and out of a knex builder, not only
 * out of an import specifier (D-87), so "it is only raw SQL" is not an escape.
 *
 * **The consequence, stated so it cannot be forgotten:** a chunk from this port
 * may name products the viewer must never see. The caller MUST intersect every
 * chunk with its own visibility and channel predicates **before** any row
 * reaches a page, a cursor, a count or a log line.
 *
 * **Owner off:** the seam fails closed, exactly as {@link ListingPricePort}'s
 * does — the port gate throws and the call answers 503 `MODULE_DISABLED`. A
 * listing that invented an ordering would be worse than one that refuses, and a
 * consumer must not wrap a call to it in a bare `catch`
 * (`check:port-catches`): swallowing `ModuleDisabledError` would turn a
 * fail-closed seam into a sort control that silently does nothing.
 */
export interface ListingPriceOrderPort {
  orderByUnitPrice(input: ListingPriceOrderQuery): Promise<ListingPriceOrderChunk>;

  /**
   * Which of `productIds` the viewer's candidate lists price at quantity 1.
   *
   * It exists for one purpose: so the caller can compose the unpriced tail
   * without asking "is this priced?" one product at a time. It is a set
   * membership answer, not a price.
   */
  pricedProductIds(input: {
    context: ListingPriceViewerContext;
    productIds: readonly string[];
  }): Promise<ReadonlySet<string>>;

  /**
   * The display mode a page resolves to for this viewer with **no product in
   * hand** — the Organization → Settings tail of the FR-039 chain, with the
   * per-product and per-category steps deliberately absent.
   *
   * Feature 086 / FR-016 needs it: a price ordering or a price range is refused
   * where the page may not show prices at all, and `none` is the supported
   * "hide prices until login" configuration. The condition is page-level on
   * purpose — a single product overridden to `none` keeps its position rather
   * than withdrawing the control, or the control would appear and disappear as
   * a buyer walks the catalogue.
   *
   * It is on this port rather than on a fourth one because it answers a
   * question about the same viewer, on the same container, behind the same
   * gate: a caller that may not order by price may not be told the ordering is
   * unavailable by a port that is itself unreachable.
   */
  pageDisplayMode(input: { context: ListingPriceViewerContext }): Promise<DisplayMode>;
}

/** Who the ordering is resolved for — the rule dimensions, and nothing else. */
export interface ListingPriceViewerContext {
  salesChannel: { id: string; defaultCurrency: string };
  currencyCode?: string;
  /** The buying organisation, when the viewer has one. `null` is the anonymous case. */
  organization?: PriceOrganization | null;
  /** Feature 040 — a customer's direct group overrides the organisation's. */
  customerGroupId?: string | null;
  /** D-287 P0 — the customer account whose own group to resolve; see {@link PricingBuyerContext}. */
  customerAccountId?: string | null;
}

/**
 * D-287 P0 — **the** customer-group rule, for every pricing path:
 *
 *     effective group = customer.customerGroupId ?? organization.customerGroupId ?? null
 *
 * A caller says who the buyer is — the organisation, and the customer account
 * when the buyer is a signed-in customer — and the engine applies the rule.
 * Listings, the product page and the cart used to pass the organisation alone,
 * so a customer whose own group overrides the organisation's (feature 040 R6)
 * was priced on the organisation's group there while quotes and the admin order
 * preview, which resolved the account themselves, honoured it: the same buyer,
 * different winning lists (`specs/pricing/read-paths-and-performance.md` §2.2).
 *
 * `customerGroupId`, when set, is a group the caller already resolved for the
 * customer and wins. The account is read only when it belongs to the
 * organisation named beside it; otherwise its group is ignored, never another
 * tenant's terms.
 */
export interface PricingBuyerContext {
  organization?: PriceOrganization | null;
  customerGroupId?: string | null;
  customerAccountId?: string | null;
}

/**
 * `?currency=` on a storefront catalogue read (issue #249): the currency the
 * shopper selected, as an ISO 4217 code in any case, answered in upper case.
 *
 * A malformed value is the caller's bug and is refused. A well-formed one the
 * sales channel does not offer is not — see {@link resolveListingCurrency}.
 */
export const listingCurrencyQuerySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'must be a three-letter ISO 4217 currency code')
  .transform((code) => code.toUpperCase());

/**
 * The currency a catalogue read is priced in: the requested one when the sales
 * channel offers it, otherwise the channel's default.
 *
 * Falling back rather than refusing is deliberate. The request comes from a
 * shopper's stored preference, which outlives a channel dropping a currency;
 * refusing would turn a stale cookie into a catalogue that will not render,
 * while the default is a price the channel genuinely quotes — and every price
 * on the wire names its currency, so the fallback is visible rather than a
 * silent relabelling.
 */
export function resolveListingCurrency(
  requested: string | undefined,
  channel: { defaultCurrency: string; currencies: readonly string[] },
): string {
  const fallback = channel.defaultCurrency.toUpperCase();
  if (requested === undefined) return fallback;
  const code = requested.toUpperCase();
  return channel.currencies.some((offered) => offered.toUpperCase() === code) ? code : fallback;
}

/**
 * The channel half of a {@link ListingPriceViewerContext}, for a read priced in
 * `currency` — the one place `catalog` and `search` turn the resolved currency
 * into the ports' `currencyCode`.
 *
 * The channel's default stays implicit: a read in the default currency asks the
 * port exactly what it asked before `currencyCode` was ever passed, and lands
 * on the same pricing-cache entries.
 */
export function listingPriceChannelContext(
  channel: { id: string; defaultCurrency: string },
  currency: string | undefined,
): Pick<ListingPriceViewerContext, 'salesChannel' | 'currencyCode'> {
  const salesChannel = { id: channel.id, defaultCurrency: channel.defaultCurrency };
  if (currency === undefined) return { salesChannel };
  const code = currency.toUpperCase();
  return code === channel.defaultCurrency.toUpperCase()
    ? { salesChannel }
    : { salesChannel, currencyCode: code };
}

export interface ListingPriceOrderQuery {
  context: ListingPriceViewerContext;
  direction: 'asc' | 'desc';
  /** Keyset resume point; `null` starts at the extreme of `direction`. */
  after: ListingPriceOrderCursor | null;
  /** How many rows the caller wants back. The provider MAY return fewer. */
  limit: number;
  /**
   * Opaque product ids the ordering is restricted to. `undefined` means the
   * whole catalogue; an empty array means nothing and answers an empty,
   * exhausted chunk.
   *
   * The provider does not interpret the ids, does not know why they were chosen
   * and does not check that they exist. It exists so a caller that has already
   * narrowed the catalogue — by category tree, or by a relevance-matched set —
   * can have the ordering run over that narrowing instead of over everything.
   *
   * **It is not a visibility mechanism.** A caller that omits it gets the whole
   * priced catalogue ordered, including products the viewer may not see.
   */
  restrictToProductIds?: readonly string[] | undefined;
  /** Inclusive bounds on the resolved amount, as decimal strings. */
  amountRange?: { min?: string; max?: string } | undefined;
}

export interface ListingPriceOrderCursor {
  amount: string;
  productId: string;
}

export interface ListingPriceOrderRow {
  productId: string;
  /** Decimal string, verbatim from `numeric(14,4)`. Never a number on this path. */
  amount: string;
  currency: string;
  priceListId: string;
  isSale: boolean;
}

export interface ListingPriceOrderChunk {
  rows: ListingPriceOrderRow[];
  /**
   * `true` when the provider reached the end of the priced relation for this
   * query. The caller uses it to move to the unpriced tail; it is NOT inferable
   * from a short `rows`, because the provider may stop early on its own scan
   * bound.
   */
  exhausted: boolean;
  /**
   * How many source rows the provider read to produce `rows`. The caller
   * subtracts it from its own page budget, so FR-019's bound is enforced across
   * chunks rather than per chunk.
   */
  sourceRowsRead: number;
  /**
   * Feature 160 (`specs/160-pricing-model-v2/contracts/price-surface.md` §3) —
   * `true` when no price order exists yet for the viewer's channel and currency
   * (no surface built) and none is built for the request: the caller serves its
   * default order, cards priced live, until the worker has built one.
   */
  unordered?: boolean;
}

/** What a resolved line price is, once the whole chain has run. */
export interface LinePriceResult {
  /** Decimal string — it lands verbatim on the cart line and then the order. */
  amount: string;
  currency: string;
  priceListId: string;
  isSale: boolean;
  bracketStartQuantity: number;
  displayMode: DisplayMode;
  /**
   * Feature 160 (D-287 P1) — which tier priced the line (FR-030). Absent on an
   * answer of the pre-160 engine; `isSale` is `source === 'sale'` when set.
   */
  source?: PriceSource;
  /** Feature 160 — the buyer price a charged sale undercut (FR-015), else absent. */
  compareAt?: string | null;
}

/**
 * Container name: `pricingService`. Owner: `price_lists`.
 *
 * The slice of the `pricingService` port a **line** resolution asks for —
 * `ListingPricePort`'s sibling, and declared here for the same reasons: one
 * wording for every caller, and a *shape* rather than an import of
 * `price_lists/services/pricing-service.interface.ts`, so a consumer does not
 * reach into the owning module (Principle I). The owner's
 * `PricingServiceContract` is a superset and satisfies it structurally.
 *
 * The difference from the listing slice is the *quantity* and the *buyer*: a
 * cart line is priced at its own quantity, against the buying organisation's
 * resolved list, so both are in the context and neither is optional in the way
 * an anonymous catalogue card's are.
 *
 * `null` is the resolver's own documented answer for "nothing applies", and it
 * is not the same thing as an absent `price_lists`. With the module off the
 * gate throws `ModuleDisabledError` — issue #124: a cart must refuse rather
 * than invent a figure, and the absent arm of {@link ListingPrice} carries no
 * `amount` for exactly the same reason.
 */
export interface LinePricePort {
  resolveLinePrice(input: {
    product: ListingPriceProduct;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: PriceOrganization | null;
      /** Feature 040 — a customer's direct group overrides the org's. */
      customerGroupId?: string | null;
      /** D-287 P0 — see {@link PricingBuyerContext}. */
      customerAccountId?: string | null;
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<LinePriceResult | null>;
}

/** One line of a batched line resolution: a caller-chosen key, a product, a quantity. */
export interface LinePriceRequest {
  /** Echoed back as the answer's map key; unique per call. */
  key: string;
  product: ListingPriceProduct;
  variantId?: string | null;
  quantity: number;
}

/**
 * Container name: `pricingService`. Owner: `price_lists`.
 *
 * `LinePricePort` for many lines at once — a cart read, a placement drift
 * check, a quote's reference prices, an external bulk price request. One call
 * prices every line at its own quantity for one buyer, in a number of
 * statements that does not grow with the lines, and answers exactly what
 * calling `resolveLinePrice` once per line answers (D-287 P0; the identity is
 * `backend/test/integration/price_lists/line-prices-batch.test.ts`).
 *
 * Every requested key gets an entry; `null` is "nothing applies", as for the
 * single call. The same product may appear on several lines, at the same or
 * different quantities.
 *
 * A separate slice so a stub of `LinePricePort` keeps compiling.
 * **Owner off:** fails closed, like `LinePricePort`.
 */
export interface LinePricesPort {
  resolveLinePrices(input: {
    lines: readonly LinePriceRequest[];
    context: PricingBuyerContext & {
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<Map<string, LinePriceResult | null>>;
}

/**
 * Container name: `productDisplayModePort`. Owner: `price_lists`.
 *
 * Whether — and how — a product's price is shown to one viewer, resolved
 * **without** a price: the Product → Category → Organization → Settings chain
 * the storefront's `GET /pricing/display-mode/:productId` answers with. `none`
 * means the product is sold on request only.
 *
 * Published for `carts` (issue #236). A cart line read the display mode off the
 * resolved list price, so a product no price list holds — priced from the
 * catalogue attribute — resolved nothing, and a product sold on request only
 * was added. `LinePricePort.resolveLinePrice` answers `null` there by design,
 * and widening that answer would break every structural stub of it; a caller
 * that needs the mode on its own asks for it by name.
 *
 * **Owner off:** the seam fails closed, like `LinePricePort`'s — resolving the
 * port throws `ModuleDisabledError`. A cart that cannot ask must not assume the
 * product is purchasable.
 */
export interface ProductDisplayModePort {
  resolveDisplayMode(input: {
    productId: string;
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
  }): Promise<DisplayMode>;
}

/**
 * Container name: `pricingService`. Owner: `price_lists`.
 *
 * `LinePricePort` plus the bracket ladder — the surface `catalog`'s external
 * namespace prices a bound organisation's request with. Same container name,
 * same owner, one method more, and the same fail-closed answer when the owner
 * is off.
 *
 * **An extension rather than two more methods on `LinePricePort`**, and that is
 * the whole design decision here. Every consumer of a published port types a
 * structural stub against it in tests; widening `LinePricePort` broke one in
 * `carts` that has no interest in brackets, and would break the next one too.
 * A caller that needs both asks for both by name.
 *
 * It had to be published somewhere for feature 075's `catalog` cut, because
 * `listBracketMinQuantities` (`listTierStarts` since feature 160) was declared **only** on
 * `price_lists/services/pricing-service.interface.ts` — and that file is
 * deliberately not in this package, because it is the target of the
 * feature-057 overlay decoration and moving it would move the contract gate.
 * The alternative was `catalog` declaring the shape on its own side, where
 * `lazyPort<T>`'s unchecked cast would leave nothing verifying that
 * `price_lists` still satisfies it (D-77's rejected alternative, same
 * reasoning). `PricingServiceContract` is a superset and satisfies this
 * structurally, so no implementation changed.
 *
 * D-287 P0 left it as it was — a stub of it still compiles — and the external
 * namespace, which now prices in batches, names `OrgLinePricePort & LinePricesPort`.
 */
export interface OrgLinePricePort extends LinePricePort {
  /**
   * Feature 062 — the distinct bracket start quantities (ascending) across
   * every ACTIVE price list for a (product, currency). The caller probes
   * `resolveLinePrice` at each one to build the buying organisation's effective
   * tier ladder without re-implementing resolution.
   */
  listTierStarts(productId: string, currencyCode: string, variantId?: string | null): Promise<number[]>;
}

/** One line of a {@link BuyerLinePriceQuery}. */
export interface BuyerLinePriceLine {
  /** Caller's correlation key, echoed back. */
  key: string;
  productId: string;
  variantId?: string | null;
  /**
   * In base pieces, the unit every quote line's quantity is in. The caller
   * never multiplies by a packaging unit's base quantity.
   */
  quantity: number;
}

/** "What does this buyer pay for these lines on this channel, now?" */
export interface BuyerLinePriceQuery {
  buyer: { customerAccountId: string | null; organizationId: string | null };
  /** `null` = the system-default channel (requests raised before channel attribution). */
  salesChannelId: string | null;
  /** Absent = the channel's default currency. */
  currencyCode?: string;
  lines: readonly BuyerLinePriceLine[];
}

/** The answer for one line, keyed by the caller's `key`. */
export interface BuyerLinePriceAnswer {
  key: string;
  /** `null` = nothing applies ("no price"), the resolver's own documented answer. */
  price: { amount: string; currency: string; isSale: boolean; priceListId: string } | null;
}

/**
 * Container name: `buyerLinePricePort`. Owner: `price_lists`.
 *
 * The net unit price a buyer would pay for each line on a normal order, on a
 * given channel, now — the question the admin resolved-price probe answers for
 * one product, asked for many. One implementation serves both, so a quote's
 * "price at request" and its "current price" are the same question at two
 * moments (feature 146). Customer group precedence: the account's
 * `customerGroupId`, else the organization's.
 *
 * A product that does not exist answers `price: null` for its line rather than
 * throwing; an unknown `salesChannelId` throws `HttpError(400, VALIDATION_FAILED)`.
 * The implementation resolves in bounded chunks, and callers send lines in
 * chunks.
 *
 * **No authority check**: the caller passes the owner of a quote request it
 * has already authorised. The HTTP probe, which serves arbitrary admin input,
 * carries the sales-representative scope check itself. When both
 * `buyer.customerAccountId` and `buyer.organizationId` are given, the account
 * must belong to that organization, else `HttpError(400, VALIDATION_FAILED)`.
 *
 * A separate port rather than a widening of {@link LinePricePort}, for the
 * reason {@link OrgLinePricePort} states: widening would break every
 * structural stub of the old one.
 *
 * **Owner off:** `price_lists` is `nonDeactivatable`; the gate is still the
 * registration, so a change to that throws `ModuleDisabledError` at the call
 * site.
 */
export interface BuyerLinePricePort {
  resolveForBuyer(query: BuyerLinePriceQuery): Promise<BuyerLinePriceAnswer[]>;
}

// --- Settings keys (also exposed via the settings manifest) -----------------

export const PRICING_SETTING_CODES = {
  DEFAULT_DISPLAY_MODE: 'pricing.default_display_mode',
  UNAUTHENTICATED_DISPLAY_MODE: 'pricing.unauthenticated_display_mode',
} as const;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `price_lists` publishes to the eight modules that read
// it (feature 075, Phase P).
//
// `PricingServiceContract` is **not** here, and that is deliberate: it lives in
// `price_lists/services/pricing-service.interface.ts` because it is the target
// of the feature-057 overlay decoration, which is written against that file and
// whose assignability to it is the contract gate. Moving it would move the gate.
// ---------------------------------------------------------------------------

/**
 * A price book as a module outside `price_lists` sees it (feature 160: every
 * price list is a price book; the base books are the `isSystem` ones).
 */
export interface PriceListRecord {
  id: string;
  name: string;
  currencyCode: string;
  priority: number;
  type: 'regular' | 'sale';
  status: 'draft' | 'active' | 'scheduled' | 'expired';
  audienceKind: 'everyone' | 'customer_groups' | 'organizations';
  startsAt: Date | null;
  endsAt: Date | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `priceListReadPort`. Owner: `price_lists`.
 *
 * `organizations` reads the books that apply to an org, `product_feeds` reads
 * the book a feed prices from. Both read the row; neither should own the
 * question of what "applies" means, which is why `listForOrganization` is here
 * rather than a status filter in each caller.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `price_lists` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface PriceListReadPort {
  findById(id: string): Promise<PriceListRecord | null>;
  findByIds(ids: readonly string[]): Promise<PriceListRecord[]>;
  /** Every book, ordered by priority desc then name. */
  listAll(): Promise<PriceListRecord[]>;
  /** Only `status === 'active'`, ordered by priority desc then name. */
  listActive(): Promise<PriceListRecord[]>;
  /**
   * Feature 160 (FR-032) — the price books that apply to an organization now:
   * those whose audience set holds the organization (`organization`, depth 0)
   * or an ancestor of it (`ancestor`, its depth in the chain), and those whose
   * audience set holds its customer group (`customer_group`). The caller
   * passes the chain (nearest first) and the group, which are the
   * organization's own facts. Ordered by priority desc, then name.
   */
  listForOrganization(input: {
    organizationChain: readonly string[];
    customerGroupId: string | null;
  }): Promise<OrganizationPriceBookRecord[]>;
}

/** One book of {@link PriceListReadPort.listForOrganization}. */
export interface OrganizationPriceBookRecord {
  id: string;
  name: string;
  type: 'regular' | 'sale';
  currencyCode: string;
  priority: number;
  status: 'scheduled' | 'active';
  reason: 'organization' | 'ancestor' | 'customer_group';
  /** Chain depth of the nearest member; `null` for a customer-group book. */
  depth: number | null;
}
