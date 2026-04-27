import type { EntityManager } from '@mikro-orm/postgresql';
import type { Money, ResolvedPrice } from '@b2b/contracts';
import { Product } from '../../catalog/entities/product.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../catalog/entities/sales-channel.entity.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListItem } from '../entities/price-list-item.entity.js';
import { PriceListAssignment } from '../entities/price-list-assignment.entity.js';

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
  constructor(private readonly emFactory: () => EntityManager) {}

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
