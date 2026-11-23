// `promotions`' hookable actions — issue #1844, on the mechanism of
// `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md` §6).
//
// The four promotion and coupon writes an instance may take part in through a
// command hook. The action strings, the phases and the data types are a public
// contract: changing one is a changeset on `@endora-commerce/contracts`.
//
// The action strings and object types are the audit entries these writes
// recorded before they were Commands, kept so the audit log reads the same:
// both coupon writes are recorded against their **promotion**
// (`objectType: 'promotion'`, `objectId` the promotion's id).
//
// The data is ids, codes, types and limit scopes — never a name, a
// description, an amount or anything about a customer. A coupon or promotion
// code is free text an operator typed, so it travels only in the in-memory
// `beforeCommit` data and never in a stored outbox row.

import { hookableAction } from './command-hooks.js';
import type { CouponLimitScope, PromotionAction, PromotionKind } from './promotions.js';

/** A usage limit's scope: which of the three caps a promotion sets. */
export type PromotionUsageLimitScope = 'global' | 'per_organization' | 'per_customer';

/**
 * The scopes a promotion sets a usage limit on, in a fixed order
 * (`global`, `per_organization`, `per_customer`) — the names, never the limits.
 */
export function promotionUsageLimitScopes(limits: {
  readonly usageLimitGlobal?: number | null | undefined;
  readonly usageLimitPerOrganization?: number | null | undefined;
  readonly usageLimitPerCustomer?: number | null | undefined;
}): PromotionUsageLimitScope[] {
  const scopes: PromotionUsageLimitScope[] = [];
  if (limits.usageLimitGlobal != null) scopes.push('global');
  if (limits.usageLimitPerOrganization != null) scopes.push('per_organization');
  if (limits.usageLimitPerCustomer != null) scopes.push('per_customer');
  return scopes;
}

/**
 * A promotion as a hook sees it: its id and code, its type, its targeting ids,
 * its window and which usage limits it sets. `promotion` reflects the
 * **uncommitted** row on the Command's transaction.
 */
export interface PromotionHookSummary {
  readonly promotionId: string;
  /** The promotion's own (legacy) code; `null` when it has none. */
  readonly code: string | null;
  /** The legacy effect, when the promotion is driven by one. */
  readonly kind: PromotionKind | null;
  /** The feature-045 action type, when the promotion is driven by one. */
  readonly actionType: PromotionAction['type'] | null;
  readonly isActive: boolean;
  /** The named rule it references; `null` for an inline rule or none. */
  readonly ruleId: string | null;
  readonly organizationId: string | null;
  readonly customerGroupId: string | null;
  readonly categoryId: string | null;
  readonly productId: string | null;
  /** ISO-4217 code, for an amount-denominated promotion. */
  readonly currency: string | null;
  /** ISO timestamps; `null` for an open end. */
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly usageLimitScopes: readonly PromotionUsageLimitScope[];
}

/** `promotion.create` — an operator creates a promotion. */
export type PromotionCreateHookData = PromotionHookSummary;

/**
 * `promotion.update` — an operator edits a promotion. This is also how a
 * promotion is switched on and off: `activationChange` says whether this write
 * did either.
 */
export interface PromotionUpdateHookData extends PromotionHookSummary {
  /** Sorted names of the columns whose value changed. */
  readonly changedFields: readonly string[];
  /** `activated` / `deactivated` when `isActive` flipped; `null` otherwise. */
  readonly activationChange: 'activated' | 'deactivated' | null;
}

/** `coupon.create_single` — an operator adds one specified coupon to a promotion. */
export interface CouponCreateSingleHookData {
  readonly promotionId: string;
  readonly couponId: string;
  readonly code: string;
  readonly limitScope: CouponLimitScope;
}

/** `coupon.generate_batch` — an operator generates a batch of coupons for a promotion. */
export interface CouponGenerateBatchHookData {
  readonly promotionId: string;
  readonly batchId: string;
  /** How many coupons the batch inserted. */
  readonly generated: number;
  readonly limitScope: CouponLimitScope;
  /** The generated codes, in insertion order. */
  readonly codes: readonly string[];
}

/**
 * `afterCommit` data: ids, codes from a closed set, booleans, counts and field
 * names only (`specs/conventions/audit-state.md` list 1). No promotion or
 * coupon code, which an operator types freely; a handler re-reads what it
 * needs after the commit.
 */
export type PromotionCreateOutbox = {
  readonly promotionId: string;
  readonly kind: string | null;
  readonly actionType: string | null;
  readonly isActive: boolean;
  readonly ruleId: string | null;
  readonly usageLimitScopes: readonly string[];
};
export type PromotionUpdateOutbox = PromotionCreateOutbox & {
  readonly changedFields: readonly string[];
  readonly activationChange: string | null;
};
export type CouponCreateSingleOutbox = {
  readonly promotionId: string;
  readonly couponId: string;
  readonly limitScope: string;
};
export type CouponGenerateBatchOutbox = {
  readonly promotionId: string;
  readonly batchId: string;
  readonly generated: number;
  readonly limitScope: string;
};

/**
 * The refs a hook author registers against
 * (`ctx.commandHooks([{ on: PROMOTION_HOOKABLE_ACTIONS.create, … }])`) and the
 * `promotions` manifest lists. All four offer both phases; the `afterCommit`
 * delivery is the transactional outbox.
 */
export const PROMOTION_HOOKABLE_ACTIONS = {
  create: hookableAction<PromotionCreateHookData, PromotionCreateOutbox>('promotion.create', 'promotion', [
    'beforeCommit',
    'afterCommit',
  ]),
  update: hookableAction<PromotionUpdateHookData, PromotionUpdateOutbox>('promotion.update', 'promotion', [
    'beforeCommit',
    'afterCommit',
  ]),
  createCoupon: hookableAction<CouponCreateSingleHookData, CouponCreateSingleOutbox>(
    'coupon.create_single',
    'promotion',
    ['beforeCommit', 'afterCommit'],
  ),
  generateCouponBatch: hookableAction<CouponGenerateBatchHookData, CouponGenerateBatchOutbox>(
    'coupon.generate_batch',
    'promotion',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;
