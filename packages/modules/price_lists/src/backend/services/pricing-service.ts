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
  ListingPriceOrderRow,
  ListingPriceViewerContext,
} from '@endora-commerce/contracts';
import { isOldModelList, PriceList } from '../entities/price-list.entity.js';
import { PriceListPriceBracket } from '../entities/price-list-price-bracket.entity.js';
import { PriceListMatrixEntry } from '../entities/price-list-matrix-entry.entity.js';
import { DEFAULT_PRICE_LIST_ID } from './default-price-list-migration.js';
import {
  buildEligibleAttributes,
  matrixEntrySpecificity,
  resolveListCandidate,
  type EligibleAttribute,
  type MatrixEntryRow,
} from './matrix-price-resolver.js';
import {
  evaluateApplicationRule,
  type ResolutionContext,
} from './application-rule-evaluator.js';
import {
  pickPriorityChain,
  type PriceListCandidate,
} from './price-list-resolver.js';
import type { PriceBracketRow } from './price-bracket-resolver.js';
import { listingPriceFrom } from './listing-price-chain.js';
import {
  buildCandidateVector,
  type CandidateViewerContext,
  type OrderedCandidate,
} from './price-list-candidate-vector.js';
import {
  buildPricedProductIdsQuery,
  buildUnitPriceMergeQuery,
  compareOrderRows,
  OWN_BRACKET_RANK,
  uuidArrayLiteral,
  type UnitPriceMatrixEntry,
  type UnitPriceStream,
} from './unit-price-ordering.js';
import type { PriceListTargetReads } from './price-list-service.js';
import type { PricingCache, PricingCacheKey, ProfilePricingCacheKey } from './pricing-cache.js';
import {
  BookPricing,
  engineFromBook,
  lineFromBook,
  listingDetailFromBook,
  listingPriceFromBook,
  type BookLineAnswer,
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
  PricingServiceContract,
} from './pricing-service.interface.js';

/**
 * PricingService (feature 011).
 *
 * Resolves the effective Base + (optional) Sale unit price for a
 * (product, variant?, quantity, organization, salesChannel) tuple.
 * The pipeline composes three pure helpers — application-rule
 * evaluator, price-list-resolver (priority chain + tie-break), and
 * price-bracket resolver (per-currency multi-bracket lookup with
 * gap fall-through). Display mode is resolved independently against
 * the Settings → Organization → Category → Product chain.
 *
 * Persistence: the resolver only reads — `PriceListService` owns
 * every write path and emits cache invalidation through the optional
 * `PricingCache` injected at construction.
 */

/** An active list that matched, paired with the row the priority walk ranks. */
interface MatchedList {
  list: PriceList;
  candidate: PriceListCandidate<PriceList>;
}

/** One (product, quantity) the batched walk resolves, with the lists that matched it. */
interface WalkItem {
  productId: string;
  quantity: number;
  matches: MatchedList[];
}

/** The buyer a batched resolution is for, with the customer group already applied. */
interface ResolvedViewer {
  organization: PricingOrganizationRef | null;
  customerGroupId: string | null;
  salesChannel: { id: string; defaultCurrency: string };
  currencyCode: string;
}

/**
 * The engine's answer, as a charged line (FR-034): Sale when present, Base
 * otherwise, `null` when nothing on any matching list prices the product.
 *
 * Extracted from `resolveLinePrice` so the batched listing path applies exactly
 * the same rule to the engine results it assembles — the sale-wins step is one
 * of the places a second implementation could have quietly disagreed.
 */
export function lineFromEngine(out: PricingEngineResult): PricingLineResult | null {
  if (out.sale) {
    return {
      amount: out.sale.bracket.amount,
      currency: out.currencyCode,
      priceListId: out.sale.listId,
      isSale: true,
      bracketStartQuantity: out.sale.bracket.minQuantity,
      displayMode: out.displayMode,
      ...(out.sale.bracket.matrixEntryId ? { matrixEntryId: out.sale.bracket.matrixEntryId } : {}),
    };
  }
  if (!out.base.bracket) return null;
  return {
    amount: out.base.bracket.amount,
    currency: out.currencyCode,
    priceListId: out.base.listId,
    isSale: false,
    bracketStartQuantity: out.base.bracket.minQuantity,
    displayMode: out.displayMode,
    ...(out.base.bracket.matrixEntryId ? { matrixEntryId: out.base.bracket.matrixEntryId } : {}),
  };
}

/**
 * Feature 148 — what a resolution knows about the price matrix, read once per
 * resolution (per page, for the batched path) and shared by both partitions'
 * walks.
 *
 * `defaultBrackets` is a memo, not a prefetch: the Default list's brackets are
 * read only for products whose best candidate is a percentage with no
 * own-list reference (`needs_reference`), and a product read once is never
 * read again by the other partition or a later wave.
 */
interface MatrixContext {
  entriesByList: ReadonlyMap<string, MatrixEntryRow[]>;
  eligibleAttributes: ReadonlyMap<string, EligibleAttribute> | null;
  organizationChain: readonly string[];
  /** The product facts the selections read — categories and attribute values. */
  products: ReadonlyMap<string, { categoryIds: ReadonlySet<string>; attributeValues: Record<string, unknown> }>;
  defaultBrackets: Map<string, PriceBracketRow[]>;
}

function bracketRow(b: PriceListPriceBracket): PriceBracketRow {
  return {
    priceListId: b.priceListId,
    productId: b.productId,
    currencyCode: b.currencyCode,
    minQuantity: b.minQuantity,
    maxQuantity: b.maxQuantity ?? null,
    amount: b.amount,
  };
}

function matrixEntryRow(e: PriceListMatrixEntry): MatrixEntryRow {
  return {
    id: e.id,
    priceListId: e.priceListId,
    productId: e.productId ?? null,
    categoryId: e.categoryId ?? null,
    attributeKey: e.attributeKey ?? null,
    attributeValue: e.attributeValue ?? null,
    organizationId: e.organizationId ?? null,
    minQuantity: e.minQuantity,
    maxQuantity: e.maxQuantity ?? null,
    // Feature 160 — the reads below keep to the old engine's two price types.
    priceType: e.priceType as MatrixEntryRow['priceType'],
    amount: e.amount ?? null,
    currencyCode: e.currencyCode ?? null,
    discountPercent: e.discountPercent ?? null,
  };
}

/**
 * Feature 160 (D-287 P1) — how the engine is composed.
 *
 * `model: 'books'` routes every batched entry point — and the single-line
 * wrappers over them — through the price-book engine (`book-pricing.ts`):
 * base → catalogue → buyer, then sale when lower, over the configurable
 * precedence. `'legacy'` (the default) keeps the Application-rule engine.
 *
 * Both exist only on the feature-160 release branch, and only until its
 * consumer phase: the old engine is what every consumer and every pre-160
 * fixture in the tree is written against, and the plan keeps them working
 * behind the same seams while the new engine is built and proven on the
 * worked examples. The consumer phase switches the composition to `'books'`
 * and the removal phase deletes `'legacy'` with the old model — the option
 * never reaches `master` as a choice.
 */
export interface PricingServiceOptions {
  model?: 'legacy' | 'books';
  /** The registered `price-list` bridge's sanctioned subquery (Principle XII). Required for `'books'`. */
  channelBridge?: ChannelBridgeSubquery;
  /** The price-book answers, keyed by pricing profile (research R6). */
  bookCache?: PricingCache<BookLineAnswer, ProfilePricingCacheKey>;
  /** The profile memo, per organization chain, group, channel and currency. */
  profileMemo?: PricingCache<PricingProfile, ProfileMemoKey>;
  /** Ask the `price_lists.surface` worker to rebuild stale profiles (best effort). */
  requestSurfaceRebuild?: () => Promise<void>;
}

export class PricingService implements PricingServiceContract {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: import('./pricing-cache.js').PricingCache<{
      base: { listId: string; listName: string; bracket: PriceBracketRow | null };
      sale: { listId: string; listName: string; bracket: PriceBracketRow } | null;
      displayMode: DisplayMode;
      currencyCode: string;
    }>,
    /**
     * Feature 056 — resolves the acting org's inheritance chain (nearest-first,
     * `[orgId, ...ancestorIds]`) so a descendant inherits an ancestor's org-named
     * price list. When absent, the chain is `[orgId]` (flat behavior, byte-for-byte).
     */
    private readonly resolveOrgChain?: (orgId: string) => Promise<readonly string[]>,
    /**
     * Feature 075 Phase C — forwarded verbatim to the `PriceListService` this
     * engine builds for the display-mode chain, whose category step reaches
     * `catalog` over its read port. Absent, that step refuses rather than
     * treating every category as unknown.
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

  /** The viewer the price-book engine reads, from a listing context. */
  async #bookViewer(context: ListingPriceViewerContext): Promise<{
    organizationId: string | null;
    customerGroupId: string | null;
    signedIn: boolean;
    salesChannelId: string;
    currencyCode: string;
  }> {
    const viewer = await this.#viewer(context);
    return {
      organizationId: viewer.organization?.id ?? null,
      customerGroupId: viewer.customerGroupId,
      signedIn: viewer.organization !== null,
      salesChannelId: viewer.salesChannel.id,
      currencyCode: viewer.currencyCode,
    };
  }

  /** Whether the batched entry points resolve on price books (feature 160). */
  get usesPriceBooks(): boolean {
    return this.options.model === 'books';
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
      displayModes: async (input) => {
        const { PriceListService } = await import('./price-list-service.js');
        return new PriceListService(this.emFactory, undefined, undefined, undefined, this.targetReads).resolveDisplayModes(
          input,
        );
      },
      ...(this.options.bookCache ? { cache: this.options.bookCache } : {}),
      ...(this.options.profileMemo ? { profileMemo: this.options.profileMemo } : {}),
    });
    return this.#books;
  }

  /** Feature 160 — every line on price books, for one buyer. */
  async #bookAnswers(
    lines: readonly PricingLineRequest[],
    context: {
      organization?: PricingOrganizationRef | null;
      customerGroupId?: string | null;
      customerAccountId?: string | null;
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    },
  ): Promise<Map<string, BookLineAnswer | null>> {
    const viewer = await this.#viewer(context);
    return this.bookPricing.resolve(lines, {
      organizationId: viewer.organization?.id ?? null,
      customerGroupId: viewer.customerGroupId,
      signedIn: viewer.organization !== null,
      salesChannelId: viewer.salesChannel.id,
      currencyCode: viewer.currencyCode,
    });
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

  /**
   * `catalog`'s category read port, or a refusal — the same refusal
   * `PriceListService.targets()` makes, for the same reason.
   *
   * Every category question this engine asks is asked here: which categories a
   * product is in, and which products a category holds. Skipping one because
   * nothing was wired would turn "this composition cannot reach `catalog`" into
   * an answer — "this product is in no category", "this category rule applies
   * to everything" — and both of those price a line the rule does not cover.
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
   * `catalog`'s attribute read port, or a refusal — feature 148. Asked only when
   * a price matrix entry the resolution reads names an attribute, and asked
   * once per resolution. Unwired, it refuses rather than answering "no
   * attribute is eligible", which would price the line as though the entry did
   * not exist.
   */
  #attributeRead(): CatalogAttributeReadPort {
    const attributeRead = this.targetReads?.catalogAttributeRead;
    if (!attributeRead) {
      throw new Error(
        'PricingService: this resolution reads a price matrix entry that selects by attribute, and ' +
          "this composition constructed the engine without `catalog`'s attribute read port.",
      );
    }
    return attributeRead;
  }

  /**
   * Feature 148 — the matrix entries a resolution can meet, in **one**
   * statement (contract §7): entries on the matched lists that name no product
   * or one of these products, and no organization or one in the buyer's chain.
   * Only lists whose `hasMatrixEntries` probe (read with the lists) is true are
   * asked about, so a resolution whose lists carry no entry pays no statement
   * at all. The eligible attributes are read only when an entry names one.
   */
  async #matrixContext(
    em: EntityManager,
    lists: readonly PriceList[],
    products: ReadonlyMap<string, { categoryIds: ReadonlySet<string>; attributeValues: Record<string, unknown> }>,
    organizationChain: readonly string[],
  ): Promise<MatrixContext> {
    const entriesByList = new Map<string, MatrixEntryRow[]>();
    const context: MatrixContext = {
      entriesByList,
      eligibleAttributes: null,
      organizationChain,
      products,
      defaultBrackets: new Map(),
    };
    // Only lists that carry an entry are read — `hasMatrixEntries` came with
    // the list rows, so a resolution whose lists carry none pays nothing.
    const listIds = [...new Set(lists.filter((l) => l.hasMatrixEntries).map((l) => l.id))];
    if (listIds.length === 0 || products.size === 0) return context;
    const rows = await em.find(PriceListMatrixEntry, {
      priceListId: { $in: listIds },
      // Feature 160 — the old engine's two price types only: the base book it
      // shares with price books (`…d51b`) may carry price-book rows.
      priceType: { $in: ['fixed', 'discount_percent'] },
      $and: [
        { $or: [{ productId: null }, { productId: { $in: [...products.keys()] } }] },
        organizationChain.length > 0
          ? { $or: [{ organizationId: null }, { organizationId: { $in: [...organizationChain] } }] }
          : { organizationId: null },
      ],
    });
    let namesAttribute = false;
    for (const row of rows) {
      const entry = matrixEntryRow(row);
      if (entry.attributeKey !== null) namesAttribute = true;
      const list = entriesByList.get(entry.priceListId);
      if (list) list.push(entry);
      else entriesByList.set(entry.priceListId, [entry]);
    }
    if (namesAttribute) {
      context.eligibleAttributes = buildEligibleAttributes(
        await this.#attributeRead().listByFlag('isPriceRule'),
      );
    }
    return context;
  }

  /**
   * The Default list's brackets for the products not yet in the memo, in one
   * statement — the percentage reference of last resort (research R5).
   */
  async #loadDefaultBrackets(
    em: EntityManager,
    context: MatrixContext,
    productIds: readonly string[],
  ): Promise<void> {
    const wanted = productIds.filter((id) => !context.defaultBrackets.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) context.defaultBrackets.set(id, []);
    const rows = await em.find(PriceListPriceBracket, {
      priceListId: DEFAULT_PRICE_LIST_ID,
      productId: { $in: wanted },
    });
    for (const row of rows) context.defaultBrackets.get(row.productId)?.push(bracketRow(row));
  }

  /** `resolveListCandidate` for one (list, product) with what the context holds. */
  #candidateFor(
    context: MatrixContext,
    list: PriceList,
    productId: string,
    ownBrackets: readonly PriceBracketRow[],
    currencyCode: string,
    quantity: number,
  ): ReturnType<typeof resolveListCandidate> {
    const facts = context.products.get(productId);
    const entries = (context.entriesByList.get(list.id) ?? []).filter(
      (e) => e.productId === null || e.productId === productId,
    );
    return resolveListCandidate({
      list: { id: list.id, isSystem: list.isSystem },
      product: {
        id: productId,
        categoryIds: facts?.categoryIds ?? new Set<string>(),
        attributeValues: facts?.attributeValues ?? {},
      },
      organizationChain: context.organizationChain,
      currencyCode,
      quantity,
      ownBrackets,
      entries,
      defaultBrackets: context.defaultBrackets.get(productId) ?? null,
      eligibleAttributes: context.eligibleAttributes,
    });
  }

  /**
   * `(product, category)` memberships for a set of products, read through
   * `catalog`'s port (feature 075 / D-87) — the shape both resolution paths
   * take, one call for the whole set.
   *
   * **Structural, deliberately** — no `activeOnly`. `evaluateApplicationRule`'s
   * `category` criterion tests the raw membership, so narrowing to live
   * categories here would price a product against a rule its memberships no
   * longer satisfy the moment an operator deactivates a category.
   *
   * Every product asked about gets an entry — an uncategorised one answers an
   * empty set rather than a missing key, which is what `resolveEngine`'s
   * single-product read means by "no rows".
   */
  async #categoryMemberships(
    productIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (const id of productIds) out.set(id, new Set<string>());
    if (productIds.length === 0) return out;
    for (const assignment of await this.#categoryRead().listAssignmentsForProducts(productIds)) {
      out.get(assignment.productId)?.add(assignment.categoryId);
    }
    return out;
  }

  // ---- Engine resolver (US5 / FR-026..FR-032) ------------------------

  /**
   * New resolver pipeline composing the three pure helpers:
   *   - evaluateApplicationRule (US4)
   *   - pickPriorityChain      (US5)
   *   - resolvePriceBracket    (US3)
   *
   * Returns Base + (optional) Sale resolutions on the given context.
   *
   * Bracket-gap fall-through (FR-031): when the picked list has no
   * bracket for the requested (product, currency, qty), the resolver
   * advances to the next-priority list in the same partition and
   * repeats. Default is the terminal fallback for the Base partition;
   * the Sale partition simply yields null when nothing matches with a
   * usable bracket.
   *
   * Display mode resolution is stubbed at this layer until US7 wires
   * the override chain. The default mode `gross_only` is returned so
   * the response shape is complete.
   */
  async resolveEngine(input: {
    product: PricedProductRef;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: PricingOrganizationRef | null;
      /**
       * Feature 040 — a customer's DIRECT customer-group membership, which
       * overrides the Organization's group when set (R6). Callers that know the
       * acting customer resolve it as `customer.customerGroupId`; when omitted,
       * the Organization's group is used (unchanged behavior).
       */
      customerGroupId?: string | null;
      /** D-287 P0 — the signed-in customer, whose own group overrides the org's. */
      customerAccountId?: string | null;
      /**
       * The request's resolved sales channel. Only `id` (rule dimension +
       * cache key) and `defaultCurrency` (currency fallback) are read, so any
       * resolved-channel shape satisfies this — a full `SalesChannel` entity,
       * or the request-scoped `CachedChannel` (feature 053 / FR-002).
       */
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<{
    base: {
      listId: string;
      listName: string;
      bracket: PriceBracketRow | null;
    };
    sale: {
      listId: string;
      listName: string;
      bracket: PriceBracketRow;
    } | null;
    displayMode: DisplayMode;
    currencyCode: string;
  }> {
    if (this.usesPriceBooks) {
      // Feature 160 — a wrapper over the batch of one.
      const answers = await this.#bookAnswers(
        [{ key: 'line', product: input.product, variantId: input.variantId ?? null, quantity: input.context.quantity }],
        input.context,
      );
      return engineFromBook(
        answers.get('line') ?? null,
        input.product.id,
        (input.context.currencyCode ?? input.context.salesChannel.defaultCurrency).toUpperCase(),
      );
    }
    const em = this.emFactory();
    const { product, context } = input;
    const currencyCode = (context.currencyCode ?? context.salesChannel.defaultCurrency).toUpperCase();
    // D-287 P0 — the one customer-group rule, before the cache key it is part of.
    const customerGroupId = await this.#customerGroupFor(context);

    const cacheKey = {
      productId: product.id,
      variantId: input.variantId ?? null,
      quantity: context.quantity,
      currencyCode,
      salesChannelId: context.salesChannel.id,
      organizationId: context.organization?.id ?? null,
      customerGroupId,
    };
    const cached = this.cache?.get(cacheKey);
    if (cached) return cached;
    // Read before the first statement: an answer that straddles an
    // invalidation is returned but not stored (D-287 P0).
    const generation = this.cache?.generation;

    // Build the resolution context.
    const productCategoryIds =
      (await this.#categoryMemberships([product.id])).get(product.id) ?? new Set<string>();
    const orgId = context.organization?.id ?? null;
    // Feature 056 — build the org inheritance chain (nearest-first). Flat when
    // no resolver is wired or the org is a root.
    const organizationChain =
      orgId !== null && this.resolveOrgChain ? await this.resolveOrgChain(orgId) : orgId !== null ? [orgId] : [];
    const ctx: ResolutionContext = {
      organizationId: orgId,
      organizationChain,
      customerGroupId,
      salesChannelId: context.salesChannel.id,
      currencyCode,
      productCategoryIds,
    };

    // Load every active list and evaluate.
    // Feature 160 — the old engine reads its own lists only (`isOldModelList`).
    const activeLists = (await em.find(PriceList, { status: 'active' })).filter(isOldModelList);
    const baseMatches: MatchedList[] = [];
    const saleMatches: MatchedList[] = [];
    for (const list of activeLists) {
      const evaluation = evaluateApplicationRule(list.applicationRule, ctx);
      if (!evaluation.matched) continue;
      const candidate: PriceListCandidate<PriceList> = {
        list,
        evaluation,
        modifiedAt: list.modifiedAt,
        name: list.name,
        isSystem: list.isSystem,
      };
      if (list.type === 'sale') saleMatches.push({ list, candidate });
      else baseMatches.push({ list, candidate });
    }

    // Feature 148 — the price matrix of every matched list, read once for both
    // partitions.
    const matrix = await this.#matrixContext(
      em,
      [...baseMatches, ...saleMatches].map((m) => m.list),
      new Map([
        [product.id, { categoryIds: productCategoryIds, attributeValues: product.attributeValues ?? {} }],
      ]),
      organizationChain,
    );

    // For each partition: walk the priority chain, do bracket lookup, and
    // fall through if the picked list has no usable bracket (FR-031).
    const baseResult = await this.pickAndResolveBracket(
      em,
      baseMatches,
      product.id,
      currencyCode,
      context.quantity,
      matrix,
    );
    const saleResult = await this.pickAndResolveBracket(
      em,
      saleMatches,
      product.id,
      currencyCode,
      context.quantity,
      matrix,
    );

    // Display mode (US7): walk the override chain via the price-list service
    // helper. Lazy-construct the helper here so PricingService does not pull
    // PriceListService into its constructor signature (keeps the existing
    // composition.ts wiring intact).
    const { PriceListService } = await import('./price-list-service.js');
    const priceListService = new PriceListService(
      this.emFactory,
      undefined,
      undefined,
      undefined,
      this.targetReads,
    );
    const displayMode = await priceListService.resolveDisplayMode({
      productId: product.id,
      organizationId: context.organization?.id ?? null,
      salesChannelId: context.salesChannel.id,
      customerKind: context.organization ? 'signed_in' : 'guest',
    });

    const result = {
      base: {
        listId: baseResult.list?.id ?? '',
        listName: baseResult.list?.name ?? '',
        bracket: baseResult.bracket,
      },
      sale: saleResult.list && saleResult.bracket
        ? {
            listId: saleResult.list.id,
            listName: saleResult.list.name,
            bracket: saleResult.bracket,
          }
        : null,
      displayMode,
      currencyCode,
    };
    this.cache?.set(cacheKey, result, generation);
    return result;
  }

  /**
   * Convenience wrapper for cart/checkout/order callers (US6 / FR-034).
   *
   * Returns the line's effective unit price as a `{ amount, currency }`
   * pair plus the source price-list ID and a flag indicating whether the
   * Sale partition won. Callers persist the amount on the cart line and
   * the source list ID for audit; if the response is `null`, the product
   * has no bracket on any matching list and the caller should refuse the
   * line (or, in the storefront's case, route to the Quote Request flow).
   *
   * Always charges the Sale price when present (FR-034). Falls back to
   * the Base price; both come from `resolveEngine`.
   */
  async resolveLinePrice(input: {
    product: PricedProductRef;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: PricingOrganizationRef | null;
      /** Feature 040 — customer's direct group overrides the org's (R6). */
      customerGroupId?: string | null;
      /** D-287 P0 — the signed-in customer, whose own group overrides the org's. */
      customerAccountId?: string | null;
      /**
       * The request's resolved sales channel. Only `id` (rule dimension +
       * cache key) and `defaultCurrency` (currency fallback) are read, so any
       * resolved-channel shape satisfies this — a full `SalesChannel` entity,
       * or the request-scoped `CachedChannel` (feature 053 / FR-002).
       */
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<PricingLineResult | null> {
    if (this.usesPriceBooks) {
      // Feature 160 — a wrapper over the batch of one.
      const answers = await this.#bookAnswers(
        [{ key: 'line', product: input.product, variantId: input.variantId ?? null, quantity: input.context.quantity }],
        input.context,
      );
      return lineFromBook(answers.get('line') ?? null);
    }
    return lineFromEngine(await this.resolveEngine(input));
  }

  /**
   * Issue #132 — the price a catalogue listing may render, per product.
   *
   * The chain is `listingPriceFrom`; this method feeds it, so the listing paths
   * make one call and get an answer whose type states which step of the chain
   * produced it. Every requested product gets an entry.
   *
   * ## Why this is a batch and not a loop
   *
   * It used to be a loop over `resolveLinePrice`, which is **7 queries per
   * product, sequentially**: a 50-item catalogue page — the platform's default
   * page size and its busiest storefront read — cost 350 round trips and 315 ms
   * of resolution on a warm local Postgres. Six of those seven asked a question
   * whose answer does not vary across the page (the active price lists, the
   * settings pair, the organization's override) or asked it one id at a time
   * (the category memberships, the brackets, the product-scope overrides).
   *
   * So the set is resolved once and applied per product: the memberships in one
   * `in (…)`, the active lists once, the organization's inheritance chain once,
   * the brackets in **priority waves** (one query per fall-through level the
   * page actually needs, not per product), and the display-mode chain through
   * `resolveDisplayModes`, reusing the memberships already read.
   *
   * ## What is *not* batched, and why
   *
   * The application-rule evaluation and the priority walk stay per product, and
   * they have to: `evaluateApplicationRule` reads the product's own category
   * memberships, so a category rule matches some cards on a page and not
   * others, and the winning list therefore differs per product. Both are pure
   * in-memory functions over rows already loaded — the same
   * `evaluateApplicationRule` / `pickPriorityChain` / `resolvePriceBracket`
   * helpers `resolveEngine` composes — so the per-product part costs no I/O.
   *
   * The bracket wave is what keeps that honest. A single `in (…)` over every
   * matched list would fetch brackets for lists most cards never reach; asking
   * one wave at a time fetches exactly the (list, product) pairs the per-product
   * walk would have asked for, in one query per level instead of one per card.
   *
   * ## Identity with the per-product path
   *
   * `resolveEngine` and `resolveLinePrice` are untouched: cart, checkout and the
   * admin resolved-price probe take the same path they always did, and
   * `test/integration/price_lists/listing-prices-batch.test.ts` asserts, product
   * by product over a fixture with a bracket gap, a sale partition, a category
   * rule and both unpriced arms, that this method answers exactly what looping
   * that path answers. The LRU is keyed and populated identically, so a page
   * whose products are already cached still issues no query at all.
   */
  async resolveListingPrices(input: ListingPricesInput): Promise<Map<string, ListingPrice>> {
    const out = new Map<string, ListingPrice>();
    if (this.usesPriceBooks) {
      for (const [productId, listed] of await this.#bookListing(input)) {
        out.set(productId, listingPriceFromBook(listed.answer, listed));
      }
      return out;
    }
    for (const [productId, { price }] of await this.#listingEngines(input)) out.set(productId, price);
    return out;
  }

  /**
   * D-287 P0 — {@link resolveListingPrices} and the base / sale / display-mode
   * split from the **same** resolution, for the surfaces that render both: the
   * product page (which resolved its product a second time through
   * `GET /storefront/products/:id/resolved-price`), the home page's cards (one
   * such request per card) and the typeahead (one `resolveEngine` per hit).
   *
   * `basePrice` is the base partition's bracket, or the Product's own price
   * when that is the listing chain's answer; `salePrice` is the sale
   * partition's bracket. The identity with `resolveEngine` is asserted in
   * `test/integration/price_lists/line-prices-batch.test.ts`.
   */
  async resolveListingPriceDetails(input: ListingPricesInput): Promise<Map<string, ListingPriceDetail>> {
    const out = new Map<string, ListingPriceDetail>();
    if (this.usesPriceBooks) {
      for (const [productId, listed] of await this.#bookListing(input)) {
        out.set(productId, listingDetailFromBook(listed.answer, listed));
      }
      return out;
    }
    for (const [productId, { price, engine }] of await this.#listingEngines(input)) {
      out.set(productId, {
        price,
        basePrice: engine.base.bracket
          ? { amount: engine.base.bracket.amount, currency: engine.currencyCode }
          : price.source === 'product'
            ? { amount: price.amount, currency: price.currency }
            : null,
        salePrice: engine.sale
          ? { amount: engine.sale.bracket.amount, currency: engine.currencyCode }
          : null,
        displayMode: engine.displayMode,
      });
    }
    return out;
  }

  /** Feature 160 — the listing entry points on price books: one batch at quantity 1, variants ranged. */
  async #bookListing(input: ListingPricesInput): Promise<Map<string, ListingAnswer>> {
    const requested = new Map<string, PricedProductRef>();
    for (const product of input.products) if (!requested.has(product.id)) requested.set(product.id, product);
    if (requested.size === 0) return new Map();
    const viewer = await this.#viewer(input.context);
    return this.bookPricing.resolveListing([...requested.values()], {
      organizationId: viewer.organization?.id ?? null,
      customerGroupId: viewer.customerGroupId,
      signedIn: viewer.organization !== null,
      salesChannelId: viewer.salesChannel.id,
      currencyCode: viewer.currencyCode,
    });
  }

  /** The two listing entry points' shared body: one batched resolution at quantity 1. */
  async #listingEngines(
    input: ListingPricesInput,
  ): Promise<Map<string, { price: ListingPrice; engine: PricingEngineResult }>> {
    const out = new Map<string, { price: ListingPrice; engine: PricingEngineResult }>();
    if (input.products.length === 0) return out;
    const viewer = await this.#viewer(input.context);

    // A page may name the same product twice; the answer is the same, and the
    // loop it replaces resolved it twice.
    const requested = new Map<string, PricedProductRef>();
    for (const product of input.products) {
      if (!requested.has(product.id)) requested.set(product.id, product);
    }
    const engines = await this.#resolveEngineSet(
      [...requested.values()].map((product) => ({ key: product.id, product, quantity: 1 })),
      viewer,
    );
    for (const product of requested.values()) {
      const engine = engines.get(product.id)!;
      out.set(product.id, {
        engine,
        price: listingPriceFrom(
          lineFromEngine(engine),
          product,
          viewer.currencyCode,
          viewer.salesChannel.defaultCurrency,
        ),
      });
    }
    return out;
  }

  /**
   * D-287 P0 — {@link resolveLinePrice} for many lines, each at its own
   * quantity, for one buyer. The cart read, the placement drift check, a
   * quote's reference prices and the external catalogue API each looped the
   * single call — about seven statements per line, sequentially
   * (`specs/pricing/read-paths-and-performance.md` §2.3, §5). This is the same
   * walk {@link resolveListingPrices} batches, with the quantity per line.
   *
   * `resolveEngine` / `resolveLinePrice` stay the reference path:
   * `test/integration/price_lists/line-prices-batch.test.ts` asserts, key by
   * key, that this answers exactly what one `resolveLinePrice` per line does.
   */
  async resolveLinePrices(input: LinePricesInput): Promise<Map<string, PricingLineResult | null>> {
    const out = new Map<string, PricingLineResult | null>();
    if (input.lines.length === 0) return out;
    if (this.usesPriceBooks) {
      for (const [key, answer] of await this.#bookAnswers(input.lines, input.context)) out.set(key, lineFromBook(answer));
      return out;
    }
    const viewer = await this.#viewer(input.context);
    for (const [key, engine] of await this.#resolveEngineSet(input.lines, viewer)) {
      out.set(key, lineFromEngine(engine));
    }
    return out;
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
   * The engine result for every line, keyed by the line's key — the batched
   * body behind {@link resolveListingPrices}, {@link resolveListingPriceDetails}
   * and {@link resolveLinePrices}.
   *
   * ## Why this is a batch and not a loop
   *
   * The per-product loop it replaced was **7 queries per product,
   * sequentially**: a 50-item catalogue page cost 350 round trips and 315 ms of
   * resolution on a warm local Postgres. Six of those seven asked a question
   * whose answer does not vary across the set (the active price lists, the
   * settings pair, the organization's override) or asked it one id at a time
   * (the category memberships, the brackets, the product-scope overrides).
   *
   * So the set is resolved once and applied per line: the memberships in one
   * `in (…)`, the active lists once, the organization's inheritance chain once,
   * the brackets in **priority waves** (one query per fall-through level the
   * set actually needs, not per line), and the display-mode chain through
   * `resolveDisplayModes`, reusing the memberships already read.
   *
   * ## What is *not* batched, and why
   *
   * The application-rule evaluation and the priority walk stay per product, and
   * they have to: `evaluateApplicationRule` reads the product's own category
   * memberships, so a category rule matches some products and not others, and
   * the winning list therefore differs per product. The bracket pick stays per
   * (product, quantity): a quantity tier is the line's own. Both are pure
   * in-memory functions over rows already loaded — the same
   * `evaluateApplicationRule` / `pickPriorityChain` / `resolveListCandidate`
   * helpers `resolveEngine` composes — so the per-line part costs no I/O.
   *
   * ## The cache
   *
   * Keyed and populated exactly as `resolveEngine` keys it, per
   * (product, variant, quantity), so a set whose lines are already cached
   * issues no query at all, and identical lines in one set are resolved once.
   */
  async #resolveEngineSet(
    lines: readonly PricingLineRequest[],
    viewer: ResolvedViewer,
  ): Promise<Map<string, PricingEngineResult>> {
    const out = new Map<string, PricingEngineResult>();
    if (lines.length === 0) return out;
    const { organization, customerGroupId, salesChannel, currencyCode } = viewer;
    const cacheKeyFor = (line: PricingLineRequest): PricingCacheKey => ({
      productId: line.product.id,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
      currencyCode,
      salesChannelId: salesChannel.id,
      organizationId: organization?.id ?? null,
      customerGroupId,
    });

    // Read before the first statement: an answer that straddles an
    // invalidation is returned but not stored (D-287 P0).
    const generation = this.cache?.generation;

    // One walk item per distinct (product, variant, quantity); several lines
    // may share it.
    const items = new Map<string, { line: PricingLineRequest; keys: string[] }>();
    for (const line of lines) {
      const id = `${line.product.id}|${line.variantId ?? ''}|${line.quantity}`;
      const item = items.get(id);
      if (item) item.keys.push(line.key);
      else items.set(id, { line, keys: [line.key] });
    }
    const pending = new Map<string, PricingLineRequest>();
    for (const [id, { line, keys }] of items) {
      const cached = this.cache?.get(cacheKeyFor(line));
      if (cached) for (const key of keys) out.set(key, cached);
      else pending.set(id, line);
    }
    if (pending.size === 0) return out;

    const em = this.emFactory();
    const productsById = new Map<string, PricedProductRef>();
    for (const line of pending.values()) {
      if (!productsById.has(line.product.id)) productsById.set(line.product.id, line.product);
    }
    const productIds = [...productsById.keys()];
    const categoryIdsByProduct = await this.#categoryMemberships(productIds);
    const orgId = organization?.id ?? null;
    // Feature 056 — one chain for the set: it depends on the acting org, which
    // the context fixes for every line.
    const organizationChain =
      orgId !== null && this.resolveOrgChain
        ? await this.resolveOrgChain(orgId)
        : orgId !== null
          ? [orgId]
          : [];
    const activeLists = (await em.find(PriceList, { status: 'active' })).filter(isOldModelList);

    // Rule evaluation depends on the product, not the quantity: once per product.
    const baseByProduct = new Map<string, MatchedList[]>();
    const saleByProduct = new Map<string, MatchedList[]>();
    for (const productId of productIds) {
      const ctx: ResolutionContext = {
        organizationId: orgId,
        organizationChain,
        customerGroupId,
        salesChannelId: salesChannel.id,
        currencyCode,
        productCategoryIds: categoryIdsByProduct.get(productId) ?? new Set<string>(),
      };
      const base: MatchedList[] = [];
      const sale: MatchedList[] = [];
      for (const list of activeLists) {
        const evaluation = evaluateApplicationRule(list.applicationRule, ctx);
        if (!evaluation.matched) continue;
        const candidate: PriceListCandidate<PriceList> = {
          list,
          evaluation,
          modifiedAt: list.modifiedAt,
          name: list.name,
          isSystem: list.isSystem,
        };
        if (list.type === 'sale') sale.push({ list, candidate });
        else base.push({ list, candidate });
      }
      baseByProduct.set(productId, base);
      saleByProduct.set(productId, sale);
    }

    // Feature 148 — one matrix read for the set, shared by both partitions.
    const matchedLists = new Map<string, PriceList>();
    for (const matches of [...baseByProduct.values(), ...saleByProduct.values()]) {
      for (const m of matches) matchedLists.set(m.list.id, m.list);
    }
    const matrix = await this.#matrixContext(
      em,
      [...matchedLists.values()],
      new Map(
        [...productsById.values()].map((p) => [
          p.id,
          {
            categoryIds: categoryIdsByProduct.get(p.id) ?? new Set<string>(),
            attributeValues: p.attributeValues ?? {},
          },
        ]),
      ),
      organizationChain,
    );

    const walk = (byProduct: Map<string, MatchedList[]>): Map<string, WalkItem> =>
      new Map(
        [...pending].map(([id, line]) => [
          id,
          {
            productId: line.product.id,
            quantity: line.quantity,
            matches: byProduct.get(line.product.id) ?? [],
          },
        ]),
      );
    const baseResults = await this.pickAndResolveBracketsForSet(em, walk(baseByProduct), currencyCode, matrix);
    const saleResults = await this.pickAndResolveBracketsForSet(em, walk(saleByProduct), currencyCode, matrix);

    // Same lazy construction as `resolveEngine`, for the same reason: it keeps
    // `PriceListService` out of this class's constructor signature.
    const { PriceListService } = await import('./price-list-service.js');
    const priceListService = new PriceListService(
      this.emFactory,
      undefined,
      undefined,
      undefined,
      this.targetReads,
    );
    const displayModes = await priceListService.resolveDisplayModes({
      productIds,
      organizationId: orgId,
      salesChannelId: salesChannel.id,
      customerKind: organization ? 'signed_in' : 'guest',
      categoryIdsByProduct,
    });

    for (const [id, line] of pending) {
      const base = baseResults.get(id) ?? { list: null, bracket: null };
      const sale = saleResults.get(id) ?? { list: null, bracket: null };
      const engine: PricingEngineResult = {
        base: {
          listId: base.list?.id ?? '',
          listName: base.list?.name ?? '',
          bracket: base.bracket,
        },
        sale:
          sale.list && sale.bracket
            ? { listId: sale.list.id, listName: sale.list.name, bracket: sale.bracket }
            : null,
        displayMode: displayModes.get(line.product.id) ?? 'gross_only',
        currencyCode,
      };
      this.cache?.set(cacheKeyFor(line), engine, generation);
      for (const key of items.get(id)!.keys) out.set(key, engine);
    }
    return out;
  }


  // ---- Feature 086 — the listing ordering slice ----------------------------

  /**
   * The catalogue in resolved-unit-price order, for one viewer, one chunk at a
   * time — {@link ListingPriceOrderPort}.
   *
   * ## Identity with the card, which is the whole point
   *
   * The rows this answers are the rows `resolveListingPrices` would answer for
   * the same viewer, sorted. Not "approximately": the candidates come from
   * {@link buildCandidateVector}, which produces its order by running
   * `pickPriorityChain` to exhaustion, and the sale partition leads the base one
   * because `lineFromEngine` charges the sale price whenever the sale partition
   * resolves anything. `test/integration/price_lists/unit-price-ordering.test.ts`
   * asserts it product by product against the batch, the way
   * `listing-prices-batch.test.ts` asserts the batch against the per-product
   * path.
   *
   * ## What it does not know
   *
   * Visibility, channel membership, product status, archival, categories the
   * *buyer* filtered by. Those are `catalog`'s facts about `catalog`'s rows, and
   * a chunk from here may name products the viewer must never see — the caller
   * intersects before anything reaches a page, a cursor or a count.
   *
   * ## Two statements, whatever the page size
   *
   * One probe of the leading stream, which fixes the watermark, and one merge of
   * the rest. A single-candidate viewer costs one. The leading stream's rows are
   * reused rather than re-read.
   */
  async orderByUnitPrice(input: ListingPriceOrderQuery): Promise<ListingPriceOrderChunk> {
    if (this.usesPriceBooks) {
      // Feature 160 — served from the price surface (`price-surface.ts`).
      return this.priceSurface.orderByUnitPrice(input, await this.#bookViewer(input.context));
    }
    const empty: ListingPriceOrderChunk = { rows: [], exhausted: true, sourceRowsRead: 0 };
    if (input.limit <= 0) return { rows: [], exhausted: false, sourceRowsRead: 0 };
    // An empty restriction means "nothing", which is a different answer from
    // `undefined` meaning "the whole catalogue".
    if (input.restrictToProductIds !== undefined && input.restrictToProductIds.length === 0) {
      return empty;
    }

    const em = this.emFactory();
    const currencyCode = this.#listingCurrency(input.context);
    const streams = await this.#candidateStreams(em, input.context, currencyCode, input.restrictToProductIds);
    if (streams.length === 0) return empty;

    const limit = input.limit;
    const direction = input.direction;
    const after = input.after;
    const range = input.amountRange;

    // Pass 1 — the leading stream alone. It carries no exclusion (nothing
    // outranks it), so its window is exactly the cheapest `limit` rows any
    // candidate can contribute below the watermark it defines.
    const lead = buildUnitPriceMergeQuery({
      streams: [streams[0]!],
      currencyCode,
      direction,
      after: after ?? null,
      ...(range ? { amountRange: range } : {}),
      perStreamLimit: limit,
      watermark: null,
    });
    const leadRows = await em.execute<Array<{ product_id: string; amount: string; stream_index: number }>>(
      lead.sql,
      lead.params,
    );
    let sourceRowsRead = leadRows.length;

    // The bound, and the one line that makes it exact: the leading stream has
    // no exclusion, so a full window of `limit` rows at or below this amount
    // means every row above it sorts after all of them and cannot be on this
    // page. A short window is no bound at all.
    const watermark = leadRows.length >= limit ? leadRows[leadRows.length - 1]!.amount : null;

    const merged = leadRows.map((row) => ({
      productId: row.product_id,
      amount: row.amount,
      streamIndex: 0,
    }));

    let everyOtherStreamShort = true;
    if (streams.length > 1) {
      const rest = buildUnitPriceMergeQuery({
        streams,
        currencyCode,
        direction,
        after: after ?? null,
        ...(range ? { amountRange: range } : {}),
        perStreamLimit: limit,
        watermark,
        skipStreams: 1,
      });
      const restRows = await em.execute<
        Array<{ product_id: string; amount: string; stream_index: number }>
      >(rest.sql, rest.params);
      sourceRowsRead += restRows.length;
      const perStream = new Map<number, number>();
      for (const row of restRows) {
        perStream.set(row.stream_index, (perStream.get(row.stream_index) ?? 0) + 1);
        merged.push({
          productId: row.product_id,
          amount: row.amount,
          streamIndex: Number(row.stream_index),
        });
      }
      for (const count of perStream.values()) if (count >= limit) everyOtherStreamShort = false;
    }

    merged.sort((a, b) => compareOrderRows(a, b, direction));
    const page = merged.slice(0, limit);
    const rows: ListingPriceOrderRow[] = page.map((row) => ({
      productId: row.productId,
      amount: row.amount,
      currency: currencyCode,
      priceListId: streams[row.streamIndex]!.priceListId,
      isSale: streams[row.streamIndex]!.isSale,
    }));

    // `exhausted` is not "a short chunk". It is "there is provably nothing
    // left": no watermark cut anything off, no stream filled its own window,
    // and the merge fitted inside the page.
    const exhausted = watermark === null && everyOtherStreamShort && merged.length <= limit;
    return { rows, exhausted, sourceRowsRead };
  }

  /**
   * Which of `productIds` the viewer's candidate lists price at quantity 1.
   *
   * `catalog` composes the unpriced tail out of the complement, so this is a set
   * membership answer and deliberately not a price: it says nothing about which
   * list won or what it charges.
   */
  async pricedProductIds(input: {
    context: ListingPriceViewerContext;
    productIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    const out = new Set<string>();
    if (input.productIds.length === 0) return out;
    if (this.usesPriceBooks) {
      return this.priceSurface.pricedProductIds(input.productIds, await this.#bookViewer(input.context));
    }
    const em = this.emFactory();
    const currencyCode = this.#listingCurrency(input.context);
    const streams = await this.#candidateStreams(em, input.context, currencyCode, input.productIds);
    if (streams.length === 0) return out;

    // Feature 148 — a stream carrying matrix entries prices products its
    // brackets do not name; the one-statement predicate form answers for
    // every stream at once. Without one, the statement below is unchanged.
    if (streams.some((stream) => stream.matrix)) {
      const built = buildPricedProductIdsQuery({ streams, currencyCode, productIds: input.productIds });
      for (const row of await em.execute<Array<{ product_id: string }>>(built.sql, built.params)) {
        out.add(row.product_id);
      }
      return out;
    }

    const params: unknown[] = [currencyCode, uuidArrayLiteral([...new Set(input.productIds)])];
    const perStream = streams.map((stream) => {
      if (stream.productIds === null) {
        params.push(stream.priceListId);
        return `b."price_list_id" = ?`;
      }
      params.push(stream.priceListId, uuidArrayLiteral(stream.productIds));
      return `(b."price_list_id" = ? and b."product_id" = any(?::uuid[]))`;
    });
    const rows = await em.execute<Array<{ product_id: string }>>(
      `select distinct b."product_id"::text as product_id
         from "price_list_price_brackets" b
        where b."currency_code" = ?
          and b."min_quantity" = 1
          and b."product_id" = any(?::uuid[])
          and (${perStream.join(' or ')})`,
      params,
    );
    for (const row of rows) out.add(row.product_id);
    return out;
  }

  /**
   * The display mode a *page* resolves to for this viewer — feature 086 /
   * FR-016. See `PriceListService.resolvePageDisplayMode` for why the
   * per-product and per-category steps are absent.
   */
  async pageDisplayMode(input: { context: ListingPriceViewerContext }): Promise<DisplayMode> {
    const { PriceListService } = await import('./price-list-service.js');
    const priceListService = new PriceListService(
      this.emFactory,
      undefined,
      undefined,
      undefined,
      this.targetReads,
    );
    return priceListService.resolvePageDisplayMode({
      organizationId: input.context.organization?.id ?? null,
      salesChannelId: input.context.salesChannel.id,
      customerKind: input.context.organization ? 'signed_in' : 'guest',
    });
  }

  #listingCurrency(context: ListingPriceViewerContext): string {
    return (context.currencyCode ?? context.salesChannel.defaultCurrency).toUpperCase();
  }

  /**
   * The viewer's candidate vector, resolved to streams: a price list, and the
   * product ids the stream is restricted to.
   *
   * Two things restrict a stream, and they are intersected rather than chosen
   * between: the caller's opaque id set, and the categories a candidate's own
   * rule requires. The second is read through `catalog`'s category port — this
   * module names `product_categories` in no statement of its own, and could not
   * express the membership as a join into the merge anyway without putting
   * another module's table in this module's SQL (D-87).
   */
  async #candidateStreams(
    em: EntityManager,
    context: ListingPriceViewerContext,
    currencyCode: string,
    restrictToProductIds: readonly string[] | undefined,
  ): Promise<UnitPriceStream[]> {
    const organization = context.organization ?? null;
    const orgId = organization?.id ?? null;
    const organizationChain =
      orgId !== null && this.resolveOrgChain
        ? await this.resolveOrgChain(orgId)
        : orgId !== null
          ? [orgId]
          : [];
    const viewer: CandidateViewerContext = {
      organizationId: orgId,
      organizationChain,
      // D-287 P0 — the card's rule, so the ordering and the card agree for a
      // customer whose own group overrides the organisation's.
      customerGroupId: await this.#customerGroupFor(context),
      salesChannelId: context.salesChannel.id,
      currencyCode,
    };
    const activeLists = (await em.find(PriceList, { status: 'active' })).filter(isOldModelList);
    const candidates = buildCandidateVector(
      activeLists.map((list) => ({
        id: list.id,
        type: list.type,
        applicationRule: list.applicationRule,
        modifiedAt: list.modifiedAt,
        name: list.name,
        isSystem: list.isSystem,
      })),
      viewer,
    );

    const restriction = restrictToProductIds ? new Set(restrictToProductIds) : null;
    const categoryProducts = await this.#categoryProductIds(candidates);

    const streams: UnitPriceStream[] = [];
    for (const candidate of candidates) {
      let ids: Set<string> | null = restriction;
      for (const group of candidate.requireAnyOf) {
        const inGroup = new Set<string>();
        for (const categoryId of group) {
          for (const productId of categoryProducts.get(categoryId) ?? []) inGroup.add(productId);
        }
        ids = ids === null ? inGroup : new Set([...ids].filter((id) => inGroup.has(id)));
      }
      // A candidate whose categories hold nothing prices nothing: dropping it
      // is not an optimisation, it is the empty stream written down.
      if (ids !== null && ids.size === 0) continue;
      streams.push({
        priceListId: candidate.priceListId,
        isSale: candidate.isSale,
        productIds: ids === null ? null : [...ids],
      });
    }
    const withMatrix = new Set(activeLists.filter((l) => l.hasMatrixEntries).map((l) => l.id));
    await this.#attachMatrix(
      em,
      streams.filter((s) => withMatrix.has(s.priceListId)),
      organizationChain,
      currencyCode,
      categoryProducts,
    );
    return streams;
  }

  /**
   * Feature 148, owner decision Q1 — the price matrix in the price-ordered
   * listing. The candidate lists' entries the viewer meets at quantity 1 are
   * read in **one** statement (a window starting at 1, an organization in the
   * chain or none, a percentage or a fixed price in the listing currency);
   * attribute entries whose attribute is not eligible drop out, exactly as the
   * resolver ignores them; each remaining selection is resolved to product ids
   * through `catalog`'s ports — the categories this method already reads, an
   * attribute value through `listProductIdsByAttributeValue` — and a stream
   * whose list carries any becomes a matrix stream. Only streams whose list
   * carries an entry at all (`hasMatrixEntries`, read with the lists) are
   * passed in, so a viewer whose lists carry none pays nothing.
   */
  async #attachMatrix(
    em: EntityManager,
    streams: UnitPriceStream[],
    organizationChain: readonly string[],
    currencyCode: string,
    categoryProducts: Map<string, string[]>,
  ): Promise<void> {
    if (streams.length === 0) return;
    const listIds = [...new Set(streams.map((s) => s.priceListId))];
    const rows = (
      await em.find(PriceListMatrixEntry, {
        priceListId: { $in: listIds },
        minQuantity: 1,
        priceType: { $in: ['fixed', 'discount_percent'] },
        $and: [
          organizationChain.length > 0
            ? { $or: [{ organizationId: null }, { organizationId: { $in: [...organizationChain] } }] }
            : { organizationId: null },
          { $or: [{ currencyCode: null }, { currencyCode }] },
        ],
      })
    ).map(matrixEntryRow);
    if (rows.length === 0) return;

    let eligible: ReadonlyMap<string, EligibleAttribute> = new Map();
    if (rows.some((r) => r.attributeKey !== null)) {
      eligible = buildEligibleAttributes(await this.#attributeRead().listByFlag('isPriceRule'));
    }
    const categoryRead = rows.some((r) => r.categoryId !== null) ? this.#categoryRead() : null;
    const attributeIds = new Map<string, string[]>();
    const entriesByList = new Map<string, UnitPriceMatrixEntry[]>();
    for (const row of rows) {
      let ids: Set<string> | null = null;
      if (row.productId !== null) ids = new Set([row.productId]);
      if (row.categoryId !== null) {
        let inCategory = categoryProducts.get(row.categoryId);
        if (!inCategory) {
          inCategory = await categoryRead!.listProductIdsInCategory(row.categoryId);
          categoryProducts.set(row.categoryId, inCategory);
        }
        ids = new Set(inCategory);
      }
      if (row.attributeKey !== null) {
        const attribute = eligible.get(row.attributeKey);
        if (!attribute || row.attributeValue === null) continue;
        const memo = `${row.attributeKey}\u0000${row.attributeValue}`;
        let withValue = attributeIds.get(memo);
        if (!withValue) {
          withValue = await this.#productRead().listProductIdsByAttributeValue({
            key: row.attributeKey,
            value: row.attributeValue,
            match:
              attribute.valueType === 'multiselect'
                ? 'array'
                : attribute.valueType === 'boolean'
                  ? 'boolean'
                  : 'scalar',
          });
          attributeIds.set(memo, withValue);
        }
        ids = ids === null ? new Set(withValue) : new Set(withValue.filter((id) => ids!.has(id)));
      }
      const chainRank = row.organizationId === null ? -1 : organizationChain.indexOf(row.organizationId);
      const entry: UnitPriceMatrixEntry = {
        id: row.id,
        orgRank: row.organizationId === null ? OWN_BRACKET_RANK : chainRank,
        specificity: matrixEntrySpecificity(row),
        productIds: ids === null ? null : [...ids],
        priceType: row.priceType,
        amount: row.amount,
        discountPercent: row.discountPercent,
      };
      if (entry.productIds !== null && entry.productIds.length === 0) continue;
      const list = entriesByList.get(row.priceListId);
      if (list) list.push(entry);
      else entriesByList.set(row.priceListId, [entry]);
    }
    for (const stream of streams) {
      const entries = entriesByList.get(stream.priceListId);
      if (entries && entries.length > 0) {
        stream.matrix = { defaultListId: DEFAULT_PRICE_LIST_ID, entries };
      }
    }
  }

  /** `catalog`'s product read port, or the same refusal `#categoryRead` makes. */
  #productRead(): CatalogProductReadPort {
    const productRead = this.targetReads?.catalogProductRead;
    if (!productRead) {
      throw new Error(
        'PricingService: this ordering asks `catalog` which products an attribute value selects, and ' +
          "this composition constructed the engine without `catalog`'s product read port.",
      );
    }
    return productRead;
  }

  /**
   * Product ids per category id, for every category any candidate's rule names.
   *
   * Read through `catalog`'s port, structurally — `listProductIdsInCategory`
   * filters neither `isActive` nor `deletedAt`, and neither does
   * `evaluateApplicationRule`'s `category` criterion, which tests the raw
   * membership. The two have to agree, so the read that agrees is the one to
   * make.
   *
   * Nothing is read at all in the ordinary case: a rule that names no category
   * produces no group, and the reference catalogue's rules name none.
   */
  async #categoryProductIds(
    candidates: readonly OrderedCandidate[],
  ): Promise<Map<string, string[]>> {
    const wanted = new Set<string>();
    for (const candidate of candidates) {
      for (const group of candidate.requireAnyOf) for (const id of group) wanted.add(id);
    }
    const out = new Map<string, string[]>();
    if (wanted.size === 0) return out;
    // Refuses when nothing was wired — see `#categoryRead`. Skipping the
    // membership would make this category rule apply to everything, which
    // prices the products it excludes.
    const categoryRead = this.#categoryRead();
    for (const categoryId of wanted) {
      out.set(categoryId, await categoryRead.listProductIdsInCategory(categoryId));
    }
    return out;
  }

  /**
   * Issue #132 — the lowest-quantity bracket amount on one named price list.
   *
   * `product_feeds` used to run this `select` itself, which put another
   * module's table in its SQL and let a feed publish prices while this module
   * was refusing to serve them. The read is the same; owning it here is what
   * makes the port gate apply.
   */
  async namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
    /** Feature 160 — the feed's channel, whose catalogue price the book's rows are taken off. */
    salesChannelId?: string;
  }): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (input.productIds.length === 0) return out;
    if (this.usesPriceBooks) {
      // Feature 160 (FR-029) — the book's rows over the channel's catalogue price.
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
    const em = this.emFactory();
    const placeholders = input.productIds.map(() => '?').join(',');
    const rows = await em.getConnection().execute<Array<{ product_id: string; amount: string }>>(
      `select distinct on ("product_id") "product_id", "amount"
         from "price_list_price_brackets"
        where "price_list_id" = ? and "currency_code" = ?
          and "product_id" in (${placeholders})
        order by "product_id" asc, "min_quantity" asc`,
      [input.priceListId, input.currencyCode.toUpperCase(), ...input.productIds],
      'all',
      em.getTransactionContext(),
    );
    for (const row of rows) out.set(row.product_id, row.amount);
    return out;
  }

  /**
   * Feature 062 — distinct bracket start quantities (ascending) across every
   * ACTIVE list for a (product, currency). Consumers probe `resolveLinePrice`
   * at each quantity to derive the acting org's effective tier ladder; a
   * quantity contributed by a non-matching list simply resolves to the same
   * amount as its predecessor and is de-duplicated by the caller — no
   * cross-org data leaks through this read.
   */
  async listTierStarts(productId: string, currencyCode: string, variantId?: string | null): Promise<number[]> {
    const em = this.emFactory();
    if (this.usesPriceBooks) {
      // Feature 160 — the starts of the rows that can price this product (or
      // this variant) in this currency: its own and its variants' rows, and the
      // selection-wide ones, on the base books and on every book that applies
      // now. Over-inclusion is this method's contract (a start no row of the
      // buyer's applies at resolves to its predecessor's price), so neither
      // the channel nor the audience is narrowed. One statement.
      const rows = await em.execute<Array<{ min_quantity: number | string }>>(
        `select e."min_quantity"
           from "price_list_matrix_entries" e
           join "price_lists" l on l."id" = e."price_list_id"
          where l."currency_code" = ?
            and e."price_type" in ('fixed', 'percent', 'amount')
            and (e."product_id" is null or e."product_id" = ?)
            and (e."variant_id" is null or e."variant_id" = ?)
            and (l."is_system" = true
                 or (l."application_rule" is null
                     and l."status" in ('active', 'scheduled')
                     and (l."starts_at" is null or l."starts_at" <= now())
                     and (l."ends_at" is null or l."ends_at" > now())))
         union
         -- Transition: the old Default list's brackets are base tiers until
         -- the conversion migration copies them into the base books.
         select b."min_quantity"
           from "price_list_price_brackets" b
          where b."price_list_id" = '00000000-0000-4000-8000-00000000d51b'
            and b."currency_code" = ? and b."product_id" = ?
          order by "min_quantity" asc`,
        [currencyCode.toUpperCase(), productId, variantId ?? null, currencyCode.toUpperCase(), productId],
      );
      return [...new Set(rows.map((r) => Number(r.min_quantity)))].sort((a, b) => a - b);
    }
    // Feature 148 / FR-018 — the union with the starting quantities of matrix
    // entries that could price this product in this currency on an active
    // list: product-less or this product, a percentage or a fixed price in this
    // currency. Over-inclusion is this method's contract (an entry of another
    // organization adds a probe, never a price), so neither the organization
    // nor the selection is narrowed here.
    const rows = await em.execute<Array<{ min_quantity: number | string }>>(
      `select b.min_quantity
         from price_list_price_brackets b
         join price_lists l on l.id = b.price_list_id
        where b.product_id = ? and b.currency_code = ? and l.status = 'active'
       union
       select e.min_quantity
         from price_list_matrix_entries e
         join price_lists l on l.id = e.price_list_id
        where (e.product_id is null or e.product_id = ?)
          and (e.currency_code is null or e.currency_code = ?)
          and l.status = 'active'
        order by min_quantity asc`,
      [productId, currencyCode.toUpperCase(), productId, currencyCode.toUpperCase()],
    );
    return rows.map((r) => Number(r.min_quantity));
  }


  /**
   * Walks the priority chain until a list yields a bracket for the
   * requested (product, currency, quantity). Excluded candidates are
   * ones that already failed the bracket lookup. Returns the first
   * list+bracket pair, or {list: null, bracket: null} if every match
   * has no usable bracket.
   */
  /**
   * `pickAndResolveBracket` for a whole set, in **priority waves**.
   *
   * Each wave picks the top-priority remaining list per item — a (product,
   * quantity) — with the same `pickPriorityChain` call the single-product walk
   * makes, and reads the brackets for that wave's (list, product) pairs in one
   * query. An item whose picked list has no usable bracket at its quantity
   * drops that list and enters the next wave, exactly as FR-031's fall-through
   * does; an item with no candidate left answers `{ list: null, bracket: null }`,
   * exactly as the single walk's exhausted `remaining` does.
   *
   * The number of queries is therefore the number of fall-through levels the
   * page actually needs — one, normally — instead of one per product, and the
   * rows fetched are the ones the per-product walk would have fetched rather
   * than every matched list's brackets.
   */
  private async pickAndResolveBracketsForSet(
    em: EntityManager,
    itemsById: ReadonlyMap<string, WalkItem>,
    currencyCode: string,
    matrix: MatrixContext,
  ): Promise<Map<string, { list: PriceList | null; bracket: PriceBracketRow | null }>> {
    const out = new Map<string, { list: PriceList | null; bracket: PriceBracketRow | null }>();
    const remaining = new Map<string, WalkItem>();
    for (const [id, item] of itemsById) {
      if (item.matches.length === 0) out.set(id, { list: null, bracket: null });
      else remaining.set(id, { ...item, matches: [...item.matches] });
    }

    while (remaining.size > 0) {
      const picks = new Map<string, PriceList>();
      for (const [id, item] of [...remaining]) {
        const picked = pickPriorityChain(item.matches.map((m) => m.candidate));
        if (!picked) {
          out.set(id, { list: null, bracket: null });
          remaining.delete(id);
          continue;
        }
        picks.set(id, picked.list);
      }
      if (picks.size === 0) break;

      const listIds = [...new Set([...picks.values()].map((list) => list.id))];
      const productIds = [...new Set([...picks.keys()].map((id) => remaining.get(id)!.productId))];
      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: { $in: listIds },
        productId: { $in: productIds },
      });
      const rowsByPair = new Map<string, PriceBracketRow[]>();
      for (const b of brackets) {
        const key = `${b.priceListId}|${b.productId}`;
        const rows = rowsByPair.get(key);
        const row = bracketRow(b);
        if (rows) rows.push(row);
        else rowsByPair.set(key, [row]);
      }

      // Feature 148 — the list's own bracket and its matrix entries compete
      // (`resolveListCandidate`). An item whose best candidate is a percentage
      // with no own-list reference is collected, the Default list's brackets
      // are read for all of them in one statement, and they are answered again
      // — never one read per item.
      const answers = new Map<string, ReturnType<typeof resolveListCandidate>>();
      const needReference: string[] = [];
      const answer = (id: string, list: PriceList) => {
        const item = remaining.get(id)!;
        return this.#candidateFor(
          matrix,
          list,
          item.productId,
          rowsByPair.get(`${list.id}|${item.productId}`) ?? [],
          currencyCode,
          item.quantity,
        );
      };
      for (const [id, list] of picks) {
        const result = answer(id, list);
        if (result.kind === 'needs_reference') needReference.push(id);
        else answers.set(id, result);
      }
      if (needReference.length > 0) {
        await this.#loadDefaultBrackets(
          em,
          matrix,
          [...new Set(needReference.map((id) => remaining.get(id)!.productId))],
        );
        for (const id of needReference) answers.set(id, answer(id, picks.get(id)!));
      }

      for (const [id, list] of picks) {
        const result = answers.get(id);
        const bracket = result?.kind === 'price' ? result.row : null;
        if (bracket) {
          out.set(id, { list, bracket });
          remaining.delete(id);
          continue;
        }
        const item = remaining.get(id);
        if (!item) continue;
        const idx = item.matches.findIndex((m) => m.list.id === list.id);
        if (idx >= 0) item.matches.splice(idx, 1);
        if (item.matches.length === 0) {
          out.set(id, { list: null, bracket: null });
          remaining.delete(id);
        }
      }
    }
    return out;
  }

  private async pickAndResolveBracket(
    em: EntityManager,
    matches: Array<{ list: PriceList; candidate: PriceListCandidate<PriceList> }>,
    productId: string,
    currencyCode: string,
    quantity: number,
    matrix: MatrixContext,
  ): Promise<{ list: PriceList | null; bracket: PriceBracketRow | null }> {
    if (matches.length === 0) return { list: null, bracket: null };
    const remaining = [...matches];
    while (remaining.length > 0) {
      const picked = pickPriorityChain(remaining.map((m) => m.candidate));
      if (!picked) return { list: null, bracket: null };
      const list = picked.list;
      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: list.id,
        productId,
      });
      const rows: PriceBracketRow[] = brackets.map(bracketRow);
      // Feature 148 — the same `resolveListCandidate` the batched walk calls.
      let result = this.#candidateFor(matrix, list, productId, rows, currencyCode, quantity);
      if (result.kind === 'needs_reference') {
        await this.#loadDefaultBrackets(em, matrix, [productId]);
        result = this.#candidateFor(matrix, list, productId, rows, currencyCode, quantity);
      }
      if (result.kind === 'price') return { list, bracket: result.row };
      // Fall through: drop the picked list from `remaining` and retry.
      const idx = remaining.findIndex((m) => m.list.id === list.id);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    return { list: null, bracket: null };
  }
}

