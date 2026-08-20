import { apiGetAuthed, apiMutate } from './mutations';
import type { RequestContext } from './client';

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
  quoteRequestBusinessId?: string;
}

export interface QuickOrderSearchResult {
  productId: string;
  sku: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'inactive';
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

export interface QuickOrderResolvedDefaults {
  paymentMethodId: string | null;
  deliveryMethodId: string | null;
  billingAddressId: string | null;
  shippingAddressId: string | null;
  source: {
    payment: 'customer' | 'organization' | null;
    delivery: 'customer' | 'organization' | null;
    billing: 'customer' | 'organization' | null;
    shipping: 'customer' | 'organization' | null;
  };
}

/** Resolved (effective) default ordering preferences for the current customer. */
export async function getResolvedQuickOrderDefaults(
  sessionCookie: string,
): Promise<QuickOrderResolvedDefaults> {
  return apiGetAuthed<QuickOrderResolvedDefaults>({
    path: '/api/v1/quick-order/preferences/resolved',
    sessionCookie,
  });
}

export interface QuickOrderPreference {
  scope: 'organization' | 'customer';
  scopeId: string;
  defaultPaymentMethodId: string | null;
  defaultDeliveryMethodId: string | null;
  defaultBillingAddressId: string | null;
  defaultShippingAddressId: string | null;
}

export interface QuickOrderPreferenceUpsert {
  scope: 'organization' | 'customer';
  scopeId: string;
  defaultPaymentMethodId?: string | null;
  defaultDeliveryMethodId?: string | null;
  defaultBillingAddressId?: string | null;
  defaultShippingAddressId?: string | null;
}

/** Read the raw stored preference row for a scope the caller may access. */
export async function getQuickOrderPreference(
  sessionCookie: string,
  scope: 'organization' | 'customer',
  scopeId: string,
): Promise<QuickOrderPreference | null> {
  return apiGetAuthed<QuickOrderPreference | null>({
    path: `/api/v1/quick-order/preferences?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`,
    sessionCookie,
  });
}

/** Upsert a scope's default ordering preferences. */
export async function upsertQuickOrderPreference(
  sessionCookie: string,
  body: QuickOrderPreferenceUpsert,
): Promise<QuickOrderPreference> {
  const res = await apiMutate<QuickOrderPreference>({
    method: 'PUT',
    path: '/api/v1/quick-order/preferences',
    body,
    sessionCookie,
  });
  return res.data!;
}

export interface QuickOrderOneClickEligibility {
  enabled: boolean;
  reason?: 'setting_disabled' | 'missing_defaults' | 'ineligible_default' | null;
}

export interface QuickOrderNextAction {
  kind: 'redirect_to_gateway' | 'awaiting_transfer' | 'none';
  url?: string;
}

export interface QuickOrderOneClickResult {
  order: { id: string; businessId: string; status: string; total: number; currency: string };
  nextAction: QuickOrderNextAction | null;
}

/** Whether the one-click-buy button should show for the current buyer. */
export async function getOneClickEligibility(
  sessionCookie: string,
  productId: string,
): Promise<QuickOrderOneClickEligibility> {
  return apiGetAuthed<QuickOrderOneClickEligibility>({
    path: `/api/v1/quick-order/one-click/eligibility?productId=${encodeURIComponent(productId)}`,
    sessionCookie,
  });
}

/** Place a one-click order from the buyer's defaults; returns order + nextAction. */
export async function placeOneClickOrder(
  sessionCookie: string,
  input: { productId: string; variantId?: string | null; quantity?: number },
): Promise<QuickOrderOneClickResult> {
  const res = await apiMutate<QuickOrderOneClickResult>({
    method: 'POST',
    path: '/api/v1/quick-order/one-click',
    body: {
      productId: input.productId,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      ...(input.quantity ? { quantity: input.quantity } : {}),
    },
    sessionCookie,
  });
  return res.data!;
}

/**
 * Type-ahead over the catalogue (issue #174).
 *
 * `ctx` is not optional decoration: the backend scopes this search to the
 * resolved sales channel now, so without the `X-Sales-Channel` header the
 * buyer would be answered from the system-default channel rather than the one
 * they are shopping. It used to make no difference because the endpoint
 * ignored the channel entirely — which was the defect.
 */
export async function searchProducts(
  sessionCookie: string,
  q: string,
  ctx: RequestContext,
  limit = 20,
): Promise<QuickOrderSearchResult[]> {
  return apiGetAuthed<QuickOrderSearchResult[]>({
    path: `/api/v1/quick-order/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    sessionCookie,
    ctx,
  });
}
