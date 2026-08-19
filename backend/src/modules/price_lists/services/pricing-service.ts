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
    interface MatchedList {
      list: PriceList;
      candidate: PriceListCandidate<PriceList>;
    }
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
    const out = await this.resolveEngine(input);
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

  /**
   * Issue #132 — the price a catalogue listing may render, per product.
   *
   * The chain is `listingPriceFrom`; this method is the loop that feeds it, so
   * the listing paths make one call and get an answer whose type states which
   * step of the chain produced it. Every requested product gets an entry.
   */
  async resolveListingPrices(input: ListingPricesInput): Promise<Map<string, ListingPrice>> {
    const currencyCode = (
      input.context.currencyCode ?? input.context.salesChannel.defaultCurrency
    ).toUpperCase();
    const out = new Map<string, ListingPrice>();
    for (const product of input.products) {
      const line = await this.resolveLinePrice({
        product,
        variantId: null,
        context: {
          quantity: 1,
          organization: input.context.organization ?? null,
          customerGroupId: input.context.customerGroupId ?? null,
          salesChannel: input.context.salesChannel,
          currencyCode,
        },
      });
      out.set(product.id, listingPriceFrom(line, product, currencyCode));
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

