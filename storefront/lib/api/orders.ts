import { purchaseConversionClaimResponseSchema } from '@endora-commerce/contracts';
import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Order API bindings (T157, T158, T159). All endpoints require an
 * authenticated `b2b_session`. Anonymous order placement is not
 * supported: the buyer must be identified before checkout.
 */

/**
 * Payment next-action returned by the place-order response (feature 034/036).
 * Drives Success-Page routing: nothing, bank-transfer details, or a redirect.
 */
export type NextAction =
  | { kind: 'none' }
  | {
      kind: 'awaiting_transfer';
      accountDetails: {
        accountNumber: string;
        accountHolder: string;
        bankName: string;
        amount: number;
        currency: string;
        reference: string;
      };
    }
  | { kind: 'redirect_to_gateway'; url: string; expiresAt: string };

/**
 * Resolve an order's status label for the active locale (feature 039):
 * statusName[locale] → statusDefaultName → raw status code.
 */
export function resolveOrderStatusLabel(
  order: { status: string; statusName?: Record<string, string>; statusDefaultName?: string },
  locale: string,
): string {
  return order.statusName?.[locale] ?? order.statusDefaultName ?? order.status;
}

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
  productSnapshot: { sku: string; name: string; primaryAssetUrl: string | null };
  variantSnapshot: { sku: string; label: string } | null;
}

export interface OrderSummary {
  id: string;
  /** Feature 036 — customer-facing business Order ID (shown instead of `id`). */
  businessId: string;
  organizationId: string;
  status: string;
  /** Feature 039 — localized status labels; resolve via resolveOrderStatusLabel. */
  statusName?: Record<string, string>;
  statusDefaultName?: string;
  paymentStatus: string;
  deliveryAddress: Record<string, string>;
  billingAddress: Record<string, string>;
  deliveryMethod: { id: string; code: string; name: Record<string, string>; cost: number };
  paymentMethod: { id: string; code: string; name: Record<string, string>; kind: string };
  items: OrderItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  deliveryTotal: number;
  total: number;
  currency: string;
  customerNote: string | null;
  placedAt: string;
  nextAction: NextAction | null;
  /**
   * Feature 085 — whether *this* buyer may cancel this order, decided by the
   * platform (FR-018). Optional on the type because only the buyer-facing reads
   * carry it; `lib/order-cancel.ts` says why nothing here re-derives it.
   */
  customerCancellable?: boolean;
}

export interface PlaceOrderPayload {
  deliveryAddressId: string;
  billingAddressId: string;
  deliveryMethodId: string;
  paymentMethodId: string;
  promotionCode?: string;
  customerNote?: string;
  idempotencyKey?: string;
  /** Optional billing-company override; defaults from the Organization. */
  billingCompanyName?: string;
  /** Optional billing tax-id (NIP) override; defaults from the Organization. */
  billingTaxId?: string;
}

/** Server-computed order-total preview (feature 049) — pricing stays server-side. */
export interface OrderTotalPreview {
  subtotal: number;
  taxTotal: number;
  deliveryTotal: number;
  paymentSurcharge: number;
  discountTotal: number;
  total: number;
  currency: string;
}

export async function previewOrderTotal(
  sessionCookie: string,
  payload: { deliveryMethodId: string; paymentMethodId: string; billingAddressId?: string },
): Promise<OrderTotalPreview> {
  const result = await apiMutate<OrderTotalPreview>({
    method: 'POST',
    path: '/api/v1/orders/preview-total',
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function placeOrder(
  sessionCookie: string,
  payload: PlaceOrderPayload,
): Promise<OrderSummary> {
  const result = await apiMutate<OrderSummary>({
    method: 'POST',
    path: '/api/v1/orders',
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function listMyOrders(sessionCookie: string): Promise<OrderSummary[]> {
  return apiGetAuthed<OrderSummary[]>({ path: '/api/v1/orders', sessionCookie });
}

export async function getMyOrder(sessionCookie: string, id: string): Promise<OrderSummary> {
  return apiGetAuthed<OrderSummary>({ path: `/api/v1/orders/${id}`, sessionCookie });
}

// --- Feature 038 ----------------------------------------------------------

export interface OrderComment {
  id: string;
  body: string;
  isCustomerVisible: boolean;
  authorCustomerAccountId: string | null;
  authorAdminUserId: string | null;
  createdAt: string;
}

/** Customer-visible comments on an order (US5). */
export async function listOrderComments(sessionCookie: string, id: string): Promise<OrderComment[]> {
  return apiGetAuthed<OrderComment[]>({ path: `/api/v1/orders/${id}/comments`, sessionCookie });
}

/** Add a customer comment to an order (US5). */
export async function addOrderComment(
  sessionCookie: string,
  id: string,
  body: string,
): Promise<OrderComment> {
  const result = await apiMutate<OrderComment>({
    method: 'POST',
    path: `/api/v1/orders/${id}/comments`,
    body: { body },
    sessionCookie,
  });
  return result.data!;
}

export interface ReorderResult {
  cartId: string;
  checkoutUrl: string;
  unavailableItems: Array<{ productId: string; variantId?: string | null; reason: string }>;
}

/** Reorder a past order — rebuilds the cart and returns the checkout URL (US6). */
export async function reorderOrder(sessionCookie: string, id: string): Promise<ReorderResult> {
  const result = await apiMutate<ReorderResult>({
    method: 'POST',
    path: `/api/v1/orders/${id}/reorder`,
    body: {},
    sessionCookie,
  });
  return result.data!;
}

/**
 * Cancel an order the buyer placed (feature 085, US3).
 *
 * No body: the target status is not the buyer's to choose. The server decides
 * eligibility and answers 409 when the shop has started or the money is no
 * longer the buyer's to owe, and 404 for an order they did not place.
 */
export async function cancelMyOrder(sessionCookie: string, id: string): Promise<OrderSummary> {
  const result = await apiMutate<OrderSummary>({
    method: 'POST',
    path: `/api/v1/orders/${id}/cancel`,
    body: {},
    sessionCookie,
  });
  return result.data!;
}

/**
 * Order again as a Quote Request (feature 039 / US4). Reuses the existing
 * clone-to-quote path (feature 038 US7).
 */
export async function cloneOrderToQuote(
  sessionCookie: string,
  id: string,
): Promise<{ quoteRequestId: string }> {
  const result = await apiMutate<{ quoteRequestId: string }>({
    method: 'POST',
    path: `/api/v1/orders/${id}/clone-to-quote`,
    body: {},
    sessionCookie,
  });
  return result.data!;
}

/**
 * Claim this order's GA4 `purchase` conversion (issue #277).
 *
 * `true` for the caller that may report it, `false` for every later one — so
 * an order is counted once, whichever storefront page the buyer sees it on
 * first and however many times they come back to it. The decision is the
 * platform's because a marker in the browser is gone with the cache and never
 * reaches the buyer's second device.
 */
export async function claimPurchaseConversion(
  sessionCookie: string,
  id: string,
): Promise<boolean> {
  const result = await apiMutate<unknown>({
    method: 'POST',
    path: `/api/v1/orders/${id}/purchase-conversion`,
    body: {},
    sessionCookie,
  });
  // Parsed rather than asserted: a body this does not recognise is a body that
  // grants nothing, and reporting a conversion the platform did not hand out
  // is the one outcome worth failing closed over.
  const parsed = purchaseConversionClaimResponseSchema.safeParse(result.data);
  return parsed.success && parsed.data.counted;
}
