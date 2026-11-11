# Contract: Column extension declaration API

Published on `@endora-commerce/platform/kernel` (one of the five module-nameable barrels; no new
barrel, so `check:platform-surface` is unchanged in shape). Implementation under
`packages/platform/src/kernel/schema-extensions/`.

## 1. API

```ts
type ExtensibleHostTable =
  | 'organizations' | 'customer_accounts' | 'orders' | 'quote_requests' | 'products'
  | 'categories' | 'crm_opportunities' | 'projects' | 'tasks'; // derived from contracts registry

type ColumnSpec =
  | { type: 'text' | 'boolean' | 'smallint' | 'integer' | 'bigint' | 'date' | 'uuid';
      nullable?: boolean; default?: Literal; index?: boolean | 'unique' }
  | { type: 'varchar'; length: number; nullable?: boolean; default?: string; index?: boolean | 'unique' }
  | { type: 'numeric'; precision: number; scale: number; nullable?: boolean; default?: string; index?: boolean | 'unique' }
  | { type: 'timestamptz'; nullable: true; index?: boolean | 'unique' }
  | { type: 'jsonb'; nullable: true; schema: z.ZodType };

export function defineColumnExtension<
  const H extends ExtensibleHostTable,
  const M extends string,
  const C extends Record<string, ColumnSpec>,
>(decl: { host: H; module: M; columns: C; adminReads?: boolean }): ColumnExtension<H, M, C>;

export type ColumnExtensionValues<D> = { [K in keyof Cols<D>]: ValueOf<Cols<D>[K]> };
export type ColumnExtensionPatch<D> = Partial<ColumnExtensionValues<D>>;

export function columnExtensionSchema<D extends ColumnExtension>(d: D): z.ZodType<ColumnExtensionValues<D>>;
export function columnExtensionPatchSchema<D extends ColumnExtension>(d: D): z.ZodType<ColumnExtensionPatch<D>>;

export function extensionColumns<D extends ColumnExtension>(d: D, em: EntityManager): {
  get(id: string): Promise<ColumnExtensionValues<D> | null>;
  load(ids: readonly string[]): Promise<Map<string, ColumnExtensionValues<D>>>;
  set(id: string, patch: ColumnExtensionPatch<D>): Promise<{ changedFields: string[] }>;
};

export function columnExtensionHook<D extends ColumnExtension>(
  d: D, opts: { id: string; on: HookableActionRef },
): CommandHookEntry; // spec 176; see command-hooks-dependency.md §2.3
```

`nullable` defaults to `false`; omitted `nullable` with no `default` is therefore refused (§3 V4).
`ValueOf` follows `data-model.md` §3.

## 2. Example and inferred type

```ts
export const acmeOrganizationColumns = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  adminReads: true,
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
    onboardedVia: { type: 'text', nullable: true },
  },
});
// ColumnExtensionValues<typeof acmeOrganizationColumns>
//   = { erpCode: string | null; creditTier: number; onboardedVia: string | null }
```

`defineColumnExtension` validates statically what it can (§3 V1–V8) and throws
`SchemaExtensionInvalidError` at import; discovery re-validates (V9–V11) with the package context.

## 3. Validation rules (code `schema_extension_invalid`, `rule` field)

| Rule | Refused when |
| --- | --- |
| V1 `module-id` | `module` fails the module id regex |
| V2 `host-not-extensible` | `host` not in the derived (and, until Phase D, rolled-out) list |
| V3 `key` | key fails `^[a-z][a-zA-Z0-9]*$` |
| V4 `not-null-without-default` | not nullable and no `default` |
| V5 `type` / `type-params` | unknown type, `varchar.length` ∉ 1–1024, `numeric` p ∉ 1–38 or s ∉ 0–p |
| V6 `default-type` | `default` not a literal of the type (bigint/numeric: decimal string) |
| V7 `index` | `unique` on a NOT NULL column; any index on `jsonb` |
| V8 `name-length` | physical column name > 63 bytes; more than 32 columns |
| V9 `module-mismatch` | `module` ≠ the package's `endora.id` |
| V10 `host-not-a-dependency` | host owner ∉ declaring module's dependency closure |
| V11 `duplicate-declaration` | two declarations for one `(module, host)` |
| V12 `not-offered-yet` | `filterable`, `sortable`, `references`, `indexes`, expression defaults present |

## 4. Discovery

`./backend` may export `schemaExtensions: readonly ColumnExtension[]`. Anything else under that
name (non-array, non-branded member) is refused, naming the package and its manifest path — the
same rule `entities` follows in `package-runtime.ts`. A workspace module package of this repository
exporting it is refused by `composer:generate`.

## 5. Accessor semantics

- Gate: `effectiveState.isPresent(decl.module)` else `ModuleDisabledError`.
- `load`: one `em.find(projection, { id: { $in } }, { fields: [declared keys] })`; ids absent or
  filtered out are absent from the map; ≤ 500 ids per call, chunked internally.
- `get`: `load([id])`.
- `set`: requires `em.isInTransaction()` (`ExtensionWriteOutsideCommandError`); validates with the
  patch schema; loads the managed projection row (fields-limited); missing →
  `ExtensionHostRowNotFoundError`; assigns; the flush of the enclosing transaction issues the
  UPDATE of changed columns only; returns `{ changedFields }` — sorted declared keys whose value
  changed, never values (audit-state D-288).
- Never inserts or deletes; the projection refuses both.
- Values: `timestamptz` → `Date`; `bigint`/`numeric` → string; `jsonb` parsed with its schema on
  read (invalid stored JSON → `ExtensionValueCorruptError`, not silently returned).
