import type { InvoiceLedgerDeliveryListItem } from '@endora-commerce/contracts';

export function mergeLedgerDeliveryPages(
  existing: InvoiceLedgerDeliveryListItem[],
  incoming: InvoiceLedgerDeliveryListItem[],
): InvoiceLedgerDeliveryListItem[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...incoming.filter((row) => !seen.has(row.id))];
}
