import type { PushAudienceCriterionType, PushAudienceRule } from '@endora-commerce/contracts';

/**
 * Pure push-audience rule evaluator (Rule Builder targeting).
 *
 * Walks the AST defined in `@endora-commerce/contracts/pwa#PushAudienceRule` and returns
 * whether a single subscriber (resolved into the context below) is in the
 * target audience. Mirrors the price-list `evaluateApplicationRule` shape but
 * keeps a boolean result — push targeting has no priority chain.
 *
 * Semantics:
 *   - `{ kind: 'all' }` and any criterion with an empty value list match
 *     everyone (an empty criterion adds no constraint).
 *   - Anonymous subscribers (`customerAccountId === null`) carry null
 *     organization/customer-group/customer context, so only `salesChannel`
 *     criteria (and `all`) can match them.
 */
export interface PushAudienceContext {
  salesChannelId: string;
  organizationId: string | null;
  customerGroupId: string | null;
  customerAccountId: string | null;
}

export function evaluatePushAudienceRule(
  rule: PushAudienceRule,
  ctx: PushAudienceContext,
): boolean {
  if (rule.kind === 'all') return true;

  if (rule.kind === 'criterion') {
    if (rule.values.length === 0) return true;
    return matchesCriterion(rule.type, rule.values, ctx);
  }

  // group node
  if (rule.children.length === 0) return true; // defensive — schema disallows
  if (rule.op === 'AND') {
    return rule.children.every((c) => evaluatePushAudienceRule(c, ctx));
  }
  return rule.children.some((c) => evaluatePushAudienceRule(c, ctx));
}

function matchesCriterion(
  type: PushAudienceCriterionType,
  values: readonly string[],
  ctx: PushAudienceContext,
): boolean {
  switch (type) {
    case 'salesChannel':
      return values.includes(ctx.salesChannelId);
    case 'organization':
      return ctx.organizationId !== null && values.includes(ctx.organizationId);
    case 'customerGroup':
      return ctx.customerGroupId !== null && values.includes(ctx.customerGroupId);
    case 'customer':
      return ctx.customerAccountId !== null && values.includes(ctx.customerAccountId);
  }
}
