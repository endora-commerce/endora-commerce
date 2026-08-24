import type { CartLine, PromotionCriterion } from '@endora-commerce/contracts';

/**
 * Feature 012 / US8 — pure rule evaluator for the promotions module.
 *
 * `matches(criterion, line, ctx)` returns `true` iff the cart line
 * satisfies the criterion. Today only the `attribute` variant carries
 * line-level meaning; the other variants are routed through the
 * existing flat eligibility filters in `PromotionService`.
 *
 * The function is pure — no clock, no I/O — so identical inputs always
 * produce identical outputs. Attribute lookups MUST be passed in via
 * `ctx.attributeLookup` to keep the evaluator deterministic and
 * testable. The lookup is built once per `applyToCart` call.
 *
 * Skip-on-toggle (FR-039): when the looked-up attribute carries
 * `isPromoRule = false`, the criterion is treated as `false` and the
 * decision is logged once at `info` via `ctx.onSkip`.
 */

export interface PromotionRuleAttributeLookup {
  /**
   * Returns the attribute's metadata (with options) by key, or `null`
   * if the attribute does not exist. The lookup is expected to be
   * pre-populated by `PromotionService.applyToCart` for every key any
   * active promotion's criteria reference.
   */
  get(key: string): {
    id: string;
    key: string;
    valueType:
      | 'string'
      | 'number'
      | 'boolean'
      | 'date'
      | 'enum'
      | 'select'
      | 'multiselect'
      | 'price';
    isPromoRule: boolean;
    options: Array<{ value: string }>;
  } | null;
}

export interface PromotionRuleEvaluationContext {
  attributeLookup: PromotionRuleAttributeLookup;
  /** Hook fired when a criterion is skipped due to FR-039. */
  onSkip?: (info: {
    promotionId: string;
    criterionAttributeKey: string;
    reason: 'attribute_not_promo_eligible' | 'attribute_not_found';
  }) => void;
  /** Identifier passed to `onSkip` so the operator can correlate. */
  promotionId: string;
}

/**
 * Per-criterion match. Returns `true` if the line satisfies the
 * criterion. For `attribute` criteria with `attributeValues` available
 * on the cart line, the lookup is consulted to determine the operator
 * vocabulary; if the attribute is missing or has `isPromoRule=false`
 * the criterion is silently skipped (treated as `false` per FR-039).
 */
export function matches(
  criterion: PromotionCriterion,
  line: CartLine,
  ctx: PromotionRuleEvaluationContext,
): boolean {
  if (criterion.type === 'category') {
    return criterion.categoryIds.some((id) => line.categoryIds.includes(id));
  }
  if (criterion.type === 'product') {
    return criterion.productIds.includes(line.productId);
  }
  if (criterion.type === 'customerGroup' || criterion.type === 'organization') {
    // Routed at the cart level; not a line-level filter.
    return true;
  }

  // criterion.type === 'attribute'
  const meta = ctx.attributeLookup.get(criterion.attributeKey);
  if (!meta) {
    ctx.onSkip?.({
      promotionId: ctx.promotionId,
      criterionAttributeKey: criterion.attributeKey,
      reason: 'attribute_not_found',
    });
    return false;
  }
  if (!meta.isPromoRule) {
    ctx.onSkip?.({
      promotionId: ctx.promotionId,
      criterionAttributeKey: criterion.attributeKey,
      reason: 'attribute_not_promo_eligible',
    });
    return false;
  }

  const raw = line.attributeValues?.[criterion.attributeKey];
  if (raw == null) return false;

  switch (criterion.op) {
    case 'equals':
      return scalarEquals(raw, criterion.values[0], meta.valueType);
    case 'in':
      if (Array.isArray(raw)) {
        // multiselect — any-of semantics
        return raw.some((v) => criterion.values.includes(v));
      }
      return criterion.values.includes(raw);
    case 'range': {
      const [min, max] = criterion.values as [unknown, unknown];
      if (meta.valueType === 'date') {
        const r = Date.parse(String(raw));
        const lo = Date.parse(String(min));
        const hi = Date.parse(String(max));
        if (!Number.isFinite(r) || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;
        return r >= lo && r <= hi;
      }
      const num = Number(raw);
      const lo = Number(min);
      const hi = Number(max);
      if (!Number.isFinite(num) || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;
      return num >= lo && num <= hi;
    }
    default:
      return false;
  }
}

function scalarEquals(
  raw: unknown,
  expected: unknown,
  valueType:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'select'
    | 'multiselect'
    | 'price',
): boolean {
  if (valueType === 'number' || valueType === 'price') {
    return Number(raw) === Number(expected);
  }
  if (valueType === 'boolean') {
    return Boolean(raw) === Boolean(expected);
  }
  if (valueType === 'multiselect' && Array.isArray(raw)) {
    return raw.length === 1 && raw[0] === expected;
  }
  return String(raw) === String(expected);
}

/**
 * `lineMatchesAllCriteria(criteria, line, ctx)` — true iff every
 * `attribute` / `category` / `product` criterion in the array matches
 * the line. Cart-level criteria (`customerGroup`, `organization`) are
 * always treated as `true` here (routed at the cart level instead).
 */
export function lineMatchesAllCriteria(
  criteria: readonly PromotionCriterion[],
  line: CartLine,
  ctx: PromotionRuleEvaluationContext,
): boolean {
  for (const c of criteria) {
    if (!matches(c, line, ctx)) return false;
  }
  return true;
}
