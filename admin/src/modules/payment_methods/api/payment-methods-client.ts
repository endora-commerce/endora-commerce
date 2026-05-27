import { apiClient } from '@/lib/api-client';

/**
 * Typed admin client for payment methods (feature 034). Wraps the shared
 * apiClient with the adapter-aware endpoints.
 */
export interface AdminPaymentMethod {
  id: string;
  code: string;
  adapter: string;
  kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
  name: Record<string, string>;
  status: 'active' | 'inactive';
  additionalPrice: number;
  statusOnPending: string;
  statusOnSuccess: string;
  statusOnFailure: string;
  salesChannelIds: string[];
}

export interface OrderStatusOption {
  code: string;
  label: string;
}

export interface PaymentMethodUpsertBody {
  code: string;
  name: Record<string, string>;
  kind: AdminPaymentMethod['kind'];
  adapter?: string;
  additionalPrice?: number;
  status?: 'active' | 'inactive';
  statusOnPending?: string;
  statusOnSuccess?: string;
  statusOnFailure?: string;
}

export const paymentMethodsClient = {
  list(): Promise<AdminPaymentMethod[]> {
    return apiClient
      .get<{ data: AdminPaymentMethod[] }>('/api/v1/admin/payment-methods')
      .then((r) => r.data);
  },
  orderStatuses(): Promise<OrderStatusOption[]> {
    return apiClient
      .get<{ data: OrderStatusOption[] }>('/api/v1/admin/order-statuses')
      .then((r) => r.data);
  },
  upsert(code: string, body: PaymentMethodUpsertBody): Promise<AdminPaymentMethod> {
    return apiClient
      .put<{ data: AdminPaymentMethod }>(
        `/api/v1/admin/payment-methods/${encodeURIComponent(code)}`,
        body,
      )
      .then((r) => r.data);
  },
  remove(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/admin/payment-methods/${id}`);
  },
};
