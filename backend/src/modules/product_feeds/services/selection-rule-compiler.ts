import type {
  CatalogProductFilter,
  CatalogProductFilterField,
  CatalogProductFilterOperator,
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
 * Most criteria compile straight to a {@link CatalogProductFilter} — `catalog`'s
 * published grammar, never a MikroORM object and never string SQL. Two do not:
 * **stock availability** and **price** live behind other modules' services, not
 * behind a column this module may read (Principle I). Those leaves compile to
 * `all` in the query stage — a deliberate **superset** — and the compiler then
 * returns a non-null `evaluate` that decides the rule exactly, in memory,
 * against the values those ports supplied.
 *
 * The superset is therefore never the answer on its own, and the type says so:
 * `evaluate` is non-null exactly when `needsStock || needsPrice`. A caller that
 * ignores it narrows nothing, which is why `ProductSelectionService` asserts on
 * it rather than trusting itself.
 *
 * ## Why the output is a published filter rather than a query object
 *
 * Feature 075. Until the cut this file emitted a MikroORM `where` that
 * `product-selection.service.ts` handed to `em.find(Product, where as never)` —
 * a query against another module's table, and the one demand Phase P declined
 * to guess at. `catalog` publishes `CatalogProductFilter` now: six columns, the
 * attribute bag, twelve operators, two combinators. Everything this compiler
 * emitted is expressible in it, and nothing it could emit is a join, a relation
 * or a raw fragment.
 *
 * ## Fail-closed rules (FR-029)
 *
 * - An attribute or custom field that no longer exists **throws**
 *   `UnknownSelectionFieldError`, naming the key. The run records a
 *   configuration error; it never quietly matches everything.
 * - A field/operator pair the compiler cannot express compiles to `none` —
 *   *unsatisfiable* — never to `all`.
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

/** A filter that can never be satisfied. The compiler's only fallback. */
const UNSATISFIABLE: CatalogProductFilter = { kind: 'none' };

/**
 * A filter that constrains nothing. Emitted for `all` and for the refinement
 * leaves, whose narrowing happens in memory.
 *
 * Naming it — rather than letting an empty predicate stand for it — is what
 * makes it safe inside an `or` branch: an empty object collapses the branch to
 * the query builder, which would make the query stage *narrower* than the rule
 * rather than a superset and quietly drop matching products. `catalog`'s
 * translator turns this node into an explicit tautology for exactly that case.
 */
const UNCONSTRAINED: CatalogProductFilter = { kind: 'all' };

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
  /** `catalog`'s published filter grammar. A superset when `evaluate` is non-null. */
  filter: CatalogProductFilter;
  /** Non-null exactly when the query stage is a superset. */
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
  const filter = toFilter(rule, context, needs);
  const refined = needs.stock || needs.price;
  return {
    filter,
    evaluate: refined ? (candidate): boolean => matches(rule, context, candidate) : null,
    needsStock: needs.stock,
    needsPrice: needs.price,
  };
}

// ---------------------------------------------------------------------------
// Stage 1 — the published filter
// ---------------------------------------------------------------------------

function toFilter(
  rule: ProductSelectionRule,
  context: SelectionCompileContext,
  needs: { stock: boolean; price: boolean },
): CatalogProductFilter {
  if (rule.kind === 'all') return UNCONSTRAINED;

  if (rule.kind === 'group') {
    // The schema requires at least one child, so this is unreachable through
    // the API — and it is still spelled out, because the empty reading of `or`
    // is "no branch matched" and defaulting it to `all` would be the one shape
    // this file exists to refuse.
    if (rule.children.length === 0) return rule.op === 'OR' ? UNSATISFIABLE : UNCONSTRAINED;
    return {
      kind: 'group',
      op: rule.op === 'OR' ? 'or' : 'and',
      children: rule.children.map((child) => toFilter(child, context, needs)),
    };
  }

  const field = rule.field;
  if (field.kind !== 'builtin') {
    const key = field.kind === 'attribute' ? field.attributeKey : field.fieldKey;
    if (!context.knownFieldKeys.has(key)) throw new UnknownSelectionFieldError(key);
    return attributeFilter(key, rule.op, rule.values);
  }

  switch (field.key) {
    case 'status':
      return columnFilter('status', rule.op, rule.values, 'string');
    case 'productType':
      return columnFilter('type', rule.op, rule.values, 'string');
    case 'createdAt':
    case 'updatedAt':
      return columnFilter(field.key, rule.op, rule.values, 'date');
    case 'brand':
      return attributeFilter(BRAND_ATTRIBUTE_KEY, rule.op, rule.values);
    case 'category':
      return categoryFilter(context, rule.op, rule.values);
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

/** One leaf, addressed at a column or at a key of the attribute bag. */
function condition(
  field: CatalogProductFilterField,
  op: CatalogProductFilterOperator,
  values: ReadonlyArray<ProductSelectionValue | Date>,
): CatalogProductFilter {
  return { kind: 'condition', field, op, values: [...values] };
}

function categoryFilter(
  context: SelectionCompileContext,
  op: ProductSelectionOp,
  values: ReadonlyArray<ProductSelectionValue>,
): CatalogProductFilter {
  if (values.length === 0) return UNSATISFIABLE;
  const ids = new Set<string>();
  for (const value of values) {
    for (const productId of context.categoryProductIds.get(String(value)) ?? []) {
      ids.add(productId);
    }
  }
  const list = [...ids];
  const field: CatalogProductFilterField = { kind: 'column', column: 'id' };
  switch (op) {
    case 'eq':
    case 'in':
      // An empty membership set is `in []`, which selects nothing — the right
      // answer for "in a category that holds no products".
      return list.length === 0 ? UNSATISFIABLE : condition(field, 'in', list);
    case 'neq':
    case 'notIn':
      // An empty membership set means "exclude nothing", which is correct here:
      // the criterion is a subtraction, so it cannot widen past the floor.
      return list.length === 0 ? UNCONSTRAINED : condition(field, 'nin', list);
    default:
      return UNSATISFIABLE;
  }
}

function columnFilter(
  column: 'status' | 'type' | 'createdAt' | 'updatedAt',
  op: ProductSelectionOp,
  rawValues: ReadonlyArray<ProductSelectionValue>,
  kind: 'string' | 'date',
): CatalogProductFilter {
  if (op !== 'isSet' && op !== 'isNotSet' && rawValues.length === 0) return UNSATISFIABLE;
  // A date the operator typed that no `Date` can be made of is unsatisfiable,
  // never "ignore that value" — the criterion is broken and the feed is empty
  // rather than wrong.
  const values: Array<ProductSelectionValue | Date> = [];
  for (const raw of rawValues) {
    const value = kind === 'date' ? toDate(raw) : raw;
    if (value === null) return UNSATISFIABLE;
    values.push(value);
  }
  const field: CatalogProductFilterField = { kind: 'column', column };

  if (kind === 'date') {
    switch (op) {
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return condition(field, COMPARISON_OPS[op], values);
      case 'between':
        // A range is two conditions under an `and`, because the published
        // grammar has one operator per condition — which is also what stops it
        // growing a second value slot nothing else would use.
        return values.length >= 2
          ? {
              kind: 'group',
              op: 'and',
              children: [
                condition(field, 'gte', [values[0]!]),
                condition(field, 'lte', [values[1]!]),
              ],
            }
          : UNSATISFIABLE;
      default:
        return UNSATISFIABLE;
    }
  }

  const translated = STRING_OPS[op];
  return translated === undefined ? UNSATISFIABLE : condition(field, translated, values);
}

/**
 * A condition on the product's JSONB value bag (`products.attribute_values`),
 * which since feature 061 holds attributes and custom fields alike.
 */
function attributeFilter(
  key: string,
  op: ProductSelectionOp,
  values: ReadonlyArray<ProductSelectionValue>,
): CatalogProductFilter {
  if (op !== 'isSet' && op !== 'isNotSet' && values.length === 0) return UNSATISFIABLE;
  const translated = STRING_OPS[op];
  if (translated === undefined) return UNSATISFIABLE;
  return condition({ kind: 'attribute', key }, translated, values);
}

/** The six ordered comparisons, which mean the same thing on both sides. */
const COMPARISON_OPS: Record<
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
  CatalogProductFilterOperator
> = { eq: 'eq', neq: 'ne', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte' };

/**
 * The operators a string column or an attribute value accepts. An operator
 * missing from this table is one the published grammar cannot express against
 * a text value — an ordered comparison, or a range — and the caller gets
 * `none` rather than a filter that quietly means something else.
 */
const STRING_OPS: Partial<Record<ProductSelectionOp, CatalogProductFilterOperator>> = {
  eq: 'eq',
  neq: 'ne',
  in: 'in',
  notIn: 'nin',
  contains: 'contains',
  startsWith: 'startsWith',
  isSet: 'isNotNull',
  isNotSet: 'isNull',
};

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
