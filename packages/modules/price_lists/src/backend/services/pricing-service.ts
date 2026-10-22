import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeReadPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  DisplayMode,
  ListingPrice,
  ListingPriceDetail,
  ListingPriceOrderChunk,
  ListingPriceOrderQuery,
  ListingPriceViewerContext,
} from '@endora-commerce/contracts';
import type { PriceListTargetReads } from './price-list-service.js';
import type { PricingCache, ProfilePricingCacheKey } from './pricing-cache.js';
import {
  BookPricing,
  engineFromBook,
  lineFromBook,
  listingDetailFromBook,
  listingPriceFromBook,
  type BookLineAnswer,
  type BookPricingViewer,
  type ChannelBridgeSubquery,
  type ListingAnswer,
} from './book-pricing.js';
import type { PricingProfile, ProfileMemoKey } from './pricing-profile.js';
import { PriceSurface } from './price-surface.js';
import { effectiveCustomerGroupId } from './customer-group-rule.js';
import type {
  LinePricesInput,
  ListingPricesInput,
  PricedProductRef,
  PricingEngineResult,
  PricingLineRequest,
  PricingLineResult,
  PricingOrganizationRef,
  PricingResolutionInput,
  PricingServiceContract,
} from './pricing-service.interface.js';

/**
 * PricingService — the one resolution chain behind every price a buyer sees or
 * is charged (feature 160, D-287 P1; `contracts/pricing-resolution-v2.md`).
 *
 * Every entry point resolves on **price books** (`book-pricing.ts`): the base
 * book of the currency, overridden by the *everyone* books of the channel (the
 * catalogue price), then the buyer's organization and customer-group books
 * ranked by the configurable precedence (the buyer price), then a sale when it
 * is lower (`book-resolver.ts`). The batched entry points are the contract
 * (`resolveListingPrices`, `resolveListingPriceDetails`, `resolveLinePrices`);
 * the single-line ones are wrappers over a batch of one. Price sort and range
 * read the price surface (`price-surface.ts`). The display mode is resolved
 * independently, over the settings → organization → category → product chain.
 *
 * The feature-011 Application-rule engine, its priority walk and its bracket
 * tables were removed with the old model in this release.
 */

/**
 * Feature 160 (D-287 P1) — how the engine is composed.
 */
export interface PricingServiceOptions {
  /** The registered `price-list` bridge's sanctioned subquery (Principle XII). Required to resolve. */
  channelBridge?: ChannelBridgeSubquery;
  /** The price-book answers, keyed by pricing profile (research R6). */
  bookCache?: PricingCache<BookLineAnswer, ProfilePricingCacheKey>;
  /** The profile memo, per organization chain, group, channel and currency. */
  profileMemo?: PricingCache<PricingProfile, ProfileMemoKey>;
  /** Ask the `price_lists.surface` worker to rebuild stale profiles (best effort). */
  requestSurfaceRebuild?: () => Promise<void>;
  /** `pricing.show_list_price` (G9): whether a detail carries the catalogue price beside a lower one. */
  showListPrice?: () => Promise<boolean>;
}

/** The buyer a batched resolution is for, with the customer group already applied. */
interface ResolvedViewer {
  organization: PricingOrganizationRef | null;
  customerGroupId: string | null;
  salesChannel: { id: string; defaultCurrency: string };
  currencyCode: string;
}

export class PricingService implements PricingServiceContract {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 056 — resolves the acting org's inheritance chain (nearest-first,
     * `[orgId, ...ancestorIds]`) so a descendant is priced by an ancestor's
     * books. When absent, the chain is `[orgId]`.
     */
    private readonly resolveOrgChain?: (orgId: string) => Promise<readonly string[]>,
    /**
     * Feature 075 Phase C — `catalog`'s and `organizations`' read ports: the
     * category memberships and attribute values the rows select on, the
     * variants, and the display-mode chain's targets. Absent, the paths that
     * need them refuse rather than treating every category as unknown.
     */
    private readonly targetReads?: PriceListTargetReads,
    /**
     * D-287 P0 — `customer_accounts`' read port, for the customer's own group
     * when a caller names the customer account (`customerAccountId`). Absent,
     * such a resolution refuses rather than pricing on the organisation's
     * group, which is the defect this exists to end.
     */
    private readonly customerAccountRead?: Pick<CustomerAccountReadPort, 'findById'>,
    private readonly options: PricingServiceOptions = {},
  ) {}

  #books: BookPricing | undefined;
  #surface: PriceSurface | undefined;

  /** The price surface over the price-book engine (feature 160, research R7). */
  get priceSurface(): PriceSurface {
    this.#surface ??= new PriceSurface({
      emFactory: this.emFactory,
      books: this.bookPricing,
      listProducts: () => this.#productRead().listAll(),
      productsByIds: (ids) => this.#productRead().findByIds(ids),
      ...(this.options.requestSurfaceRebuild ? { requestRebuild: this.options.requestSurfaceRebuild } : {}),
    });
    return this.#surface;
  }

  /** The price-book engine, built once. */
  get bookPricing(): BookPricing {
    if (this.#books) return this.#books;
    const channelBridge = this.options.channelBridge;
    if (!channelBridge) {
      throw new Error(
        "PricingService: price-book resolution reads a book's channel set through the registered " +
          '`price-list` bridge, and this composition constructed the engine without the membership accessor.',
      );
    }
    this.#books = new BookPricing({
      emFactory: this.emFactory,
      channelBridge,
      ...(this.resolveOrgChain ? { resolveOrgChain: this.resolveOrgChain } : {}),
      categoryRead: () => this.#categoryRead(),
      attributeRead: () => this.#attributeRead(),
      variantRead: () => this.#productRead(),
      displayModes: async (input) => (await this.#displayModes()).resolveDisplayModes(input),
      ...(this.options.bookCache ? { cache: this.options.bookCache } : {}),
      ...(this.options.profileMemo ? { profileMemo: this.options.profileMemo } : {}),
    });
    return this.#books;
  }

  /**
   * The display-mode chain (`PriceListService`), built per call so this class's
   * constructor does not name it.
   */
  async #displayModes() {
    const { PriceListService } = await import('./price-list-service.js');
    return new PriceListService(this.emFactory, undefined, this.targetReads);
  }

  /** `pricing.show_list_price`, read through the settings module (cached there); off when unreadable. */
  async #showListPrice(): Promise<boolean> {
    if (!this.options.showListPrice) return false;
    return this.options.showListPrice();
  }

  /** The viewer the price-book engine reads. */
  #engineViewer(viewer: ResolvedViewer): BookPricingViewer {
    return {
      organizationId: viewer.organization?.id ?? null,
      customerGroupId: viewer.customerGroupId,
      signedIn: viewer.organization !== null,
      salesChannelId: viewer.salesChannel.id,
      currencyCode: viewer.currencyCode,
    };
  }

  /** Every line on price books, for one buyer. */
  async #bookAnswers(
    lines: readonly PricingLineRequest[],
    context: Omit<PricingResolutionInput['context'], 'quantity'>,
  ): Promise<Map<string, BookLineAnswer | null>> {
    return this.bookPricing.resolve(lines, this.#engineViewer(await this.#viewer(context)));
  }

  /**
   * The customer group a resolution is for — {@link effectiveCustomerGroupId},
   * with the account read when the caller named one and resolved no group
   * itself. One statement, once per call (once per page or basket for the
   * batched entry points).
   */
  async #customerGroupFor(context: {
    organization?: PricingOrganizationRef | null;
    customerGroupId?: string | null;
    customerAccountId?: string | null;
  }): Promise<string | null> {
    const organization = context.organization ?? null;
    if (context.customerGroupId || !context.customerAccountId) {
      return effectiveCustomerGroupId({ explicit: context.customerGroupId ?? null, organization });
    }
    if (!this.customerAccountRead) {
      throw new Error(
        "PricingService: this resolution names a customer account, whose own customer group overrides " +
          "the organisation's, and this composition constructed the engine without `customer_accounts`' " +
          'read port.',
      );
    }
    const account = await this.customerAccountRead.findById(context.customerAccountId);
    return effectiveCustomerGroupId({
      customer: account ? { organizationId: account.organizationId, customerGroupId: account.customerGroupId } : null,
      organization,
    });
  }

  /** The batched entry points' buyer: currency, and the customer group applied once. */
  async #viewer(context: {
    organization?: PricingOrganizationRef | null;
    customerGroupId?: string | null;
    customerAccountId?: string | null;
    salesChannel: { id: string; defaultCurrency: string };
    currencyCode?: string;
  }): Promise<ResolvedViewer> {
    return {
      organization: context.organization ?? null,
      customerGroupId: await this.#customerGroupFor(context),
      salesChannel: context.salesChannel,
      currencyCode: (context.currencyCode ?? context.salesChannel.defaultCurrency).toUpperCase(),
    };
  }

  /**
   * `catalog`'s category read port, or a refusal. Skipping it because nothing
   * was wired would turn "this composition cannot reach `catalog`" into "this
   * product is in no category", which prices a line a category row covers.
   */
  #categoryRead(): CatalogCategoryReadPort {
    const categoryRead = this.targetReads?.catalogCategoryRead;
    if (!categoryRead) {
      throw new Error(
        'PricingService: this resolution asks `catalog` about category membership and this ' +
          "composition constructed the engine without `catalog`'s category read port.",
      );
    }
    return categoryRead;
  }

  /**
   * `catalog`'s attribute read port, or a refusal — asked when a row selects by
   * an attribute value. Unwired, it refuses rather than answering "no attribute
   * is eligible", which would price the line as though the row did not exist.
   */
  #attributeRead(): CatalogAttributeReadPort {
    const attributeRead = this.targetReads?.catalogAttributeRead;
    if (!attributeRead) {
      throw new Error(
        'PricingService: this resolution reads a price-book row that selects by attribute, and ' +
          "this composition constructed the engine without `catalog`'s attribute read port.",
      );
    }
    return attributeRead;
  }

  /** `catalog`'s product read port, or the same refusal `#categoryRead` makes. */
  #productRead(): CatalogProductReadPort {
    const productRead = this.targetReads?.catalogProductRead;
    if (!productRead) {
      throw new Error(
        'PricingService: this resolution reads `catalog` products or variants, and this composition ' +
          "constructed the engine without `catalog`'s product read port.",
      );
    }
    return productRead;
  }

  // ---- Entry points ---------------------------------------------------------

  /**
   * One line's resolution in the engine shape: the regular price, the sale
   * when charged, the display mode, and the tier that priced it. A wrapper over
   * the batch of one; a consumer pricing more than one line uses the batch.
   */
  async resolveEngine(input: PricingResolutionInput): Promise<PricingEngineResult> {
    const answers = await this.#bookAnswers(
      [{ key: 'line', product: input.product, variantId: input.variantId ?? null, quantity: input.context.quantity }],
      input.context,
    );
    return engineFromBook(
      answers.get('line') ?? null,
      input.product.id,
      (input.context.currencyCode ?? input.context.salesChannel.defaultCurrency).toUpperCase(),
      await this.#showListPrice(),
    );
  }

  /**
   * The charged unit price of one line (`null` when no book prices it): the
   * sale when one is charged, the regular price otherwise. A wrapper over the
   * batch of one.
   */
  async resolveLinePrice(input: PricingResolutionInput): Promise<PricingLineResult | null> {
    const answers = await this.#bookAnswers(
      [{ key: 'line', product: input.product, variantId: input.variantId ?? null, quantity: input.context.quantity }],
      input.context,
    );
    return lineFromBook(answers.get('line') ?? null);
  }

  /**
   * Issue #132 — the price a catalogue listing may render, per product, at
   * quantity 1; a variant product is ranged over its variants (FR-024). Every
   * requested product gets an entry; one nothing prices gets the `none` arm.
   */
  async resolveListingPrices(input: ListingPricesInput): Promise<Map<string, ListingPrice>> {
    const out = new Map<string, ListingPrice>();
    for (const [productId, listed] of await this.#bookListing(input)) {
      out.set(productId, listingPriceFromBook(listed.answer, listed));
    }
    return out;
  }

  /**
   * D-287 P0 — {@link resolveListingPrices} and the base / sale / display-mode
   * split from the **same** resolution, for the surfaces that render both.
   */
  async resolveListingPriceDetails(input: ListingPricesInput): Promise<Map<string, ListingPriceDetail>> {
    const out = new Map<string, ListingPriceDetail>();
    const listing = await this.#bookListing(input);
    const showListPrice = listing.size > 0 ? await this.#showListPrice() : false;
    for (const [productId, listed] of listing) {
      out.set(productId, listingDetailFromBook(listed.answer, listed, showListPrice));
    }
    return out;
  }

  /** The listing entry points' shared body: one batch at quantity 1, variants ranged. */
  async #bookListing(input: ListingPricesInput): Promise<Map<string, ListingAnswer>> {
    const requested = new Map<string, PricedProductRef>();
    for (const product of input.products) if (!requested.has(product.id)) requested.set(product.id, product);
    if (requested.size === 0) return new Map();
    return this.bookPricing.resolveListing([...requested.values()], this.#engineViewer(await this.#viewer(input.context)));
  }

  /**
   * D-287 P0 — many lines, each at its own quantity, for one buyer: the cart
   * read, the placement check, a quote's reference prices, the external
   * catalogue API. `test/integration/price_lists/line-prices-batch.test.ts`
   * asserts, key by key, that this answers exactly what one
   * {@link resolveLinePrice} per line does.
   */
  async resolveLinePrices(input: LinePricesInput): Promise<Map<string, PricingLineResult | null>> {
    const out = new Map<string, PricingLineResult | null>();
    if (input.lines.length === 0) return out;
    for (const [key, answer] of await this.#bookAnswers(input.lines, input.context)) out.set(key, lineFromBook(answer));
    return out;
  }

  // ---- Feature 086 / 160 — the price ordering, on the price surface ---------

  /**
   * The catalogue in resolved-unit-price order, for one viewer, one chunk at a
   * time — {@link ListingPriceOrderPort}, served from the price surface
   * (`price-surface.ts`, `contracts/price-surface.md`). The order equals the
   * live card prices (`price-surface-identity.test.ts`); it may lag a change by
   * the surface worker's turnaround, a displayed price never.
   *
   * It knows nothing of visibility, channel membership, status or archival:
   * the caller intersects before anything reaches a page, a cursor or a count.
   */
  async orderByUnitPrice(input: ListingPriceOrderQuery): Promise<ListingPriceOrderChunk> {
    return this.priceSurface.orderByUnitPrice(
      input,
      this.#engineViewer(await this.#viewer(input.context)),
    );
  }

  /**
   * Which of `productIds` the viewer's books price at quantity 1 — a set
   * membership answer, not a price: `catalog` composes the unpriced tail out of
   * the complement.
   */
  async pricedProductIds(input: {
    context: ListingPriceViewerContext;
    productIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    if (input.productIds.length === 0) return new Set();
    return this.priceSurface.pricedProductIds(input.productIds, this.#engineViewer(await this.#viewer(input.context)));
  }

  /**
   * The display mode a *page* resolves to for this viewer — feature 086 /
   * FR-016. See `PriceListService.resolvePageDisplayMode` for why the
   * per-product and per-category steps are absent.
   */
  async pageDisplayMode(input: { context: ListingPriceViewerContext }): Promise<DisplayMode> {
    return (await this.#displayModes()).resolvePageDisplayMode({
      organizationId: input.context.organization?.id ?? null,
      salesChannelId: input.context.salesChannel.id,
      customerKind: input.context.organization ? 'signed_in' : 'guest',
    });
  }

  /**
   * Issue #132 / feature 160 (FR-029) — a named book's quantity-1 prices for a
   * feed pinned to it: the book's rows over the channel's catalogue price;
   * products the book does not price are absent.
   */
  async namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
    /** The feed's channel, whose catalogue price the book's rows are taken off. */
    salesChannelId?: string;
  }): Promise<Map<string, string>> {
    if (input.productIds.length === 0) return new Map();
    if (!input.salesChannelId) {
      throw new Error('PricingService.namedListPrices: a price book is read on a sales channel; none was named.');
    }
    const products = await this.#productRead().findByIds([...new Set(input.productIds)]);
    return this.bookPricing.namedBookPrices({
      bookId: input.priceListId,
      salesChannelId: input.salesChannelId,
      currencyCode: input.currencyCode,
      products,
    });
  }

  /**
   * Feature 062 / 160 — the distinct tier starts (ascending) of the rows that
   * can price this product (or this variant) in this currency: its own and its
   * variants' rows and the selection-wide ones, on the base books and on every
   * book that applies now. Over-inclusion is this method's contract (a start no
   * row of the buyer's applies at resolves to its predecessor's price), so
   * neither the channel nor the audience is narrowed. One statement.
   */
  async listTierStarts(productId: string, currencyCode: string, variantId?: string | null): Promise<number[]> {
    const rows = await this.emFactory().execute<Array<{ min_quantity: number | string }>>(
      `select distinct e."min_quantity"
         from "price_list_matrix_entries" e
         join "price_lists" l on l."id" = e."price_list_id"
        where l."currency_code" = ?
          and (e."product_id" is null or e."product_id" = ?)
          and (e."variant_id" is null or e."variant_id" = ?)
          and (l."is_system" = true
               or (l."status" in ('active', 'scheduled')
                   and (l."starts_at" is null or l."starts_at" <= now())
                   and (l."ends_at" is null or l."ends_at" > now())))
        order by e."min_quantity" asc`,
      [currencyCode.toUpperCase(), productId, variantId ?? null],
    );
    return rows.map((r) => Number(r.min_quantity));
  }
}
