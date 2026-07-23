import type {
  AttributeValueType,
  ComparisonAttributeRow,
  ComparisonRowClass,
} from '@b2b/contracts';

/**
 * The slice of the catalog's composed `CatalogAttributeView` this projection
 * needs (feature 061 — comparisons no longer imports catalog entities; the
 * definitions arrive through the injected `CatalogAttributeReadService`).
 */
export interface ComparableAttributeDefinition {
  key: string;
  label: Record<string, string>;
  valueType: AttributeValueType;
}

/**
 * Pure projection from "products + comparable-attribute definitions" to
 * the body rows of the comparison page (and PDF). Implements research.md
 * R-6 algorithm.
 *
 * Inputs:
 *   - `products` — the column-ordered list of products in the comparison.
 *     Each product carries its `attributeValues` JSONB record (catalog
 *     stores values keyed by attribute key).
 *   - `attributeDefinitions` — every catalog attribute flagged
 *     `is_comparable=true`, in display order. Order is preserved in the
 *     output so the client / PDF both render rows top-to-bottom in the
 *     same sequence.
 *
 * Output: one `ComparisonAttributeRow` per definition, with one entry
 * per product (in column order) and the row's classification (`common`
 * vs `different`). Pre-formatted strings ride on the wire so the
 * storefront table doesn't have to re-format multi-value attributes.
 *
 * Equality semantics (R-6):
 *   - `multiselect`           — set equality (full overlap), order-insensitive.
 *   - `enum` / `string`       — `===` after `String(v).trim()`.
 *   - `number` / `price`      — `===` after `Number(v)` (no tolerance).
 *   - `boolean`               — `===`.
 *   - `date`                  — `===` after ISO-8601 normalisation (parse → toISOString).
 *   - missing value on either side — classified as `different`; cell is `null`.
 *
 * Pure: no DB, no HTTP, no I/O. Unit-testable in isolation.
 */
export class ComparableAttributeProjection {
  projectRows(
    products: Array<{ attributeValues: Record<string, unknown> }>,
    attributeDefinitions: ComparableAttributeDefinition[],
  ): ComparisonAttributeRow[] {
    return attributeDefinitions.map((def) => {
      const rawValues = products.map((p) => p.attributeValues?.[def.key]);
      const formatted = rawValues.map((v) =>
        formatForDisplay(def.valueType, v),
      );
      const rowClass: ComparisonRowClass = classifyRow(def.valueType, rawValues);
      return {
        key: def.key,
        label: def.label,
        valueType: def.valueType,
        values: formatted,
        rowClass,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (file-private — exported for testing only).
// ---------------------------------------------------------------------------

/** Returns true when v should be treated as "no value". */
function isMissing(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

/**
 * Pre-format a raw `attributeValues[key]` for display. Returns null when
 * the value is missing — the storefront / PDF render `—` for null cells.
 */
export function formatForDisplay(
  valueType: AttributeValueType,
  v: unknown,
): string | null {
  if (isMissing(v)) return null;
  switch (valueType) {
    case 'multiselect':
      // Sorted for stable visual presentation across re-renders.
      return Array.isArray(v) ? [...v].map(String).sort().join(', ') : String(v);
    case 'date':
      // Best-effort ISO normalisation; if the catalog value is already a
      // valid date string, this is idempotent.
      return normaliseDate(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
    case 'price':
      return String(Number(v));
    case 'enum':
    case 'string':
    default:
      return String(v).trim();
  }
}

/**
 * Returns 'common' iff every product carries an equivalent value for the
 * attribute (per R-6 equality semantics) AND no product is missing. Any
 * other case is 'different'.
 */
export function classifyRow(
  valueType: AttributeValueType,
  rawValues: unknown[],
): ComparisonRowClass {
  if (rawValues.length < 2) {
    // 0 or 1 product: trivially "common" — no disagreement possible.
    return 'common';
  }
  if (rawValues.some(isMissing)) return 'different';

  const [head, ...rest] = rawValues;
  for (const v of rest) {
    if (!equalsForType(valueType, head, v)) return 'different';
  }
  return 'common';
}

function equalsForType(
  valueType: AttributeValueType,
  a: unknown,
  b: unknown,
): boolean {
  switch (valueType) {
    case 'multiselect': {
      const sa = Array.isArray(a) ? new Set(a.map(String)) : new Set([String(a)]);
      const sb = Array.isArray(b) ? new Set(b.map(String)) : new Set([String(b)]);
      if (sa.size !== sb.size) return false;
      for (const v of sa) {
        if (!sb.has(v)) return false;
      }
      return true;
    }
    case 'number':
    case 'price':
      return Number(a) === Number(b);
    case 'boolean':
      return Boolean(a) === Boolean(b);
    case 'date':
      return normaliseDate(a) === normaliseDate(b);
    case 'enum':
    case 'string':
    default:
      return String(a).trim() === String(b).trim();
  }
}

function normaliseDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const parsed = new Date(String(v));
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}
