import { apiClient } from '@/lib/api-client';

/**
 * Admin quick-order bindings (feature 039). Wraps the `/api/v1/admin/quick-order`
 * endpoints; the operator acts on behalf of a customer + organization.
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

export interface QuickOrderImportResponse {
  recognized: RecognizedQuickOrderItem[];
  rejected: RejectedQuickOrderItem[];
  summary: { recognizedCount: number; rejectedCount: number; mergedCount: number; truncated: boolean };
}

export type QuickOrderTarget = 'cart' | 'quote_request';

export interface QuickOrderBuildResponse {
  target: QuickOrderTarget;
  cartId?: string;
  checkoutUrl?: string;
  quoteRequestId?: string;
}

export interface OnBehalfOf {
  customerAccountId: string;
  organizationId: string;
}

interface Envelope<T> {
  data: T;
}

export async function adminQuickOrderImport(input: {
  csv?: string;
  file?: { filename: string; contentBase64: string };
}): Promise<QuickOrderImportResponse> {
  const res = await apiClient.post<Envelope<QuickOrderImportResponse>>(
    '/api/v1/admin/quick-order/import',
    input,
  );
  return res.data;
}

export async function adminQuickOrderBuild(input: {
  target: QuickOrderTarget;
  items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
  onBehalfOf: OnBehalfOf;
}): Promise<QuickOrderBuildResponse> {
  const res = await apiClient.post<Envelope<QuickOrderBuildResponse>>(
    '/api/v1/admin/quick-order/build',
    input,
  );
  return res.data;
}
