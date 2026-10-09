import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  DeliveryMethodAdapterOption,
  DeliveryMethodAvailability,
} from '@endora-commerce/contracts';
/**
 * Typed admin client for delivery (shipping) methods (feature 035). Wraps the
 * shared apiClient with the adapter-aware endpoints.
 */
export interface AdminDeliveryMethod {
  id: string;
  code: string;
  adapter: string;
  name: Record<string, string>;
  cost: { amount: number; currency: string };
  status: 'active' | 'inactive';
  statusOnSuccess: string;
  statusOnFailure: string;
  salesChannelIds: string[];
  rendererKey: string | null;
  /** Whether checkout can offer the method, and the module that decides it. */
  availability: DeliveryMethodAvailability;
}

export type { DeliveryMethodAdapterOption };

export interface OrderStatusOption {
  code: string;
  label: string;
}

export interface DeliveryMethodUpsertBody {
  code: string;
  name: Record<string, string>;
  cost: number;
  currency: string;
  adapter?: string;
  status?: 'active' | 'inactive';
  statusOnSuccess?: string;
  statusOnFailure?: string;
  salesChannelIds?: string[];
}

export const deliveryMethodsClient = {
  async list(): Promise<AdminDeliveryMethod[]> {
    const res = await apiClient.get<{ data: AdminDeliveryMethod[] }>(
      '/api/v1/admin/delivery-methods',
    );
    return res.data;
  },

  /** The adapters a method may be bound to: registered, and their module switched on. */
  async adapters(): Promise<DeliveryMethodAdapterOption[]> {
    const res = await apiClient.get<{ data: DeliveryMethodAdapterOption[] }>(
      '/api/v1/admin/delivery-methods/adapters',
    );
    return res.data;
  },

  /** Shared endpoint owned by the payment-methods admin routes (same registry). */
  async orderStatuses(): Promise<OrderStatusOption[]> {
    const res = await apiClient.get<{ data: OrderStatusOption[] }>('/api/v1/admin/order-statuses');
    return res.data;
  },

  async upsert(code: string, body: DeliveryMethodUpsertBody): Promise<AdminDeliveryMethod> {
    const res = await apiClient.put<{ data: AdminDeliveryMethod }>(
      `/api/v1/admin/delivery-methods/${encodeURIComponent(code)}`,
      body,
    );
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/admin/delivery-methods/${id}`);
  },
};
