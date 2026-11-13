import type { OrderInvoiceListItem } from '@endora-commerce/contracts';
import { apiGetAuthed } from './mutations';
import { publicApiBaseUrl } from '../env.mjs';

/**
 * Storefront invoice bindings (feature 047, US4). Lists the invoices attached
 * to one of the customer's own orders. The PDF download is served by the
 * backend customer route (ownership-guarded).
 */
/** One row of `GET /api/v1/orders/:id/invoices` — the published `orderInvoiceListItemSchema` (issue #599). */
export type MyOrderInvoice = OrderInvoiceListItem;

const apiBaseUrl = publicApiBaseUrl();

/** Absolute URL to the backend invoice PDF download route. */
export function invoiceDownloadUrl(orderId: string, invoiceId: string): string {
  return `${apiBaseUrl}/api/v1/orders/${orderId}/invoices/${invoiceId}/pdf`;
}

export async function listMyOrderInvoices(
  sessionCookie: string,
  orderId: string,
): Promise<MyOrderInvoice[]> {
  return apiGetAuthed<MyOrderInvoice[]>({
    path: `/api/v1/orders/${orderId}/invoices`,
    sessionCookie,
  });
}
