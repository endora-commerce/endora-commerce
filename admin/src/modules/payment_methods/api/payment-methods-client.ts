import { apiClient } from '@/lib/api-client';

/**
 * Typed admin client for payment methods (feature 034). Wraps the shared
 * apiClient with the adapter-aware endpoints.
 */
/**
 * Why a method is, or is not, offered to a buyer (issue #96). The admin keeps
 * every row — switching a gateway off drops nothing — and renders the reason
 * from the owning module's presence, exactly as `/platform/modules` does.
 */
export interface PaymentMethodAvailability {
  ownerModule: string | null;
  available: boolean;
  ownerPresence: {
    id: string;
    present: boolean;
    platformState: string;
    activated: boolean;
    deactivatable: boolean;
    nonDeactivatableReason: string | null;
  } | null;
}

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
  rendererKey: string | null;
  availability: PaymentMethodAvailability;
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
  adapters(): Promise<string[]> {
    return apiClient
      .get<{ data: string[] }>('/api/v1/admin/payment-methods/adapters')
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
  /**
   * Availability — feature 076 (D-82). Its own endpoint, because it is its own
   * operation: the `PUT` above requires `name` and `kind`, so a toggle through
   * it would resend the whole record and clobber a concurrent edit.
   */
  setStatus(id: string, status: 'active' | 'inactive'): Promise<AdminPaymentMethod> {
    return apiClient
      .patch<{ data: AdminPaymentMethod }>(`/api/v1/admin/payment-methods/${id}/status`, {
        status,
      })
      .then((r) => r.data);
  },
  remove(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/admin/payment-methods/${id}`);
  },
};
