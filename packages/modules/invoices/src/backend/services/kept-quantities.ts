import type { OrderReturnedQuantity } from '@endora-commerce/contracts';

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
