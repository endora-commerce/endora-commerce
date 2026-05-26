import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Quick-order bindings (T205). Both endpoints require an authenticated
 * customer session — SKU-to-product disclosure is gated to logged-in
 * buyers.
 */

export interface RecognizedQuickOrderItem {
  line: number;
  sku: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface RejectedQuickOrderItem {
  line: number;
  raw: string;
  reason:
    | 'sku_missing'
    | 'quantity_invalid'
    | 'product_not_found'
    | 'product_archived'
    | 'malformed_row';
}

export interface QuickOrderImportResponse {
  recognized: RecognizedQuickOrderItem[];
  rejected: RejectedQuickOrderItem[];
}

export interface QuickOrderSearchResult {
  productId: string;
  sku: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'inactive';
}

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
