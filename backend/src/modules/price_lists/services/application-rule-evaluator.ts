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
  /**
   * Feature 056 — the acting org's inheritance chain, nearest-first
   * (`[orgId, ...ancestorIds]`). When present, the `organization` criterion
   * matches ANY org in the chain, and the resolver ranks by nearness so a list
   * naming a nearer org outranks one naming a farther ancestor (R5). When
   * absent, it defaults to `[organizationId]` (flat behavior, byte-for-byte).
   */
  organizationChain?: readonly string[];
  customerGroupId: string | null;
  salesChannelId: string;
  currencyCode: string;
  productCategoryIds: ReadonlySet<string>;
}

export interface RuleEvaluation {
  matched: boolean;
  explicitOn: ReadonlySet<RuleCriterionType>;
  /**
   * Feature 056 — index of the NEAREST org (in the resolution chain) that this
   * rule explicitly names, or `undefined` when the rule names no org in the
   * chain. Lower = nearer = higher price-list priority within the `organization`
   * level (R5). A direct-org match (flat) is rank 0.
   */
  organizationRank?: number;
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
    if (rule.type === 'organization') {
      const rank = organizationMatchRank(rule.values, ctx);
      if (rank === undefined) return { matched: false, explicitOn: NO_EXPLICIT };
      return { matched: true, explicitOn: new Set(['organization']), organizationRank: rank };
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
    return {
      matched: true,
      explicitOn: unionExplicit(childEvaluations),
      ...withRank(minRank(childEvaluations)),
    };
  }

  // OR
  const matchingChildren = childEvaluations.filter((e) => e.matched);
  if (matchingChildren.length === 0) return { matched: false, explicitOn: NO_EXPLICIT };
  // Only matching children contribute to the explicit set + nearness rank.
  return {
    matched: true,
    explicitOn: unionExplicit(matchingChildren),
    ...withRank(minRank(matchingChildren)),
  };
}

/**
 * The nearness rank of the nearest org (in `ctx.organizationChain`, else
 * `[organizationId]`) named by `values`, or `undefined` when none match.
 */
function organizationMatchRank(
  values: readonly string[],
  ctx: ResolutionContext,
): number | undefined {
  const chain =
    ctx.organizationChain && ctx.organizationChain.length > 0
      ? ctx.organizationChain
      : ctx.organizationId !== null
        ? [ctx.organizationId]
        : [];
  const valueSet = new Set(values);
  for (let i = 0; i < chain.length; i += 1) {
    if (valueSet.has(chain[i]!)) return i; // nearest-first → first hit is the nearest
  }
  return undefined;
}

function minRank(evaluations: readonly RuleEvaluation[]): number | undefined {
  let min: number | undefined;
  for (const e of evaluations) {
    if (e.organizationRank !== undefined && (min === undefined || e.organizationRank < min)) {
      min = e.organizationRank;
    }
  }
  return min;
}

function withRank(rank: number | undefined): { organizationRank?: number } {
  return rank === undefined ? {} : { organizationRank: rank };
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
      return organizationMatchRank(values, ctx) !== undefined;
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
