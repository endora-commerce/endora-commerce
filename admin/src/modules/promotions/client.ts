import { apiClient } from '@/lib/api-client';
import type { Promotion, PromotionAction, PromotionRule } from '@b2b/contracts';

/**
 * Feature 045 — admin API client for the promotions engine.
 */
export interface UpsertPromotionPayload {
  name: string;
  description?: string | null;
  isActive?: boolean;
  priority?: number;
  stopFurther?: boolean;
  action?: PromotionAction;
  rule?: PromotionRule | null;
  ruleId?: string | null;
  code?: string | null;
  minCartSubtotal?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  usageLimitGlobal?: number | null;
  usageLimitPerOrganization?: number | null;
  usageLimitPerCustomer?: number | null;
}

export interface PromoRuleAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'select' | 'multiselect' | 'price';
  options?: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
}

export const promotionsClient = {
  list: (): Promise<Promotion[]> =>
    apiClient.get<{ data: Promotion[] }>('/api/v1/admin/promotions').then((r) => r.data),
  get: (id: string): Promise<Promotion> =>
    apiClient.get<{ data: Promotion }>(`/api/v1/admin/promotions/${id}`).then((r) => r.data),
  create: (payload: UpsertPromotionPayload): Promise<Promotion> =>
    apiClient.post<{ data: Promotion }>('/api/v1/admin/promotions', payload).then((r) => r.data),
  update: (id: string, payload: UpsertPromotionPayload): Promise<Promotion> =>
    apiClient.put<{ data: Promotion }>(`/api/v1/admin/promotions/${id}`, payload).then((r) => r.data),
  remove: (id: string): Promise<void> => apiClient.delete<void>(`/api/v1/admin/promotions/${id}`),
  actionTypes: (): Promise<Array<{ type: string; labelKey: string }>> =>
    apiClient
      .get<{ data: { items: Array<{ type: string; labelKey: string }> } }>(
        '/api/v1/admin/promotions/action-types',
      )
      .then((r) => r.data.items),
  ruleAttributes: (): Promise<PromoRuleAttribute[]> =>
    apiClient
      .get<{ data: { items: PromoRuleAttribute[] } }>(
        '/api/v1/admin/promotions/rule-targets/attributes',
      )
      .then((r) => r.data.items),
};
