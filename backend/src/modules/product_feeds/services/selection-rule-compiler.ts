import type {
  ProductSelectionOp,
  ProductSelectionRule,
  ProductSelectionValue,
} from '@b2b/contracts';

/**
 * Selection-rule compiler — feature 067 / FR-025, FR-029 (T066).
 *
 * A pure function on purpose: the one property that has to hold under every
 * future edit is *fail-closed*, and a pure function is the only shape in which
 * that can be asserted exhaustively without a database.
 *
 * ## The two-stage contract
 *
 * Most criteria compile straight to a MikroORM filter object (never string
 * SQL). Two do not: **stock availability** and **price** live behind other
 * modules' services, not behind a column this module may read (Principle I).
 * Those leaves compile to `true` in the SQL stage — a deliberate **superset** —
 * and the compiler then returns a non-null `evaluate` that decides the rule
 * exactly, in memory, against the values those ports supplied.
 *
 * The superset is therefore never the answer on its own, and the type says so:
 * `evaluate` is non-null exactly when `needsStock || needsPrice`. A caller that
 * ignores it narrows nothing, which is why `ProductSelectionService` asserts on
 * it rather than trusting itself.
 *
 * ## Fail-closed rules (FR-029)
 *
 * - An attribute or custom field that no longer exists **throws**
 *   `UnknownSelectionFieldError`, naming the key. The run records a
 *   configuration error; it never quietly matches everything.
 * - A field/operator pair the compiler cannot express compiles to `{ id: null }`
 *   — *unsatisfiable* — never to `{}`.
 * - A condition with no values is unsatisfiable for the same reason: an
 *   operator who half-filled a criterion gets an empty feed they can see, not a
 *   full one they cannot.
 */

export class UnknownSelectionFieldError extends Error {
  constructor(public readonly key: string) {
    super(`Selection rule references "${key}", which no longer exists.`);
    this.name = 'UnknownSelectionFieldError';
  }
}

/** A predicate that can never be satisfied. The compiler's only fallback. */
const UNSATISFIABLE: Record<string, unknown> = { id: null };

/** A predicate that constrains nothing. Emitted for `all` and for refinement leaves. */
const UNCONSTRAINED: Record<string, unknown> = {};

/**
 * An explicit tautology, for the one place emptiness is not neutral: a branch
 * of `$or`. An empty object inside `$or` is not "match everything" to the query
 * builder — it collapses the branch, which would make the SQL stage *narrower*
 * than the rule rather than a superset, and quietly drop matching products.
 * `id` is the primary key, so `id IS NOT NULL` is true for every row.
 */
const ALWAYS_TRUE: Record<string, unknown> = { id: { $ne: null } };

function isEmptyPredicate(predicate: Record<string, unknown>): boolean {
  return Object.keys(predicate).length === 0;
}

/** The product attribute conventionally holding the manufacturer, as in the item resolver. */
const BRAND_ATTRIBUTE_KEY = 'brand';

export interface SelectionCompileContext {
  /**
   * Every product-host attribute / custom-field key that currently exists.
   * One registry since feature 061, so attributes and custom fields share it.
   */
  knownFieldKeys: ReadonlySet<string>;
  /**
   * Product ids per category id, already expanded over the category's whole
   * subtree (FR-025 "including descendants"). Resolved by the caller so this
   * function stays synchronous and testable.
   */
  categoryProductIds: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The per-product facts the in-memory stage decides on. */
export interface SelectionCandidate {
  id: string;
  type: string;
  status: string;
  attributeValues: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  /** `null` = the inventory port could not say. Fail closed: no match. */
  inStock: boolean | null;
  /** `null` = the pricing port could not say. Fail closed: no match. */
  price: number | null;
}

export interface CompiledSelection {
  /** MikroORM filter object. A superset when `evaluate` is non-null. */
  predicate: Record<string, unknown>;
  /** Non-null exactly when the SQL stage is a superset. */
  evaluate: ((candidate: SelectionCandidate) => boolean) | null;
  needsStock: boolean;
  needsPrice: boolean;
}

/** Every category id named anywhere in the rule, so the caller can expand them once. */
export function collectSelectionCategoryIds(rule: ProductSelectionRule): string[] {
  const out = new Set<string>();
  const walk = (node: ProductSelectionRule): void => {
    if (node.kind === 'group') {
      for (const child of node.children) walk(child);
      return;
    }
    if (node.kind !== 'condition') return;
    if (node.field.kind === 'builtin' && node.field.key === 'category') {
      for (const value of node.values) out.add(String(value));
    }
  };
  walk(rule);
  return [...out];
}

export function compileSelectionRule(
  rule: ProductSelectionRule,
  context: SelectionCompileContext,
): CompiledSelection {
  const needs = { stock: false, price: false };
  const predicate = toPredicate(rule, context, needs);
  const refined = needs.stock || needs.price;
  return {
    predicate,
    evaluate: refined ? (candidate): boolean => matches(rule, context, candidate) : null,
    needsStock: needs.stock,
    needsPrice: needs.price,
  };
}

// ---------------------------------------------------------------------------
// Stage 1 — the SQL predicate
// ---------------------------------------------------------------------------

function toPredicate(
  rule: ProductSelectionRule,
  context: SelectionCompileContext,
  needs: { stock: boolean; price: boolean },
): Record<string, unknown> {
  if (rule.kind === 'all') return UNCONSTRAINED;

  if (rule.kind === 'group') {
    // A refinement leaf contributes nothing to the SQL stage, so it becomes an
    // explicit tautology here: under AND that is harmless, and under OR it is
    // the only way the branch stays the superset the evaluator then narrows.
    const children = rule.children.map((child) => {
      const predicate = toPredicate(child, context, needs);
      return isEmptyPredicate(predicate) ? ALWAYS_TRUE : predicate;
    });
    const operator = rule.op === 'OR' ? '$or' : '$and';
    return { [operator]: children };
  }

  const field = rule.field;
  if (field.kind !== 'builtin') {
    const key = field.kind === 'attribute' ? field.attributeKey : field.fieldKey;
    if (!context.knownFieldKeys.has(key)) throw new UnknownSelectionFieldError(key);
    return jsonPredicate(key, rule.op, rule.values);
  }

  switch (field.key) {
    case 'status':
      return columnPredicate('status', rule.op, rule.values, 'string');
    case 'productType':
      return columnPredicate('type', rule.op, rule.values, 'string');
    case 'createdAt':
    case 'updatedAt':
      return columnPredicate(field.key, rule.op, rule.values, 'date');
    case 'brand':
      return jsonPredicate(BRAND_ATTRIBUTE_KEY, rule.op, rule.values);
    case 'category':
      return categoryPredicate(context, rule.op, rule.values);
    case 'stockState':
      needs.stock = true;
      return UNCONSTRAINED;
    case 'price':
      needs.price = true;
      return UNCONSTRAINED;
    default:
      // Unreachable while the contract enum and this switch agree; if a future
      // enum member arrives without a branch here, it narrows to nothing rather
      // than to everything.
      return UNSATISFIABLE;
  }
}

function categoryPredicate(
  context: SelectionCompileContext,
  op: ProductSelectionOp,
  values: ReadonlyArray<ProductSelectionValue>,
): Record<string, unknown> {
  if (values.length === 0) return UNSATISFIABLE;
  const ids = new Set<string>();
  for (const value of values) {
    for (const productId of context.categoryProductIds.get(String(value)) ?? []) {
      ids.add(productId);
    }
  }
  const list = [...ids];
  switch (op) {
    case 'eq':
    case 'in':
      return { id: { $in: list } };
    case 'neq':
    case 'notIn':
      // An empty membership set means "exclude nothing", which is correct here:
      // the criterion is a subtraction, so it cannot widen past the floor.
      return { id: { $nin: list } };
    default:
      return UNSATISFIABLE;
  }
}

function columnPredicate(
  column: string,
  op: ProductSelectionOp,
  rawValues: ReadonlyArray<ProductSelectionValue>,
  kind: 'string' | 'date',
): Record<string, unknown> {
  if (op !== 'isSet' && op !== 'isNotSet' && rawValues.length === 0) return UNSATISFIABLE;
  const values = kind === 'date' ? rawValues.map(toDate) : [...rawValues];
  if (values.some((value) => value === null)) return UNSATISFIABLE;
  const first = values[0];

  if (kind === 'date') {
    switch (op) {
      case 'eq':
        return { [column]: first };
      case 'neq':
        return { [column]: { $ne: first } };
      case 'gt':
        return { [column]: { $gt: first } };
      case 'gte':
        return { [column]: { $gte: first } };
      case 'lt':
        return { [column]: { $lt: first } };
      case 'lte':
        return { [column]: { $lte: first } };
      case 'between':
        return values.length >= 2
          ? { [column]: { $gte: first, $lte: values[1] } }
          : UNSATISFIABLE;
      default:
        return UNSATISFIABLE;
    }
  }

  switch (op) {
    case 'eq':
      return { [column]: first };
    case 'neq':
      return { [column]: { $ne: first } };
    case 'in':
      return { [column]: { $in: values } };
    case 'notIn':
      return { [column]: { $nin: values } };
    case 'contains':
      return { [column]: { $ilike: `%${String(first)}%` } };
    case 'startsWith':
      return { [column]: { $ilike: `${String(first)}%` } };
    case 'isSet':
      return { [column]: { $ne: null } };
    case 'isNotSet':
      return { [column]: null };
    default:
      return UNSATISFIABLE;
  }
}

/**
 * A condition on the product's JSONB value bag (`products.attribute_values`),
 * which since feature 061 holds attributes and custom fields alike.
 */
function jsonPredicate(
  key: string,
  op: ProductSelectionOp,
  values: ReadonlyArray<ProductSelectionValue>,
): Record<string, unknown> {
  if (op !== 'isSet' && op !== 'isNotSet' && values.length === 0) return UNSATISFIABLE;
  const first = values[0];
  switch (op) {
    case 'eq':
      return { attributeValues: { [key]: first } };
    case 'neq':
      return { attributeValues: { [key]: { $ne: first } } };
    case 'in':
      return { attributeValues: { [key]: { $in: [...values] } } };
    case 'notIn':
      return { attributeValues: { [key]: { $nin: [...values] } } };
    case 'contains':
      return { attributeValues: { [key]: { $ilike: `%${String(first)}%` } } };
    case 'startsWith':
      return { attributeValues: { [key]: { $ilike: `${String(first)}%` } } };
    case 'isSet':
      return { attributeValues: { [key]: { $ne: null } } };
    case 'isNotSet':
      return { attributeValues: { [key]: null } };
    default:
      return UNSATISFIABLE;
  }
}

function toDate(value: ProductSelectionValue): Date | null {
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// Stage 2 — the exact, in-memory evaluation
// ---------------------------------------------------------------------------

function matches(
  rule: ProductSelectionRule,
  context: SelectionCompileContext,
  candidate: SelectionCandidate,
): boolean {
  if (rule.kind === 'all') return true;
  if (rule.kind === 'group') {
    return rule.op === 'OR'
      ? rule.children.some((child) => matches(child, context, candidate))
      : rule.children.every((child) => matches(child, context, candidate));
  }

  const field = rule.field;
  if (field.kind !== 'builtin') {
    const key = field.kind === 'attribute' ? field.attributeKey : field.fieldKey;
    if (!context.knownFieldKeys.has(key)) throw new UnknownSelectionFieldError(key);
    return compareScalar(candidate.attributeValues[key], rule.op, rule.values);
  }

  switch (field.key) {
    case 'status':
      return compareScalar(candidate.status, rule.op, rule.values);
    case 'productType':
      return compareScalar(candidate.type, rule.op, rule.values);
    case 'brand':
      return compareScalar(candidate.attributeValues[BRAND_ATTRIBUTE_KEY], rule.op, rule.values);
    case 'createdAt':
      return compareNumber(candidate.createdAt.getTime(), rule.op, rule.values.map(toTime));
    case 'updatedAt':
      return compareNumber(candidate.updatedAt.getTime(), rule.op, rule.values.map(toTime));
    case 'category': {
      const member = rule.values.some((value) =>
        context.categoryProductIds.get(String(value))?.has(candidate.id) ?? false,
      );
      if (rule.op === 'eq' || rule.op === 'in') return member;
      if (rule.op === 'neq' || rule.op === 'notIn') return !member;
      return false;
    }
    case 'stockState': {
      if (candidate.inStock === null) return false;
      const state = candidate.inStock ? 'in_stock' : 'out_of_stock';
      return compareScalar(state, rule.op, rule.values);
    }
    case 'price':
      if (candidate.price === null) return false;
      return compareNumber(
        candidate.price,
        rule.op,
        rule.values.map((value) => (typeof value === 'number' ? value : Number(value))),
      );
    default:
      return false;
  }
}

function toTime(value: ProductSelectionValue): number {
  const date = toDate(value);
  return date === null ? Number.NaN : date.getTime();
}

function compareScalar(
  actual: unknown,
  op: ProductSelectionOp,
  values: ReadonlyArray<ProductSelectionValue>,
): boolean {
  const present = actual !== null && actual !== undefined && actual !== '';
  if (op === 'isSet') return present;
  if (op === 'isNotSet') return !present;
  if (values.length === 0) return false;
  const text = String(actual ?? '');
  switch (op) {
    case 'eq':
      return text === String(values[0]);
    case 'neq':
      return text !== String(values[0]);
    case 'in':
      return values.some((value) => String(value) === text);
    case 'notIn':
      return !values.some((value) => String(value) === text);
    case 'contains':
      return text.toLowerCase().includes(String(values[0]).toLowerCase());
    case 'startsWith':
      return text.toLowerCase().startsWith(String(values[0]).toLowerCase());
    default:
      return false;
  }
}

function compareNumber(
  actual: number,
  op: ProductSelectionOp,
  values: ReadonlyArray<number>,
): boolean {
  if (values.length === 0 || values.some((value) => Number.isNaN(value))) return false;
  const first = values[0]!;
  switch (op) {
    case 'eq':
      return actual === first;
    case 'neq':
      return actual !== first;
    case 'gt':
      return actual > first;
    case 'gte':
      return actual >= first;
    case 'lt':
      return actual < first;
    case 'lte':
      return actual <= first;
    case 'between':
      return values.length >= 2 && actual >= first && actual <= values[1]!;
    case 'in':
      return values.includes(actual);
    case 'notIn':
      return !values.includes(actual);
    default:
      return false;
  }
}
