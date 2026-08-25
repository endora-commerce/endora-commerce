import { apiGet } from './client';
import { withModuleAbsence } from './module-absence';

/**
 * Public method-listing bindings used by the checkout step (T157).
 * Both endpoints are anonymous: they describe what the buyer can choose,
 * not what the buyer has chosen.
 */

export interface DeliveryMethodSummary {
  id: string;
  code: string;
  name: Record<string, string>;
  cost: { amount: number; currency: string };
  status: 'active' | 'inactive';
  // Feature 035 — shipping adapter framework fields.
  adapter: string;
  rendererKey: string | null;
}

export interface PaymentMethodSummary {
  id: string;
  code: string;
  name: Record<string, string>;
  kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
  status: 'active' | 'inactive';
  // Feature 034 — adapter framework fields.
  adapter: string;
  additionalPrice: number;
  rendererKey: string | null;
}

export async function listDeliveryMethods(): Promise<DeliveryMethodSummary[]> {
  const payload = await apiGet<{ data: DeliveryMethodSummary[] }>('/api/v1/delivery-methods');
  return payload.data;
}

/**
 * The payment catalogue, or **no methods** when `payment_methods` is switched
 * off (Constitution XVII: a module that is off behaves as if never installed).
 *
 * The route is owned by `payment_methods` and its registration seam is gated,
 * so an operator who deactivates that module makes this endpoint answer
 * `503 MODULE_DISABLED` rather than `200 {"data": []}`. Every caller of this
 * function renders a catalogue, and a Server Component that throws on the
 * refusal gives the buyer Next's 500 page — which is the one thing "as if never
 * installed" cannot mean.
 *
 * The absence value is the **empty list** and not a distinct sentinel, because
 * the two causes are indistinguishable to a buyer: a shop that configured no
 * method and a platform whose payment capability is off both answer "you cannot
 * pay here". The operator-facing difference belongs to the
 * deactivation-consequence dialog.
 *
 * `withModuleAbsence` is what keeps this from becoming a blanket catch: only the
 * `MODULE_DISABLED` envelope degrades. A 500, a timeout or an unparseable body
 * still throws, and the checkout error boundary — not this empty state — is what
 * the buyer sees for those.
 */
export async function listPaymentMethods(): Promise<PaymentMethodSummary[]> {
  return withModuleAbsence(fetchPaymentMethods, []);
}

async function fetchPaymentMethods(): Promise<PaymentMethodSummary[]> {
  const payload = await apiGet<{ data: PaymentMethodSummary[] }>('/api/v1/payment-methods');
  return payload.data;
}
