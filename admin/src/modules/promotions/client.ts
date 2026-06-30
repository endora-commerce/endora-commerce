import { apiClient } from '@/lib/api-client';
import type {
  Promotion,
  PromotionAction,
  PromotionRule,
  PromotionRuleRecord,
  PromotionStatsGroupBy,
  PromotionUsageStats,
} from '@b2b/contracts';

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

export type RuleTargetKind =
  | 'customer-groups'
  | 'organizations'
  | 'categories'
  | 'payment-methods'
  | 'delivery-methods';

export interface RuleTargetItem {
  id: string;
  code?: string;
  name: string;
  slug?: string;
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
  ruleTarget: (kind: RuleTargetKind): Promise<RuleTargetItem[]> =>
    apiClient
      .get<{ data: { items: RuleTargetItem[] } }>(`/api/v1/admin/promotions/rule-targets/${kind}`)
      .then((r) => r.data.items),
  listCoupons: (id: string): Promise<Coupon[]> =>
    apiClient.get<{ data: Coupon[] }>(`/api/v1/admin/promotions/${id}/coupons`).then((r) => r.data),
  bulkSetCouponActive: (
    id: string,
    couponIds: string[],
    isActive: boolean,
  ): Promise<{ updated: number }> =>
    apiClient
      .post<{ data: { updated: number } }>(`/api/v1/admin/promotions/${id}/coupons/bulk-active`, {
        couponIds,
        isActive,
      })
      .then((r) => r.data),
  createCoupon: (id: string, code: string): Promise<Coupon> =>
    apiClient
      .post<{ data: Coupon }>(`/api/v1/admin/promotions/${id}/coupons`, { code })
      .then((r) => r.data),
  stats: (id: string, groupBy?: PromotionStatsGroupBy): Promise<PromotionUsageStats> =>
    apiClient
      .get<{ data: PromotionUsageStats }>(
        `/api/v1/admin/promotions/${id}/stats${groupBy ? `?groupBy=${groupBy}` : ''}`,
      )
      .then((r) => r.data),
  generateBatch: (
    id: string,
    req: GenerateBatchRequest,
  ): Promise<{ batch: { id: string }; generated: number }> =>
    apiClient
      .post<{ data: { batch: { id: string }; generated: number } }>(
        `/api/v1/admin/promotions/${id}/coupon-batches`,
        req,
      )
      .then((r) => r.data),
};

export const promotionRulesClient = {
  list: (): Promise<PromotionRuleRecord[]> =>
    apiClient.get<{ data: PromotionRuleRecord[] }>('/api/v1/admin/promotion-rules').then((r) => r.data),
  create: (input: { name: string; description?: string | null; definition: PromotionRule }): Promise<PromotionRuleRecord> =>
    apiClient.post<{ data: PromotionRuleRecord }>('/api/v1/admin/promotion-rules', input).then((r) => r.data),
  remove: (id: string): Promise<void> => apiClient.delete<void>(`/api/v1/admin/promotion-rules/${id}`),
};

export interface GenerateBatchRequest {
  count: number;
  length: number;
  format: 'alnum' | 'digits' | 'letters';
  prefix?: string | null;
  suffix?: string | null;
  dashEvery?: number;
  limitScope: 'per_coupon' | 'shared_batch';
}

export interface Coupon {
  id: string;
  promotionId: string;
  batchId: string | null;
  code: string;
  limitScope: 'per_coupon' | 'shared_batch';
  isActive: boolean;
  createdAt: string;
}
