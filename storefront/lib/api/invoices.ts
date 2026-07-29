import { apiGetAuthed } from './mutations';

/**
 * Storefront invoice bindings (feature 047, US4). Lists the invoices attached
 * to one of the customer's own orders. The PDF download is served by the
 * backend customer route (ownership-guarded).
 */
export interface MyOrderInvoice {
  id: string;
  kind: 'proforma' | 'invoice' | 'correction';
  number: string;
  issuedAt: string;
  currency: string;
  total: number;
  downloadHref: string;
}

const apiBaseUrl = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

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
