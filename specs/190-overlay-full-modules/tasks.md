# Tasks: Overlay modules as full modules (190, D-297)

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**TDD (III, NN)**: every "Test" task is written and **seen failing** before the task after it.
`[P]` = parallelisable within its phase. FR ids in brackets. Phases follow `plan.md`'s work packages;
the phase header names the issue it closes.

Verify per task: `pnpm run build:packages` after editing a package, then the targeted
`pnpm --filter <member> exec vitest run <path>`. Per phase: `pnpm -r run typecheck`,
`pnpm -r run lint`, `pnpm --filter '!backend' run test`, the integration files named below against
`pnpm run dev:infra:test`, and — for every phase that deletes or moves a file — `rg` over
`backend/test/**` and every package's tests for the old path or symbol (AGENTS.md trap). Phases that
change a generated artefact run `composer:generate`, `manifests:generate` and
`pnpm install --lockfile-only` and commit the result.

**Gate**: Phases 1 – 4 may merge before #1866 (MikroORM 7.2.11). Phases 5 – 11 start after it.

**Release placement (OR-11)**: Phases 1, 2 and 4 ship in **0.113.0**. Phases 2 (#1848) and 4 (#1855)
are `breaking change`; the lead applies the GitHub labels. If either misses the 0.113.0 cut, ask the
owner for its placement. Do not move it to a later release silently.

**Not in scope (OR-12, OR-13)**: no `DEPLOYMENT=example` leg in `backend-suite.yml`, and no demo
built with `DEPLOYMENT=example`.

## Phase 0 — Ruling (#1846)

- [x] T000 This spec merged (#1876); D-297 recorded in `spec.md` *Decisions*. #1846 was not closed
  by that merge; it is closed by the follow-up merge request that records D-297 in the convention
  layer (documentation and contract only, `contracts/docs-pass.md` *Phase 0*) [FR-005]

## Phase 1 — Type-check of overlay code (#1847, US2)

- [x] T001 Test: instance template renders `backend/tsconfig.apps.json` per `contracts/overlay-build.md` §1, `typecheck` script, `setup` runs it before `migrate` — `packages/cli/src/new-instance/template.test.ts` [FR-010, FR-011]
- [x] T002 Implement in `packages/cli/src/new-instance/template.ts` (`backendScripts`, file entries, setup steps) [FR-010, FR-011]
- [ ] T003 Test: an overlay source with `enum` fails `tsc -p backend/tsconfig.apps.json`; a clean one passes — acceptance step in `backend/scripts/acceptance/instance.ts` [FR-010]
  - Partial (#1847): measured by the compiler over the **rendered** configuration in a temporary tree — `packages/cli/src/new-instance/template.test.ts` (`enum`, `namespace`, parameter property, a type error, admin/test exclusion). The acceptance step is not written: it needs a new R6.3 assertion id and a recorded state from a real run
- [x] T004 This repository: `backend/tsconfig.apps.json` (`erasableSyntaxOnly`, `src/apps/**`), exclude `src/apps/**` from `backend/tsconfig.json`, `typecheck` names three programs; widen `backend/test/unit/harness/workspace-resolution.test.ts` to three programs (test first) [FR-010]
- [x] T005 Fix whatever `erasableSyntaxOnly` reports under `backend/src/apps/` (expected: none or a handful of parameter properties) — measured: none. The program resolves the packages through `paths: {}` (their `dist` declarations): with the source `paths` the flag also judged `packages/contracts/src`, which has parameter properties and is not overlay code
- [ ] T006 Instance README text (`template.ts` overlay section): the type-check exists — convention sentence in `overlay-modules.md` updated in the same MR [FR-104]
  - Partial (#1847): the README text, the scaffolded overlay comment and `create-your-first-module.md` (EN + PL) are done; the `overlay-modules.md` sentence waits for PR #1899, which changes that file

## Phase 2 — Overlay build and freshness (#1848, US2) — after Phase 1

- [ ] T010 Test: layout refusals `nested-module`, `package-in-disguise` over a temp tree — `packages/platform/src/overlay/overlay-layout.test.ts` [FR-002, FR-003]
- [ ] T011 Implement `overlay-layout.ts`; call `assertOverlayLayout` in `overlayModuleIdsUnder` **beside** (not yet instead of) the schema refusal [FR-002, FR-003]
- [ ] T012 [P] Test: CLI mirror of the layout walk agrees with the platform's on the same fixture (the two walks must agree) — `packages/cli/src/build/layout.test.ts` [FR-003]
- [ ] T013 Move the runtime-asset classification `backend/scripts/lib/runtime-assets.ts` → `packages/cli/src/lib/runtime-assets.ts`; `copy-runtime-assets.ts` imports it; grep `backend/test/**` for the old path [FR-013]
- [ ] T014 Test: `endora build overlays` compiles to `backend/dist/apps/**`, mirrors `i18n/*.json`, refuses an unclassified extension, exit codes 0/1/2 — `packages/cli/src/build/build.test.ts` [FR-012, FR-013]
- [ ] T015 Implement `packages/cli/src/build/` (spawn the instance's own `tsc`; `--watch` + recursive `fs.watch` for assets) [FR-012 – FR-014]
- [ ] T016 Test: freshness pairing — `fresh`, `stale`, `unbuilt` (file and whole module), `orphan`; admin, test, `.d.ts` excluded; no source root → one `info` line — `packages/platform/src/overlay/overlay-freshness.test.ts` [FR-015]
- [ ] T017 Implement `overlay-freshness.ts`, `OverlayBuildError`; `exitOnRefusal` prints the refusal family; `ComposeAppOptions.deploymentSourceRoot` [FR-015]
- [ ] T018 Test + implement: instance wiring passes `deploymentRoot = backend/dist` and `deploymentSourceRoot = root` in `index`, `worker`, `migrate`, `cli`, `module-commands/*`, `mikro-orm.config`; `build`/`dev` scripts per `overlay-build.md` §2 — `template.test.ts` [FR-012, FR-014, FR-016]
- [ ] T019 This repository: `backend/src/overlay/overlay-roots.ts` passes the source root when compiled and `backend/src` exists [FR-016]
- [ ] T020 Test + implement: `endora upgrade` rewrites the wiring files and writes `tsconfig.apps.json`; a hand-edited wiring file is reported, not overwritten — `packages/cli/src/upgrade/*.test.ts` [FR-017]
- [ ] T021 Acceptance: stale edit, unbuilt module, orphan unit, `package.json` under `apps/` — each refused by API start, `migrate` and `module:status`; a clean build boots — `backend/scripts/acceptance/instance.ts` [FR-015, FR-003]
- [ ] T022 Convention + README sentences ("nothing in this tree compiles") updated; `building-packages.md` pointer [FR-104]
- [ ] T023 Changesets for #1848: cli `minor` + platform `minor` (`major` is refused in `0.x`, `release-intent.md`), marked **`breaking change`**, **0.113.0** (OR-11). The body carries the upgrade note of FR-018: the wiring files `endora upgrade` rewrites (`index`, `worker`, `migrate`, `cli`, `module-commands/*`, `mikro-orm.config`); `backend/tsconfig.apps.json`; the new `build` / `dev` / `typecheck` / `setup` scripts; the deployment root moving to `backend/dist`. It also says that a wiring file the instance hand-edited is reported, not overwritten, and the edit must be re-applied to the new rendering. It is written so the 0.113.0 release pull request can copy it unchanged into *After upgrading to 0.113.0* in `docs/docs/upgrading-an-instance.md` (EN + PL). Verified against the T020 test output, which lists the files the upgrade actually rewrites [FR-018]

## Phase 3 — Overlay ports and dependencies (#1854, US4) — stands alone

- [ ] T030 Test: overlay-boundary analysis — sanctioned type import passes; value import, other file, other deployment, missing dependency each reported with the failed clause — `packages/cli/src/lib/overlay-boundary.test.ts` [FR-070, FR-071]
- [ ] T031 Implement `overlay-boundary.ts`
- [ ] T032 Reader 1: `backend/scripts/check-module-boundary.ts` uses the analysis for overlay↔overlay edges; red proof in its test; existing ledger entries for such edges (if any) re-derived [FR-071]
- [ ] T033 Reader 2: `endora generate` reports findings, exit 1 after writing — `packages/cli/src/generate/index.test.ts` [FR-071]
- [ ] T034 Test: dependency between two overlay modules — composition, install refusal of a missing dependency, deactivation refused naming the dependent, `dependents-block` on hard uninstall — platform lifecycle tests over a temp deployment root [FR-072]
- [ ] T035 Lift `--ports`: emits `ports.ts` + `providePort` — `packages/cli/src/new-module/overlay.test.ts` [FR-059]
- [ ] T036 Divergence: sibling-overlay port consumption under `notRecorded` — `packages/cli/src/lib/divergence.test.ts`
- [ ] T037 C-1 (OR-10): no origin or tier code in this feature. Before Phase 6, confirm that 189's `ModuleOrigin` / `ModuleEntry.origin` (`specs/189-command-middleware/contracts/module-origin.md` §1 – §2) has merged. Grep the WP3 diff for `TrustTier`, `trustTierOf` or any new origin union: expected none [FR-090]
- [ ] T038 Convention sentences (overlay ports) updated; changeset cli `minor`

## Phase 4 — Overlay admin layer (#1855, US3) — after Phase 0

- [ ] T040 Test: `emitDeploymentAdminRegistry` — two deployments, bare → empty, relative imports, sorted — `packages/cli/src/lib/admin-artefacts.test.ts` [FR-080]
- [ ] T041 Implement the renderer and the Tailwind `@source` per overlay admin layer of every deployment on disk [FR-080, FR-082]
- [ ] T042 This repository: `composer:generate` renders `admin/src/deployments/{example,none}.generated.ts`; `overlay:check` byte-compares every deployment; commit artefacts [FR-080]
- [ ] T043 Instance: `endora generate` renders them uncommitted; `.gitignore` entry in the template [FR-080]
- [ ] T044 Test + implement wiring: `admin/vite.config.ts` alias selection (unset → none; missing file → refuse), `resolve.dedupe`; `admin/src/main.tsx` concatenation; `admin/tsconfig.json` includes overlay admin layers; backend overlay project excludes them — both trees [FR-081, FR-083, FR-084]
- [ ] T045 Test: bundle-content — admin built for deployment A holds no import of B's layer (two fixture deployments) [SC-004]
- [ ] T046 Move palette coverage analysis into `packages/cli/src/lib/palette-coverage.ts`; `admin/test/unit/palette-coverage.test.ts` iterates every deployment on disk; `endora generate` reports it (exit 1 after writing) [FR-085]
- [ ] T047 [P] `registered-bundles-shape.test.ts`, `check:action-route-permissions`, permission inventory (`DEPLOYMENT=<name>`): populations include overlay admin layers — red proof with a fixture overlay action [FR-086]
- [ ] T048 Lift `--admin` / `--action` in `new-module/overlay.ts` [FR-059]
- [ ] T049 Instance admin image `ARG DEPLOYMENT` (`deploy.ts` `adminDockerfile`); acceptance builds an overlay admin layer [FR-081, FR-084]
- [ ] T050 `module-admin-surfaces.md` item 7 sentence replaced [FR-104]
- [ ] T051 Changeset for #1855: cli `minor`, marked **`breaking change`**, **0.113.0** (OR-11). The body carries the upgrade note of FR-018: the admin image's new `ARG DEPLOYMENT` (`deploy.ts` `adminDockerfile`); the admin build selecting `admin/src/deployments/<deployment>.generated.ts`, rendered uncommitted by `endora generate` and git-ignored by the template; and `endora upgrade` re-rendering the admin wiring, with a hand-edited file reported and not overwritten. Written for the same 0.113.0 *After upgrading* section as T023. Verified against T044 / T049 [FR-018]

## ══ Gate: #1866 (MikroORM 7.2.11, legacy decorators) merged ══

## Phase 5 — Classification refusal (#1849, US7)

- [ ] T060 Test: undecorated class per origin (core list, package fixture, overlay fixture) refused naming class + contributor; doubly classified refused; embeddable ignored — `packages/platform/src/tenancy/entity-classification.test.ts` [FR-020, FR-021]
- [ ] T061 Implement `UnclassifiedEntityError` and the call in `configuredEntitiesFrom` (v7 metadata storage API) [FR-020, FR-021]
- [ ] T062 Integration: this repository's full composition boots (no false positive) — existing boot integration test, run it
- [ ] T063 C-6: the `/legacy`-only decorator check from #1866 includes `backend/src/apps/**` and instance overlay sources [FR-022]
- [ ] T064 Changeset platform `minor` (a third-party package with an unclassified entity now refuses boot — upgrade note)

## Phase 6 — Overlay schema discovery (#1850, US1) — after Phases 2 and 5 — **one merge request**

- [ ] T070 Test: `overlaySchemaContributionsUnder` — `entities` export read; `entities-not-array`, `entity-not-class`; migration directory read file by file; `migration-file-shape` (none / two / mismatched name); `overlay-entity-unexported`; bare root → `[]` — `packages/platform/src/overlay/overlay-schema.test.ts` (rewritten) [FR-030 – FR-032]
- [ ] T071 Implement (rewrite `overlay-schema.ts`); `MigrationOrigin` + `'overlay'` [FR-030 – FR-033]
- [ ] T072 Test: merge — overlay entities in the ORM set; overlay migrations ordered by dependencies; guard wraps them with **no** exemption (a first-party exemption naming the same table does not apply); ownership covers overlay ids; `DEPLOYMENT` unset → byte-identical result — `configured-migrations.test.ts`, `configured-entities.test.ts` [FR-033 – FR-036]
- [ ] T073 Implement in `configured-entities.ts`, `configured-migrations.ts` (`deploymentRoot` inputs) [FR-033 – FR-036]
- [ ] T074 Bindings: `backend/src/db/configured-{entities,migrations}.ts` pass the overlay root; instance wiring `mikro-orm.config.ts` passes it; `migrate.ts` loses `refuseOverlaySchema` [FR-035]
- [ ] T075 **Delete** every refusal of `contracts/overlay-schema-discovery.md` §4 (platform, CLI generate, CLI new-module `--entities` stays refused until Phase 8, composer branches); rewrite the tests that asserted them; `rg -n "OverlaySchemaError|contributes no schema|overlaySchemaFiles|refuseOverlaySchema"` over the whole tree returns only this spec and history [FR-037, SC-003]
- [ ] T076 Composer: overlay schema validated (scoped names, filename/class agreement, one classification, `/legacy` imports), nothing emitted; registries bare core — `backend/test/unit/scripts/generate-composer*.test.ts` [FR-038]
- [ ] T077 Test (red first): a test that sets `DEPLOYMENT=example` in-process gets a template digest different from bare core, and a bare-core test in the same run keeps the bare-core template. Group the overlay-table integration tests (T079, T090, T120) so they share that one template. No `backend-suite.yml` leg is added (OR-13) — `backend/test/unit/harness/` [FR-039, FR-040]
- [ ] T077a Implement: `backend/test/template-identity.ts` floors overlay migrations as their own origin [FR-039]
- [ ] T078 `check:module-boundary` R1/R2 and `fk-dependency-drift.test.ts` read overlay migrations under `backend/src/apps/` [FR-034]
- [ ] T079 Integration (`DEPLOYMENT` set in-process): fixture overlay entity + migration applied, cross-tenant read is "not found" [US1]
- [ ] T080 Acceptance: fixture instance overlay with a table — `setup` green, route works [US1, SC-001]
- [ ] T081 Convention sentences: `overlay-modules.md` D-106 paragraph → D-297, stale `services/` sentence deleted; `module-migrations.md` overlay paragraph and R2 instance paragraph [FR-101, FR-104]
- [ ] T083 Test (OR-10, needs 189 P1; see plan C-1): a fixture overlay with one entity, one migration, a `ports.ts` and an admin layer composes with `ModuleEntry.origin === 'deployment'` (via `moduleOriginOf`) while its `ModuleIdClaimOrigin` stays `overlay` and it stays in `deploymentShippedEntries`, the same as a schema-less overlay. No manifest field changes it — `packages/platform/src/overlay/overlay-runtime.test.ts` [FR-090, FR-091]
- [ ] T082 Dispatch `backend-suite.yml` on the branch (D-198) before merge; changeset platform `minor`

## Phase 7 — Lifecycle (#1851, US5) — after Phase 6

- [ ] T090 Test: lifecycle sequence of `contracts/overlay-lifecycle.md` §5 — `backend/test/integration/_lifecycle/overlay-tables.integration.test.ts` [FR-045]
- [ ] T091 `module:status` lists overlay migrations per module with origin [FR-045]
- [ ] T092 [P] Off-state test template for overlays; `check:off-state-coverage` counts overlay modules of every deployment [FR-046]
- [ ] T093 Test + implement `DivergenceKind` `column-extension` (contracts first), own tables under `notRecorded`; C-2 side-table kind with 187 [FR-047]
- [ ] T094 Changeset contracts `minor`

## Phase 8 — CLI (#1852, US1) — after Phase 6

- [ ] T100 Move migration naming from `backend/scripts/new-migration.ts` into `packages/cli/src/lib/migration-naming.ts`; parity test over stamps and slugs [FR-056, FR-057]
- [ ] T101 Test + implement `endora new migration <moduleId> --name <slug>` [FR-056]
- [ ] T102 Test + implement `migration:new --module <overlay-id>` here [FR-057]
- [ ] T103 Test + implement `--entities [--tenant-scope]` for overlays (legacy decorators, one tenancy decorator, `entities` export, first migration) [FR-055]
- [ ] T104 Test-kit entity index includes overlay entities — `entity-index-artefact.test.ts` [FR-058]
- [ ] T105 `module-migrations.md` §1 overlay form; changeset cli `minor`

## Phase 9 — `x_*` columns from overlays (#1853, US6) — after Phase 6

- [ ] T110 Test: overlay `schemaExtensions` held to V9 – V11 with the overlay context; generated step at the head of the overlay block; ledger rows under the overlay id; orphaned on hard uninstall — re-run the 178 fixtures with an overlay declarer [FR-065, FR-066]
- [ ] T111 Implement in `overlaySchemaContributionsUnder` + merge; composer keeps refusing workspace module packages, accepts overlays
- [ ] T112 `schema-extensions` convention sentence; changeset platform `minor`

## Phase 10 — Reference overlay (#1856, US8) — after Phases 4, 6, 187 (#1834) and #1835

- [ ] T120 Test first: `example_erp_keys` off-state, hard uninstall, cross-tenant, unique ERP key, palette action visible / hidden by permission, promotion-name test (class names unchanged when loaded as a package fixture) [FR-095, US9]
- [ ] T121 Implement `backend/src/apps/example/modules/example_erp_keys/`: org-scoped side-table entity on `organizations` declared per 187, migration, `beforeCommit` hook on `organization.create`, port + `ports.ts`, admin landing + sidebar, palette action, pl + en bundles, permissions [FR-095]
- [ ] T122 Divergence sentences in `backend/src/apps/example/divergence.ts`; `composer:generate`, `overlay:check`, `check:divergence` green for every deployment
- [ ] T123 C-3: 187's side-table checks re-run over the overlay; C-4: extension-attribute read through `include`
- [ ] T124 OR-12: the demo deployment configuration (`.github/workflows/*` and deploy scripts) sets no `DEPLOYMENT`. Grep it, and add no demo wiring for `example` [FR-096]

## Phase 11 — Docs and constitution XV (#1857) — after Phases 4, 6, #1840, 189's XV/XIII sentences (OR-9) and the #1841 warning release

- [ ] T130 Constitution XV MINOR amendment with Sync Impact Report, version chained from `master` (C-5). Precondition: 189's XV and XIII sentences are on `master`. Keep them verbatim, place 190's text around them per `contracts/constitution-xv-amendment.md`, and leave XIII untouched (OR-9) [FR-100]
- [ ] T131 `overlay-modules.md` *Overlay module layout* section [FR-101]
- [ ] T132 [P] Published pages EN + PL per `contracts/docs-pass.md` table [FR-102]
- [ ] T133 [P] Ladder: rung 2c command middleware, policy participants, rung 4a decoration of the four `GUARD_SEAM_REGISTRATIONS` deprecated (0.113.0) / refused (0.114.0) with other root names still decoratable, data ladder *Who* D1/D2, bus-wrap → middleware migration example [FR-103]
- [ ] T134 `check:docs-translations`, `check:doc-snippets`, `check:language`, `check:naming`, `test/unit/docs/`, docs build green; close #1858

## Dependencies & execution

- Phase 1 → Phase 2; Phases 3 and 4 independent of 1–2; Phase 5 after #1866; Phase 6 after 2 + 5;
  Phases 7, 8, 9 parallel after 6; Phase 10 after 4 + 6 + siblings; Phase 11 last.
- Cross-spec: T083 needs 189 P1 (plan C-1, OR-10). T130 needs 189's XV/XIII sentences on `master`
  (plan C-5, OR-9).
- MVP: Phases 1 + 2 + 5 + 6 deliver US1 and US2 (an instance overlay owning a table, compiled and
  checked).
