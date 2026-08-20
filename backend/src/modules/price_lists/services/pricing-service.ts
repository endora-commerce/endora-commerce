import type { EntityManager } from '@mikro-orm/postgresql';
import type { DisplayMode, ListingPrice } from '@b2b/contracts';
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

