/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/contracts/write-encoding.md` §4, SC-014) —
 * the **one** shared case table of the scoped write encoding.
 *
 * Imported, never copied, by every test of a scoped write path: the pure codec test beside
 * this file, the save API (`backend/test/contract/catalog/scoped-values-encoding.test.ts`),
 * the CSV import (`backend/test/integration/import_export/products-csv-encoding.test.ts`) and
 * the connector contract (`pim-locale-mapping.test.ts`). A row added here is a row every path
 * must honour.
 *
 * Each case carries **either** a JSON value (the API / connector body, `json`) **or** a CSV
 * cell (`csv`). `expect` is what the path must do with it: `no_change`, the decoded
 * {@link ScopedWriteOp}, or a {@link ScopedWriteRefusal}. A CSV `set` carries the decoded
 * **text**; converting it to a number or a list is the column's own parser.
 */

import type { FieldScopeSpec, ScopeLevel } from './product-scope-model.js';
import type { ScopedWriteOp, ScopedWriteRefusal } from './scoped-write-encoding.js';

/** The fields the table exercises, one per behaviour class of data-model §9. */
export type ScopedWriteCaseField = 'name' | 'description' | 'status' | 'minOrderQuantity' | 'returnable' | 'attribute:multi';

/**
 * The spec of each case field. `attribute:multi` is an optional, scopable `multiselect`
 * attribute (`{G,C}`, `NULL` = nothing selected); consumers create one with that key.
 */
export const SCOPED_WRITE_CASE_FIELDS: Readonly<Record<ScopedWriteCaseField, FieldScopeSpec & { column: 'text' | 'value' }>> = {
  name: { levels: ['G', 'C', 'CL'], required: true, emptyable: false, column: 'text' },
  description: { levels: ['G', 'C', 'CL'], required: false, emptyable: true, column: 'text' },
  status: { levels: ['G', 'C', 'CL'], required: false, emptyable: false, column: 'value' },
  minOrderQuantity: { levels: ['G', 'C'], required: false, emptyable: true, column: 'value' },
  returnable: { levels: ['G', 'C'], required: false, emptyable: false, column: 'value' },
  'attribute:multi': { levels: ['G', 'C'], required: false, emptyable: true, column: 'value' },
};

export interface ScopedWriteCase {
  name: string;
  json?: unknown;
  csv?: string;
  field: ScopedWriteCaseField;
  level: ScopeLevel;
  expect: ScopedWriteOp<unknown> | 'no_change' | ScopedWriteRefusal;
}

const set = <T>(value: T): ScopedWriteOp<T> => ({ op: 'set', value });
const EMPTY: ScopedWriteOp<never> = { op: 'empty' };
const INHERIT: ScopedWriteOp<never> = { op: 'inherit' };

export const SCOPED_WRITE_CASES: readonly ScopedWriteCase[] = [
  // §1 — JSON meanings.
  { name: 'json: absent field is no change', field: 'description', level: 'C', expect: 'no_change' },
  { name: 'json: "" is no change', json: '', field: 'description', level: 'CL', expect: 'no_change' },
  { name: 'json: null is an empty override', json: null, field: 'description', level: 'CL', expect: EMPTY },
  { name: 'json: null at Global is no value', json: null, field: 'description', level: 'G', expect: EMPTY },
  { name: 'json: {inherit:true} removes the own value', json: { inherit: true }, field: 'description', level: 'C', expect: INHERIT },
  { name: 'json: a value', json: 'Opis', field: 'description', level: 'CL', expect: set('Opis') },
  { name: 'json: the text "NULL" is a value', json: 'NULL', field: 'description', level: 'CL', expect: set('NULL') },
  { name: 'json: the text "INHERIT" is a value', json: 'INHERIT', field: 'name', level: 'C', expect: set('INHERIT') },
  // §1 — CSV meanings.
  { name: 'csv: empty cell is no change', csv: '', field: 'description', level: 'CL', expect: 'no_change' },
  { name: 'csv: NULL is an empty override', csv: 'NULL', field: 'description', level: 'CL', expect: EMPTY },
  { name: 'csv: INHERIT removes the own value', csv: 'INHERIT', field: 'description', level: 'C', expect: INHERIT },
  { name: 'csv: a text', csv: 'Opis produktu', field: 'description', level: 'CL', expect: set('Opis produktu') },
  // §3 — CSV escaping.
  { name: 'csv: lower-case null is text', csv: 'null', field: 'description', level: 'CL', expect: set('null') },
  { name: 'csv: Null is text', csv: 'Null', field: 'description', level: 'CL', expect: set('Null') },
  { name: 'csv: leading space before NULL is text', csv: ' NULL', field: 'description', level: 'CL', expect: set(' NULL') },
  { name: 'csv: trailing space after NULL is text', csv: 'NULL ', field: 'description', level: 'CL', expect: set('NULL ') },
  { name: 'csv: NULL inside a text is text', csv: 'No NULL here', field: 'description', level: 'CL', expect: set('No NULL here') },
  { name: 'csv: \\NULL is the text NULL', csv: '\\NULL', field: 'description', level: 'CL', expect: set('NULL') },
  { name: 'csv: \\INHERIT is the text INHERIT', csv: '\\INHERIT', field: 'name', level: 'CL', expect: set('INHERIT') },
  { name: 'csv: \\\\NULL is the text \\NULL', csv: '\\\\NULL', field: 'description', level: 'CL', expect: set('\\NULL') },
  { name: 'csv: \\foo stays verbatim', csv: '\\foo', field: 'description', level: 'CL', expect: set('\\foo') },
  // §3a — formula-injection guard (text columns only).
  { name: 'csv: a quoted formula loses its quote', csv: "'=1+1", field: 'description', level: 'CL', expect: set('=1+1') },
  { name: 'csv: a doubled quote loses one', csv: "''quoted", field: 'description', level: 'CL', expect: set("'quoted") },
  { name: 'csv: a quoted minus in a text column', csv: "'-5", field: 'description', level: 'CL', expect: set('-5') },
  { name: "csv: 'NULL is the text NULL, not the token", csv: "'NULL", field: 'description', level: 'CL', expect: set('NULL') },
  { name: 'csv: a numeric column keeps its minus', csv: '-5', field: 'minOrderQuantity', level: 'C', expect: set('-5') },
  { name: 'csv: a numeric column keeps a quote', csv: "'5", field: 'minOrderQuantity', level: 'C', expect: set("'5") },
  // Refusals (FR-062, FR-113).
  { name: 'json: null on the name is refused', json: null, field: 'name', level: 'CL', expect: 'required_empty' },
  { name: 'csv: NULL on the name is refused', csv: 'NULL', field: 'name', level: 'G', expect: 'required_empty' },
  { name: 'json: null on a status is refused', json: null, field: 'status', level: 'C', expect: 'not_emptyable' },
  { name: 'csv: NULL on a status is refused', csv: 'NULL', field: 'status', level: 'CL', expect: 'not_emptyable' },
  { name: 'json: null on a boolean is refused', json: null, field: 'returnable', level: 'C', expect: 'not_emptyable' },
  { name: 'csv: NULL on a boolean is refused', csv: 'NULL', field: 'returnable', level: 'G', expect: 'not_emptyable' },
  { name: 'json: inherit at Global is refused', json: { inherit: true }, field: 'description', level: 'G', expect: 'inherit_at_global' },
  { name: 'csv: INHERIT at Global is refused', csv: 'INHERIT', field: 'name', level: 'G', expect: 'inherit_at_global' },
  { name: 'json: null minimum order quantity = no minimum', json: null, field: 'minOrderQuantity', level: 'C', expect: EMPTY },
  { name: 'csv: NULL minimum order quantity = no minimum', csv: 'NULL', field: 'minOrderQuantity', level: 'C', expect: EMPTY },
  { name: 'json: a minimum order quantity', json: 5, field: 'minOrderQuantity', level: 'C', expect: set(5) },
  { name: 'json: null multiselect = nothing selected', json: null, field: 'attribute:multi', level: 'C', expect: EMPTY },
  { name: 'csv: NULL multiselect = nothing selected', csv: 'NULL', field: 'attribute:multi', level: 'G', expect: EMPTY },
  { name: 'json: inherit a multiselect at the channel', json: { inherit: true }, field: 'attribute:multi', level: 'C', expect: INHERIT },
];
