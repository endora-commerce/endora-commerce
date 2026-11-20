import type { InvoiceKind, InvoiceStatus } from '@endora-commerce/contracts';

/** The largest page `GET /api/v1/admin/invoices` serves (`paginationSchema`: 1–200). */
export const INVOICE_LIST_MAX_LIMIT = 200;

/** The admin invoice list's filter bar, as the inputs hold it. */
export interface InvoiceListFilters {
  status: '' | InvoiceStatus;
  kind: '' | InvoiceKind;
  orderNumber: string;
  /** `YYYY-MM-DD` from a date input, or `''`. */
  issuedFrom: string;
  issuedTo: string;
  totalMin: string;
  totalMax: string;
}

export const NO_INVOICE_FILTERS: InvoiceListFilters = {
  status: '',
  kind: '',
  orderNumber: '',
  issuedFrom: '',
  issuedTo: '',
  totalMin: '',
  totalMax: '',
};

/**
 * The `GET /api/v1/admin/invoices` path for one page of the list. `cursor` is
 * the opaque `pagination.cursor` the previous page answered (issue #1120); the
 * first page passes none. `limit` is the page size (the endpoint's default,
 * 50, when absent; at most {@link INVOICE_LIST_MAX_LIMIT}).
 */
export function invoiceListPath(filters: InvoiceListFilters, cursor?: string | null, limit?: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('filter[status]', filters.status);
  if (filters.kind) params.set('filter[kind]', filters.kind);
  if (filters.orderNumber.trim()) params.set('filter[orderNumber]', filters.orderNumber.trim());
  if (filters.issuedFrom) params.set('filter[issuedFrom]', `${filters.issuedFrom}T00:00:00.000Z`);
  if (filters.issuedTo) params.set('filter[issuedTo]', `${filters.issuedTo}T23:59:59.999Z`);
  if (filters.totalMin.trim()) params.set('filter[totalMin]', filters.totalMin.trim());
  if (filters.totalMax.trim()) params.set('filter[totalMax]', filters.totalMax.trim());
  if (cursor) params.set('cursor', cursor);
  if (limit !== undefined) params.set('limit', String(limit));
  const query = params.toString();
  return '/api/v1/admin/invoices' + (query ? `?${query}` : '');
}
