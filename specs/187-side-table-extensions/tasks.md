---
description: "Task list for specs/187-side-table-extensions (D-294)"
---

# Tasks: Side-table entity extensions as a platform mechanism (D1)

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`
**Prerequisites**: #1866 (MikroORM 7.2.11) merged on `master`. Nothing below starts before it.
**Tests**: mandatory (Constitution III). Every implementation task is preceded by a test task that
must fail first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[US*n*]**: the user story of `spec.md` the task serves
- Both owner questions are closed (OR-9 tenancy A; OR-10 admin HTTP deferred), so no task is
  conditional
- Paths are repository-relative; `platform` = `packages/platform/src`, `contracts` =
  `packages/contracts/src`

---

## Phase 1: Setup

- [x] T001 Confirm in the #1862 spike (throwaway, nothing kept in the tree) that MikroORM 7.2.11 keeps
  `discovery.afterDiscovered(storage, platform)`, that `storage.getAll()` is a `Map` holding every
  registered entity and `EntitySchema`, and that `em.getConnection().execute(sql, params)` returns
  rows; record the answer on #1834. If `afterDiscovered` changed, apply `plan.md` Risk 1 before T013.
  *Note:* confirmed statically against the installed 7.2.11 rather than in a spike: `discovery.afterDiscovered(storage, platform) => MaybePromise<void>` (`Configuration.d.ts`), awaited after `mapDiscoveredEntities()` in `discover()` (`MetadataDiscovery.js`; `discoverSync` does not await it, so the rule stays synchronous); `MetadataStorage.getAll(): Map<EntityName, EntityMetadata>`; `Connection.execute(sql, params, 'all', trx)` returns rows. Risk 1 does not apply. The answer is recorded here and in the Phase A report, not on #1834 (no GitHub comment was posted from this session).
- [x] T002 Rebase onto `master` after #1866; `pnpm run build:packages`; confirm `pnpm -r run typecheck`
  is green before any edit.
  *Note:* worktree off `origin/master` at `41b54e8b9` (after #1866/#1910); contracts and platform type-checked green before the first edit.
- [x] T003 Measure: on a database built by `pnpm run setup`, run the query of
  `contracts/verification-rules.md` §4 and record every table it returns in the merge request of
  Phase A. Expected from the entity scan: `quote_request_org_policies`,
  `quote_request_account_policies`. Any other table is either declared by its owner in T021 or raised
  with the architect before T030.
  *Note:* measured on four fully migrated test template databases (`b2b_test_tpl_*`, `b2b_acceptance_v7_test`; 328 – 330 migrations) rather than on a `pnpm run setup` database, which was not built: exactly `quote_request_account_policies` (→ `customer_accounts`, cascade, references the PK) and `quote_request_org_policies` (→ `organizations`, cascade, references the PK). No other table.

---

## Phase 2: Foundational (blocks every story)

- [x] T004 [P] Failing tests in `contracts/modules.test.ts`: `extends` accepts
  `{ entity: 'organizations.Organization', table: 'acme_erp_organization_links' }`; refuses a bad
  `entity` shape, an upper-case or 64-byte `table`, a 17th entry, an extra key; `defineModuleManifest`
  refuses a duplicate `table` (`contracts/entity-extension-declaration.md` §1, E1, E5).
- [x] T005 Implement `EntityExtensionDeclarationSchema` and `ModuleManifestSchema.extends` in
  `contracts/modules.ts`; duplicate-table refusal in `defineModuleManifest`.
  *Note:* `defineModuleManifest`'s E5 message carries `duplicate-table`; the contracts package cannot throw the platform's `EntityExtensionInvalidError`, so `resolveEntityExtensions` re-asks E1 and E5 (and refuses one table claimed by two modules) with the error class.
- [x] T006 [P] Failing test in `contracts/custom-fields.test.ts`: every binding carries
  `entityClassName` with the values of `contracts/entity-extension-declaration.md` §2.
- [x] T007 Add `entityClassName` to `CustomFieldHostBinding` and `CUSTOM_FIELD_HOST_BINDINGS`;
  add `ENTITY_EXTENSION_HOSTS` to `platform/kernel/schema-extensions/extensible-hosts.ts` with a test
  in `extensible-hosts.test.ts` (nine keys, no rollout filter — research R-3).
  *Note:* `ENTITY_EXTENSION_HOSTS` maps to a new `EntityExtensionHost` (`ExtensibleHost` + `entityClassName`) instead of widening `ExtensibleHost` itself: that type is published on `./db` and built by instance code, so a new required field would break D2 consumers.
- [x] T008 [P] `platform/kernel/entity-extensions/errors.ts`: `EntityExtensionInvalidError`,
  `EntityExtensionDriftError`, `EntityExtensionLoaderOutputError`, each with `{ rule, moduleId,
  origin, table, host, detail }`; unit test of their messages (module, origin, table, remedy).
  *Note:* the static/metadata error carries `entity` (the contract's field name, `entity-extension-declaration.md` §3) where this task wrote `host`; the physical finding carries `host` (`verification-rules.md` §4).
- [x] T009 `pnpm run build:packages`; `pnpm -r run typecheck`.

**Checkpoint**: contracts carry the declaration and the class names; nothing reads them yet.

---

## Phase 3: User Story 1 — declare and verify (P1) — Phase A, #1834

**Goal**: a correct declaration migrates, boots and is listed, for every origin.
**Independent test**: `mod-acme-links` fixture migrated on a fresh database; `quote_requests`' own
tables in this repository's suite.

- [x] T010 [P] [US1] Failing tests `platform/kernel/entity-extensions/declarations.test.ts`: E2
  (`invoices.Invoice` refused, message lists nine hosts), E3 (owner outside the dependency closure,
  direct and transitive), E4 (`organizations` declaring on itself); the same declaration under origins
  `core`, `package`, `overlay` gives identical verdicts (FR-005).
- [x] T011 [US1] Implement `declarations.ts` (`resolveEntityExtensions(manifests) →
  ResolvedEntityExtension[]`, using `dependencyClosureOf` from `kernel/schema-extensions/validate.ts`);
  call it from the manifest-registry derivation in `platform/lifecycle/manifest-registry.ts` so the
  lifecycle orchestrator, boot and `migrate` all refuse.
  *Note:* also asked by `buildStaticRegistry` (every `module:*` command) and by the migration merge (`configuredMigrationsFrom`, over the composed graph).
- [x] T012 [P] [US1] Guard case in `platform/db/foreign-schema-guard.test.ts`: a package migration's
  `create table "acme_links_x" (… references "organizations" ("id") on delete cascade)` is allowed and
  reports no foreign write (research R-15).
  *Note:* green on its first run, as R-15 predicts: the guard needed no change, the case pins it.
- [x] T013 [P] [US1] Failing tests `platform/db/entity-extension-metadata.test.ts` (ORM init with
  `connect: false`): a correct `@GlobalEntity` side entity on `organizations` passes; M0 refuses a
  binding whose table is mapped by a differently named class.
  *Note:* MikroORM 7 connects lazily, so the ORM is initialised without `connect: false` (the option no longer exists).
- [x] T014 [US1] Implement `platform/db/entity-extension-metadata.ts` over discovered v7 metadata
  (`getAll().values()`, never decorators — research R-4); add the `entityExtensions` input to
  `mikroOrmConfigFrom` and chain the rule after D2's `assertTableMappings` in `afterDiscovered`;
  `recordActiveEntityExtensions` beside `recordActiveSchemaExtensions`.
  *Note:* ownership of core tables comes from a new `ENTITY_OWNERS` export the composer emits beside `ALL_ENTITIES` (`backend/scripts/generate-composer.ts`), passed as `coreEntityOwners`; packages' and overlays' owners come from the merge.
- [x] T015 [US1] Supply the resolved declarations from the application binding under `backend/src/db/`
  and from the new-instance template the CLI emits (`packages/cli`, the file the template writes for
  `configured-entities`); test that a generated instance type-checks.
  *Note:* the declarations reach `mikroOrmConfigFrom` by default from the migration merge (`ConfiguredMigrations.entityExtensions`, resolved over core manifests, packages and overlays), so an instance's scaffolded `mikro-orm.config.ts` needs no edit and the CLI template was not changed. The backend binding passes `coreEntityOwners: ENTITY_OWNERS`. Proved by `packages/platform/src/db/configured-migrations.test.ts` and `backend/test/unit/db/entity-extension-package-discovery.test.ts`; the new-instance type-check test was not added because the template did not change.
- [x] T016 [P] [US1] Fixture `backend/test/fixtures/installed-packages/mod-acme-links/`: manifest
  (`dependencies: ['organizations', 'orders']`, `extends` on `organizations.Organization` →
  `acme_links_organization_refs` and `orders.Order` → `acme_links_order_notes`), two entities
  (`@GlobalEntity()`; `@TransitivelyScoped('Order', 'orderId')`), one scaffold-shaped migration
  creating both tables with cascading foreign keys, `README.md` line in the fixtures README.
  *Note:* ships `lib/` (+ `.d.ts`) only. The integration tests assemble its package contribution from `lib/` by path (`backend/test/helpers/acme-links-instance.ts`): a copy under `node_modules` is imported natively under vitest and its `@endora-commerce/platform/tenancy` becomes a second classification registry, so its entities arrive unclassified. The `node_modules` scan of its `extends` is held separately by `test/unit/db/entity-extension-package-discovery.test.ts`.
- [x] T017 [US1] Failing integration test `backend/test/integration/db/entity-extension-verifier.test.ts`
  (happy path): `migrate up` with the fixture commits, the verifier ran inside the transaction after the
  last migration, boot passes, and each verification issued exactly one statement (FR-023).
  *Note:* boot is proved through the verifier call `composeApp` makes (`verifyEntityExtensions` on a plain connection), not through a full `composeApp` boot.
- [x] T018 [US1] Implement `platform/db/entity-extension-verifier.ts` (the §4 query through
  `SchemaExtensionExec`); call it in `platform/db/migrate.ts` `migrateUpVerified` after D2's verifier and
  in `platform/composition/compose-app.ts` after D2's boot verifier.
  *Note:* with nothing declared and the policy at `warn` the bare `migrator.up()` path stays bare and the catalog query runs after it for warnings only; otherwise the run is the transactional one.
- [x] T019 [US1] Failing tests in `platform/lifecycle/commands/schema-extensions.test.ts`: `list` prints
  the `entity-extension` section and `--json` the `entityExtensions` key
  (`contracts/schema-extensions-cli.md` §1); `--module` filters; the ledger is not written;
  `audit-packages` prints one verdict per `extends` entry without a database (§2); `drop` on a
  side-table-only module prints the §3 line.
  *Note:* the tasks' file did not exist; created `packages/platform/src/lifecycle/commands/schema-extensions.test.ts` with a fake connection.
- [x] T020 [US1] Implement T019 in `platform/lifecycle/commands/schema-extensions.ts`.
  *Note:* `drop` on a side-table-only module prints the §3 line and keeps the old exit code (65), since the contract leaves exit codes unchanged.
- [x] T021 [US1] Declare `quote_requests`' two side tables in
  `packages/modules/quote_requests/src/manifest.ts`; new test
  `backend/test/integration/db/entity-extension-core-composition.test.ts` asserts zero U1/U2 findings and
  zero violations for this repository's composition (FR-032) and M0 over the real bindings; run
  `manifests:generate` and `pnpm install --lockfile-only` and commit what they change.
  *Note:* `manifests:generate` and `pnpm install --lockfile-only` changed nothing.
- [x] T022 [US1] **Blocked by #1850 (`specs/190-overlay-full-modules/`)**: overlay-origin leg of
  T017 — an overlay module under `backend/src/apps/` with a declared side table migrates, boots and lists
  with `origin: overlay`; no code path differs from T017's.
  *Note:* #1850 merged before this work, so the leg was done: `backend/test/integration/db/entity-extension-overlay-origin.test.ts`. The overlay contribution is assembled as overlay discovery assembles one (origin `overlay`, guarded, no exemption) rather than read from a module under `backend/src/apps/`, for T016's module-instance reason.

**Checkpoint**: US1 passes for core and package origins; overlay leg waits for #1850.

---

## Phase 4: User Story 2 — refusals (P1) — Phase A, #1834

**Independent test**: one red case per rule, each naming its rule; each physical case rolls back.

- [x] T023 [P] [US2] Failing cases in `entity-extension-metadata.test.ts`: M1 (no entity maps the
  table), M2 (another module's entity maps it), M3 (two-property key), M4 (`varchar` key).
- [x] T024 [P] [US2] Failing cases in `entity-extension-metadata.test.ts`, one per row of
  `contracts/verification-rules.md` §3: `organizations` accepts `@GlobalEntity` and `@OrgScoped` keyed
  by the PK (the `QuoteRequestOrgPolicy` shape) and refuses `@OrgScoped` keyed by another column;
  `customer_accounts` accepts `@TransitivelyScoped('CustomerAccount', '<pk>')` (the
  `QuoteRequestAccountPolicy` shape) and refuses `@OrgScoped` with a copied `organization_id` and a
  transitive parent naming another class; `products` accepts only `@GlobalEntity`; `projects` accepts
  only `@RuleScoped`; the message names the admitted form.
- [x] T025 [US2] Implement M1 – M5 in `entity-extension-metadata.ts` with the messages of
  `contracts/verification-rules.md` §2 – §3.
- [x] T026 [P] [US2] Failing cases in `entity-extension-verifier.test.ts`, each at `migrate up` (run
  rolled back, no migration recorded) and at boot on a database altered by hand: P1 table missing, P2 no
  foreign key, P3 foreign key to a non-PK column and to the wrong host, P4 `on delete restrict`; all
  findings of one run reported together.
- [x] T027 [US2] Implement P1 – P4 reactions and the failure-path `to_regclass` disambiguation in
  `entity-extension-verifier.ts`.
- [x] T028 [P] [US2] Lifecycle case in `backend/test/unit/_lifecycle/orchestrator.test.ts` (or its
  platform co-located twin): `install` of an arriving package whose `extends` host owner is not in its
  closure is refused with `host-not-a-dependency` and exit 65, before any migration runs.
  *Note:* the refusal sits in `buildStaticRegistry`, whose errors `module:install` already maps to exit 65 before any resource opens; test `packages/platform/src/lifecycle/commands/install-entity-extension.test.ts` (the platform co-located twin).

**Checkpoint**: every rule of `data-model.md` §6 that US1/US2 own has a red test.

---

## Phase 5: User Story 3 — undeclared side tables (P2) — Phase A, #1834

- [x] T029 [US3] Failing cases in `entity-extension-verifier.test.ts`: a fixture table with a PK = FK
  to `orders` mapped by a composed module's entity and undeclared → one `warn` line under policy `warn`,
  refusal and rollback under `refuse` (policy injected by the test); a table no entity maps → `warn`
  under both; a test asserting `ENTITY_EXTENSION_UNDECLARED_POLICY === 'warn'`.
  *Note:* the U1 case drops the fixture's own `acme_links_order_notes` from the injected context, so an entity of a composed module maps an undeclared table; `refuse` rolls the run back.
- [x] T030 [US3] Implement U1/U2 and the policy constant in `entity-extension-verifier.ts`.
- [x] T031 [US3] Extend T019/T020: `undeclared` and `unowned` statuses in `list`, with `moduleId: null`
  for `unowned`.

**Checkpoint**: Phase A complete — mergeable alone, inert for a composition that declares nothing.

---

## Phase 6: User Story 4 — read ports, mechanism + `organizations` (P1) — Phase B1, #1835

- [x] T032 [P] [US4] Failing tests then implementation of `contracts/entity-extensions.ts`
  (`EntityExtensionIncludeSchema`, `EntityExtensionReadOptions`, `WithEntityExtensions`) and
  `ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED` in `contracts/errors.ts`; the code declared by `_lifecycle`
  and translated in `packages/modules/_i18n/i18n/en.json` and `pl.json` with the strings of
  `contracts/extension-attributes-read-ports.md` §1 (`check:language`, the i18n key checks).
  *Note:* `packages/contracts/src/entity-extensions.ts` also exports `ENTITY_EXTENSION_INCLUDE_MAX` (8) and `entityExtensionModuleOf`. The code is declared by `_i18n` (T3, beside `COMMAND_EXTENSION_UNCLAIMED`), not `_lifecycle`: every platform-owned code is `_i18n`'s and there is no `_lifecycle` manifest declaring codes; both reference ledgers record it. The `{path}` placeholder is not filled by the error envelope from an array `details` (only scalar members of an object are), so a translated response falls back to the thrower's English prose — kept as the contract states it.
- [x] T033 [P] [US4] Failing tests `platform/kernel/entity-extensions/loaders.test.ts`: L1
  `loader-without-extension`, L2 `duplicate-loader`, L3 after seal; attribution to the registering
  module (an entry cannot carry another module id).
  *Note:* `packages/platform/src/kernel/entity-extensions/loaders.test.ts` (8 tests).
- [x] T034 [US4] Implement `ctx.entityExtensionLoaders` in `platform/kernel/module-context.ts` and the
  registry in `platform/kernel/entity-extensions/registry.ts`, sealed with the composition; publish the
  entry type on `./kernel` (`published-surface.test.ts` ratchet updated with the reason).
  *Note:* Entry types in `loaders.ts`, the registry in `registry.ts` with `entityExtensionDeclarationsFrom(manifests)`; L1 is judged at registration against the composed manifests' `extends`, given to the registry's constructor. `composeModules` takes `entityExtensionLoaderRegistry` and seals it after the middleware registry. `./kernel` publishes `EntityExtensionLoaderEntry`; `./composition` the registry and the derivation. The new `ModuleContext` member is marked breaking in its changeset (#1983 ruling).
- [x] T035 [US4] Failing tests `platform/kernel/entity-extensions/reads.test.ts` for semantics 1 – 7 of
  `contracts/extension-attributes-read-ports.md` §3: no include → unchanged and no call; dedupe; > 8 →
  422; unclaimed → 422 with `details` before any loader; empty records → no call; absent module → key
  absent; `null` fill; extra ids dropped; schema refusal → 500; one call per module, sequential, with
  the records' ids in order and the given `em`.
  *Note:* `reads.test.ts` (15 tests). Semantics 2 answers `422 VALIDATION_FAILED` (the contract's `VALIDATION_ERROR` is not an `ERROR_CODES` member), also for an include outside the `extensions.*` family.
- [x] T036 [US4] Implement `platform/kernel/entity-extensions/reads.ts`; register `entityExtensionReads`
  in `platform/composition/compose-app.ts` beside `schemaExtensionReads`.
  *Note:* `reads.ts` also exports `lazyEntityExtensionReads(resolve)` (on `./kernel`): a host module holds the service through it so a read without `include` resolves nothing, and a hand-built service with none answers every include as unclaimed. Registered in `composeApp` and in the test kit's `composeTestServer`.
- [x] T037 [US4] Failing contract test
  `backend/test/contract/organizations/organization-details-port-extensions.test.ts` over
  `mod-acme-links` with a loader on `organizations.Organization`: `findById`, `findByIds`,
  `searchByName`, `findByTaxId` byte-identical without `include`; with it, `extensions.acme_links`
  present (`T` / `null`); 50 records → one statement for the loader (query logger); unclaimed key → 422.
  *Note:* Over a clone with the fixture migrated (`openAcmeLinksInstance`), the fixture's `registerModule` composed through `composeModules`, the port being `OrganizationDetailsService` over `createEntityExtensionReads` — not a full `composeApp` boot, for T016's module-instance reason. 5 tests; 50 records → 1 side-table statement (query logger) for `findByIds` and for `searchByName`.
- [x] T038 [US4] Add `options?: EntityExtensionReadOptions` to those four methods in
  `contracts/organizations.ts` and implement in the `organizations` module's port (resolving
  `entityExtensionReads` as `schemaExtensionReads` is resolved in
  `packages/modules/organizations/src/backend/index.ts`); add the loader to `mod-acme-links`.
  *Note:* `findByTaxId` intersects `{ includeDeleted }` with the read options and now reads on one manager (the lookup already took `em`). The fixture gains `AcmeLinksOrganizationRefSchema` and one loader on `organizations.Organization`.

**Checkpoint**: B1 complete — with Phase A, the 0.113.0 scope; #1856 (spec 190) can build on it.

---

## Phase 7: User Story 4 — the other eight hosts (P1) — Phase B2, #1835

Each task: failing contract test (byte-identical without `include`; one loader statement for 50
records; unclaimed 422), then the `options` parameter on the methods listed in
`contracts/extension-attributes-read-ports.md` §4 and the `attach` call in the port. **Each is blocked
by `specs/186-aggregate-ports/`' task for the same aggregate**; if 186 reshapes the port, the row moves
to the port 186 publishes.

- [x] T039 [P] [US4] `customer_accounts.CustomerAccount` — `CustomerAccountReadPort`.
  *Note:* Methods: `findById`, `findByIds`, `searchByEmail`, `listAll` — the by-id pair added to the §4 row, which predated them (row updated). `findByEmail`, `findInOrganization`, `listByOrganization` and `listDueForAnonymization` unchanged. Test `backend/test/contract/customer_accounts/customer-account-read-port-extensions.test.ts` (6) over the composition's real port; the include is served by `helpers/entity-extension-probe.ts` (a test-local `acme_probe` module composed through `composeModules`, swapped in as the container's `entityExtensionReads` for the call), whose loader reads the host table rather than a side table so the shared run database gains none.
- [ ] T040 [P] [US4] `orders.Order` — `OrderReadPort`, plus US4 scenario 5: an actor scoped to
  organization A reading `[orderOfA, orderOfB]` → the loader of `mod-acme-links`' `acme_links_order_notes`
  receives only `orderOfA`.
  *Note:* Not started: blocked by spec 186 PR #1963 (orders read port still changing).
- [x] T041 [P] [US4] `quote_requests.QuoteRequest` — `QuoteRequestReadPort`.
  *Note:* Methods per §4: `findById`, `findByBusinessId`, `findByIds` (`listOpenForOrganizations` unchanged, as the row says). Test `backend/test/contract/quote_requests/quote-request-read-port-extensions.test.ts` (6): under an administrator confined to Organization A the loader is handed only A's 50 quotes, never B's.
- [ ] T042 [P] [US4] `catalog.Product` — `CatalogProductReadPort`.
  *Note:* Not started: blocked by spec 186 PRs #1975 / #1826 (catalog read ports still changing).
- [ ] T043 [P] [US4] `catalog.Category` — `CatalogCategoryReadPort`.
  *Note:* Not started: blocked by spec 186 PRs #1975 / #1826 (catalog read ports still changing).
- [ ] T044 [P] [US4] `crm.CrmOpportunity` — `OpportunityReadPort`.
  *Note:* Not started: blocked by spec 186 PR #1976 (crm read port still changing).
- [x] T045 [P] [US4] `projects.Project` — `ProjectReadPort`.
  *Note:* Methods per §4. `ProjectReadPortDeps` gains an optional `extensions: { reads, em }` (the provider passes `emFactory`, the factory `ProjectAccess` reads with); `projectRecordOf` and the command port are untouched. Test `backend/test/contract/projects/project-read-port-extensions.test.ts` (6): a Project hidden from the caller never reaches the loader; a member who sees it hands 51 ids.
- [ ] T046 [P] [US4] `tasks.Task` — `TaskReadPort`.
  *Note:* Not started: blocked by spec 186 PR #1985 (tasks read port still changing).

---

## Phase 8: User Story 5 — off state, uninstall, deletion (P2)

- [ ] T047 [US5] Add to `mod-acme-links` a `beforeCommit` hook on
  `ORGANIZATION_HOOKABLE_ACTIONS.create` that persists the side row on the hook's `em` and calls
  `noteAuditChanges(['externalRef'])` (spec 176).
- [ ] T048 [US5] Failing-first integration test
  `backend/test/integration/organizations/entity-extension-hook.test.ts`: create → side row in the same
  transaction, one audit entry with `extensions.acme_links.changedFields`; a throwing hook leaves no
  organization and no audit row; a read inside the same Command transaction sees the row through
  `include`.
- [ ] T049 [US5] Off-state test `backend/test/integration/organizations/entity-extension-off-state.test.ts`:
  module switched off and platform-unavailable — hook skipped, rows kept, loader not called, key absent,
  `organizations` responses and audit rows byte-identical on / off / absent; switched on again — all
  back (`specs/conventions/module-activation.md` item 6).
- [ ] T050 [US5] Lifecycle test: hard delete of an organization cascades its side row;
  `module:uninstall acme_links --hard` drops only the module's own tables; `module:uninstall
  organizations` refused with `dependents-block` while `acme_links` is installed.
- [ ] T051 [US5] Extend `backend/test/integration/db/schema-extension-preservation.test.ts` with one
  `preservation_<host>_links` side table per host after its creating migration, asserting a cascading
  FK at the end (FR-070, research R-16).

---

## Phase 9: User Story 6 — convention, guide, constitution (P3) — Phase C, #1836

- [ ] T052 [US6] `specs/conventions/module-migrations.md` item 4b: the side-table rule, once —
  declaration, what `migrate` and boot check, tenancy table, writes through own Commands and 176 hooks,
  off and uninstall; cites `contracts/verification-rules.md`.
- [ ] T053 [US6] **Blocked by #1856**: `docs/docs/architecture/side-table-extensions.md`, written for an
  instance author, every code block `verbatim-from` the reference overlay module's sources
  (`check:doc-snippets`); covers #1836's list including when to choose D1 over D2 and over custom
  fields; links the convention.
- [ ] T054 [US6] Polish twin under `docs/i18n/pl/docusaurus-plugin-content-docs/current/architecture/`
  per `docs/docs/contributing/documentation-i18n.md`; `docs/sidebars.js` entry beside
  `architecture/schema-extensions`.
- [ ] T055 [P] [US6] Edit `customisation-ladder.md` (D1 row: "declared in the manifest, checked at
  migrate and boot, readable through the host's read port"; the "Never a rung" paragraph's overlay
  sentence is spec 190's), `schema-extensions.md` (pointer to D1), `migrations.md` (the verifier step),
  each with its Polish twin.
- [ ] T056 [US6] Constitution I and XI sentences (FR-071), MINOR bump from the version found on `master`,
  Sync Impact Report; if spec 190's XV amendment merged first, chain from it (spec 178 R-A3).

---

## Phase 10: Polish and verification

- [ ] T057 Changesets per `plan.md` § Generated artefacts (`specs/conventions/release-intent.md`);
  the platform changeset of Phase A states that undeclared side tables are refused from the next release.
- [ ] T058 Verify: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`,
  `pnpm --filter backend run test:unit:fast`, the targeted integration and contract files of this
  feature, `pnpm --filter '!backend' run test`, `pnpm run check:naming && pnpm run check:language`;
  dispatch `backend-suite.yml` on the branch before merging Phase A (D-198 runs it only after merge).
- [ ] T059 Grep `backend/test/**` and `packages/**` for every symbol renamed or moved; re-derive anything
  derived from a moved location (AGENTS traps).

---

## Phase D (the release after A): refusal

- [ ] T060 Flip `ENTITY_EXTENSION_UNDECLARED_POLICY` to `'refuse'`, update T029's assertion, platform
  changeset with the upgrade note (EN), docs line in `side-table-extensions.md` (+ PL).

---

## Dependencies and execution order

- **Phase 1 → Phase 2 → US1** (T010 – T021) — T022 additionally waits for #1850.
- **US2** and **US3** need US1's T014 and T018 (the rule homes); they can run in parallel with each other.
- **US4 B1** (T032 – T038) needs Phase 2 and US1's T011 (declarations resolved); it does not need
  US2/US3.
- **US4 B2** (T039 – T046) needs B1 and, per host, spec 186's task for that aggregate.
- **US5** needs B1 (loader, include) and US1.
- **US6** needs US1, B1 and #1856 for T053/T054; T052, T055 and T056 can start after US1.
- **Phase D** ships one release after the release that carried Phase A.

### Parallel opportunities

T004/T006/T008; T010/T012/T013/T016; T023/T024/T026/T028; T032/T033; every B2 host task; T055 with T052.

## Implementation strategy

MVP = Phases 1 – 5 (Phase A, #1834): the declaration and its checks, inert for a composition that
declares nothing and immediately useful to `quote_requests`. Then B1 for 0.113.0. B2 follows spec 186
host by host. C closes #1836 when #1856 lands. D flips the policy a release later.
