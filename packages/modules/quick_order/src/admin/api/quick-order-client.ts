import { apiClient } from '@endora-commerce/admin-kit/lib';
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

export type PreferenceScope = 'organization' | 'customer';

export interface QuickOrderPreference {
  scope: PreferenceScope;
  scopeId: string;
  defaultPaymentMethodId: string | null;
  defaultDeliveryMethodId: string | null;
  defaultBillingAddressId: string | null;
  defaultShippingAddressId: string | null;
}

export interface QuickOrderPreferenceUpsert {
  scope: PreferenceScope;
  scopeId: string;
  defaultPaymentMethodId?: string | null;
  defaultDeliveryMethodId?: string | null;
  defaultBillingAddressId?: string | null;
  defaultShippingAddressId?: string | null;
}

export async function adminGetPreference(
  scope: PreferenceScope,
  scopeId: string,
): Promise<QuickOrderPreference | null> {
  const res = await apiClient.get<Envelope<QuickOrderPreference | null>>(
    `/api/v1/admin/quick-order/preferences?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`,
  );
  return res.data;
}

export async function adminUpsertPreference(
  body: QuickOrderPreferenceUpsert,
): Promise<QuickOrderPreference> {
  const res = await apiClient.put<Envelope<QuickOrderPreference>>(
    '/api/v1/admin/quick-order/preferences',
    body,
  );
  return res.data;
}
