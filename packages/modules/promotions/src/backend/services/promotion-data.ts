import type { PromotionAction, PromotionCriterion, PromotionRule } from '@endora-commerce/contracts';

/**
 * What an operator's create or edit of a promotion carries — the validated
 * request body, as `routes.ts` hands it on.
 *
 * Here rather than in `promotion-service.ts` since issue #1844: the promotion
 * Commands build the row from it, and the service runs those Commands, so a
 * shared home keeps the import one-directional.
 */
export interface UpsertPromotionInput {
  code?: string | null;
  name: string;
  kind?: 'percentage_off' | 'amount_off' | 'free_delivery';
  value?: number;
  currency?: string | null;
  minCartSubtotal?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  organizationId?: string | null;
  customerGroupId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
  criteria?: PromotionCriterion[];
  isActive?: boolean;
  // Feature 045 — engine fields.
  description?: string | null;
  priority?: number;
  stopFurther?: boolean;
  action?: PromotionAction;
  ruleId?: string | null;
  rule?: PromotionRule | null;
  usageLimitGlobal?: number | null;
  usageLimitPerOrganization?: number | null;
  usageLimitPerCustomer?: number | null;
}

/** Map an upsert input into the entity-assignable data object. */
export function buildPromotionData(input: UpsertPromotionInput): Record<string, unknown> {
  const { actionType, actionConfig } = splitAction(input.action);
  return {
    name: input.name,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.value !== undefined ? { value: String(input.value) } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.minCartSubtotal !== undefined && input.minCartSubtotal !== null
      ? { minCartSubtotal: String(input.minCartSubtotal) }
      : {}),
    ...(input.validFrom !== undefined
      ? { validFrom: input.validFrom ? new Date(input.validFrom) : null }
      : {}),
    ...(input.validUntil !== undefined
      ? { validUntil: input.validUntil ? new Date(input.validUntil) : null }
      : {}),
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.customerGroupId !== undefined ? { customerGroupId: input.customerGroupId } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.productId !== undefined ? { productId: input.productId } : {}),
    ...(input.criteria !== undefined ? { criteria: input.criteria } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.stopFurther !== undefined ? { stopFurther: input.stopFurther } : {}),
    ...(input.action !== undefined ? { actionType, actionConfig } : {}),
    // A rule source set clears the other (mutually exclusive).
    ...(input.ruleId !== undefined ? { ruleId: input.ruleId, ruleDefinition: null } : {}),
    ...(input.rule !== undefined ? { ruleDefinition: input.rule, ruleId: null } : {}),
    ...(input.usageLimitGlobal !== undefined ? { usageLimitGlobal: input.usageLimitGlobal } : {}),
    ...(input.usageLimitPerOrganization !== undefined
      ? { usageLimitPerOrganization: input.usageLimitPerOrganization }
      : {}),
    ...(input.usageLimitPerCustomer !== undefined
      ? { usageLimitPerCustomer: input.usageLimitPerCustomer }
      : {}),
  };
}

/** Split a `PromotionAction` union into the stored `(type, config)` pair. */
function splitAction(action?: PromotionAction): {
  actionType: PromotionAction['type'] | null;
  actionConfig: Record<string, unknown>;
} {
  if (!action) return { actionType: null, actionConfig: {} };
  const { type, ...config } = action;
  return { actionType: type, actionConfig: config };
}

/** The two decimal columns, stored as strings with their scale (`'10.0000'`). */
const DECIMAL_FIELDS = new Set(['value', 'minCartSubtotal']);

/** A JSON text with sorted object keys, so a `jsonb` column read back compares equal to its input. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameValue(field: string, before: unknown, after: unknown): boolean {
  if (before instanceof Date || after instanceof Date) {
    const time = (v: unknown): number | null => (v instanceof Date ? v.getTime() : v == null ? null : new Date(String(v)).getTime());
    return time(before) === time(after);
  }
  if (DECIMAL_FIELDS.has(field) && before != null && after != null) return Number(before) === Number(after);
  return stableJson(before) === stableJson(after);
}

/**
 * The sorted names of the columns `data` changed on a row whose values before
 * the write were `before` — a value written back unchanged (a decimal at
 * another scale, a date at the same instant, a `jsonb` object with its keys in
 * another order) is not a change.
 */
export function changedPromotionFields(
  before: Readonly<Record<string, unknown>>,
  data: Readonly<Record<string, unknown>>,
): string[] {
  return Object.keys(data)
    .filter((field) => !sameValue(field, before[field], data[field]))
    .sort();
}
