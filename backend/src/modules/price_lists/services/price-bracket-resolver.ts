/**
 * Pure bracket resolver (feature 011 / FR-014, FR-016, FR-031).
 *
 * Given a list of brackets across currencies, returns the bracket whose
 * `(currency, minQuantity, maxQuantity)` window covers the requested
 * `(currency, qty)`. Returns null when the requested currency is missing
 * from the bracket set OR the requested quantity falls outside every
 * bracket on that currency (the bracket-gap fall-through case from
 * research §R5 — the resolver advances to the next-priority list).
 *
 * Brackets are expected to be non-overlapping within the same currency
 * (overlap-freedom is enforced at the service layer when brackets are
 * written; this resolver assumes valid input).
 */
export interface PriceBracketRow {
  priceListId: string;
  productId: string;
  currencyCode: string;
  minQuantity: number;
  maxQuantity: number | null;
  amount: string;
}

export function resolvePriceBracket(
  brackets: readonly PriceBracketRow[],
  currencyCode: string,
  quantity: number,
): PriceBracketRow | null {
  if (quantity < 1) return null;
  const inCurrency = brackets.filter((b) => b.currencyCode === currencyCode);
  if (inCurrency.length === 0) return null;
  for (const b of inCurrency) {
    if (b.minQuantity > quantity) continue;
    if (b.maxQuantity != null && b.maxQuantity < quantity) continue;
    return b;
  }
  return null;
}
