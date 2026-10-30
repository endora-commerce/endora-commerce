# Contract: the one write encoding for scoped product values (FR-110…FR-117)

Owner: `packages/contracts` (`src/scoped-write-encoding.ts`, new). Decision: research R3. Applies to **scoped
product values only** (FR-117); other `null`-means-inherit fields are the follow-ups of research R20.

## 1. Meanings

| Intent | JSON (API, connector port) | CSV cell |
| --- | --- | --- |
| No change | field absent, or `""` | empty cell |
| Deliberately empty value (empty override; at Global: no value) | `null` | `NULL` (exactly, whole cell) |
| Remove the own value, inherit from the scope above | `{ "inherit": true }` | `INHERIT` (exactly, whole cell) |
| A value | the value | the text; a leading backslash before `NULL` / `INHERIT` escapes (§3) |

This differs from JSON Merge Patch (`null` = remove the member) and from Magento's `__EMPTY__VALUE__`; the API
documentation must say so (FR-115). After 168 ships, adding a token is additive; changing an existing meaning is
a breaking, versioned change (FR-111, Constitution II).

## 2. TypeScript surface

```ts
export const INHERIT_TOKEN = 'INHERIT';
export const EMPTY_TOKEN = 'NULL';
export type ScopedWriteOp<T> = { op: 'set'; value: T } | { op: 'empty' } | { op: 'inherit' };

/** `valueSchema | null | {inherit:true}`, optional; `""` preprocessed to undefined (no change). */
export function scopedWrite<S extends z.ZodTypeAny>(valueSchema: S): z.ZodOptional<…>;
export function toScopedWriteOp<T>(raw: T | null | { inherit: true } | undefined): ScopedWriteOp<T> | undefined;

export type CsvCell = { kind: 'no_change' } | { kind: 'empty' } | { kind: 'inherit' } | { kind: 'text'; text: string };
export function decodeCsvScopedCell(cell: string): CsvCell;
export function encodeCsvScopedCell(cell: { kind: 'empty' } | { kind: 'inherit' } | { kind: 'text'; text: string }): string;

export type ScopedWriteRefusal = 'required_empty' | 'not_emptyable' | 'inherit_at_global';
export function validateScopedWrite(
  field: { required: boolean; emptyable: boolean },   // from PRODUCT_FIELD_SCOPE_SETS / attribute definition
  op: ScopedWriteOp<unknown>,
  level: 'G' | 'C' | 'CL',
): ScopedWriteRefusal | null;
```

`emptyable` is false for single selects (`status`, `audience`, `enum`, `select`), booleans (`returnable`,
`hidden`, `boolean` attributes); `required` is true for `name`, `urlKey` and attributes marked required.

## 3. CSV escaping (FR-112)

| Cell | Decodes to |
| --- | --- |
| `` (empty) | no change |
| `NULL` | empty |
| `INHERIT` | inherit |
| `null`, `Null`, ` NULL`, `NULL `, `No NULL here` | text, verbatim |
| `\NULL` | text `NULL` |
| `\INHERIT` | text `INHERIT` |
| `\\NULL` | text `\NULL` |
| `\foo` | text `\foo` (only `^\\+(NULL\|INHERIT)$` loses one backslash) |

Encode: empty → `NULL`; inherit → `INHERIT`; text matching `^\\*(NULL|INHERIT)$` → one `\` prepended; other text
verbatim. `decode(encode(x)) = x` for every text `x` (property test).

## 4. Shared case table (SC-014)

`packages/contracts/src/scoped-write-encoding.cases.ts` exports `SCOPED_WRITE_CASES: Array<{ name; json?: unknown;
csv?: string; field: 'name' | 'description' | 'status' | 'minOrderQuantity' | 'attribute:multi'; level; expect:
ScopedWriteOp | 'no_change' | ScopedWriteRefusal }>`, covering every row of §1 and §3 plus the refusals (`NULL` on
name, on status, on a boolean; `INHERIT` at Global; `NULL` on minimum order quantity = no minimum; `NULL` on a
multiselect = nothing selected). Imported by:

1. `packages/contracts/src/scoped-write-encoding.test.ts` (pure),
2. `backend/test/contract/catalog/scoped-values-encoding.test.ts` (the save API) [PG],
3. `backend/test/integration/import_export/products-csv-encoding.test.ts` (CSV import) [PG],
4. `packages/contracts/src/pim-locale-mapping.test.ts` (the connector contract through `planLocaleWrites` and
   `catalogProductScopeWritePort` input parsing).

## 5. Where 163's `null` = inherit changes in place (FR-116)

| 163 shape | 168 |
| --- | --- |
| `patchProductScopesRequestSchema` channel fields `null` = inherit | `scopedWrite(...)`; `status: null` refused, `minOrderQuantity: null` = no minimum, `window: null` = open window override |
| `ProductScopeWriteInput` (connector port) `value: null` = inherit | replaced by v2 input (`pim-locale-mapping.md` §4) |
| `ScopedStatusCell.status: null` (empty CSV cell = inherit) | CSV codec: empty = no change, `INHERIT` = inherit, `NULL` refused |
| gallery role `null` = use inherited (`catalog.ts:1683`) | `galleryRole` `ScopedWrite<uuid>`: `null` = no image holds the role, `{inherit:true}` = inherit. A gallery role is an **image pointer**, not a single select under FR-062: it is optional, so `null` (empty override — no image holds the role at this scope) is allowed (`data-model.md` §6b, §9) |
| `putProductUrlKeysRequestSchema` `key: null` = inherit | `{inherit:true}` = inherit; `null` refused (required) |
| `minOrderQuantity` at C: `null` = inherit, `1` = no minimum | `null` = no minimum, `{inherit:true}` = inherit |
