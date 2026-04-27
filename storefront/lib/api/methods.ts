import { apiGet } from './client';

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
}

export interface PaymentMethodSummary {
  id: string;
  code: string;
  name: Record<string, string>;
  kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
  status: 'active' | 'inactive';
}

export async function listDeliveryMethods(): Promise<DeliveryMethodSummary[]> {
  const payload = await apiGet<{ data: DeliveryMethodSummary[] }>('/api/v1/delivery-methods');
  return payload.data;
}

export async function listPaymentMethods(): Promise<PaymentMethodSummary[]> {
  const payload = await apiGet<{ data: PaymentMethodSummary[] }>('/api/v1/payment-methods');
  return payload.data;
}
