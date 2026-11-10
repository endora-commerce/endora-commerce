# Contract: Generated DDL, placement, ledger, verifier, orphan and drop

## 1. Placement in the execution order

`configuredMigrationsFrom` (`packages/platform/src/db/configured-migrations.ts`) appends, for each
installed package with a non-empty `schemaExtensions`, one entry
`{ moduleId, origin: 'generated', cls }` before calling `orderMigrations`.

- Name: `Migration10000101T000000<expectedNamePrefix(moduleId)>SchemaExtensions<hash12>`.
- `orderMigrations` treats it like any entry of `moduleId`; its stamp sorts first, so it runs at the
  **head** of the module's block, i.e. after every module the declaring module depends on (the host
  included) and before the module's own migrations (research R-5).
- `parseEntries` refuses stamp `10000101T000000` on an entry whose origin is not `generated`
  (`MigrationOrderError` code `reserved-stamp`).
- `MigrationOrigin` becomes `'core' | 'external' | 'generated'`; `RegisteredMigration.origin`
  reports it; the test template digest treats `generated` as its own origin floor.
- Ownership: the entry is in `migrationNamesFor(moduleId)`, so `uninstall --hard` reverts it (last,
  since it sorts first and revert runs in reverse).

## 2. DDL grammar (the only statements the platform generates)

```sql
alter table "<host>" add column "<col>" <sqltype> null;
alter table "<host>" add column "<col>" <sqltype> not null default <literal>;
create index "<ix>" on "<host>" ("<col>");
create unique index "<ux>" on "<host>" ("<col>") where "<col>" is not null;
-- drop command only (§6):
drop index if exists "<ix>";
alter table "<host>" drop column if exists "<col>";
```

Identifiers are quoted; literals are rendered by the platform's literal encoder (never string
concatenation of user input). Index name: `ix_<host>_<col>` / `ux_<host>_<col>` when ≤ 63 bytes,
else `ix_x_<16 hex of sha256("<host>.<col>")>` / `ux_x_…`.

## 3. Reconcile algorithm (`up()` of the generated entry, inside the migration transaction)

1. `select … from schema_extensions where module_id = $1 and status <> 'dropped' for update`.
2. One `information_schema.columns` read for the module's hosts and `x_<module>_%` columns; one
   `pg_indexes` read.
3. For each declared element (columns, then indexes):
   - ledger `applied`, same hash, present physically → nothing;
   - ledger `applied|orphaned`, **different** hash → refuse `non-additive-change` (names key, old
     and new spec);
   - ledger `orphaned`, same hash, present → set `applied`;
   - no ledger row, column present → adopt if the physical type matches §3 of `data-model.md`,
     else refuse `unledgered-column-mismatch`;
   - no ledger row, absent → `addSql` the DDL, insert ledger row `applied`.
4. Ledger rows of the module not declared any more → `orphaned`, `orphaned_at = now()`.

All refusals throw `SchemaExtensionReconcileError` and roll the whole run back (`allOrNothing`).

`down()`: `update schema_extensions set status = 'orphaned', orphaned_at = now() where module_id =
$1 and status = 'applied'`. Drops nothing (OR-6).

## 4. Verifier

`verifySchemaExtensions(conn, declarations, ownership)`; two queries total
(`information_schema.columns` for all extensible hosts filtered to `x\_%`, `pg_indexes` for the same
tables), plus one ledger read.

| Finding | Severity | At migrate | At boot |
| --- | --- | --- | --- |
| declared column missing | `drift` | rollback | boot fails |
| declared column wrong type / nullability / default | `drift` | rollback | boot fails |
| declared index missing | `drift` | rollback | boot fails |
| ledger `applied` without declaration | `orphan-candidate` | marked `orphaned` | `warn` |
| `x_*` column without ledger row | `unledgered` | `warn` | `warn` |

`SchemaExtensionDriftError` message: module, key, physical column, host, and "last executed
migration of `<owner>`: `<name>` (executed at …)" read from `mikro_orm_migrations` ∩
`ownership.migrationNamesFor(owner)`.

Callers: `migrateUpVerified(orm)` (new, `packages/platform/src/db/migrate.ts`), used by the `up` and
`fresh` verbs and by `LifecycleOrchestrator.install` (replacing its bare `migrator.up()` at
`orchestrator.ts` l. 278–282); `composeApp` right after `ormLifecycle.open()`.

## 5. Uninstall interactions

- Declaring module soft-uninstalled: nothing changes in the ledger; accessor refuses (not present).
- Declaring module `--hard`: generated entry's `down()` → `orphaned`.
- Host module uninstall while a declaring module is installed: `dependents-block` (existing).
- Host module `--hard` (after the extension is gone): its table drop takes the columns; a platform
  step in `uninstall` marks that host's non-dropped ledger rows `dropped` (FR-034).

## 6. Drop command

`module:schema-extensions list [--module <id>]` — prints the ledger (module, host, element, status,
applied/orphaned at).

`module:schema-extensions drop <moduleId> [--key <key>] [--confirm]`:

- Refuses `extension-still-declared` if any targeted element is declared by a discovered package.
- Refuses `not-orphaned` for rows that are not `orphaned`.
- Without `--confirm`: prints the plan (statements, per-column non-null counts) and exits 0.
- With `--confirm`: runs Command `schema_extension.drop` (objectType `schema_extension`, objectId
  `<moduleId>`) via `CommandBus.run` under `withSystemScope('schema-extensions drop')`: executes §2
  drop statements, sets rows `dropped`, `drop_audit_id`; audit `stateBefore` = ledger rows + non-null
  counts, `stateAfter` = dropped element names. No values are recorded.
- Entry point: `backend/src/lifecycle/scripts/schema-extensions.ts` (one entry per `module:*`
  command), work in `packages/platform/src/lifecycle/commands/schema-extensions.ts`.
