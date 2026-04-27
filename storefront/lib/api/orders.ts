import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Order API bindings (T157, T158, T159). All endpoints require an
 * authenticated `b2b_session`. Anonymous order placement is not
 * supported: the buyer must be identified before checkout.
 */

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
  productSnapshot: Record<string, unknown>;
}

export interface OrderSummary {
  id: string;
  organizationId: string;
  status: string;
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
  nextAction: { kind: string } | null;
}

export interface PlaceOrderPayload {
  deliveryAddressId: string;
  billingAddressId: string;
  deliveryMethodId: string;
  paymentMethodId: string;
  promotionCode?: string;
  customerNote?: string;
  idempotencyKey?: string;
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
