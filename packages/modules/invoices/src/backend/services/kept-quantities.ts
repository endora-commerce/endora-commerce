import {
  compareDecimals,
  grossPartsAtRowTarget,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  roundHalfUp,
  type OrderReturnedQuantity,
} from '@endora-commerce/contracts';

/**
 * The order lines an invoice issued after a return lists, each with the
 * quantity the buyer kept (issue #435, product-owner ruling of 2026-11-07):
 * the ordered quantity less what settled returns took back, in the order's
 * order. A line returned in full drops out. There is no invoice to correct
 * before the first one is issued (#135), so the invoice itself documents the
 * sale that is left.
 */
export function keptOrderLines<T extends { id: string; quantity: number }>(
  items: readonly T[],
  returned: readonly OrderReturnedQuantity[],
): Array<{ item: T; quantity: number }> {
  const back = new Map<string, number>();
  for (const r of returned) back.set(r.orderItemId, (back.get(r.orderItemId) ?? 0) + r.quantity);
  const kept: Array<{ item: T; quantity: number }> = [];
  for (const item of items) {
    const quantity = item.quantity - (back.get(item.id) ?? 0);
    if (quantity > 0) kept.push({ item, quantity });
  }
  return kept;
}

/**
 * The order-level discount an invoice issued after a return lists (issue #435,
 * product-owner ruling Q3 of 2026-11-07): the order's discount less what the
 * settled returns carried back, as they recorded it — the kept goods' share —
 * at two places, and never below zero. `'0.00'` means the line is left off.
 */
export function keptDiscount(orderDiscount: string | number, returned: readonly OrderReturnedQuantity[]): string {
  const kept = moneyDifference(roundHalfUp(orderDiscount), moneySum(['0', ...returned.map((r) => r.discount)]));
  return compareDecimals(kept, 0) > 0 ? kept : '0.00';
}

/**
 * The amounts withheld on the order's returns, one per order line something
 * was withheld from, in the order's order (issue #854, owner ruling of
 * 2026-11-07: the amount withheld on a return is part of the goods' price, at
 * the goods' VAT rate). Each is a gross at the rate of the line it was withheld
 * from, and its net is found by the row-target rule over the kept goods
 * (`grossPartsAtRowTarget`): the rate's row gross on the invoice is the kept
 * goods' gross plus what was withheld there, wherever a net carries it. The
 * branch is on stored data only — each line's own rate — never on the order's
 * VAT method.
 */
export function retainedOnReturnLines<T extends { id: string; quantity: number; unitPrice: string | number; taxRate: string | number }>(
  items: readonly T[],
  returned: readonly OrderReturnedQuantity[],
): Array<{ item: T; rate: string; gross: string; net: string; exact: boolean }> {
  const withheld = new Map<string, string[]>();
  for (const r of returned) {
    if (r.retained === undefined || compareDecimals(r.retained, 0) <= 0) continue;
    withheld.set(r.orderItemId, [...(withheld.get(r.orderItemId) ?? []), r.retained]);
  }
  const from = items.flatMap((item) => {
    const amounts = withheld.get(item.id);
    return amounts ? [{ item, gross: moneySum(amounts) }] : [];
  });
  if (from.length === 0) return [];
  const goods = keptOrderLines(items, returned).map(({ item, quantity }) => ({
    net: lineAmountHalfUp(item.unitPrice, quantity),
    rate: item.taxRate,
  }));
  const parts = grossPartsAtRowTarget({
    goods,
    parts: from.map((f) => ({ gross: f.gross, rate: f.item.taxRate })),
    unit: 'fraction',
  });
  return from.map((f, i) => ({ item: f.item, ...parts[i]! }));
}
