# Contract: side-table verification (FR-010 – FR-032)

Three layers, each run wherever the platform initialises an ORM against a database, and each
independent of the declaring module's origin.

| Layer | Where | Needs | Reaction |
| --- | --- | --- | --- |
| Static (E1 – E5) | manifest load, registry derivation | manifests | refuse composition (`entity-extension-declaration.md` §3) |
| Metadata (M0 – M5) | `discovery.afterDiscovered` | discovered metadata + tenancy registry | refuse ORM init — so `migrate`, boot and `install` all stop |
| Physical (P1 – P4, U1, U2) | `migrateUpVerified` (in transaction) and `composeApp` (read-only) | one catalog query | in `migrate`: roll the run back; at boot: refuse to start |

## 1. Inputs

`mikroOrmConfigFrom` (`packages/platform/src/db/mikro-orm.config.ts`) gains

```ts
readonly entityExtensions?: readonly ResolvedEntityExtension[];

interface ResolvedEntityExtension {
  readonly moduleId: string;
  readonly origin: 'core' | 'package' | 'overlay';
  readonly declaration: EntityExtensionDeclaration;
  readonly host: ExtensibleHost;           // from ENTITY_EXTENSION_HOSTS, E2 already passed
}
```

supplied by the application binding (`backend/src/db/…`, and an instance's equivalent) from the
registered manifests after E1 – E5, the same way `schemaExtensions` reaches it from package
contributions today. It is recorded for the verifier through `recordActiveEntityExtensions`,
beside D2's `recordActiveSchemaExtensions` (`kernel/schema-extensions/registry.ts`).

## 2. Metadata rules (in `afterDiscovered`)

Facts read from v7's discovered `MetadataStorage` (`getAll()` is a `Map`; iterate `.values()`),
never from decorators (research R-4): `className`, `tableName`, `primaryKeys`, the PK property's
`fieldNames` and `type`, `class`; ownership from the table-owner map the composer and
`buildTableOwners` share.

| Rule | Refused when | `rule` |
| --- | --- | --- |
| M0 | (always, even with no declaration) the entity mapping a binding's `table` is not named `entityClassName` | `host-binding-mismatch` |
| M1 | no discovered entity maps `table` | `table-not-owned` |
| M2 | the entity mapping `table` belongs to a module other than the declaring one | `table-not-owned` |
| M3 | the entity has more than one primary-key property | `primary-key-not-single` |
| M4 | the PK property's type is not the host PK's type (`uuid`) | `primary-key-type-mismatch` |
| M5 | the entity's classification is not admitted for the host (§3) | `tenancy-mismatch` |

`afterDiscovered` already hosts D2's `assertTableMappings`; the two run in sequence, D2 first, and
each throws its own error class.

## 3. Admitted tenancy classifications (M5; research R-6; owner ruling OR-9, OQ-187-1 = A)

| Host classification | Admitted side-entity classification |
| --- | --- |
| `global`, host is `organizations` | `GlobalEntity`, or `OrgScoped` whose tenant key property is the PK property |
| `global`, any other host | `GlobalEntity` |
| `org` | `TransitivelyScoped` with `parentClassName` = host `entityClassName` and `fk` = the PK property |
| `rule` | `RuleScoped` |
| `customer`, `transitive` | none — `host-scope-not-offered` |

The error names the host, its classification and the admitted form, e.g.
`acme_crm_order_notes is @OrgScoped; a side table of orders (@OrgScoped) must be
@TransitivelyScoped('Order', 'orderId'): its tenant is its host's, and a copied organization_id
goes stale when the host moves`.

The owner confirmed this table on 2026-11-23 (OR-9). Option B is a possible follow-up outside this
feature. It would leave the table unchanged and add a §3a: the platform registers a default-on filter
on every `TransitivelyScoped` side entity of an `org` host, built from `orgScopeSql` over the host's
tenant key in a sub-select on the host's PK.

## 4. Physical rules (one catalog query)

```sql
-- every table whose primary key is exactly one foreign key into one of the host tables
select c.relname            as table_name,
       pk.conname           as pk_name,
       fk.conname           as fk_name,
       h.relname            as host_table,
       fk.confdeltype       as on_delete,          -- 'c' = cascade
       (fk.confkey = hpk.conkey) as references_host_pk
from pg_constraint pk
join pg_class c       on c.oid = pk.conrelid
join pg_namespace n   on n.oid = c.relnamespace and n.nspname = current_schema()
join pg_constraint fk on fk.conrelid = pk.conrelid and fk.contype = 'f' and fk.conkey = pk.conkey
join pg_class h       on h.oid = fk.confrelid and h.relname = any($1::text[])
join pg_constraint hpk on hpk.conrelid = h.oid and hpk.contype = 'p'
where pk.contype = 'p'
```

with `$1` = the nine host tables. Array equality on `conkey` makes "exactly the primary key" exact for
composite keys too (a two-column PK never equals a one-column FK). Run through
`SchemaExtensionExec` (`db/schema-extension-verifier.ts`), so it is the same call in a migration
transaction and at boot, and unaffected by knex → kysely.

For each declared table:

| Rule | Finding | `rule` |
| --- | --- | --- |
| P1 | the table is not among the rows and `to_regclass(table)` is null | `table-missing` |
| P2 | the table exists and is not among the rows (no FK equal to its PK into a host) | `foreign-key-missing` |
| P3 | the row's `host_table` is not the declared host, or `references_host_pk` is false | `foreign-key-missing` (detail says which) |
| P4 | `on_delete <> 'c'` | `foreign-key-not-cascade` |

For each row whose table is **not** declared:

| Rule | Finding | `rule` / reaction |
| --- | --- | --- |
| U1 | an entity of a composed module maps it | `undeclared-entity-extension` — `warn` under policy `warn`, refusal under `refuse` |
| U2 | no composed module's entity maps it | `unowned-entity-extension` — always `warn` |

A row whose table is mapped by an entity of the **host's own owning module** is neither: a host
module keeping a 1:1 table of its own aggregate is ordinary ownership, which E4 forbids declaring and
this rule therefore never reports.

`P1` costs one extra statement per missing table, on the failure path only. The success path is one
statement in total (FR-023).

Physical findings throw `EntityExtensionDriftError` (list of `{ rule, moduleId, origin, table, host,
detail }`), the analogue of D2's `SchemaExtensionDriftError`; boot and `migrate` print all findings
at once.

## 5. Policy constant

```ts
// packages/platform/src/db/entity-extension-verifier.ts
/** OR-8: 'warn' in 0.113.0; 'refuse' from the release after. The flip is its own changeset. */
export const ENTITY_EXTENSION_UNDECLARED_POLICY: 'warn' | 'refuse' = 'warn';
```

A unit test asserts its value, so the flip is a deliberate, reviewed one-line change with a test edit,
not a drift.

## 6. Order of execution

1. ORM init → `afterDiscovered`: D2 table-mapping rule, then M0 – M5.
2. `migrateUpVerified`: migrations → D2 verifier → side-table verifier → commit.
3. `composeApp`: ORM open → D2 verifier → side-table verifier → modules compose.

A database with no declarations and no matching tables issues the one catalog query and nothing else;
with zero extensible host tables present (an unmigrated database at boot) the query returns no rows and
P1 names `migrate up` as the remedy, as D2's verifier does.
