import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Quick-order bindings (feature 039). All endpoints require an authenticated
 * customer session — SKU-to-product disclosure and cart / RFQ mutation are
 * gated to logged-in buyers.
 */

export type QuickOrderRejectionReason =
  | 'sku_missing'
  | 'quantity_invalid'
  | 'product_not_found'
  | 'product_archived'
  | 'malformed_row'
  | 'variant_not_resolved'
  | 'variant_ambiguous'
  | 'row_limit_exceeded';

export interface RecognizedQuickOrderItem {
  line: number;
  sku: string;
  productId: string;
  variantId: string | null;
  resolvedVariantSku?: string | null;
  quantity: number;
  mergedFromLines?: number[];
}

export interface RejectedQuickOrderItem {
  line: number;
  raw: string;
  reason: QuickOrderRejectionReason;
}

export interface QuickOrderImportSummary {
  recognizedCount: number;
  rejectedCount: number;
  mergedCount: number;
  truncated: boolean;
}

export interface QuickOrderImportResponse {
  recognized: RecognizedQuickOrderItem[];
  rejected: RejectedQuickOrderItem[];
  summary: QuickOrderImportSummary;
}

export type QuickOrderTarget = 'cart' | 'quote_request';

export interface QuickOrderBuildResponse {
  target: QuickOrderTarget;
  cartId?: string;
  checkoutUrl?: string;
  quoteRequestId?: string;
}

export interface QuickOrderSearchResult {
  productId: string;
  sku: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'archived';
  matchedOn?: Array<'sku' | 'name' | 'attribute'>;
}

/** Import a pasted CSV blob. */
export async function importQuickOrderCsv(
  sessionCookie: string,
  csv: string,
): Promise<QuickOrderImportResponse> {
  const res = await apiMutate<QuickOrderImportResponse>({
    method: 'POST',
    path: '/api/v1/quick-order/import',
    body: { csv },
    sessionCookie,
  });
  return res.data!;
}

/** Import an uploaded CSV or .xlsx file (sent base64; backend owns parsing). */
export async function importQuickOrderFile(
  sessionCookie: string,
  filename: string,
  contentBase64: string,
): Promise<QuickOrderImportResponse> {
  const res = await apiMutate<QuickOrderImportResponse>({
    method: 'POST',
    path: '/api/v1/quick-order/import',
    body: { file: { filename, contentBase64 } },
    sessionCookie,
  });
  return res.data!;
}

/** Build a Cart or Quote Request from confirmed recognized lines. */
export async function buildQuickOrder(
  sessionCookie: string,
  target: QuickOrderTarget,
  items: Array<{ productId: string; variantId?: string | null; quantity: number }>,
): Promise<QuickOrderBuildResponse> {
  const res = await apiMutate<QuickOrderBuildResponse>({
    method: 'POST',
    path: '/api/v1/quick-order/build',
    body: { target, items },
    sessionCookie,
  });
  return res.data!;
}

export async function searchProducts(
  sessionCookie: string,
  q: string,
  limit = 20,
): Promise<QuickOrderSearchResult[]> {
  return apiGetAuthed<QuickOrderSearchResult[]>({
    path: `/api/v1/quick-order/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    sessionCookie,
  });
}
