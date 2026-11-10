# Tasks: Declared extension columns on core tables (178)

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**TDD (III, NN)**: every "Test" task is written and **seen failing** before the task after it.
`[P]` = parallelisable within its phase. FR ids in brackets.

Verify per task: `pnpm run build:packages` after editing a package, then the targeted
`vitest run <path>`; per phase: `pnpm -r run typecheck`, `pnpm -r run lint`,
`pnpm --filter '!backend' run test`, and the integration files named below against
`pnpm run dev:infra:test`.

## Phase A — Platform mechanism (inert: no host rolled out)

### A1. Contracts and bindings

- [x] T001 Test: `CUSTOM_FIELD_HOST_BINDINGS` holds 9 entries with table/valueColumn/ownerModuleId, `products` → table `products`, column `attribute_values`, owner `catalog` — `packages/contracts/src/custom-fields.test.ts` [FR-010]
- [x] T002 Move the binding to `packages/contracts/src/custom-fields.ts`; `custom_fields`' `hostStorageBinding` reads it; grep `backend/test/**` for the old map [FR-010]
- [x] T003 [P] Test + implement `ExtensionsQuerySchema`, `ExtensionAttributesSchema`, `ExtensibleHostTable` in `packages/contracts/src/schema-extensions.ts` [FR-050]
- [x] T004 Test: derived `EXTENSIBLE_HOSTS` equals the binding tables; rollout constant `[]` makes every host refuse V2 — `packages/platform/src/kernel/schema-extensions/extensible-hosts.test.ts` [FR-010, FR-011]
- [x] T005 Implement `extensible-hosts.ts` [FR-010, FR-011]

### A2. Declaration API

- [x] T006 Test: `defineColumnExtension` inferred types (`expectTypeOf`) for every type row of `data-model.md` §3; Zod schemas accept/refuse the same values — `define.test.ts` [FR-001, FR-002, FR-003]
- [x] T007 Test: one failing case per rule V1–V8, V12 — `validate.test.ts` [FR-003–FR-007, FR-060, FR-063]
- [x] T008 Implement `define.ts`, `types.ts`, `zod.ts`, `validate.ts`, `errors.ts`; export from `packages/platform/src/kernel/index.ts` [FR-001–FR-007]
- [x] T009 Test: `packageSchemaContributionsUnder` reads `schemaExtensions` from `./backend`; refuses non-array / non-branded; V9–V11 with package context — `packages/platform/src/packages/package-runtime-schema-extensions.test.ts` [FR-007, FR-008]
- [x] T010 Implement in `package-runtime.ts` (`PackageSchemaContribution.schemaExtensions`) [FR-008]
- [x] T011 Test + implement: composer refuses a `schemaExtensions` export in a workspace module package; overlay module refused [FR-008, FR-064]

### A3. Ledger

- [x] T012 Scaffold `pnpm --filter backend run migration:new -- --module core --name schema_extensions_ledger`; write table per `data-model.md` §1; entity `SchemaExtensionElement` (`@GlobalEntity`) in `PLATFORM_ENTITIES`; `composer:generate`, commit registries [FR-022]
- [x] T013 Test: `check-entity-tenant-classification` and `kernel-migration-ownership.test.ts` stay green with the new entity (run them) [FR-022]

### A4. Projection and mapping rule

- [x] T014 Test (unit, `connect: false`, ports research R-1/R-3): default discovery refuses; with the rule declared projections pass, undeclared second mapping refused naming classes; projection props ⊆ allowed — `packages/platform/src/db/table-mapping-rule.test.ts` [FR-031]
- [x] T015 Test: projection carries `filters.org` for an `@OrgScoped` host, `RuleScoped`/`GlobalEntity` copied, insert/delete hooks present; no `x_*` property on the core meta — `schema-extension-projection.test.ts` [FR-030, FR-032]
- [x] T016 Implement `schema-extension-projection.ts`, `table-mapping-rule.ts`; `mikroOrmConfigFrom` takes `schemaExtensions`, always sets the discovery pair [FR-030–FR-032]
- [x] T017 Test: test-kit fixture ORM registers no projection (R-4) [FR-031]

### A5. Synthetic step, reconcile, verifier

- [x] T018 Test: `orderMigrations` places a `generated` entry at the head of its module's block; refuses `reserved-stamp` on non-generated; hash changes iff declarations change — `migration-order.test.ts`, `schema-extension-migration.test.ts` [FR-020]
- [x] T019 Implement origin `generated`, reserved stamp, `schemaExtensionEntries()` in `schema-extension-migration.ts`, wired in `configuredMigrationsFrom` [FR-020]
- [x] T020 Test (integration, throwaway host table via fixture module owning it — keeps Phase A independent of real hosts): fresh apply; re-run idempotent; add key; remove key → orphaned; re-add same → applied; changed spec → `non-additive-change`; adopt matching unledgered column; mismatch refused; `down()` orphans and drops nothing — `backend/test/integration/db/schema-extension-reconcile.test.ts` [FR-021–FR-024]
- [x] T021 Implement reconcile `up()`/`down()` [FR-021–FR-024]
- [x] T022 Test (integration): verifier finds missing / wrong-typed column and missing index; message names module, key, column, host, owner's last executed migration; ≤ 2 catalog queries; in-run loss rolls back `migrateUpVerified` — `schema-extension-verifier.test.ts` [FR-025–FR-027]
- [x] T023 Implement `schema-extension-verifier.ts`, `migrateUpVerified` in `db/migrate.ts`; `up`/`fresh` verbs and orchestrator `install` use it; `composeApp` verifies at boot [FR-025, FR-026]

### A6. Accessor and reads service

- [x] T024 Test (integration over the fixture host): `load` one fields-limited select; `set` one UPDATE of changed columns only (query logger), returns sorted `changedFields`, no values; unknown id → not found, no INSERT; outside tx refused; module off → `ModuleDisabledError`; `em.remove` on projection refused; org-scoped filter narrows — `accessor.test.ts` [FR-033, FR-032]
- [x] T025 Implement `accessor.ts` [FR-033]
- [x] T026 Test + implement `reads.ts` (`schemaExtensionReads.attach`): omits absent/undeclared/non-`adminReads`; one query per module; registered in `composeApp` [FR-051, FR-052]

### A7. Uninstall, drop CLI

- [x] T027 Test: `uninstall --hard` of the declaring fixture → rows `orphaned`, columns present; host `--hard` → rows `dropped`; host uninstall with declarer installed → `dependents-block` — `backend/test/integration/_lifecycle/schema-extension-uninstall.test.ts` [FR-023, FR-034, FR-082]
- [x] T028 Implement FR-034 in the orchestrator [FR-034]
- [x] T029 Test: `module:schema-extensions list`; `drop` plan without `--confirm`; refusals `extension-still-declared`, `not-orphaned`; with `--confirm` drops, rows `dropped`, one audit `schema_extension.drop` without values — `schema-extensions-cli.test.ts` [FR-081]
- [x] T030 Implement `lifecycle/commands/schema-extensions.ts`, entry `backend/src/lifecycle/scripts/schema-extensions.ts`, `backend/package.json` script; check gate-coverage classification [FR-081]

### A8. Fixture

- [x] T031 Create `backend/test/fixtures/installed-packages/mod-acme-erp/` per `quickstart.md` (compiled JS + `src/` TS reproduced for docs) and a `tsc --noEmit` test over its `src/` [SC-001]

**Checkpoint A**: all of the above green with rollout `[]`; real hosts untouched; mergeable.

Phase A implementation notes (2026-11-10, `feat/178-extensible-columns-a`):

- V2 is asked twice, by design: `defineColumnExtension` refuses a host outside the full derived
  list at import (a typo fails where it is written), and discovery — `configuredMigrationsFrom`
  and `mikroOrmConfigFrom` — refuses a host outside the *rolled-out* list. With rollout `[]` every
  real declaration is refused there (T004, and `backend/test/unit/fixtures/mod-acme-erp-source.test.ts`).
- The integration tests (T020 – T029) run over a throwaway host module (`fixture_host`, tables
  `x178_hosts` / `x178_org_hosts`) in a database of their own, through the real configuration path
  with the host set passed where production passes the rolled-out one
  (`backend/test/helpers/schema-extension-fixture.ts`).
- The generated step's name is a digest of the declarations, so a module that returns to an earlier
  declaration set (A → B → A) would find A recorded as executed. `migrateUpVerified` therefore
  forgets every generated step that is not the current one before it runs (those names are no longer
  in the migration list, which umzug already ignores).
- The accessor's presence seam is not on `./kernel` (a module could answer its own gate):
  `extensionColumnsWithPresence` is on the host-internal `./db`.
- The audit entry of `schema_extension.drop` is linked to the ledger rows (`drop_audit_id`) right
  after the Command commits, since the bus writes the entry inside the transaction and returns no id.

## Phase B — Organizations (release together with Phase C)

- [x] T040 Test: preservation test (`contracts/preservation-test.md`) over the rolled-out list, red with a hand-written rebuilding migration in a throwaway module, green on master — `backend/test/integration/db/schema-extension-preservation.test.ts` [FR-080]
- [x] T041 Set rollout constant to `['organizations']`; update T004's assertion [FR-011]
- [x] T042 Test: end-to-end fixture on `organizations` — migrate, accessor via a Command (one audit entry, column patch), US1 scenarios 1–5, US2 1–4 — `backend/test/integration/organizations/schema-extension-example.test.ts` [FR-020–FR-033, SC-001]
- [x] T043 Test: off-state — core org create/read/list responses and audit rows byte-identical with fixture absent vs installed-and-off vs installed-and-on-without-param — `schema-extension-off-state.test.ts` [SC-002, FR-052]
- [x] T044 Test (contract): `GET /api/v1/admin/organizations/:id` and list with `?extensions=acme_erp` — shape, one extra query for 50 rows, omitted when off/absent/not `adminReads` — `backend/test/contract/organizations/extension-attributes.test.ts` [FR-050–FR-052]
- [x] T045 Implement `?extensions` in `packages/modules/organizations/src/backend/routes.admin.ts` (l. 257, 295) and optional `extensions` on the admin record schema in `packages/contracts/src/organizations.ts` [FR-051]
- [ ] T046 **(waits for spec 176 — not merged; open by design, see Phase B notes)** Re-reconcile `contracts/command-hooks-dependency.md` with 176 as merged; Test US3 (custom `organization.create` hook sets `onboardedVia` and finds the unflushed row; single audit entry with `extensions.acme_erp.changedFields`; throwing hook rolls back; module off → hook skipped) — `schema-extension-hook.test.ts`; implement in the fixture [FR-040, FR-041]
- [ ] T046a **(waits for spec 176)** Test then implement `columnExtensionHook` (absent input no-op; valid input written; invalid → 422 `SCHEMA_EXTENSION_INPUT_INVALID` with `extensions.<module>` paths; error code declared and translated pl + en) [FR-042]
- [x] T047 Constitution amendment I/XIV/XV, Sync Impact Report, 4.1.0 → 4.2.0 [FR-090]
- [x] T048 [P] `customisation-ladder.md` EN + PL data ladder [FR-091]
- [x] T049 [P] `migrations.md` EN + PL; `specs/conventions/module-migrations.md`; `specs/conventions/module-activation.md` [FR-092]
- [x] T050 [P] Developer page EN + PL with the worked example (path per `specs/conventions/module-documentation.md`); `check:docs-translations`, `check:module-docs` [FR-093]
- [x] T051 Changesets per plan §Generated artefacts

Phase B implementation notes (2026-11-10, `feat/178-extensible-columns-b`):

- **T046 / T046a are open, deliberately**: they need spec 176's command hooks (`ctx.commandHooks`,
  `noteAuditChanges`, `command.extensions`), and 176 is not merged. US3 and FR-040 – FR-042 ship
  with or after it; `contracts/command-hooks-dependency.md` is re-reconciled then.
- T042 – T044 install `mod-acme-erp` into a throwaway instance root and point the backend's **own**
  ORM configuration at it with `ENDORA_INSTANCE_ROOT`, over a clone of the run's template migrated
  forward with `migrateUpVerified` (`backend/test/helpers/acme-erp-instance.ts`). Presence is seeded
  on the registry cache, the axis the package's manifest would supply in an instance.
- Vitest externalizes anything under `node_modules`, so the installed copy's own code runs against a
  second, native evaluation of the platform; T042 therefore drives the accessor through the
  declaration object the ORM registered and mirrors the package's `syncErpCode` line for line. An
  instance's process holds one platform, so this is a test-runner artefact, not a product gap.
- T043 passed on first run: it is a guard over Phase A's design (the core entity never maps the
  columns), not a red-then-green task. "Absent" is the platform axis off within the installed
  database; a platform with no package at all differs from it in nothing a core path reads.
- The developer page lives at `docs/docs/architecture/schema-extensions.md` (beside
  `custom-fields.md` and the ladder), not under a new `developers/` category the site does not have.
- With `?extensions=` present every record carries `extensions` (`{}` when no named module
  qualifies), so absent, off and non-exposing modules answer the same bytes.

## Phase C — Foreign schema refusal (OD-17) (release together with Phase B)

- [x] T060 Test: `sqlWriteTargets` corpus incl. `do $$` bodies, knex `toQuery()`, quoted/unquoted, schema-qualified — `sql-statement-targets.test.ts` [FR-070]
- [x] T061 Implement `sql-statement-targets.ts` [FR-070]
- [x] T062 Test: parity with `sqlTableAccesses` over every first-party migration — `backend/test/unit/db/sql-write-targets-parity.test.ts` [FR-070]
- [x] T063 Test: guard refuses foreign DDL via `addSql`, foreign DML via `execute`, foreign write via `getEntityManager().flush()`; allows own tables, kernel tables, own-`x_` back-fill; refuses back-fill touching core columns; preserves class name; rolls back — `foreign-schema-guard.test.ts` + integration with a rogue fixture package [FR-070, US7]
- [x] T064 Implement `foreign-schema-guard.ts`; wrap `external` entries in `configuredMigrationsFrom` [FR-070]
- [x] T065 Test + implement exemption rendering in `composer:generate` from the R2 ledger; freshness in `overlay:check`; an instance composition of all first-party packages migrates clean (`backend/test/unit/db/instance-migration-order.test.ts` harness) [FR-071]
- [x] T066 Test (red proofs per finding, exit 2, read line) then implement `check:extensible-tables`; inventory row, `check-inventory.test.ts`, estate entry, `quality` job; record read size in a clean tree [FR-072]
- [x] T067 Test + implement `module:schema-extensions audit-packages` (dry-run of the guard over installed packages, no writes) [FR-073]

Phase C implementation notes (2026-11-10, `feat/178-extensible-columns-c`):

- **The parity test (T062) found three real gaps in `sqlTableAccesses`**, fixed in it rather than
  tolerated: a table a statement reads before it writes was recorded as a read only (`with … update`);
  DML inside `do $$ … $$` blocks and `create function` bodies was invisible. One R2 write the first gap
  hid is now ledgered (`organizations` personal-organizations `up()` re-parents `customer_accounts`).
  The runtime classifier in turn learned to read PL/pgSQL `execute '…'` strings as SQL.
- **The guard's ownership rule is R2's**, measured by T065 rather than assumed: own = entity tables ∪
  tables the module's migrations create **and no other module's entity maps** (a migration from before a
  module split does not own the table it once created); DDL on a table the same migration creates is a
  declaration, not a write (both halves of the migration count). With those two rules, an instance of every
  first-party module refuses, without exemptions, **exactly** the R2 ledger's (module, migration, table)
  set, and with them nothing (`backend/test/unit/db/instance-foreign-writes.test.ts`, both directions).
- Own tables created by a module's *earlier* migrations are found by a dry run of the module's migrations
  (`up()` with `execute` answering no rows), lazily at the first guarded migration — never at boot.
  `drop index` is resolved through `pg_indexes` at run time and through the audited migrations' own
  `create index`es in the audit.
- umzug wraps the refusal in a `MigrationError`; `ForeignSchemaWriteError` is its `cause`.
- `check:extensible-tables` is a relocated rule (`@endora-commerce/cli/rules/extensible-tables.js`) with a
  built package host; the binding/owner reconciliation is a declared partial signal there. It has no
  ledger, by the contract; the tree is clean (123 migrations of 8 owners).

## Phase D — Remaining eight hosts (later release — OD-178-4, ruled D-291; out of this release)

- [ ] T080 Delete the rollout constant; T004 asserts all 9 hosts [FR-011]
- [ ] T081 Preservation test over 9 tables green (fix or escalate any core migration it reds) [FR-080]
- [ ] T082 [P] Per host (customer_accounts, orders, quote_requests, catalog products, catalog categories, crm opportunities, projects, tasks): contract test then `?extensions` on admin detail + list, `extensions` on the record schema; module page line EN + PL [FR-051]
- [ ] T083 Accessor org-filter integration on `orders` (US2 scenario 5) [FR-030]
- [ ] T084 Changesets for the eight modules

## Dependencies

A → B, A → C, B → D. T046 waits for spec 176. B and C in one release.
