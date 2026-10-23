import {
  priceBookRowShapeIssues,
  priceBookSelectionKind,
  type BasePricesForCurrency,
  type BasePriceTier,
  type PriceBookRowErrorReason,
  type PriceBookRowInput,
} from '@endora-commerce/contracts';

/**
 * The write rules of price books that need no database — feature 160
 * (`specs/160-pricing-model-v2/data-model.md` §4, FR-005–FR-009). Pure, so the
 * unit tests state them and the service applies exactly them.
 */

export interface RuleIssue {
  path: string[];
  message: string;
  /** The rule's code, where the issue reaches a row refusal (feature 161). */
  reason?: PriceBookRowErrorReason;
}

/** A row as stored in `price_list_matrix_entries`, before it has an id. */
export interface PlannedRow {
  variantId: string | null;
  productId: string | null;
  categoryId: string | null;
  attributeKey: string | null;
  attributeValue: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  priceType: 'fixed' | 'percent' | 'amount';
  amount: string | null;
  percent: string | null;
}

/** Quantity windows that overlap, as index pairs of the input (sorted by start). */
export function overlappingWindows(
  windows: ReadonlyArray<{ minQuantity: number; maxQuantity: number | null }>,
): Array<[number, number]> {
  const order = windows.map((w, i) => ({ ...w, i })).sort((a, b) => a.minQuantity - b.minQuantity);
  const out: Array<[number, number]> = [];
  for (let k = 1; k < order.length; k += 1) {
    const prev = order[k - 1]!;
    const next = order[k]!;
    if (prev.maxQuantity === null || next.minQuantity <= prev.maxQuantity) out.push([prev.i, next.i]);
  }
  return out;
}

function tierIssues(tiers: readonly BasePriceTier[], path: string[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  tiers.forEach((tier, i) => {
    if (tier.maxQuantity !== null && tier.maxQuantity < tier.minQuantity) {
      issues.push({ path: [...path, String(i), 'maxQuantity'], message: 'maxQuantity must be at least minQuantity.' });
    }
  });
  for (const [, b] of overlappingWindows(tiers)) {
    issues.push({ path: [...path, String(b)], message: 'Quantity tiers of one base price may not overlap.' });
  }
  return issues;
}

/**
 * The rows a base-price write stores for one product in one currency's base
 * book (FR-009): the product's tiers as fixed product rows, and each variant's
 * own row — fixed tiers, or a percentage or amount adjustment of the product's
 * base at the same quantity (`null` = the variant inherits, no row).
 *
 * Refused: overlapping tiers, a variant that is not the product's, and an
 * adjustment with no product base in that currency to adjust.
 */
export function planBasePriceRows(input: {
  productId: string;
  currencyCode: string;
  prices: BasePricesForCurrency;
  variantIdsOfProduct: ReadonlySet<string>;
}): { rows: PlannedRow[]; issues: RuleIssue[] } {
  const { productId, currencyCode, prices } = input;
  const base = ['byCurrency', currencyCode];
  const issues = tierIssues(prices.product, [...base, 'product']);
  const rows: PlannedRow[] = prices.product.map((tier) => ({
    variantId: null,
    productId,
    categoryId: null,
    attributeKey: null,
    attributeValue: null,
    minQuantity: tier.minQuantity,
    maxQuantity: tier.maxQuantity,
    priceType: 'fixed',
    amount: tier.amount,
    percent: null,
  }));
  for (const [variantId, variantRow] of Object.entries(prices.variants)) {
    const path = [...base, 'variants', variantId];
    if (!input.variantIdsOfProduct.has(variantId)) {
      issues.push({ path, message: 'This variant does not belong to the product.' });
      continue;
    }
    if (variantRow === null) continue;
    if (variantRow.type === 'fixed') {
      issues.push(...tierIssues(variantRow.tiers, [...path, 'tiers']));
      for (const tier of variantRow.tiers) {
        rows.push({
          variantId,
          productId,
          categoryId: null,
          attributeKey: null,
          attributeValue: null,
          minQuantity: tier.minQuantity,
          maxQuantity: tier.maxQuantity,
          priceType: 'fixed',
          amount: tier.amount,
          percent: null,
        });
      }
      continue;
    }
    if (prices.product.length === 0) {
      issues.push({
        path,
        message: "A percentage or amount adjustment needs the product's own base price in this currency.",
      });
      continue;
    }
    rows.push({
      variantId,
      productId,
      categoryId: null,
      attributeKey: null,
      attributeValue: null,
      minQuantity: 1,
      maxQuantity: null,
      priceType: variantRow.type,
      amount: variantRow.type === 'amount' ? variantRow.amount : null,
      percent: variantRow.type === 'percent' ? variantRow.percent : null,
    });
  }
  return { rows, issues };
}

/** Why a row may not be written to a **base** book, if it may not (FR-009). */
export function baseBookRowIssues(row: PriceBookRowInput): RuleIssue[] {
  const kind = priceBookSelectionKind(row.selection);
  if (kind !== 'product' && kind !== 'variant') {
    return [{ path: ['selection'], message: 'A base book prices products and variants only.', reason: 'base_book_kind' }];
  }
  if (kind === 'product' && row.price.type !== 'fixed') {
    return [{ path: ['price', 'type'], message: "A product's base price is a fixed amount.", reason: 'base_product_fixed' }];
  }
  return [];
}

/** The stored shape of a row input (no id), after the shape rules. */
export function plannedRowOf(row: PriceBookRowInput, parentProductId: string | null): PlannedRow {
  return {
    variantId: row.selection.variantId ?? null,
    productId: row.selection.variantId ? parentProductId : (row.selection.productId ?? null),
    categoryId: row.selection.categoryId ?? null,
    attributeKey: row.selection.attribute?.key ?? null,
    attributeValue: row.selection.attribute?.value ?? null,
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity,
    priceType: row.price.type,
    amount: row.price.type === 'percent' ? null : row.price.amount,
    percent: row.price.type === 'percent' ? row.price.percent : null,
  };
}

/** The shape rules of the contracts, re-exported where the service reads them. */
export { priceBookRowShapeIssues };

/** The selection a stored row names, as one comparable string. */
export function selectionKey(row: Pick<PlannedRow, 'variantId' | 'productId' | 'categoryId' | 'attributeKey' | 'attributeValue'>): string {
  return [row.variantId ?? '', row.variantId ? '' : (row.productId ?? ''), row.categoryId ?? '', row.attributeKey ?? '', row.attributeValue ?? ''].join('|');
}

/** Rows of one book with the same selection and overlapping quantity windows (FR-006). */
export function rowOverlaps(rows: ReadonlyArray<PlannedRow & { id?: string }>): Array<[number, number]> {
  const bySelection = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = selectionKey(row);
    const list = bySelection.get(key);
    if (list) list.push(i);
    else bySelection.set(key, [i]);
  });
  const out: Array<[number, number]> = [];
  for (const indices of bySelection.values()) {
    if (indices.length < 2) continue;
    for (const [a, b] of overlappingWindows(indices.map((i) => rows[i]!))) out.push([indices[a]!, indices[b]!]);
  }
  return out;
}
