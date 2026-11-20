/**
 * Whose invoice this is (`specs/182-related-payers/` FR-080, FR-081, RP-8) — the one expression
 * the invoice ledger's client key, the Admin UI list's reach and its organization filter share:
 *
 * - an ERP-imported row carries its Organization itself (feature 119);
 * - a platform invoice belongs to the Organization its order **bills**: the order's payer when
 *   it names one, else the buyer. `''` when the order can no longer be read.
 */
export function invoiceOwnerOrganizationId(
  invoice: { readonly origin?: string | null; readonly organizationId?: string | null },
  order: { readonly organizationId: string; readonly payerOrganizationId?: string | null } | null,
): string {
  if (invoice.origin === 'erp_import') return invoice.organizationId ?? '';
  if (!order) return '';
  return order.payerOrganizationId ?? order.organizationId;
}
