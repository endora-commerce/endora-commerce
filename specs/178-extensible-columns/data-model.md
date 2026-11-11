# Data model: Declared extension columns (178)

## 1. `schema_extensions` (platform-owned ledger)

Owner: the platform (`core` migration group, `packages/platform/src/migrations/`), entity
`SchemaExtensionElement` in `PLATFORM_ENTITIES` (`packages/platform/src/db/platform-schema.ts`),
`@GlobalEntity`. Created by one migration scaffolded with
`pnpm --filter backend run migration:new -- --module core --name schema_extensions_ledger` (no number
is chosen by hand).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `module_id` | text not null | declaring module (`endora.id`) |
| `host_table` | text not null | one of the extensible hosts |
| `kind` | text not null | check in (`column`, `index`) |
| `physical_name` | text not null | `x_<module>_<key>` or the index name |
| `declared_key` | text not null | camelCase key; for an index, the key it covers |
| `spec` | jsonb not null | normalised spec (§3) |
| `spec_hash` | text not null | sha256 of canonical `spec` |
| `status` | text not null | check in (`applied`, `orphaned`, `dropped`) |
| `platform_version` | text not null | `@endora-commerce/platform` version that applied it |
| `package_version` | text null | declaring package version at apply |
| `applied_at` | timestamptz not null | |
| `orphaned_at` | timestamptz null | |
| `dropped_at` | timestamptz null | |
| `drop_audit_id` | uuid null | audit entry of `schema_extension.drop` |

Indexes: unique `(host_table, physical_name) where status <> 'dropped'`; btree `(module_id)`.

State machine: `applied → orphaned` (declaration removed, `uninstall --hard`), `orphaned → applied`
(re-declared with identical `spec_hash`), `orphaned → dropped` (audited drop), `applied|orphaned →
dropped` (host hard-uninstalled, FR-034). `dropped` is terminal; a later declaration of the same
name creates a new row.

## 2. Physical extension elements (on host tables)

- Column `x_<moduleId>_<snake(key)>`, type per §3, nullable or NOT NULL with a constant default.
- Index `ix_<host>_<column>` (≤ 63 bytes) or `ix_x_<sha256(host.column)[0:16]>` otherwise; unique
  variant `ux_…` with `where <column> is not null`.

## 3. Normalised column spec (`spec` jsonb, also the hash input)

```json
{ "type": "varchar", "length": 64, "nullable": true, "default": null, "index": "unique" }
```

Keys in fixed order: `type`, `length?`, `precision?`, `scale?`, `nullable`, `default` (JSON literal
or `null`), `index` (`false` | `true` | `"unique"`). `jsonb`'s Zod `schema` is not part of the spec
(it is validation, not shape).

| Declared `type` | SQL | `information_schema` match (`udt_name`) | TS value | Zod |
| --- | --- | --- | --- | --- |
| `text` | `text` | `text` | `string` | `z.string()` |
| `varchar` | `varchar(n)` | `varchar`, `character_maximum_length = n` | `string` | `z.string().max(n)` |
| `boolean` | `boolean` | `bool` | `boolean` | `z.boolean()` |
| `smallint` | `smallint` | `int2` | `number` | `z.number().int().min(-32768).max(32767)` |
| `integer` | `integer` | `int4` | `number` | `z.number().int()` (int4 range) |
| `bigint` | `bigint` | `int8` | `string` | `z.string().regex(/^-?\d{1,19}$/)` |
| `numeric` | `numeric(p,s)` | `numeric`, precision/scale | `string` | decimal string regex for p,s |
| `date` | `date` | `date` | `string` (YYYY-MM-DD) | `z.iso.date()` |
| `timestamptz` | `timestamptz` | `timestamptz` | `Date` | `z.date()` |
| `uuid` | `uuid` | `uuid` | `string` | `z.uuid()` |
| `jsonb` | `jsonb` | `jsonb` | `z.infer<schema>` | the declared `schema` |

Nullable columns add `| null` / `.nullable()`.

## 4. Declaration (in-memory, frozen)

`ColumnExtension<Host, Module, Cols>`: `{ host, module, columns, adminReads, id: '<module>:<host>' }`
plus a non-enumerable brand. Validation rules: `contracts/column-extension-declaration.md` §3.

## 5. Projection (in-memory ORM metadata)

One `EntitySchema` per declaration, entity name `__x_<module>__<host>` (not exported), `tableName =
host`, properties: host PK (`id`, `uuid`), `organizationId` (`organization_id`) when the host is
`@OrgScoped`, one property per declared key (`fieldName` = physical name). Classification copied
from the host; `filters.org` set for `org` scope; hooks `beforeCreate`/`beforeDelete` throw.

## 6. Synthetic migration entry

`{ moduleId, origin: 'generated', cls }`, `cls.name =
Migration10000101T000000<Prefix>SchemaExtensions<hash12>`, `hash12` = first 12 hex of sha256 over
the canonical JSON of the module's declarations sorted by host. `up()` reconciles (§`contracts/
generated-ddl-and-ledger.md` §3); `down()` marks the module's rows `orphaned`.

## 7. Wire shapes (`@endora-commerce/contracts`)

- `CUSTOM_FIELD_HOST_BINDINGS` (moved from `custom_fields`), `ExtensibleHostTable` (union of tables).
- `ExtensionsQuerySchema = z.object({ extensions: z.string().regex(/^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*){0,7}$/).optional() })`.
- `ExtensionAttributesSchema = z.record(moduleId, z.record(z.string(), z.json()))`, added as
  `extensions: ExtensionAttributesSchema.optional()` to each extensible host's admin record schema.
