import type { ApplicationRule, RuleCriterionType } from '@b2b/contracts';

/**
 * Pure rule evaluator (feature 011 / FR-022, FR-023, FR-026, FR-029).
 *
 * Walks the discriminated-union AST and returns:
 *   - `matched`: the overall AST truth value against the resolution context.
 *   - `explicitOn`: the criterion types that contributed to the match AND
 *     had non-empty value lists. The resolver's priority chain consults this
 *     to award the per-step boost (FR-026 steps 1..4).
 *
 * Notes:
 *   - The `category` criterion is product-driven (FR-029): it matches when
 *     the product belongs to any category named in the rule's value list.
 *   - The `currency` criterion never appears in the priority chain even
 *     when explicit; it is purely a matching criterion.
 *   - `{ kind: 'all' }` and any criterion with `values: []` are treated as
 *     always-true and contribute nothing to `explicitOn` (FR-022).
 */
export interface ResolutionContext {
  organizationId: string | null;
  customerGroupId: string | null;
  salesChannelId: string;
  currencyCode: string;
  productCategoryIds: ReadonlySet<string>;
}

export interface RuleEvaluation {
  matched: boolean;
  explicitOn: ReadonlySet<RuleCriterionType>;
}

const NO_EXPLICIT: ReadonlySet<RuleCriterionType> = new Set();

export function evaluateApplicationRule(
  rule: ApplicationRule,
  ctx: ResolutionContext,
): RuleEvaluation {
  if (rule.kind === 'all') {
    return { matched: true, explicitOn: NO_EXPLICIT };
  }

  if (rule.kind === 'criterion') {
    if (rule.values.length === 0) {
      return { matched: true, explicitOn: NO_EXPLICIT };
    }
    const matched = matchesCriterion(rule.type, rule.values, ctx);
    return {
      matched,
      explicitOn: matched ? new Set([rule.type]) : NO_EXPLICIT,
    };
  }

  // group node
  if (rule.children.length === 0) {
    // defensive — schema disallows, but evaluate as always-true (empty AND/OR)
    return { matched: true, explicitOn: NO_EXPLICIT };
  }
  const childEvaluations = rule.children.map((c) => evaluateApplicationRule(c, ctx));

  if (rule.op === 'AND') {
    const allMatch = childEvaluations.every((e) => e.matched);
    if (!allMatch) return { matched: false, explicitOn: NO_EXPLICIT };
    return { matched: true, explicitOn: unionExplicit(childEvaluations) };
  }

  // OR
  const anyMatch = childEvaluations.some((e) => e.matched);
  if (!anyMatch) return { matched: false, explicitOn: NO_EXPLICIT };
  // Only matching children contribute to the explicit set.
  return {
    matched: true,
    explicitOn: unionExplicit(childEvaluations.filter((e) => e.matched)),
  };
}

function matchesCriterion(
  type: RuleCriterionType,
  values: readonly string[],
  ctx: ResolutionContext,
): boolean {
  switch (type) {
    case 'salesChannel':
      return values.includes(ctx.salesChannelId);
    case 'organization':
      return ctx.organizationId !== null && values.includes(ctx.organizationId);
    case 'customerGroup':
      return ctx.customerGroupId !== null && values.includes(ctx.customerGroupId);
    case 'category':
      return values.some((c) => ctx.productCategoryIds.has(c));
    case 'currency':
      return values.includes(ctx.currencyCode);
  }
}

function unionExplicit(
  evaluations: readonly RuleEvaluation[],
): ReadonlySet<RuleCriterionType> {
  const out = new Set<RuleCriterionType>();
  for (const e of evaluations) {
    for (const t of e.explicitOn) out.add(t);
  }
  return out;
}
