import type {
  PromotionRule,
  PromotionRuleCondition,
  PromotionRuleOp,
  PromotionRuleValue,
} from '@b2b/contracts';

/**
 * Feature 045 — pure evaluator for the typed promotion Rule AST.
 *
 * `evaluatePromotionRule(rule, ctx)` returns whether a cart satisfies the
 * rule. It is pure (no clock, no I/O): the caller assembles the
 * `PromotionRuleContext` from the cart snapshot. Attribute conditions are
 * evaluated against an aggregated per-key value view of the cart; a
 * condition over an attribute that has lost its promo-eligibility flag is
 * treated as non-matching and reported through `onSkip` (FR-039 parity).
 */
export interface PromotionRuleContext {
  cartTotal: number;
  paymentMethodCode: string | null;
  deliveryMethodCode: string | null;
  deliveryCountry: string | null;
  deliveryPostalCode: string | null;
  organizationId: string | null;
  customerGroupId: string | null;
  /** Union of every line's category ids. */
  categoryIds: readonly string[];
  /** Per-attribute-key list of values present across cart lines. */
  attributeValues: Readonly<Record<string, readonly PromotionRuleValue[]>>;
  /** When provided, an attribute returning `false` is skipped (treated non-matching). */
  isPromoEligibleAttribute?: (key: string) => boolean;
  onSkip?: (info: { attributeKey: string; reason: 'attribute_not_promo_eligible' }) => void;
}

export function evaluatePromotionRule(rule: PromotionRule, ctx: PromotionRuleContext): boolean {
  switch (rule.kind) {
    case 'all':
      return true;
    case 'group':
      return rule.op === 'AND'
        ? rule.children.every((child) => evaluatePromotionRule(child, ctx))
        : rule.children.some((child) => evaluatePromotionRule(child, ctx));
    case 'condition':
      return evaluateCondition(rule, ctx);
    default:
      return false;
  }
}

function evaluateCondition(cond: PromotionRuleCondition, ctx: PromotionRuleContext): boolean {
  if (cond.field.kind === 'attribute') {
    const key = cond.field.attributeKey;
    if (ctx.isPromoEligibleAttribute && !ctx.isPromoEligibleAttribute(key)) {
      ctx.onSkip?.({ attributeKey: key, reason: 'attribute_not_promo_eligible' });
      return false;
    }
    const present = ctx.attributeValues[key] ?? [];
    // Set-style operators compare the whole present-value set; scalar
    // operators match if ANY present value satisfies the condition.
    if (cond.op === 'in') return present.some((v) => cond.values.includes(v));
    if (cond.op === 'notIn') return !present.some((v) => cond.values.includes(v));
    return present.some((v) => matchScalar(v, cond.op, cond.values));
  }

  switch (cond.field.key) {
    case 'cartTotal':
      return matchScalar(ctx.cartTotal, cond.op, cond.values);
    case 'paymentMethod':
      return matchScalar(ctx.paymentMethodCode, cond.op, cond.values);
    case 'deliveryMethod':
      return matchScalar(ctx.deliveryMethodCode, cond.op, cond.values);
    case 'deliveryCountry':
      return matchScalar(ctx.deliveryCountry, cond.op, cond.values);
    case 'deliveryPostalCode':
      return matchScalar(ctx.deliveryPostalCode, cond.op, cond.values);
    case 'organization':
      return matchScalar(ctx.organizationId, cond.op, cond.values);
    case 'customerGroup':
      return matchScalar(ctx.customerGroupId, cond.op, cond.values);
    case 'category':
      return matchSet(ctx.categoryIds, cond.op, cond.values);
    default:
      return false;
  }
}

/** Set membership for multi-valued subjects (e.g. category ids). */
function matchSet(
  subject: readonly PromotionRuleValue[],
  op: PromotionRuleOp,
  values: readonly PromotionRuleValue[],
): boolean {
  const intersects = subject.some((s) => values.includes(s));
  switch (op) {
    case 'in':
    case 'eq':
      return intersects;
    case 'notIn':
    case 'neq':
      return !intersects;
    default:
      return false;
  }
}

/** Scalar comparison for a single (possibly null) subject. */
function matchScalar(
  subject: PromotionRuleValue | null,
  op: PromotionRuleOp,
  values: readonly PromotionRuleValue[],
): boolean {
  switch (op) {
    case 'eq':
      return values.some((v) => looseEq(subject, v));
    case 'neq':
      return subject != null && !values.some((v) => looseEq(subject, v));
    case 'in':
      return subject != null && values.some((v) => looseEq(subject, v));
    case 'notIn':
      return subject != null && !values.some((v) => looseEq(subject, v));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareNumeric(subject, op, values[0]);
    case 'between': {
      const num = toNumber(subject);
      const lo = toNumber(values[0]);
      const hi = toNumber(values[1]);
      if (num == null || lo == null || hi == null) return false;
      return num >= lo && num <= hi;
    }
    case 'contains':
      return subject != null && values.some((v) => String(subject).includes(String(v)));
    case 'startsWith':
      return subject != null && values.some((v) => String(subject).startsWith(String(v)));
    default:
      return false;
  }
}

function compareNumeric(
  subject: PromotionRuleValue | null,
  op: 'gt' | 'gte' | 'lt' | 'lte',
  value: PromotionRuleValue | undefined,
): boolean {
  const a = toNumber(subject);
  const b = toNumber(value);
  if (a == null || b == null) return false;
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
  }
}

function toNumber(v: PromotionRuleValue | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function looseEq(a: PromotionRuleValue | null, b: PromotionRuleValue): boolean {
  if (a == null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na != null && nb != null) return na === nb;
  }
  return String(a) === String(b);
}
