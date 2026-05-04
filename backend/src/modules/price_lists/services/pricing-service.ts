import type { EntityManager } from '@mikro-orm/postgresql';
import type { Money, ResolvedPrice, DisplayMode } from '@b2b/contracts';
import { Product } from '../../catalog/entities/product.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListItem } from '../entities/price-list-item.entity.js';
import { PriceListAssignment } from '../entities/price-list-assignment.entity.js';
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

/**
 * PricingService (T130 / FR-050).
 *
 * Resolves the effective unit price for a (product, variant?, quantity,
 * organization, salesChannel) tuple.
 *
 * Resolution algorithm:
 *
 *   1. Compute the **base price** from `product.attributeValues.defaultPrice`.
 *      This is the fall-back when no price list applies.
 *   2. Pick **applicable assignments**:
 *        - organization-specific (matches `organization.id`)
 *        - customer-group       (matches `organization.customerGroupId`)
 *        - default              (`isDefault=true`)
 *      Each assignment may further require a sales-channel match.
 *   3. For each applicable assignment's PriceList, look for the most-specific
 *      matching item:
 *        - **fixed_unit on the variant** beats fixed_unit on the product.
 *        - Within fixed_unit rows, the highest `minQuantity` ≤ requested
 *          `quantity` wins (volume tier).
 *        - **percentage_off / amount_off on a category** the product belongs
 *          to applies on top of the base price (additive across categories
 *          would over-discount; we take the most generous of any one
 *          adjustment).
 *   4. The resolver returns the lowest non-negative computed price across
 *      all candidate lists ("most favourable to the Customer", FR-050
 *      default tiebreaker). When no list matches, the base price wins.
 */

export interface PriceContext {
  /** Quantity the Customer is pricing (drives volume tiers). */
  quantity: number;
  /** Customer Organization (drives org + group lookups). Anonymous → undefined. */
  organization?: Organization | null;
  /** Active Sales Channel (further scopes assignment lookups). */
  salesChannel?: SalesChannel | null;
}

export class PricingService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: import('./pricing-cache.js').PricingCache<{
      base: { listId: string; listName: string; bracket: PriceBracketRow | null };
      sale: { listId: string; listName: string; bracket: PriceBracketRow } | null;
      displayMode: DisplayMode;
      currencyCode: string;
    }>,
  ) {}

  async resolvePrice(input: {
    product: Product;
    variantId?: string | null;
    context: PriceContext;
  }): Promise<ResolvedPrice> {
    const em = this.emFactory();
    const { product, context } = input;
    const variantId = input.variantId ?? null;

    const baseAmount = readBasePrice(product);
    const baseCurrency = context.salesChannel?.defaultCurrency ?? 'PLN';
    const basePrice: Money = { amount: baseAmount, currency: baseCurrency };

    // --- Step 2: gather applicable assignments ---------------------------
    const assignmentClauses: Array<Record<string, unknown>> = [{ isDefault: true }];
    if (context.organization?.id) {
      assignmentClauses.push({ organizationId: context.organization.id });
    }
    if (context.organization?.customerGroupId) {
      assignmentClauses.push({ customerGroupId: context.organization.customerGroupId });
    }
    const assignments = await em.find(
      PriceListAssignment,
      { $or: assignmentClauses },
      { orderBy: { priority: 'desc' } },
    );
    const applicableAssignments = assignments.filter((a) => {
      if (a.salesChannelId == null) return true;
      return context.salesChannel?.id === a.salesChannelId;
    });
    if (applicableAssignments.length === 0) {
      return { unitPrice: basePrice, basePrice, source: 'base', priceListId: null, appliedItemId: null };
    }

    // --- Step 3: load price lists + their items ---------------------------
    const priceListIds = Array.from(new Set(applicableAssignments.map((a) => a.priceListId)));
    const priceLists = await em.find(PriceList, { id: { $in: priceListIds } });
    const items = await em.find(PriceListItem, { priceListId: { $in: priceListIds } });
    const itemsByList = new Map<string, PriceListItem[]>();
    for (const item of items) {
      const list = itemsByList.get(item.priceListId) ?? [];
      list.push(item);
      itemsByList.set(item.priceListId, list);
    }

    // Categories the product belongs to — needed for percentage_off / amount_off.
    const categoryRows = await em.getConnection().execute<Array<{ category_id: string }>>(
      `select category_id from product_categories where product_id = ?`,
      [product.id],
    );
    const productCategoryIds = new Set(categoryRows.map((r) => r.category_id));

    // --- Step 4: compute candidate prices --------------------------------
    interface Candidate {
      amount: number;
      priceListId: string;
      itemId: string | null;
    }
    const candidates: Candidate[] = [];
    for (const list of priceLists) {
      const listItems = itemsByList.get(list.id) ?? [];

      // 4a. fixed_unit on the variant
      const variantItem = pickHighestQuantityTier(
        listItems.filter(
          (i) =>
            i.mode === 'fixed_unit' &&
            i.productId === product.id &&
            i.variantId === variantId &&
            variantId !== null,
        ),
        context.quantity,
      );
      if (variantItem && variantItem.unitPrice != null) {
        candidates.push({
          amount: Number(variantItem.unitPrice),
          priceListId: list.id,
          itemId: variantItem.id,
        });
        continue;
      }

      // 4b. fixed_unit on the product (no variant)
      const productItem = pickHighestQuantityTier(
        listItems.filter(
          (i) =>
            i.mode === 'fixed_unit' &&
            i.productId === product.id &&
            (i.variantId == null),
        ),
        context.quantity,
      );
      if (productItem && productItem.unitPrice != null) {
        candidates.push({
          amount: Number(productItem.unitPrice),
          priceListId: list.id,
          itemId: productItem.id,
        });
        continue;
      }

      // 4c. category adjustments — pick the single most generous discount
      // across all matching category items. We don't stack adjustments
      // because they all derive from the same base; stacking would
      // double-discount in a non-obvious way.
      let mostGenerous: { amount: number; itemId: string } | null = null;
      for (const item of listItems) {
        if (item.mode === 'fixed_unit') continue;
        if (item.categoryId == null) continue;
        if (!productCategoryIds.has(item.categoryId)) continue;
        if (item.adjustmentValue == null) continue;
        const adjusted = applyAdjustment(baseAmount, item.mode, Number(item.adjustmentValue));
        if (adjusted < 0) continue;
        if (mostGenerous == null || adjusted < mostGenerous.amount) {
          mostGenerous = { amount: adjusted, itemId: item.id };
        }
      }
      if (mostGenerous) {
        candidates.push({
          amount: mostGenerous.amount,
          priceListId: list.id,
          itemId: mostGenerous.itemId,
        });
      }
    }

    if (candidates.length === 0) {
      return { unitPrice: basePrice, basePrice, source: 'base', priceListId: null, appliedItemId: null };
    }

    // FR-050: most favourable wins.
    candidates.sort((a, b) => a.amount - b.amount);
    const winner = candidates[0]!;
    return {
      unitPrice: { amount: round2(winner.amount), currency: basePrice.currency },
      basePrice,
      source: 'list',
      priceListId: winner.priceListId,
      appliedItemId: winner.itemId,
    };
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
    product: Product;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: Organization | null;
      salesChannel: SalesChannel;
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
      customerGroupId: context.organization?.customerGroupId ?? null,
    };
    const cached = this.cache?.get(cacheKey);
    if (cached) return cached;

    // Build the resolution context.
    const productCategoryRows = await em
      .getConnection()
      .execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ?`,
        [product.id],
      );
    const ctx: ResolutionContext = {
      organizationId: context.organization?.id ?? null,
      customerGroupId: context.organization?.customerGroupId ?? null,
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
    const priceListService = new PriceListService(this.emFactory);
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
    product: Product;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: Organization | null;
      salesChannel: SalesChannel;
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

function pickHighestQuantityTier(
  items: PriceListItem[],
  quantity: number,
): PriceListItem | null {
  const eligible = items.filter((i) => i.minQuantity <= quantity);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.minQuantity - a.minQuantity);
  return eligible[0]!;
}

function applyAdjustment(
  base: number,
  mode: 'percentage_off' | 'amount_off' | 'fixed_unit',
  value: number,
): number {
  if (mode === 'percentage_off') {
    return base * (1 - value / 100);
  }
  if (mode === 'amount_off') {
    return base - value;
  }
  return base;
}

function readBasePrice(product: Product): number {
  const raw = Number(
    product.attributeValues['defaultPrice'] ??
      product.attributeValues['price'] ??
      Number.NaN,
  );
  return Number.isFinite(raw) ? raw : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
