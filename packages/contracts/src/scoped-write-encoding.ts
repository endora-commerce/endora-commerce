/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/contracts/write-encoding.md`; research R3;
 * FR-110…FR-118) — the **one** write encoding of scoped product values, for JSON (the admin API,
 * the connector port) and CSV (import and export).
 *
 * | Intent | JSON | CSV |
 * | --- | --- | --- |
 * | No change | absent, or `""` | empty cell |
 * | Empty override (at Global: no value) | `null` | `NULL` |
 * | Remove the own value, inherit | `{ "inherit": true }` | `INHERIT` |
 * | A value | the value | the text (`\` escapes a token) |
 *
 * This differs from JSON Merge Patch (`null` = remove the member) and from Magento's
 * `__EMPTY__VALUE__` (FR-115). Applies to scoped product values only (FR-117). Adding a token
 * later is additive; changing a meaning is a breaking, versioned change (FR-111).
 */

import { z } from 'zod';
import type { FieldScopeSpec, ScopeLevel } from './product-scope-model.js';

export const INHERIT_TOKEN = 'INHERIT';
export const EMPTY_TOKEN = 'NULL';

/** A decoded scoped write. Absent (no change) is `undefined`, never an op. */
export type ScopedWriteOp<T> = { op: 'set'; value: T } | { op: 'empty' } | { op: 'inherit' };

/** The JSON marker that removes the own value. Strict: `{ inherit: true }` and nothing else. */
export const inheritMarkerSchema = z.object({ inherit: z.literal(true) }).strict();
export type InheritMarker = z.infer<typeof inheritMarkerSchema>;

/** The wire form of a scoped write of `T`: the value, `null` (empty) or `{ inherit: true }`. */
export type ScopedWrite<T> = T | null | InheritMarker;

/**
 * The Zod schema of one scoped write: `null | { inherit: true } | valueSchema`, optional, with
 * `""` read as absent (no change). `null` and the marker are tried before the value schema, so a
 * permissive value schema never swallows them.
 */
export function scopedWrite<S extends z.ZodType>(valueSchema: S) {
  return z.preprocess(
    (raw) => (raw === '' ? undefined : raw),
    z.union([z.null(), inheritMarkerSchema, valueSchema]).optional(),
  );
}

function isInheritMarker(raw: unknown): raw is InheritMarker {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === 1 &&
    (raw as { inherit?: unknown }).inherit === true
  );
}

/** The op a parsed {@link scopedWrite} value means; `undefined` = no change. */
export function toScopedWriteOp<T>(raw: T | null | InheritMarker | undefined): ScopedWriteOp<T> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return { op: 'empty' };
  if (isInheritMarker(raw)) return { op: 'inherit' };
  return { op: 'set', value: raw as T };
}

/** The wire form of an op — the inverse of {@link toScopedWriteOp}. */
export function fromScopedWriteOp<T>(op: ScopedWriteOp<T>): ScopedWrite<T> {
  if (op.op === 'empty') return null;
  if (op.op === 'inherit') return { inherit: true };
  return op.value;
}

// --- CSV -------------------------------------------------------------------------------------

export type CsvCell = { kind: 'no_change' } | { kind: 'empty' } | { kind: 'inherit' } | { kind: 'text'; text: string };

/**
 * Which rule set a column takes: `text` columns get the formula-injection guard (§3a, FR-118);
 * `value` columns (numbers, booleans, dates, selects) do not.
 */
export interface CsvColumnOptions {
  column: 'text' | 'value';
}

const TOKEN_ESCAPED = /^\\+(NULL|INHERIT)$/;
const TOKEN_TO_ESCAPE = /^\\*(NULL|INHERIT)$/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Decode one CSV cell (§3, §3a). Tokens are matched on the raw, whole cell; then, in a text
 * column, one leading `'` is dropped; then a cell of backslashes before a token loses one
 * backslash. Anything else is text, verbatim.
 */
export function decodeCsvScopedCell(cell: string, options: CsvColumnOptions = { column: 'text' }): CsvCell {
  if (cell === '') return { kind: 'no_change' };
  if (cell === EMPTY_TOKEN) return { kind: 'empty' };
  if (cell === INHERIT_TOKEN) return { kind: 'inherit' };
  let text = cell;
  if (options.column === 'text' && text.startsWith("'")) text = text.slice(1);
  if (TOKEN_ESCAPED.test(text)) text = text.slice(1);
  return { kind: 'text', text };
}

/**
 * Encode one CSV cell — the inverse of {@link decodeCsvScopedCell}: `decode(encode(x)) = x` for
 * every non-empty text. An empty text has no CSV form (an empty cell means no change); write the
 * empty override as `{ kind: 'empty' }` instead.
 */
export function encodeCsvScopedCell(
  cell: { kind: 'empty' } | { kind: 'inherit' } | { kind: 'text'; text: string },
  options: CsvColumnOptions = { column: 'text' },
): string {
  if (cell.kind === 'empty') return EMPTY_TOKEN;
  if (cell.kind === 'inherit') return INHERIT_TOKEN;
  const { text } = cell;
  if (text === '') throw new Error('An empty text has no CSV form: an empty cell means "no change".');
  if (options.column === 'text' && (text.startsWith("'") || FORMULA_LEAD.test(text))) return `'${text}`;
  if (TOKEN_TO_ESCAPE.test(text)) return `\\${text}`;
  return text;
}

// --- Validation ------------------------------------------------------------------------------

export type ScopedWriteRefusal = 'required_empty' | 'not_emptyable' | 'inherit_at_global';

/**
 * The one place an op is refused for what it means (FR-062, FR-113): `inherit` at Global for
 * every field; `empty` on a required field (name, URL key, required attribute), then on a field
 * that takes no empty override (single selects, booleans). Value shapes and lengths are the
 * value schema's; the scope set is the caller's `FIELD_NOT_AT_SCOPE` check.
 */
export function validateScopedWrite(
  field: Pick<FieldScopeSpec, 'required' | 'emptyable'>,
  op: ScopedWriteOp<unknown>,
  level: ScopeLevel,
): ScopedWriteRefusal | null {
  if (op.op === 'inherit') return level === 'G' ? 'inherit_at_global' : null;
  if (op.op === 'empty') {
    if (field.required) return 'required_empty';
    if (!field.emptyable) return 'not_emptyable';
  }
  return null;
}
