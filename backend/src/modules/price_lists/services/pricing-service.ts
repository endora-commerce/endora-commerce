import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DisplayMode,
  ListingPrice,
  ListingPriceOrderChunk,
  ListingPriceOrderQuery,
  ListingPriceOrderRow,
  ListingPriceViewerContext,
} from '@b2b/contracts';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListPriceBracket } from '../entities/price-list-price-bracket.entity.js';
import {
  evaluateApplicationRule,
  type ResolutionContext,
} from './application-rule-evaluator.js';
import {
  pickPriorityChain,
  type PriceListCandidate,
} from './price-list-resolver.js';
import {
  resolvePriceBracket,
  type PriceBracketRow,
} from './price-bracket-resolver.js';
import { listingPriceFrom } from './listing-price-chain.js';
import {
  buildCandidateVector,
  type CandidateViewerContext,
  type OrderedCandidate,
} from './price-list-candidate-vector.js';
import {
  buildUnitPriceMergeQuery,
  compareOrderRows,
  uuidArrayLiteral,
  type UnitPriceStream,
} from './unit-price-ordering.js';
import type { PriceListTargetReads } from './price-list-service.js';
import type {
  ListingPricesInput,
  PricedProductRef,
  PricingEngineResult,
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
  };
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
  ) {}

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
    const em = this.emFactory();
    const { product, context } = input;
    const currencyCode = (context.currencyCode ?? context.salesChannel.defaultCurrency).toUpperCase();

    const cacheKey = {
      productId: product.id,
      variantId: input.variantId ?? null,
      quantity: context.quantity,
      currencyCode,
      salesChannelId: context.salesChannel.id,
      organizationId: context.organization?.id ?? null,
      customerGroupId: context.customerGroupId ?? context.organization?.customerGroupId ?? null,
    };
    const cached = this.cache?.get(cacheKey);
    if (cached) return cached;

    // Build the resolution context.
    const productCategoryRows = await em.execute<Array<{ category_id: string }>>(
      `select category_id from product_categories where product_id = ?`,
      [product.id],
    );
    const orgId = context.organization?.id ?? null;
    // Feature 056 — build the org inheritance chain (nearest-first). Flat when
    // no resolver is wired or the org is a root.
    const organizationChain =
      orgId !== null && this.resolveOrgChain ? await this.resolveOrgChain(orgId) : orgId !== null ? [orgId] : [];
    const ctx: ResolutionContext = {
      organizationId: orgId,
      organizationChain,
      customerGroupId: context.customerGroupId ?? context.organization?.customerGroupId ?? null,
      salesChannelId: context.salesChannel.id,
      currencyCode,
      productCategoryIds: new Set(productCategoryRows.map((r) => r.category_id)),
    };

    // Load every active list and evaluate.
    const activeLists = await em.find(PriceList, { status: 'active' });
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

    // For each partition: walk the priority chain, do bracket lookup, and
    // fall through if the picked list has no usable bracket (FR-031).
    const baseResult = await this.pickAndResolveBracket(
      em,
      baseMatches,
      product.id,
      currencyCode,
      context.quantity,
    );
    const saleResult = await this.pickAndResolveBracket(
      em,
      saleMatches,
      product.id,
      currencyCode,
      context.quantity,
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
    this.cache?.set(cacheKey, result);
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
    amount: string;
    currency: string;
    priceListId: string;
    isSale: boolean;
    bracketStartQuantity: number;
    displayMode: DisplayMode;
  } | null> {
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
    const currencyCode = (
      input.context.currencyCode ?? input.context.salesChannel.defaultCurrency
    ).toUpperCase();
    const out = new Map<string, ListingPrice>();
    if (input.products.length === 0) return out;

    const organization = input.context.organization ?? null;
    const customerGroupId =
      input.context.customerGroupId ?? organization?.customerGroupId ?? null;
    const salesChannel = input.context.salesChannel;
    const cacheKeyFor = (productId: string) => ({
      productId,
      variantId: null,
      quantity: 1,
      currencyCode,
      salesChannelId: salesChannel.id,
      organizationId: organization?.id ?? null,
      customerGroupId,
    });

    // A page may name the same product twice; the answer is the same, and the
    // loop it replaces resolved it twice.
    const requested = new Map<string, PricedProductRef>();
    for (const product of input.products) {
      if (!requested.has(product.id)) requested.set(product.id, product);
    }

    const pending: PricedProductRef[] = [];
    for (const product of requested.values()) {
      const cached = this.cache?.get(cacheKeyFor(product.id));
      if (cached) out.set(product.id, listingPriceFrom(lineFromEngine(cached), product, currencyCode));
      else pending.push(product);
    }
    if (pending.length === 0) return out;

    const em = this.emFactory();
    const productIds = pending.map((p) => p.id);
    const categoryIdsByProduct = await this.loadCategoryMemberships(em, productIds);
    const orgId = organization?.id ?? null;
    // Feature 056 — one chain for the page: it depends on the acting org, which
    // the listing context fixes for every product on it.
    const organizationChain =
      orgId !== null && this.resolveOrgChain
        ? await this.resolveOrgChain(orgId)
        : orgId !== null
          ? [orgId]
          : [];
    const activeLists = await em.find(PriceList, { status: 'active' });

    const baseMatches = new Map<string, MatchedList[]>();
    const saleMatches = new Map<string, MatchedList[]>();
    for (const product of pending) {
      const ctx: ResolutionContext = {
        organizationId: orgId,
        organizationChain,
        customerGroupId,
        salesChannelId: salesChannel.id,
        currencyCode,
        productCategoryIds: categoryIdsByProduct.get(product.id) ?? new Set<string>(),
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
      baseMatches.set(product.id, base);
      saleMatches.set(product.id, sale);
    }

    const baseResults = await this.pickAndResolveBracketsForSet(em, baseMatches, currencyCode, 1);
    const saleResults = await this.pickAndResolveBracketsForSet(em, saleMatches, currencyCode, 1);

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

    for (const product of pending) {
      const base = baseResults.get(product.id) ?? { list: null, bracket: null };
      const sale = saleResults.get(product.id) ?? { list: null, bracket: null };
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
        displayMode: displayModes.get(product.id) ?? 'gross_only',
        currencyCode,
      };
      this.cache?.set(cacheKeyFor(product.id), engine);
      out.set(product.id, listingPriceFrom(lineFromEngine(engine), product, currencyCode));
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
    const em = this.emFactory();
    const currencyCode = this.#listingCurrency(input.context);
    const streams = await this.#candidateStreams(em, input.context, currencyCode, input.productIds);
    if (streams.length === 0) return out;

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
   * module does not name `product_categories` in a new statement, and could not
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
      customerGroupId: context.customerGroupId ?? organization?.customerGroupId ?? null,
      salesChannelId: context.salesChannel.id,
      currencyCode,
    };
    const activeLists = await em.find(PriceList, { status: 'active' });
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
    return streams;
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
    const categoryRead = this.targetReads?.catalogCategoryRead;
    if (!categoryRead) {
      // The same refusal `PriceListService.targets()` makes, for the same
      // reason: skipping the membership would turn "this composition cannot
      // reach `catalog`" into "this category rule applies to everything", which
      // would price products the rule excludes.
      throw new Error(
        'PricingService: a candidate price list is scoped to a category and this composition ' +
          "constructed the engine without `catalog`'s category read port.",
      );
    }
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
  }): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (input.productIds.length === 0) return out;
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
  async listBracketMinQuantities(productId: string, currencyCode: string): Promise<number[]> {
    const em = this.emFactory();
    const rows = await em.execute<Array<{ min_quantity: number | string }>>(
      `select distinct b.min_quantity
         from price_list_price_brackets b
         join price_lists l on l.id = b.price_list_id
        where b.product_id = ? and b.currency_code = ? and l.status = 'active'
        order by b.min_quantity asc`,
      [productId, currencyCode.toUpperCase()],
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
   * `(product_id, category_id)` memberships for a set of products, every
   * requested product present — an uncategorised one answers an empty set
   * rather than a missing key, which is what `resolveEngine`'s single-product
   * read means by "no rows".
   */
  private async loadCategoryMemberships(
    em: EntityManager,
    productIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (const id of productIds) out.set(id, new Set<string>());
    if (productIds.length === 0) return out;
    const placeholders = productIds.map(() => '?').join(',');
    const rows = await em.execute<Array<{ product_id: string; category_id: string }>>(
      `select product_id, category_id from product_categories where product_id in (${placeholders})`,
      [...productIds],
    );
    for (const row of rows) out.get(row.product_id)?.add(row.category_id);
    return out;
  }

  /**
   * `pickAndResolveBracket` for a whole page, in **priority waves**.
   *
   * Each wave picks the top-priority remaining list per product — the same
   * `pickPriorityChain` call the single-product walk makes — and reads the
   * brackets for that wave's (list, product) pairs in one query. A product
   * whose picked list has no usable bracket drops that list and enters the next
   * wave, exactly as FR-031's fall-through does; a product with no candidate
   * left answers `{ list: null, bracket: null }`, exactly as the single walk's
   * exhausted `remaining` does.
   *
   * The number of queries is therefore the number of fall-through levels the
   * page actually needs — one, normally — instead of one per product, and the
   * rows fetched are the ones the per-product walk would have fetched rather
   * than every matched list's brackets.
   */
  private async pickAndResolveBracketsForSet(
    em: EntityManager,
    matchesByProduct: ReadonlyMap<string, MatchedList[]>,
    currencyCode: string,
    quantity: number,
  ): Promise<Map<string, { list: PriceList | null; bracket: PriceBracketRow | null }>> {
    const out = new Map<string, { list: PriceList | null; bracket: PriceBracketRow | null }>();
    const remaining = new Map<string, MatchedList[]>();
    for (const [productId, matches] of matchesByProduct) {
      if (matches.length === 0) out.set(productId, { list: null, bracket: null });
      else remaining.set(productId, [...matches]);
    }

    while (remaining.size > 0) {
      const picks = new Map<string, PriceList>();
      for (const [productId, matches] of [...remaining]) {
        const picked = pickPriorityChain(matches.map((m) => m.candidate));
        if (!picked) {
          out.set(productId, { list: null, bracket: null });
          remaining.delete(productId);
          continue;
        }
        picks.set(productId, picked.list);
      }
      if (picks.size === 0) break;

      const listIds = [...new Set([...picks.values()].map((list) => list.id))];
      const brackets = await em.find(PriceListPriceBracket, {
        priceListId: { $in: listIds },
        productId: { $in: [...picks.keys()] },
      });
      const rowsByPair = new Map<string, PriceBracketRow[]>();
      for (const b of brackets) {
        const key = `${b.priceListId}|${b.productId}`;
        const rows = rowsByPair.get(key);
        const row: PriceBracketRow = {
          priceListId: b.priceListId,
          productId: b.productId,
          currencyCode: b.currencyCode,
          minQuantity: b.minQuantity,
          maxQuantity: b.maxQuantity ?? null,
          amount: b.amount,
        };
        if (rows) rows.push(row);
        else rowsByPair.set(key, [row]);
      }

      for (const [productId, list] of picks) {
        const bracket = resolvePriceBracket(
          rowsByPair.get(`${list.id}|${productId}`) ?? [],
          currencyCode,
          quantity,
        );
        if (bracket) {
          out.set(productId, { list, bracket });
          remaining.delete(productId);
          continue;
        }
        const matches = remaining.get(productId);
        if (!matches) continue;
        const idx = matches.findIndex((m) => m.list.id === list.id);
        if (idx >= 0) matches.splice(idx, 1);
        if (matches.length === 0) {
          out.set(productId, { list: null, bracket: null });
          remaining.delete(productId);
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
      const rows: PriceBracketRow[] = brackets.map((b) => ({
        priceListId: b.priceListId,
        productId: b.productId,
        currencyCode: b.currencyCode,
        minQuantity: b.minQuantity,
        maxQuantity: b.maxQuantity ?? null,
        amount: b.amount,
      }));
      const bracket = resolvePriceBracket(rows, currencyCode, quantity);
      if (bracket) return { list, bracket };
      // Fall through: drop the picked list from `remaining` and retry.
      const idx = remaining.findIndex((m) => m.list.id === list.id);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    return { list: null, bracket: null };
  }
}

