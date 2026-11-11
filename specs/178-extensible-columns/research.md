# Research: Declared extension columns on core tables (178)

Every decision is stated as decision → rationale → alternatives rejected. "Spike" means the
throwaway test run on 2026-11-10 against MikroORM 6.6.16 and a disposable Postgres database on the
test instance (`localhost:5441`, database `spike178`, dropped afterwards). The spike file was
deleted from the tree; nothing from it is committed.

## R-1 — Projection entity (E2) works alongside the core entity

**Verified by spike**, core entity `SpOrg` (decorators, `@GlobalEntity`, a stored generated column
`lazy: true, hidden: true` like `Product`) plus a programmatic `EntitySchema` projection on the same
table mapping `id` + two `x_acme_erp_*` columns:

| Question | Observed |
| --- | --- |
| Default discovery | `Duplicate table names are not allowed` — refused |
| Core INSERT | `insert into "sp_organizations" ("id","name","sku") … returning "sku_key"` — no `x_*`, RETURNING names only core's generated column (settles the review's E1 `[unverified]` for E2) |
| Core SELECT | `select "s0"."id","s0"."name","s0"."sku" …` — explicit column list; core never reads `x_*` |
| Projection bulk read, no `fields` | `select "s0".* …` — reads every core column; **the accessor must pass `fields`** |
| Projection read with `fields` | `select "s0"."id","s0"."x_acme_erp_erp_code","s0"."x_acme_erp_credit_tier" … where id in (…)` |
| Change on core and projection, one flush | `begin; update … set "x_acme_erp_erp_code" = $1 where "id" = $2; update … set "name" = $1 where "id" = $2 returning "sku_key"; commit` — only changed props, one transaction |
| `nativeUpdate` on the projection | `update … set "x_acme_erp_credit_tier" = $1 where "id" = $2`; returns 0 for a missing id, never inserts |
| `em.create` on the projection | refused by an EntitySchema `hooks.beforeCreate` throwing |
| Identity map, same id | two distinct objects; core `remove` deletes the row, projection untouched in memory |

Decision: E2 as ruled (OR-2). Accessor uses `fields`-limited finds and managed assignment (so the
audit gets `before`), never `create`/`remove`.

## R-2 — Tenant classification must be on the schema, not on the class

**Verified by spike.** `OrgScoped()(ProjectionClass)` then `new EntitySchema({ class:
ProjectionClass, … })`: the classification registry lists the class as `org`, but
`metadata.filters` is **empty** and the query had no `organization_id` predicate. Declaring
`filters: { org: { name: 'org', cond: () => orgFilterCond(), default: true, args: false } }` on
the schema produced `where "s0"."organization_id" = $1` under a `single-org` context.

Decision: the projection builder copies the host's classification into both places — the registry
(so `check-entity-tenant-classification`, `assertTransitiveParentsResolve` and
`OrgWriteGuardSubscriber` see it) and the schema's `filters` (so queries are narrowed). A unit test
asserts `meta.filters.org` exists for every `org`-scoped host projection. `rule`-scoped hosts
(`projects`, `tasks`) get `RuleScoped` and no filter: callers obtain ids from the host's own
visibility-checked reads, which is exactly how the extension attributes attach (FR-051).

Rejected: `TransitivelyScoped(hostClass, 'id')` — it applies no filter and refuses a `global` or
`rule` terminus (`org-scoped.decorator.ts`), so it fits none of the nine hosts uniformly.

## R-3 — Replacing `checkDuplicateTableNames`

`MetadataDiscoveryOptions.checkDuplicateTableNames` and `afterDiscovered(storage, platform)` exist
in `@mikro-orm/core/utils/Configuration.d.ts` l. 306–315. **Verified by spike**: with the check off,
an `afterDiscovered` rule grouping `storage.getAll()` by `tableName` accepted declared projections
and refused an undeclared second mapping (`Rogue`) by name.

Decision: `mikroOrmConfigFrom` (the one place the platform builds the config) always sets the pair.
Allowed duplicates come from a set the projection builder fills (projection entity names, keyed by
table), never from a package. The rule also asserts the projection's properties ⊆ {PK, tenant key,
declared columns}.

Rejected: leaving the MikroORM check on and naming projections into a different `schema` — the
table really is the same one, and a schema qualifier would not be.

## R-4 — SchemaGenerator sees two `create table` for one table

**Verified by spike**: `getCreateSchemaSQL()` emitted two `create table "sp_organizations"`.
Production never runs the SchemaGenerator (`migrations.snapshot: false`, hand-written migrations);
`packages/test-kit/test/services/fixture-platform.ts` l. 186 runs `updateSchema` over **its own**
fixture entities only. Decision: projections are added only by `mikroOrmConfigFrom`; a unit test
asserts the test-kit fixture ORM registers none. Risk recorded in plan.

## R-5 — Where the generated DDL runs

Facts: `orderMigrations` (`packages/platform/src/db/migration-order.ts`) emits a baseline block,
then each module's migrations contiguously, topologically by `dependencies`, ascending by stamp
inside a module. `configuredMigrationsFrom` (`configured-migrations.ts`) is the single merge of core
and package entries. Hard uninstall reverts `ownership.migrationNamesFor(moduleId)` sorted ascending,
in reverse, with `migrator.down({ migrations: [name] })` (`lifecycle/services/orchestrator.ts`
l. 1237–1250).

**Verified by spike**: a programmatic `Migration` subclass placed in `migrationsList` ran after a
preceding entry, could read `information_schema` through `this.execute` inside the migration
transaction, its `addSql` DDL applied, `down({ migrations: [name] })` reverted only it, and it
became pending again. Umzug 3.8.2 computes pending as "list minus storage" and executed as
"list ∩ storage" (`umzug/lib/umzug.js` l. 104–121), so a stale executed name that is no longer in the
list is ignored by `up`; MikroORM's `getExecutedMigrations()` does still list it (observed), which
is cosmetic.

Decision: one synthetic registry entry per declaring module, `moduleId` = that module, origin
`generated`, class name `Migration10000101T000000<Prefix>SchemaExtensions<hash12>`. It goes through
`orderMigrations` unchanged: the prefix satisfies `unscoped-name`, `10000101T000000` is a real
instant (passes `assertRealInstant`) and sorts **first** in the module's block, and ownership/hard
revert treat it like the module's own. `parseEntries` refuses that stamp on any entry whose origin
is not `generated`, so a package cannot spoof it.

Head, not tail, because the declaring module's own later migrations may back-fill its new column;
on a fresh database a tail step would run after them and the back-fill would fail. Since the host
is a dependency, the head of the block is still after every host migration — the brief's intent.

Rejected: (a) segmented `migrator.up({ to })` calls with reconciliation between segments — every
caller of the migrator (four verbs, lifecycle install, the test template builder) would need it;
(b) a stable name — runs once per database and never sees a changed declaration; (c) reconcile at
boot outside migrations — DDL at boot, outside the migration lock and history.

## R-6 — Verifier inside the migration transaction

MikroORM 6.6.16 `Migrator.runMigrations` accepts `options.transaction` and then runs the umzug
batch on it (`@mikro-orm/migrations/Migrator.js` l. 343–357). Decision: the `up`/`fresh` verbs
(`packages/platform/src/db/migrate.ts`) and lifecycle `install` call one platform function
`migrateUpVerified(orm)` that opens `connection.transactional(trx => { up({ transaction: trx });
verify(trx) })`. A core migration that loses a column in the same run rolls everything back.
Boot (`composeApp`, `packages/platform/src/composition/compose-app.ts` l. 498 after
`ormLifecycle.open()`) verifies read-only.

"Last core migration on that table" is not knowable without parsing SQL at runtime; the error names
the **last executed migration of the table's owning module** and says so.

## R-7 — How an instance package declares the extension

Facts: an overlay module ships no schema (D-106; `module-migrations.md`). Installed packages are
discovered at runtime and never reach committed registries (D-119/D-155); a workspace link is not
discovered (`installed-packages.ts` header). `packageSchemaContributionsUnder` already imports
`./backend` and reads `entities`.

Decision: `export const schemaExtensions = [acmeOrganizationColumns]` from `./backend`, read beside
`entities` into `PackageSchemaContribution.schemaExtensions`. `manifests:generate` and
`composer:generate` need no change (the declaration is code, read at runtime like entities). The
composer refuses a `schemaExtensions` export in a workspace module package of this repository (a
first-party module owns its tables or uses an S1 side table).

Rejected: a manifest field — it would need a Zod rendering into `package.json`'s `endora` block,
two representations of one declaration, and the inferred TS type would be lost.

Consequence: until instance-local packages exist (review OD-12), an instance author `pnpm pack`s
the module and installs the tarball, or points `ENDORA_INSTANCE_ROOT` at a real install.

## R-8 — Deriving the extensible list

Facts: `HOST_STORAGE` in `custom_fields/src/backend/services/host-storage-binding.ts` is module
internal; the platform cannot import a module (`check:kernel-boundary` B). `SupportedEntityType`
already lives in `packages/contracts/src/custom-fields.ts`.

Decision: move the binding to `@endora-commerce/contracts` as `CUSTOM_FIELD_HOST_BINDINGS:
Record<SupportedEntityType, { table; valueColumn; ownerModuleId }>`; `hostStorageBinding` reads it;
the platform derives `EXTENSIBLE_HOSTS` (table → owner) from it. For `products` the table is
`products` (the value bag is the `attribute_values` column, not a table). `FR-012`'s test holds the
owner against `buildTableOwners`.

Rejected: resolving a `custom_fields` port at boot (too late: ORM config and migration order are
computed before composition); a manifest `schema.extensible` flag per owner (the second declaration
OR-3 forbids).

## R-9 — Writes: owner-only, inside a transaction, audited

Decision: no Command Bus change. Ownership is enforced structurally: the projection's entity name is
private to the platform, reachable only through `extensionColumns(decl, em)`, and `decl` is the
module's own export (another module importing it is a `check:module-boundary` finding). The
accessor refuses writes when `!em.isInTransaction()`, so writes happen in a Command or a hook
(XIII). `set` returns `{ changedFields }` — names, never values, per
`specs/conventions/audit-state.md` (D-288) and spec 176's `noteAuditChanges`.

Rejected: a flush subscriber that checks "the running Command's owning module" — the bus does not
know it (review's open question) and adding it couples every Command to module identity for one
feature.

## R-10 — Foreign schema refusal at runtime (OD-17)

Facts: instances install every module, core ones included, as `external` packages; the platform has
no `typescript` dependency, so `packages/cli/src/lib/sql-tables.ts` cannot run at migrate time;
`check:module-boundary` for packages is `pending('Phase 3')` in `packages/cli/src/check/estate.ts`.
MikroORM's runner calls `migration.up()` then executes `getQueries()`; direct `execute()` runs
immediately (`MigrationRunner.js`, `Migration.js`).

**Verified by spike**: a platform-made subclass of a package migration class overriding `addSql`
and `execute` (name preserved with `Object.defineProperty`) saw both `addSql(knex.schema.alterTable
…toQuery())` and `execute('update … set …')` and its refusal rolled the run back.

Decision: `guardExternalMigration(cls, ownTables, declarations, exemptions)` wraps every
`external`-origin entry in `configuredMigrationsFrom`. A regex statement classifier in the platform
(`db/sql-statement-targets.ts`) extracts write targets of `alter|create index … on|drop|comment on|
create trigger … on|insert into|update|delete from|truncate`. Own tables = tables the module's own
entities map ∪ tables its own migrations `create`. Exemptions: first-party R2 ledger entries by
(module, class, table), rendered by `composer:generate`. `do $$ … $$` blocks are scanned as text and
any foreign target inside refuses. A shared corpus test runs the platform classifier and
`sqlTableAccesses` over every first-party migration and asserts equal write-target sets.

Rejected: Postgres event triggers (superuser); catalog diffing between blocks (needs a guard name
that changes with the block contents and cannot attribute a change to a statement).

## R-11 — Static rule for core's promise (preservation on MRs)

The preservation integration test runs in `test:backend`, which merge-request pipelines do not
create (D-198). Decision: a new `check:extensible-tables` in the `quality` job refuses the rebuild
shapes on extensible tables in migrations of their owners and holds the binding/owner
reconciliation. A new check rather than an arm of `check:module-boundary`: that check's predicates
are cross-module, this one is about an owner's own table.

## R-12 — Command hooks (spec 176)

Reconciled against 176's draft contracts (`command-hooks-api.md`, `organization-hookable-actions.md`)
on 2026-11-10: hooks register through `ctx.commandHooks`, receive the caller's `command.extensions`
key, and report changed **names** via `noteAuditChanges`. 178 therefore returns `changedFields`
from `set`, adds the standard `columnExtensionHook`, and defers the HTTP `extensions` body field
(176 leaves it to 178). Only Phase B's US3/FR-042 depend on 176; Phases A, C and D do not.

## R-13 — Exposure points kept minimal

In: accessor; extension attributes on admin reads (one generic helper, one query per module per
response — no N+1); existing admin detail zones as the slot
(`packages/contracts/src/admin-contributions.ts`: `OrganizationDetailZoneProps` etc.; products and
categories have editor zones; `projects` has none — recorded, not added).
Deferred: list filter/sort (each of nine list builders), write contracts, search/export/PDF/events,
storefront. Custom fields' `listFilter` remains the generic filtering answer.

## R-14 — DDL cost on large tables

`add column … null` and `add column … not null default <constant>` are catalog-only in PostgreSQL ≥
11. `create index` (not `concurrently`, which cannot run in a transaction) takes a SHARE lock on the
host for the build. Recorded as an operator note on the developer page; `concurrently` deferred.
