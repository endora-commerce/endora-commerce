import {
  promotionUsageLimitScopes,
  type PromotionCreateOutbox,
  type PromotionHookSummary,
} from '@endora-commerce/contracts';
import type { Promotion } from '../entities/promotion.entity.js';

/**
 * A promotion as `PROMOTION_HOOKABLE_ACTIONS` hands it to a `beforeCommit`
 * hook (issue #1844): ids, codes, the type, the window and the limit scopes.
 * Never the name, the description, the amounts or the action's configuration.
 */
export function promotionHookSummary(row: Promotion): PromotionHookSummary {
  return {
    promotionId: row.id,
    code: row.code ?? null,
    kind: row.kind ?? null,
    actionType: row.actionType ?? null,
    isActive: row.isActive,
    ruleId: row.ruleId ?? null,
    organizationId: row.organizationId ?? null,
    customerGroupId: row.customerGroupId ?? null,
    categoryId: row.categoryId ?? null,
    productId: row.productId ?? null,
    currency: row.currency ?? null,
    validFrom: row.validFrom?.toISOString() ?? null,
    validUntil: row.validUntil?.toISOString() ?? null,
    usageLimitScopes: promotionUsageLimitScopes(row),
  };
}

/**
 * The stored `afterCommit` half: `audit-state.md` list 1 only. No promotion
 * code — an operator types it freely — and no targeting `organizationId`,
 * which the outbox would read as the row's routing and pin the handler to
 * that Organization.
 */
export function promotionOutbox(row: Promotion): PromotionCreateOutbox {
  return {
    promotionId: row.id,
    kind: row.kind ?? null,
    actionType: row.actionType ?? null,
    isActive: row.isActive,
    ruleId: row.ruleId ?? null,
    usageLimitScopes: promotionUsageLimitScopes(row),
  };
}
