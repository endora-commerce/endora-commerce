---
description: "Task list for the CRM module — Sales Opportunities"
---

# Tasks: CRM — Sales Opportunities

**Input**: Design documents from `specs/143-crm-sales-opportunities/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution III is non-negotiable: in every phase the test tasks come
first, are run, and must fail *for the stated reason* before the implementation task that
turns them green is started. Report which tests were seen red.

**Organization**: by user story. Phase 3 (User Story 1) is the MVP and the owner's success
criterion; every later story is independently verifiable on top of it.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — can run in parallel with its neighbours **inside its own phase**: a different
  file, no dependency on an unfinished task of that phase.
- **[US#]** — the user story of `spec.md` the task serves. Setup, Foundational and Polish
  tasks carry none.
- Parallelism **between stories** (separate worktrees) is in *Dependencies & Execution Order*.

## Path conventions

- The module: `packages/modules/crm/` — `src/manifest.ts`, `src/backend/`, `src/migrations/`,
  `src/admin/`; `i18n/` and `docs/` at the package root.
- Unit tests sit beside their subject as `*.test.ts`. Contract and integration tests:
  `backend/test/contract/crm/`, `backend/test/integration/crm/`. Admin screen tests:
  `admin/test/modules/crm/`.
- Targeted run: `pnpm --filter backend exec vitest run <path>`; module unit tests:
  `pnpm --filter @endora-commerce/mod-crm run test`; admin: `pnpm --filter admin exec vitest
  run <path>`.

## Standing rules for every task

1. **Read before writing**: the routed convention for what you are about to do
   (`AGENTS.md` § *Where the rest of it lives*) and the prior art `plan.md` § *Handoff* names.
2. **A premise tagged [unverified] in `research.md` is re-derived by reading the tree** at the
   task that names it. Record what you found in the pull-request description.
3. **Rebuild a package you edited before running tests against it** (`dist` vs `paths`).
4. **Regenerate, never edit**, generated files; run `pnpm install --lockfile-only` beside
   `manifests:generate`.
5. A file outside `packages/modules/crm/` may be touched **only** if it is listed in
   `contracts/foreign-module-changes.md`. Otherwise stop and report.
6. Never run `db:fresh`, `db:reset`, `setup` or `module:*` unprefixed (development database).
7. Commits: conventional style, `git commit -s` (DCO), no `Co-Authored-By` or AI trailer.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: a registered, empty, buildable module; the host's "CRM" navigation group; the
contracts file. Nothing user-visible yet.

- [x] T001 Create the package skeleton `packages/modules/crm/` from the non-source scaffolding of `packages/modules/blog/` (`tsconfig.json`, `tsconfig.build.json`, `tsconfig.ui.json`, `vitest.config.ts`, `tailwind.css`, `LICENSE`, `README.md`, an empty `CHANGELOG.md`), with a hand-seeded `package.json` (`name: "@endora-commerce/mod-crm"`, the workspace's current lockstep `version`, `endora: { type: "module", id: "crm" }`) that `manifests:generate` will re-render; add `src/manifest.ts` (`defineModuleManifest({ id: 'crm', name: 'CRM', version, dependencies: ['auth', 'settings'], activation: { settingCode: 'crm.enabled', default: true }, settings: <group 'crm' + the `crm.enabled` boolean>, docs: false, demo: false })`), `src/backend/index.ts` (`registerModule(ctx)` doing nothing, `export const entities = []`) and `src/migrations/index.ts` (`export const migrations = []`)
- [x] T002 Run `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`, `pnpm --filter backend run composer:generate`; commit exactly the artefacts those commands report (`packages/modules/crm/package.json`, `pnpm-lock.yaml`, the generated manifest index and registries under `backend/src/`); prove with `composer:check`, `manifests:check`, `overlay:check` and `pnpm install --frozen-lockfile`
- [x] T003 Measure, do not assume (research R-1): run `pnpm run check:naming`, `pnpm run check:language`, `pnpm --filter @endora-commerce/mod-crm run typecheck` and `run build`, and `pnpm --filter backend exec vitest run test/unit/db/module-graph.test.ts test/unit/kernel/` against the skeleton. If `check:naming` refuses the id `crm` (Principle VI asks for a plural), **stop and report to the owner** — do not rename and do not add an exemption
  - **Measured 2026-10-05, resolved the same day.** `check:naming` refused `crm` (*"Backend module folder looks singular"*). Resolution relayed by the coordinator from the owner's requirements document, which names the module "CRM (crm)": the id stays, and `crm` joins `allowed_proper_noun` in `scripts/check-naming.sh` — `research.md` § *Implementation notes*, N-1.
- [x] T004 [P] Write failing schema tests in `packages/contracts/src/crm.test.ts`: one accept and one reject case per request schema named in `contracts/admin-api.md` §1–§12, the token grammar of §9, `opportunityStatusEventName` for all four kinds, and `OpportunityTransitionOutcome` exhaustiveness
- [x] T005 [P] Write a failing admin test `admin/test/modules/crm/nav-section.test.tsx`: a contribution with `section: 'crm'` renders under a heading labelled "CRM" placed after *Sales*; with no visible item the heading is not rendered. First `grep -rn "'sales'\|AdminNavSectionNameSchema\|appShell.section" admin/test backend/test packages/*/src --include=*.ts --include=*.tsx` and list every test that enumerates sections, so T007 updates them in the same change
- [x] T006 Implement `packages/contracts/src/crm.ts` — every Zod schema, inferred type, port interface, event payload type, `opportunityStatusEventName`, `OpportunityTransitionVetoError` and the guard-registry types of `contracts/admin-api.md` and `contracts/events-and-ports.md`, for **all** stories (API-first; later stories add no contract) — and `export * from './crm.js'` in `packages/contracts/src/index.ts`; T004 green; `pnpm --filter @endora-commerce/contracts run build`
  - **Deviation (2026-10-05):** the three port interfaces are in `crm.ts`, but their `Container name:` marker lines are withheld until the change that registers each name (T049 for the guard registry; User Story 14 for the two ports) — `check:port-shape` refuses a marked port with no registration. `research.md` N-5.
- [x] T007 Add the host's navigation group (owner ruling 2026-10-05, research R-19): `'crm'` in `AdminNavSectionNameSchema` in `packages/contracts/src/admin-contributions.ts`; `{ key: 'crm', labelKey: 'appShell.section.crm', items: [] }` after `sales` in `NAV` in `packages/admin-shell/src/components/AppShell.tsx`; `"appShell.section.crm": "CRM"` in `packages/modules/_i18n/i18n/en.json` and `pl.json`; update the tests T005 listed; T005 green; rebuild `contracts`, `admin-shell`, `mod-i18n`
- [x] T008 [P] Write the changeset `.changeset/crm-module.md` (`minor`, never `major` in `0.x`) for the consumer of the packages: the new package `@endora-commerce/mod-crm`, the new `crm` exports of `@endora-commerce/contracts`, and the new `crm` member of `AdminNavSectionNameSchema`; verify with `pnpm --filter backend exec tsx scripts/check-release-intent.ts --since origin/master`
- [x] T009 Phase gate: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter backend run test:unit:fast`, `pnpm --filter '!backend' run test`

**Checkpoint**: the workspace installs and builds with an empty `crm` module registered.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the whole schema and every entity (so no later story touches a generated
registry), the activation axis, one gated route, and the off-state proof.

**⚠️ CRITICAL**: no user story starts before this phase is green.

### Tests first

- [x] T010 [P] Write failing `backend/test/integration/crm/migration.test.ts` (model: `backend/test/integration/quote_requests/migration.test.ts`): all 13 tables and the sequence of `data-model.md` exist; the partial unique index on `is_initial`; both partial unique indexes on `crm_order_status_mappings`; unique `(document_kind, document_id)`; the FKs to `organizations` and `sales_channels` are `on delete restrict`; the six seeded statuses and the seeded transitions are present, exactly one initial
- [x] T011 [P] Write failing `backend/test/integration/crm/off-state.test.ts` (model: `backend/test/integration/quote_requests/off-state.test.ts`) calling `expectModuleAbsent(h, 'crm', { routes: [{ url: '/api/v1/admin/crm/workflow', cookies: admin }], adminPresence: { cookies: admin }, settingWrite: { code: 'crm.auto_create_from_orders', value: true, cookies: admin } })`, with a positive control first (the route answers 200 while on)
- [x] T012 [P] Write failing unit tests `packages/modules/crm/src/backend/domain/opportunity-status-graph.test.ts`: `has`, `canTransition`, `kindOf`, `initial`, outgoing edges from a closing status allowed, and `assertValid` refusing each broken invariant of `data-model.md` (no initial, two initials, initial not `open`, no `won`, no `lost`, an edge naming an unknown status)

### Schema and entities

- [x] T013 Scaffold the migration with `pnpm --filter backend run migration:new -- --module crm --name init` (never choose a stamp or a number) and write its `up`/`down` in the scaffolded `packages/modules/crm/src/migrations/<stamp>_crm_init.ts`: every table, index, check and FK of `data-model.md`, the sequence `crm_opportunity_number_seq`, and the seeded default workflow (research R-25 — own tables only); export it from `packages/modules/crm/src/migrations/index.ts`
- [x] T014 [P] Create the configuration entities in `packages/modules/crm/src/backend/entities/`: `crm-opportunity-status.entity.ts`, `crm-opportunity-status-transition.entity.ts`, `crm-order-status-mapping.entity.ts`, `crm-value-counting-status.entity.ts`, `crm-tag.entity.ts` — each `@GlobalEntity()`
- [x] T015 [P] Create `packages/modules/crm/src/backend/entities/crm-opportunity.entity.ts` — `@OrgScoped()`, class `CrmOpportunity`, every column of `data-model.md`
- [x] T016 [P] Create the eight child entities in `packages/modules/crm/src/backend/entities/` — `crm-opportunity-link`, `-status-history`, `crm-status-propagation`, `crm-opportunity-comment`, `-attachment`, `-tag`, `-reference` (`*.entity.ts`) — each `@TransitivelyScoped('CrmOpportunity', 'opportunityId')`
  - **Seven** classes, not eight: the list above names seven and `data-model.md` has seven child tables (13 = 5 configuration + the Opportunity + 7). `research.md` N-7.
- [x] T017 Export all 13 classes as `entities` from `packages/modules/crm/src/backend/index.ts`; add `organizations` and `sales_channels` to the manifest `dependencies` (the two FKs force them — `fk-dependency-drift.test.ts`); run `composer:generate` + `manifests:generate` + `pnpm install --lockfile-only`; T010 green; `pnpm --filter backend exec vitest run test/unit/db/fk-dependency-drift.test.ts test/unit/db/migrations-registry.test.ts` and the entity tenant-classification check green
- [x] T018 [P] Expose the CRM entity classes the integration tests need through `backend/test/helpers/package-entities.ts`, following that file's own header (the harness's sanctioned door to a packaged module's entities)

### Manifest, composition, the first gated route

- [x] T019 Complete `packages/modules/crm/src/manifest.ts` for this phase: `dependencies` — add `orders`, `customer_accounts`, `catalog`, `admin_users`, `assets_library` (research R-17; each is added by the first task that resolves its port if you prefer the build to prove it — `check:port-dependencies` fails without the edge); `permissions: [{ code: 'crm:read', label: 'View sales opportunities', module: 'crm', requires: [<the code `orders` gates its admin order read/search with — read `packages/modules/orders/src/backend/routes.ts`, research R-23>] }]`; the two module Settings `crm.auto_create_from_orders` and `crm.auto_create_from_quote_requests` (boolean, default `false`, group `crm`, with names and descriptions — declared now because the off-state proof needs a non-activation setting to show configuration is not editable while off; their behaviour is US9's); `i18n: { bundlesDir: 'i18n' }`; `docs: { dir: 'docs' }`; keep `demo: false`. Declare **no** permission and no palette action that nothing enforces or routes to yet (`permission-inventory.test.ts` sweeps both directions; a palette entry for a missing route is a defect)
- [x] T020 [P] Create `packages/modules/crm/i18n/en.json` and `pl.json` (flat maps): `adminRoles.permission.crm:read`, the settings group and `crm.enabled` labels the settings screen needs, `workflow.*` status-kind labels
  - The generic settings screen renders a setting's manifest `name` / `description` and reads no bundle key for them (no module bundle carries one), so the bundles hold the permission label and the `workflow.kind.*` labels only.
- [x] T021 Implement `packages/modules/crm/src/backend/domain/opportunity-status-graph.ts` (pure; model `packages/modules/orders/src/backend/domain/order-status-graph.ts`); T012 green
- [x] T022 Implement `packages/modules/crm/src/backend/services/workflow-read-service.ts` (`loadGraph()` — no cache, research R-2 — and `getWorkflow()` returning `OpportunityWorkflow` with `inUseCount` from a raw query constrained by `orgConstraintFor()`, model `packages/modules/orders/src/backend/services/order-status-usage.ts`) and `packages/modules/crm/src/backend/routes/routes.workflow.ts` with `GET /api/v1/admin/crm/workflow` gated `requireAdmin('crm:read')`
  - `orderStatusKnown` is returned as `true` for every mapping until T059 — no mapping can exist before the configuration endpoints land. No published `orders` port answers "is this an Order status code" today; `research.md` N-8.
- [x] T023 Create `packages/modules/crm/src/backend/compose/workflow.ts` (`registerWorkflow(ctx)`: `ctx.di.register` the service, `ctx.routes` the route) and call it from `registerModule` in `packages/modules/crm/src/backend/index.ts`. **Prove the compose-file shape** (plan § Structure Decision, [unverified]): run `check:subscribe-seam`, `check:port-dependencies`, `check:container-imports`, `check:entry-presence`, `check:module-boundary`; if any of them does not follow a `ctx` handed to a helper in another file, collapse to a single `index.ts` and say so in the pull request — every later "compose/<area>.ts" task then means "a section of `index.ts`"
  - **Premise false (2026-10-05): collapsed to a single `index.ts`.** `check:port-dependencies` reads a module's registrations from the file exporting `registerModule` and from no other: with `ctx.di.register` in `compose/workflow.ts` it reported `crmWorkflowReadService` as *"resolved by crm and registered by no module"* (exit 1). **Every later "`compose/<area>.ts`" task means "a section of `packages/modules/crm/src/backend/index.ts`"**, which is therefore a hot file for every story. `research.md` N-6.
- [x] T024 [P] Write `packages/modules/crm/docs/crm.md` — front matter `title` + one-sentence `description`, sections *What it does*, *Switching it on and off*, *Permissions*, placeholders for the per-story sections — and its Polish copy under `docs/i18n/pl/` per `docs/docs/contributing/documentation-i18n.md`; no relative link to a sibling module or to the site tree; run `composer:generate`, `check:module-docs`, `check:docs-translations`
- [x] T025 T011 green: rebuild the package, run `off-state.test.ts`, then `pnpm --filter backend run check:off-state-coverage`
- [x] T026 Phase gate: the full block of `quickstart.md` § *Before calling any story done*; report every result with its output
  - **2026-10-05:** green. Two things the block does not name and a route-adding story owes: `backend/test/fixtures/openapi-baseline.json` (regenerate with `UPDATE_OPENAPI_BASELINE=1`), and — under a memory cap — `--workspace-concurrency=1` on the `'!backend'` run. `research.md` N-11, N-12.

**Checkpoint**: `crm` is installed, migrated, toggleable, absent when off. Stories may start.

---

## Phase 3: User Story 1 — Work an Opportunity through its workflow, with a linked Order following along (Priority: P1) 🎯 MVP

**Goal**: configure the workflow; create, list, edit and open Opportunities by hand; link an
existing Order; move the Opportunity and see linked Orders follow through the Order workflow's
own rules, with every outcome shown; register business logic on X → Y.

**Independent Test**: `backend/test/integration/crm/workflow-walk.test.ts`
(`quickstart.md` § *The MVP walk*) — and by hand in the admin.

### Tests for User Story 1 (write first, see them fail)

- [x] T027 [P] [US1] Contract tests `backend/test/contract/crm/workflow.contract.test.ts`: `POST/PATCH/DELETE /statuses`, `PUT /transitions`, `PUT /order-status-mappings` (forward direction) against their schemas; `crm:configure` enforced (403 with `crm:read` only); every refusal of `contracts/admin-api.md` §4
- [x] T028 [P] [US1] Contract tests `backend/test/contract/crm/opportunities.contract.test.ts`: list (each filter of §1 that US1 owns: `q`, `statusCode`, `state`, `organizationId`, `salesChannelId`, dates, sort, cursor), create, get with `ETag`, patch with `If-Match` (409 on a stale version), delete gated `crm:configure`
- [x] T029 [P] [US1] Contract tests `backend/test/contract/crm/links-and-transition.contract.test.ts`: link/unlink/`syncStatus` for `documentKind: 'order'` with the four errors of §3; `POST /transition` result shape and the four refusals of §2; retry and dismiss
- [x] T030 [P] [US1] Integration test `backend/test/integration/crm/workflow-walk.test.ts` — the ten steps of `quickstart.md` § *The MVP walk*, against the real `orders` module; the Order's status is read through `orderReadPort`, never assumed from the response
- [x] T031 [P] [US1] Integration test `backend/test/integration/crm/tenant-isolation.test.ts`: an admin scoped to Organization A gets 404 `CRM_OPPORTUNITY_NOT_FOUND` for B's Opportunity on get, patch, transition, link, and never sees it in the list; linking B's Order to A's Opportunity is 404/422; a child (`links/:linkId`, `propagations/:id`) of B's Opportunity addressed under A's id is 404
- [x] T032 [P] [US1] Integration test `backend/test/integration/crm/transition-hooks.test.ts`: a guard registered for `{ from, to }`, for `{ from }` only and for `{ to }` only each vetoes exactly its transitions and nothing is written; a guard whose `ownerModuleId` is switched off is skipped; the two `.before` events precede the write; the three after-events fire once, after commit and after propagation; a throwing after-subscriber does not undo the transition
- [x] T033 [P] [US1] Integration test `backend/test/integration/crm/transition-concurrency.test.ts`: two concurrent transitions of one Opportunity — one applies, the other is re-evaluated once and answers "already there" or 409 `CRM_TRANSITION_CONFLICT`; exactly one history row and one set of propagation rows
- [x] T034 [P] [US1] Integration test `backend/test/integration/crm/forward-propagation.test.ts`: three linked Orders — one follows (`applied`), one has `syncStatus: false` (no row, untouched), one is in a terminal Order status (`not_permitted` with `detail`); an Order-side veto guard yields `vetoed`; the Opportunity moved in every case; a `pending` row exists before the port call; retry after fixing the cause yields `applied` and dismisses the old row; a mapping to a deleted Order status yields `unknown_status`
- [x] T035 [P] [US1] Unit tests `packages/modules/crm/src/backend/events/opportunity-status-events.test.ts` (names for the four kinds, payload shape) and `packages/modules/crm/src/backend/services/opportunity-number.test.ts` (format `OPP-000123`)
- [x] T036 [P] [US1] Admin tests `admin/test/modules/crm/WorkflowConfigPage.test.tsx` (add a status, mark it closing-won, add a transition in the graph, set a forward mapping, deleting an in-use status shows the refusal) and `admin/test/modules/crm/OpportunityDetail.test.tsx` (status control offers only `allowedTransitions`; after a move, a refused Order is shown with its reason and *Retry* / *Dismiss*)
- [x] T037 [P] [US1] Admin tests `admin/test/modules/crm/OpportunitiesList.test.tsx` and `OpportunityCreatePage.test.tsx`: filters drive the query; create requires title + Organization + currency; the Organization picker, optional contact person and Sales Channel are sent; success navigates to the detail

### Implementation for User Story 1

- [x] T038 [US1] Add to `packages/modules/crm/src/manifest.ts`: permissions `crm:write` and `crm:configure` (`contracts/admin-surfaces.md` §4); `errorCodes` for the codes US1 raises (`contracts/admin-api.md` §13). **First read commit `512b68e84` and `packages/contracts/src/errors.ts`** to establish how a code is minted (whether it joins `ERROR_CODES`, which ledgers record it) and follow that; add `errors.<CODE>` and the two permission labels to `packages/modules/crm/i18n/en.json` + `pl.json`; `check:error-translations` green
  - **2026-10-05:** the codes join `ERROR_CODES`, with a `MINTED_ERROR_CODES` entry each and `crm` on the `MIGRATED_MODULES` roster; eleven of the fourteen are declared here, the other three by the story that first raises them. `research.md` N-13.
- [x] T039 [P] [US1] Implement `packages/modules/crm/src/backend/services/workflow-config-service.ts`: status create/update/delete/set-initial, `setTransitions`, `setOrderStatusMappings` — each a Command through `CommandBus.run` (`data-model.md` § Audit actions), each re-validating the graph with `assertValid` inside the Command and answering 422 `CRM_WORKFLOW_INVALID` with `details.rule` (model: `order-status-graph-service.ts` `#audited`)
- [x] T040 [US1] Add the configuration routes to `packages/modules/crm/src/backend/routes/routes.workflow.ts` (`crm:configure`) and register the service in `compose/workflow.ts`; T027 green
  - Composition is a section of `packages/modules/crm/src/backend/index.ts` (N-6). Every write answers the whole workflow; `research.md` N-20.
- [x] T041 [P] [US1] Implement `packages/modules/crm/src/backend/services/opportunity-service.ts`: `create` (validate Organization through `organizationDetailsPort`, contact person through `customerAccountReadPort` and that it belongs to the Organization, start status from the graph, number from the sequence, the creation row in `crm_opportunity_status_history`, event `crm.opportunity.created.v1` via the Command's `event`), `list` (filters, cursor), `get` (with `allowedTransitions`), `update` (optimistic `version`), `delete` — all writes Commands; ports through `lazyPort<T>(ctx, '<literal>')`
  - The Organization's *reach* is asked with `isOrgInScope` — the port is not tenant-filtered (`research.md` N-14). Tags and the assignee/tag filters are refused until their stories (N-18).
- [x] T042 [US1] Create `packages/modules/crm/src/backend/routes/routes.opportunities.ts` and `compose/opportunities.ts`; register in `index.ts`; T028 and T031 (the CRUD half) green
- [x] T043 [P] [US1] Implement `packages/modules/crm/src/backend/services/opportunity-link-service.ts` for `documentKind: 'order'`: add (validate via `orderReadPort.findById` under the caller's scope, same-Organization rule, unique-constraint → 409), set `syncStatus`, remove; render a link through `orderReadPort.findByIds` with `available: false` for an unreadable Order; events and audit per `data-model.md`
- [x] T044 [US1] Create `packages/modules/crm/src/backend/routes/routes.links.ts` and `compose/links.ts`; register; the link half of T029 green
- [x] T045 [P] [US1] Implement `packages/modules/crm/src/backend/events/opportunity-status-events.ts` (emit helpers over the contracts' name builder — before pair, after triple) ; T035 green
- [x] T046 [P] [US1] Implement `packages/modules/crm/src/backend/services/opportunity-transition-guard-registry.ts` (`OpportunityTransitionGuardRegistryPort`: `register`, `owners`, and an internal `run(event)` that skips a guard whose `ownerModuleId` is not `effectiveState.isPresent`, maps `OpportunityTransitionVetoError` to 409 `CRM_TRANSITION_VETOED`)
- [x] T047 [US1] Implement `packages/modules/crm/src/backend/services/opportunity-transition-service.ts` — the five steps of research R-3 in that order, refusing before writing; row lock + one re-evaluation (model: `order-transition-service.ts` `apply`); `closed_at`/`closed_kind` maintenance; history row; `cause` parameter; after-events emitted in a `finally` after propagation
- [x] T048 [US1] Implement `packages/modules/crm/src/backend/services/order-status-propagation-service.ts` — forward direction (research R-4): for each sync-enabled order link write a `pending` row, call `lazyPort<OrderTransitionPort>(ctx, 'orderTransitionPort').applyStatus(…)` **after** the Opportunity's commit and outside any transaction, persist the returned outcome and `detail`; `retry` and `dismiss`; **no `catch` around the port call** except a narrow one whose first line is `rethrowIfModuleDisabled(error)` recording `failed` (run `check:port-catches` and `check:transaction-context`)
  - The `pending` rows are written inside the transition's own Command, by the transition service; this service says which Orders are owed what, asks them after the commit and records the answer. `research.md` N-16, N-19.
- [x] T049 [US1] Create `packages/modules/crm/src/backend/routes/routes.transitions.ts` and `compose/transitions.ts` (register the guard registry with `ctx.di.register` — ungated, a contribution seam — and the two services); T029, T030, T032, T033, T034 green
  - The `Container name:` marker of `OpportunityTransitionGuardRegistryPort` landed with the registration (N-5).
- [x] T050 [P] [US1] Contribute the Sales Channel attribution counter from a contribution-only `ctx.onBoot` in `packages/modules/crm/src/backend/compose/opportunities.ts`, after reading `packages/modules/quote_requests/src/backend/services/sales-channel-attributions.ts` for the descriptor shape (research R-13, [unverified]); declare what `check:port-dependencies` asks for; add a case to `tenant-isolation.test.ts` or a new `backend/test/integration/crm/sales-channel-attribution.test.ts` proving a channel with an Opportunity is reported as attributed
  - Proved in `backend/test/integration/crm/sales-channel-attribution.test.ts`. Descriptor shape and edge: `research.md` N-23.
- [x] T051 [P] [US1] Create `packages/modules/crm/src/admin/api.ts` (typed calls over `apiClient` from `@endora-commerce/admin-kit/lib`, types from `@endora-commerce/contracts`) and `packages/modules/crm/src/admin/index.ts` (`contributions`: the four US1 routes and the two US1 nav rows of `contracts/admin-surfaces.md` §1–§2, section `crm`; components as dynamic-import factories only)
- [x] T052 [P] [US1] Implement `packages/modules/crm/src/admin/pages/WorkflowConfigPage.tsx` with `workflow/StatusesTable.tsx`, `workflow/StatusDialog.tsx` and `workflow/OrderStatusMappings.tsx`, reusing `StatusTransitionGraph`, `ColorPicker`, `Table`, `PageHeader` from admin-kit (model: `packages/modules/orders/src/admin/pages/OrderStatusConfigPage.tsx`); Order statuses for the mapping picker come from the Orders API; T036 (workflow half) green
- [x] T053 [P] [US1] Implement `packages/modules/crm/src/admin/pages/OpportunitiesList.tsx` (`ResponsiveTable`, `PaginationFooter`, filters) and `OpportunityCreatePage.tsx` (`OrganizationPicker`, `CustomerPicker`, `SalesChannelPicker`); honour an `organizationId` query parameter as a preselection; T037 green
  - **2026-10-05:** the list's footer is a module-private `CursorPagination`, not the kit's `PaginationFooter` — the endpoint is cursor-paged and knows no total (`research.md` N-26). `CustomerPicker` is stubbed in the create test (N-27).
- [x] T054 [US1] Implement `packages/modules/crm/src/admin/pages/OpportunityDetail.tsx`, `opportunity-detail/tabs.ts` (data: one entry, *Overview*) and `opportunity-detail/tabs/OverviewTab.tsx` with `components/StatusControl.tsx`, `components/LinkedDocuments.tsx` (link an Order by search, toggle following, unlink) and `components/PropagationOutcomes.tsx` (per-Order outcome, *Retry*, *Dismiss*); every async surface has loading, empty and error states (`.claude/skills/ux-laws/SKILL.md`); T036 (detail half) green
- [x] T055 [US1] Add the two US1 palette actions (`open-opportunities`, `new-opportunity`) to `packages/modules/crm/src/manifest.ts` and every US1 UI string to `packages/modules/crm/i18n/en.json` + `pl.json` under `nav.*`, `actions.*`, `opportunity.*`, `workflow.*`, `links.*`, `propagation.*`, `auditLog.crm.*`; `i18n:hardcoded`, `check:bundle-pairing`, `registered-bundles-shape.test.ts`, `check:action-route-permissions` green
- [x] T056 [P] [US1] Extend `packages/modules/crm/docs/crm.md` (+ Polish copy): the workflow, statuses and kinds, linking Orders, the mapping and what each propagation outcome means, how to register business logic on X → Y (events and the guard registry, with a five-line example for an overlay module)
  - **Backend half done 2026-10-05** — the page and its Polish copy cover the workflow, linking Orders, the mappings and outcomes, and both extension seams.
  - **Admin half done 2026-10-05** — a section *In the Admin UI* names the four screens, the code that opens each, the two palette actions and a five-step first walk; the *coming* line about screens is gone. Both translation-cache entries were refreshed (`check:docs-translations`).
- [x] T057 [US1] Regenerate (`manifests:generate`, `pnpm install --lockfile-only`, `composer:generate` — `admin/package.json` and `admin/src/modules.generated.ts` change now that `src/admin/` exists), extend `backend/test/integration/crm/off-state.test.ts` with the US1 routes, and run the full gate of `quickstart.md`; add an empty or real changeset as `check:release-intent --since origin/master` asks
  - **Backend half done 2026-10-05** — `off-state.test.ts` probes every US1 route, the OpenAPI baseline holds them, the generated reference page and its Polish mirror carry the three permissions, and the gate ran.
  - **Admin half done 2026-10-05** — regenerated with `src/admin/` present (the module's `package.json`, `tailwind.css` and `README.md`; `admin/package.json`, `admin/src/modules.generated.ts`, `admin/src/tailwind.generated.css`; the lockfile; the generated reference page and its Polish mirror). `off-state.test.ts` gained the palette case on both axes. The gate ran, and the success scenario was walked in a browser — `research.md` N-26 … N-30.
- [x] T181 [US1] The Opportunity edit form and delete control the detail screen lacked (`research.md` N-28 (g), (h)): `components/OpportunityEditForm.tsx` in the *Details* section of `OverviewTab.tsx` over `PATCH /opportunities/:id` — only the changed fields, `If-Match` from the version the draft was read at, a 409 `VERSION_CONFLICT` said with *Reload* and never retried; a delete control with a confirmation dialog in `OpportunityDetail.tsx` for a holder of `crm:configure`; an optional reason on `StatusControl.tsx`; strings under `opportunity.edit.*`, `opportunity.delete.*`, `opportunity.status.reason*`; tests first in `admin/test/modules/crm/OpportunityEdit.test.tsx`; docs section (+ Polish)
  - **Done 2026-10-05** — beyond T054's letter; `research.md` N-C1.

**Checkpoint**: the owner's success criterion holds. Demonstrable MVP.

---

## Phase 4: User Story 2 — An Order's status moves its Opportunity (Priority: P2)

**Goal**: reverse mappings with the any/all rule and one-hop loop prevention.

**Independent Test**: `backend/test/integration/crm/reverse-mapping.test.ts`.

- [x] T058 [P] [US2] Integration test `backend/test/integration/crm/reverse-mapping.test.ts`: one linked Order reaching a mapped status moves the Opportunity with `cause: 'order_status'` and `causeOrderId`; `requireAllOrders` holds the move until every sync-enabled Order qualifies; a transition the Opportunity graph lacks is recorded `skipped` with the reason and nothing moves; a closed Opportunity is not reopened; **loop cases** — with mappings in both directions, a user-initiated move produces exactly one history row and its Orders' echoes move nothing; a reverse-caused move pushes no other Order; the Order is changed through the real Orders admin endpoint, not by emitting the event by hand
- [x] T059 [P] [US2] Extend `backend/test/contract/crm/workflow.contract.test.ts`: `PUT /order-status-mappings` with `direction: 'order_to_opportunity'`, `requireAllOrders`, the one-per-Order-status uniqueness; `GET /workflow` reports `orderStatusKnown`
- [x] T060 [P] [US2] Extend `backend/test/integration/crm/off-state.test.ts`: positive control, then `order.status_changed.v1` for a linked Order moves nothing while `crm` is deactivated and does again after reactivation
- [x] T061 [US2] Implement the reverse half in `packages/modules/crm/src/backend/services/order-status-propagation-service.ts` (`onOrderStatusChanged`: echo suppression against forward rows, link/`syncStatus`/closed checks, mapping lookup, the any/all rule, apply through `OpportunityTransitionService` with `cause: 'order_status'`, record `skipped`) and make the transition service skip forward propagation for that cause (research R-5)
- [x] T062 [US2] Create `packages/modules/crm/src/backend/compose/reverse-mapping.ts`: `ctx.subscribe('order.status_changed.v1', …)` parsing the payload with its Zod schema and running inside `enterSystemScope('crm: order status follows', …)`; register in `index.ts`; allow the reverse direction in `workflow-config-service.ts`; T058–T060 green; `check:subscribe-seam`, `check:entry-scope` green
  - A section of `index.ts` (N-6). No Zod schema exists for the event; the payload is read with a guard (`research.md` N-B2).
- [x] T063 [P] [US2] Admin: add the reverse-direction table and the "only when every linked Order is there" toggle (default on when the target closes) to `packages/modules/crm/src/admin/pages/workflow/OrderStatusMappings.tsx`; show the cause Order on `OverviewTab.tsx`; test in `admin/test/modules/crm/WorkflowConfigPage.test.tsx`; strings under `workflow.*`
- [x] T064 [US2] Docs section (+ Polish), regenerate if imports changed, full gate
  - **Backend half done 2026-10-05** — the page and its Polish copy describe the reverse direction and its API; no import of the package changed, so nothing was regenerated; the gate ran. `research.md` N-B1…N-B4.

---

## Phase 5: User Story 3 — Opportunities are assigned to Sales Reps (Priority: P2)

**Goal**: default assignee from the Organization's Sales Reps; reassign; "mine"; notify.

**Independent Test**: `backend/test/integration/crm/default-assignee.test.ts`.

- [x] T065 [P] [US3] Unit tests `packages/modules/crm/src/backend/domain/default-assignee.test.ts`: the three-step rule of research R-9 — creator among the assigned reps wins; else the earliest `createdAt`; inactive users skipped; none → `null`
- [x] T066 [P] [US3] Integration test `backend/test/integration/crm/default-assignee.test.ts` with real `organizations` sales-rep assignments: the four acceptance scenarios of US3; `POST /assign` to an inactive user is 422 `CRM_ASSIGNEE_INVALID`; `assignedAdminUserId=me|unassigned` filters; a scoped admin sees an in-scope Opportunity assigned to somebody else
- [x] T067 [P] [US3] Integration test `backend/test/integration/crm/assignment-notification.test.ts`: assignment records one admin notification for the new assignee with a `linkPath` to the Opportunity and none for a self-assignment; with `admin_notifications` deactivated (`withModuleOff`) the assignment still succeeds and nothing is recorded
- [x] T068 [US3] Implement `packages/modules/crm/src/backend/domain/default-assignee.ts` (pure) and `packages/modules/crm/src/backend/services/opportunity-assignment-service.ts` (`resolveDefault` via `salesRepAssignmentPort.listForOrganization` + `adminUserReadPort.findByIds`; `assign` as Command `crm.opportunity.assign` with event `crm.opportunity.assigned.v1`); call `resolveDefault` from `opportunity-service.ts` `create` when `assignedAdminUserId` is absent
- [x] T069 [US3] Implement `packages/modules/crm/src/backend/services/crm-notifier.ts`: ask `effectiveState.isPresent('admin_notifications')` first, then `lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort').record(…)`; **before writing the call, check whether `specs/093-backend-delivered-prose/` has landed a key/params variant of the port** (research R-11, [unverified]) and use it if so; declare the `degrades-without` edge with its `whenAbsent` sentence in `packages/modules/crm/src/manifest.ts`
- [x] T070 [US3] Create `packages/modules/crm/src/backend/routes/routes.assignment.ts` and `compose/assignment.ts`; register; add the `assignedAdminUserId` filter to the list; T065–T067 green; `check:port-dependencies` green (the consequence ledger accepts the edge)
- [x] T071 [P] [US3] Admin: `AdminUserPicker` for the assignee on `OpportunityCreatePage.tsx` and `OverviewTab.tsx` (with an "inactive" marker), an assignee column and a "Mine / Unassigned / Anyone" filter on `OpportunitiesList.tsx`; tests in `admin/test/modules/crm/assignment.test.tsx`; strings under `assignment.*`
- [x] T072 [US3] Docs section (+ Polish), full gate
  - **Backend half done 2026-10-05** — the page and its Polish copy describe the default rule, the endpoint, the filter and the notification; `off-state.test.ts` probes the new route, the OpenAPI baseline holds it, the generated reference page and its Polish mirror carry the `admin_notifications` edge; the gate ran. `research.md` N-B5…N-B8.

---

## Phase 6: User Story 4 — Notes and internal messages (Priority: P2)

**Goal**: notes (author-editable) and a message thread (immutable, notifying), both internal.

**Independent Test**: `backend/test/integration/crm/comments.test.ts`.

- [x] T073 [P] [US4] Contract tests `backend/test/contract/crm/comments.contract.test.ts` for the four endpoints of `contracts/admin-api.md` §6
- [x] T074 [P] [US4] Integration test `backend/test/integration/crm/comments.test.ts`: a note is listed with its author; only the author edits or deletes it (403 otherwise); a deleted note disappears from the list and stays in the audit trail; a message cannot be edited or deleted (409 `CRM_MESSAGE_IMMUTABLE`); a message notifies the assignee and earlier thread participants except the author; with `admin_notifications` off the message is still stored; comments of an out-of-scope Opportunity are 404; **no customer-facing route returns a note or a message** (assert the storefront order and quote endpoints for that Organization carry none)
- [x] T075 [US4] Implement `packages/modules/crm/src/backend/services/opportunity-comment-service.ts` (Commands `note_add`, `note_update`, `note_delete`, `message_add`; parent loaded through the scoped EM first; recipients computed from the assignee and prior message authors; notifications through `crm-notifier.ts` — **if US3 has not landed, create that file here per T069**), `routes/routes.comments.ts`, `compose/comments.ts`; register; T073–T074 green
- [x] T076 [P] [US4] Admin: `opportunity-detail/tabs/NotesTab.tsx` and `MessagesTab.tsx` with one shared `components/CommentComposer.tsx` (a plain `Textarea`; US12 swaps in the reference textarea), two lines in `tabs.ts`; tests `admin/test/modules/crm/comments.test.tsx` (author sees edit/delete on notes only; messages show none); strings under `comments.*`
- [x] T077 [US4] Docs section (+ Polish), full gate
  - **Backend half done 2026-10-05** — the page and its Polish copy describe notes, messages and their API; `off-state.test.ts` probes the four routes, the OpenAPI baseline holds them; the gate ran. `research.md` N-B12…N-B14.

---

## Phase 7: User Story 5 — Attachments (Priority: P2)

**Goal**: files from the media library attached to an Opportunity, protected from deletion.

**Independent Test**: `backend/test/integration/crm/attachments.test.ts`.

- [x] T078 [P] [US5] Contract tests `backend/test/contract/crm/attachments.contract.test.ts` (`contracts/admin-api.md` §7)
- [x] T079 [P] [US5] Integration test `backend/test/integration/crm/attachments.test.ts`: attach an uploaded asset, list with name/size/uploader, remove; the same asset cannot be attached twice; `assetReferenceRegistry.findReferences(assetId)` reports the Opportunity while attached and not after removal; the reference is still reported while `crm` is deactivated (model: `backend/test/integration/blog/asset-reference-while-off.test.ts` — read what that test asserts and mirror it); attachments of an out-of-scope Opportunity are 404
- [x] T080 [US5] Read first, then implement: `packages/admin-kit/src/components/asset-picker/assets-api.ts`, the `returns` attachment flow and `packages/modules/blog/src/backend/services/blog-asset-references.ts` — to establish (research R-15, [unverified]) which visibility an upload gets, how a private asset is downloaded by an admin, and which read port yields name/MIME/size. Implement `packages/modules/crm/src/backend/services/opportunity-attachment-service.ts` (Commands `attachment_add`, `attachment_remove`; attachments are uploaded **private**), `services/crm-asset-references.ts` (the descriptor), `routes/routes.attachments.ts`, `compose/attachments.ts` with a **contribution-only** `ctx.onBoot` (no presence probe) pushing the descriptor; register; T078–T079 green; `check:entry-presence` green
  - Stopped first, on the closed enum `assetReferenceKindSchema` (N-B15); unblocked the same day by the coordinator's approval of row A10 and built. A section of `index.ts` (N-6). `research.md` N-B15…N-B17.
- [x] T081 [P] [US5] Admin: `opportunity-detail/tabs/AttachmentsTab.tsx` using `AssetUploader` / `FileDropzone` from admin-kit, one line in `tabs.ts`; test `admin/test/modules/crm/attachments.test.tsx`; strings under `attachments.*`
- [x] T082 [US5] Docs section (+ Polish), full gate
  - **Backend half done 2026-10-05** — the page and its Polish copy describe attachments and their API; `off-state.test.ts` probes the three routes, the OpenAPI baseline holds them; the gate ran. `research.md` N-B17.

---

## Phase 8: User Story 6 — Tags (Priority: P2)

**Goal**: tag CRUD, tagging, AND-filter on the list.

**Independent Test**: `backend/test/integration/crm/tags.test.ts`.

- [x] T083 [P] [US6] Contract tests `backend/test/contract/crm/tags.contract.test.ts` (`contracts/admin-api.md` §8; `crm:configure` for CRUD, `crm:write` for tagging)
- [x] T084 [P] [US6] Integration test `backend/test/integration/crm/tags.test.ts`: create/rename/recolour/delete; a case-insensitively duplicate name is 409 `CRM_TAG_NAME_TAKEN`; deleting a tag in use removes it from its Opportunities; `PUT …/tags` replaces the set and is audited; the list with two `tagId` values returns only Opportunities carrying both; `usageCount` counts only Opportunities the caller may see
- [x] T085 [US6] Implement `packages/modules/crm/src/backend/services/tag-service.ts` (Commands per `data-model.md`), `routes/routes.tags.ts`, `compose/tags.ts`; add the `tagId` filter and `tags` to the summary in `opportunity-service.ts`; register; T083–T084 green
- [x] T086 [P] [US6] Admin: `pages/TagsPage.tsx` (table, dialog, delete confirmation naming the usage count), route `/crm/tags` and its nav row in `src/admin/index.ts`, a tag `MultiSelect` on the create form, on `OverviewTab.tsx` and as a list filter; tests `admin/test/modules/crm/tags.test.tsx`; strings under `tags.*`
- [x] T087 [US6] Docs section (+ Polish), regenerate (new admin route), full gate
  - **Backend half done 2026-10-05** — the page and its Polish copy describe tags and their API; `off-state.test.ts` probes the five routes, the OpenAPI baseline holds them; the gate ran. Left for the admin half: the admin route and its regeneration. `research.md` N-B9…N-B11.

---

## Phase 9: User Story 7 — Board view (Priority: P2)

**Goal**: a column per status; move by drag **and** by a non-drag control; filter.

**Independent Test**: `admin/test/modules/crm/board.test.tsx` and
`backend/test/contract/crm/board.contract.test.ts`.

**Owner ruling, 2026-10-05 (third round)**: the board is built on **`@dnd-kit`**, as a
reusable, domain-free `KanbanBoard` primitive in `packages/admin-kit` that CRM is the first
to consume (research R-20; `plan.md` § Complexity Tracking carries the Constitution IV
justification). T089, T091 and T093 were rewritten in place for it; T148–T151 are new and
**run before T091** — order inside this phase: T088, T089, T148 (tests) → T149 → T150 → T090,
T091 → T092 → T151 → T093.

- [x] T088 [P] [US7] Contract + integration tests `backend/test/contract/crm/board.contract.test.ts`: `GET /board` returns one column per status in `weight` order with `count`, `valueTotals` per currency, at most `perColumn` items and `hasMore`; filters by tag, assignee, Sales Channel, Organization; an out-of-scope Opportunity is in no column and in no count
  - **Done 2026-10-05** — every clause but two: the board **refuses** `tagId` and `assignedAdminUserId` with 422, as the list does (N-18), and the test asserts that. The stories that teach the list those filters add them to `BoardService.conditions` and replace that case (`research.md` N-C2).
- [x] T089 [P] [US7] Admin test `admin/test/modules/crm/board.test.tsx` over CRM's board (the `KanbanBoard` primitive itself is proven by T148): columns render from the response in `weight` order with count and value totals; the card's **"Move to…" menu lists exactly `allowedTransitions`** and calls the transition endpoint — this is the single-pointer, non-drag path WCAG 2.2 SC 2.5.7 requires and it is tested as a first-class path, not a fallback; `canDrop` handed to the primitive is true exactly for `allowedTransitions`; an `onMove` from the primitive calls the same transition endpoint, moves the card optimistically and rolls it back with the server's reason on a refusal; a refused Order outcome after a move is surfaced on the card; the filter bar drives the query
  - **Done 2026-10-05** — 20 cases; the real primitive is rendered and a wrapper records the props it is handed. A card's transitions are the workflow's, read from `GET /workflow`: `OpportunitySummary` carries no `allowedTransitions` (N-C3).
- [x] T090 [US7] Implement `packages/modules/crm/src/backend/services/board-service.ts` (one query per column or one windowed query — measure against SC-006 with 500 open Opportunities and record the timing), `routes/routes.board.ts`, `compose/board.ts`; register; T088 green
  - **Done 2026-10-05** — one grouped statement for every column's figures plus one list call per column for its cards; composition is a section of `src/backend/index.ts` (N-6), not `compose/board.ts`. With 500 open Opportunities: median 56 ms at `perColumn=50`, 65 ms at 200 (N-C2).
- [x] T091 [US7] Implement `packages/modules/crm/src/admin/components/OpportunityBoard.tsx` on **`KanbanBoard` from `@endora-commerce/admin-kit/components`** (T150) — CRM imports the primitive and **never `@dnd-kit/*` directly**, so `manifests:generate` renders no `@dnd-kit` peer into `mod-crm` — and `pages/OpportunityBoardPage.tsx`: columns from `GET /board`, `canDrop` from each card's `allowedTransitions`, `onMove` → the transition endpoint with optimistic move and rollback, `renderCard` with title, Organization, assignee, value, tags and the "Move to…" menu, announcement labels from the module's bundles in both languages; states: loading, empty column, error; T089 green
  - **Done 2026-10-05** — also `components/MoveToMenu.tsx` (a disclosure, not the kit's `RowActionMenu`) and `components/OpportunityFilterFields.tsx`, which the list now renders too (N-C3, N-C4).
- [x] T092 [US7] Add the route `/crm/board` and its nav row to `src/admin/index.ts`, the palette action `open-opportunity-board` to `src/manifest.ts`, strings under `board.*`; `check:action-route-permissions` green
  - **Done 2026-10-05** — the palette action, the nav row at weight 200 and the route, each on `crm:read`.
- [ ] T093 [US7] Docs section (+ Polish) — including that a card can be moved by dragging (pointer, touch, keyboard) or from its "Move to…" menu; regenerate; full gate; hand the screen to `endora-commerce-designer` for a UX/accessibility audit on a touch device and with a screen reader (the drag announcements and the non-drag path)
  - **2026-10-05: everything but the audit.** The docs section and its Polish copy, the regeneration, the full gate and a headless-Chromium run of the board (mouse, keyboard, the "Move to…" menu, touch emulation, 390 px, Polish) are done — `research.md` N-C5, which also lists what a person still has to check. The task stays open until `endora-commerce-designer` has audited the screen on a touch device and with a screen reader.
- [x] T148 [P] [US7] **Primitive tests first** — `admin/test/components/KanbanBoard.test.tsx` (beside the other admin-kit component tests; read one, e.g. the reorder list's, for the harness): renders one lane per column with `renderColumnHeader` and one card per item with `renderCard`; a pointer drag onto a lane whose `canDrop` is true calls `onMove(itemId, fromColumnId, toColumnId)` exactly once; onto a lane whose `canDrop` is false calls nothing and the card returns; dropping on the source lane calls nothing; **keyboard**: focus a card, lift with Space, move between lanes with the arrow keys, drop with Space, cancel with Escape — each announced through the live region with the consumer's labels; a click on an interactive element inside a card (a link, a menu button) does not start a drag; the component carries no CRM vocabulary (grep the file for `opportunit|status|crm`). These tests are also the proof that `@dnd-kit/core` works under React 19 (research R-20, [unverified])
- [x] T149 [US7] Add the dependency (Constitution IV — justified in `plan.md` § Complexity Tracking; **`@dnd-kit/core` only**, range `^6.3.1`, MIT; re-check the latest stable and its licence with `pnpm view @dnd-kit/core version license peerDependencies` and use what it answers if newer within the same major): `peerDependencies` **and** `devDependencies` of `packages/admin-kit/package.json`, and `dependencies` of `admin/package.json` — the pattern `echarts` follows in those two files. Do **not** add `@dnd-kit/sortable`, and do not add anything to `packages/modules/crm`. Run `pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile` and read its output for an unmet-peer warning naming `@dnd-kit/core`: if another workspace consumer of `@endora-commerce/admin-kit` (check `packages/admin-shell/package.json`, the docs site, the `create-endora-commerce` template) must declare the peer too, add it there in the same commit and name the file in the pull request; commit `pnpm-lock.yaml`; `manifests:check` green (no module manifest may have moved)
- [x] T150 [US7] Implement the reusable primitive `packages/admin-kit/src/components/kanban/KanbanBoard.tsx` (+ `index.ts`) and export it and its types from `packages/admin-kit/src/components/index.ts`: generic over column and item (`columns`, `itemsByColumn`, `getItemId`, `canDrop(item, columnId)`, `onMove(itemId, from, to)`, `renderCard`, `renderColumnHeader`, `labels`), built on `DndContext`, `useDraggable`, `useDroppable`, `DragOverlay`, `PointerSensor` (activation distance so clicks stay clicks), `KeyboardSensor` and the library's announcements; design tokens and primitives of the kit only; a doc comment stating that a consumer owes a non-drag alternative (WCAG 2.2 SC 2.5.7) because the primitive cannot know the targets' meaning; T148 green; `pnpm --filter @endora-commerce/admin-kit run build`; `check:platform-surface` and the admin-kit surface tests green
- [x] T151 [P] [US7] Changeset `.changeset/admin-kit-kanban-board.md` (`minor`) written for the consumer of `@endora-commerce/admin-kit`: the new `KanbanBoard` export **and the new peer dependency `@dnd-kit/core`** an application must provide; `check:release-intent --since origin/master` green. `AGENTS.md` § Stack already says "`@dnd-kit` for drag-drop" and is now true — do not edit it

---

## Phase 10: User Story 8 — Quote Requests and a computed Opportunity value (Priority: P2)

**Goal**: link Quote Requests; value by hand or computed from linked documents in counting
statuses; counted once; quote conversions join the Opportunity.

**Independent Test**: `backend/test/integration/crm/value.test.ts`.

- [x] T094 [P] [US8] Unit tests `packages/modules/crm/src/backend/domain/value-calculation.test.ts` (pure): counting sets; a Quote Request whose `convertedOrderId` is a linked counting Order is skipped; other-currency documents land in `excludedDocuments`; an empty counting set gives 0; decimal arithmetic on strings has no float error (`0.10 + 0.20`)
- [x] T095 [P] [US8] Integration test `backend/test/integration/crm/value.test.ts` with real `orders` and `quote_requests`: link a Quote Request (same-Organization rule, uniqueness); `manual` ignores documents; `computed` follows link/unlink, `order.status_changed.v1`, `rfq.approved.v1` / `canceled` / `modified` / `expired`; **the quote figure equals what the quote desk shows for the same request** (read how `RfqDetail.tsx` / `rfq-service.ts` total a quote first — research R-14, [unverified]); `PUT /value-counting-statuses` answers 202 and, once the job has run, every computed Opportunity is recalculated; an Order placed from a linked Quote Request is linked automatically with `linkSource: 'quote_conversion'`
- [x] T096 [P] [US8] Integration test `backend/test/integration/crm/quote-requests-off.test.ts`: with `quote_requests` deactivated (`withModuleOff`), Opportunities list and open; a linked Quote Request renders `available: false`; it contributes nothing to the computed value; linking one answers 503 `MODULE_DISABLED`; reactivation restores everything. **This is the task that changes shape if the owner answers Q1 "hard dependency"**: the edge moves to `dependencies` and this test is replaced by one asserting the switch is refused naming `crm`
- [x] T097 [P] [US8] Extend `backend/test/contract/crm/links-and-transition.contract.test.ts` for `documentKind: 'quote_request'` and `backend/test/contract/crm/workflow.contract.test.ts` for `PUT /value-counting-statuses`; extend `off-state.test.ts`: the recalculation subscribers do not run while `crm` is off
- [x] T098 [US8] Implement `packages/modules/crm/src/backend/domain/value-calculation.ts` (pure, decimal-safe) and `packages/modules/crm/src/backend/services/opportunity-value-service.ts` (`recalculate(opportunityId)` reading `orderReadPort.findByIds` and — only when `effectiveState.isPresent('quote_requests')` — `quoteRequestReadPort.findById` / `listItems`; writes `computed_value` in a Command with `skipAudit: true` and the reason in a comment); T094 green
- [x] T099 [US8] Extend `opportunity-link-service.ts` for `quote_request` (presence check, then `quoteRequestReadPort`), declare the `quote_requests` `degrades-without` edge with its `whenAbsent` sentence in `src/manifest.ts`, and add `setValueCountingStatuses` to `workflow-config-service.ts` (it only enqueues)
- [x] T100 [US8] Implement `packages/modules/crm/src/backend/workers/value-recalculation-worker.ts` (queue `crm-value-recalculation`; model: `orders`' `startTransitionEffectSweep` wiring in `packages/modules/orders/src/backend/index.ts` — built only when `processRunsWorkers` and `moduleQueueRedis` are present, attached with `ctx.worker(worker, { logger })`, idempotent, runs in `enterSystemScope`) and `compose/value.ts` (the worker; `ctx.subscribe` for `order.status_changed.v1`, the four `rfq.*` events, and `order.created.v1` for the quote-conversion link); register; T095–T097 green; `check:queue-names`, `check:subscribe-seam`, `check:entry-presence` green
- [x] T101 [P] [US8] Admin: value mode switch, manual value field, computed value with the list of excluded documents on `OverviewTab.tsx`; Quote Request search in `LinkedDocuments.tsx`, hidden when the module is absent (resolved from the server's enabled-set through `@endora-commerce/admin-kit/lib` module presence, never hard-coded); `workflow/ValueCountingStatuses.tsx` with two multi-selects and the "this and every later status" shortcut; tests `admin/test/modules/crm/value.test.tsx`; strings under `value.*`
- [x] T102 [US8] **Both halves done** (backend: research N-E1…N-E6; admin: N-H2, N-H5). Docs section (+ Polish): what counts, what is excluded, gross or net as `OrderRecord.total` is (state which, having read it); regenerate (new peers `bullmq` / `ioredis` appear in the rendered `package.json`); full gate

---

## Phase 11: User Story 9 — Automatic creation from placed Orders and Quote Requests (Priority: P3)

**Goal**: two Settings; idempotent creation; no duplicates for linked or converted documents.

**Independent Test**: `backend/test/integration/crm/auto-create.test.ts`.

- [x] T103 [P] [US9] Integration test `backend/test/integration/crm/auto-create.test.ts`: both settings default off → nothing is created; with "from Orders" on, **an Order placed through the real placement API** yields one Opportunity (start status, Organization, Sales Channel, default assignee, `source: 'order'`, `valueMode: 'computed'`) linked to it; with "from Quote Requests" on, a Quote Request submitted through the customer API likewise; redelivering the event creates nothing more; an Order placed from an already-linked Quote Request joins that Opportunity and creates none; a per-channel override of the setting is honoured
- [x] T104 [P] [US9] Extend `backend/test/integration/crm/off-state.test.ts`: with the setting on and `crm` deactivated, placing an Order creates nothing, and nothing appears retroactively after reactivation; the two settings are not writable while off
- [x] T105 [US9] Review the two Settings declared in Phase 2 (`crm.auto_create_from_orders`, `crm.auto_create_from_quote_requests`) in `packages/modules/crm/src/manifest.ts`: their operator-facing names and descriptions must now say exactly what T103 proves (placed after switching on; never for a document already linked or created from an Opportunity); export their codes as `CRM_SETTING_CODES` for the service and the tests
- [x] T106 [US9] Implement `packages/modules/crm/src/backend/services/opportunity-auto-create-service.ts` (the decision table of research R-8; settings through `lazyPort<SettingsReadPort>(ctx, 'settingsReadPort').get(code, salesChannelId, schema)`; creation through `OpportunityService` in `enterSystemScope` with an explicit `organizationId`; idempotent on the unique link constraint — a constraint violation is "already linked", not an error) and `compose/auto-create.ts` (`ctx.subscribe('order.created.v1')`, `ctx.subscribe('rfq.created.v1')`); if US8 has landed, its `order.created.v1` quote-conversion handler and this one become **one** subscriber with the R-8 order of branches; register; T103–T104 green
- [x] T107 [US9] Docs section (+ Polish): the two settings, what is and is not created; full gate

---

## Phase 12: User Story 10 — Create an Order or a Quote Request from within an Opportunity (Priority: P3)

**Goal**: the existing creation screens, opened from an Opportunity, produce a linked document.
**This is the only story that changes `orders` and `quote_requests`** —
`contracts/foreign-module-changes.md` §A6, §B, §C is the complete file list.

**Independent Test**: `backend/test/integration/crm/create-from-opportunity.test.ts`, plus the
owners' own tests below.

> **Done 2026-10-06 — read research N-J1 to N-J8 beside these rows.** Where a row and the tree
> disagree, the tree is what was measured: an invalid `origin` is **400**, not 422 (T108,
> N-J3 a); `orders`' `routes.ts` needed no edit (T114, N-J3 b); the origin branch lives in the
> existing `opportunity-auto-create-service.ts` and a new
> `opportunity-origin-link-service.ts`, composed in `index.ts` — there is no
> `compose/auto-create.ts` (T117, N-6); the create screens read `organizationId`,
> `salesChannelId` and `returnTo` beside the three parameters of T112/T116 (N-J4); the buttons
> are in `CreateFromOpportunity.tsx`, mounted in both link sections (T117, N-J5); the OpenAPI
> baseline did not move (T118, N-J3 d).

- [x] T108 [P] [US10] `orders` test first — extend `backend/test/integration/orders/` with `admin-create-origin.test.ts`: `POST /api/v1/admin/orders` with `origin` puts `origin` on `order.created.v1`; without it the payload has **no** `origin` key; a storefront placement whose body smuggles `origin` does not reach the event; an invalid `origin` is 422
- [x] T109 [P] [US10] `quote_requests` test first — `backend/test/integration/quote_requests/admin-create-origin.test.ts`: `createOnBehalf` emits `rfq.created_by_admin.v1` exactly once with the given `origin`, and with `origin: null` when none was sent; `rfq.created.v1` is still **not** emitted on the admin path
- [x] T110 [P] [US10] Integration test `backend/test/integration/crm/create-from-opportunity.test.ts`: an admin order created with `origin: { type: 'crm_opportunity', id }` is linked to that Opportunity with `linkSource: 'created_from_opportunity'`, **with automatic creation on and no second Opportunity created**; the same for a quote request; an `origin` naming an Opportunity of another Organization or a missing one links nothing and (if the setting is on) falls through to automatic creation; an unknown `origin.type` is ignored
- [x] T111 [P] [US10] Extend `backend/test/integration/crm/off-state.test.ts`: with `crm` deactivated, `POST /api/v1/admin/orders` and `POST /api/v1/admin/quote-requests` carrying an `origin` succeed and return what they return without it (FR-070, SC-003)
- [x] T112 [P] [US10] Admin tests: extend `admin/test/modules/orders/OrderCreatePage.test.tsx` and add `admin/test/modules/quote_requests/RfqCreatePage.origin.test.tsx` — with `?originType=…&originId=…&customerAccountId=…` the customer is preselected and the create request carries `origin`; without the parameters the request is byte-identical to today's
- [x] T113 [US10] Add `OriginReferenceSchema` to `packages/contracts/src/common.ts`; optional `origin` on `adminCreateOrderRequestSchema` and the `order.created.v1` payload type in `packages/contracts/src/orders.ts`; optional `origin` on `adminCreateQuoteRequestSchema` and the `rfq.created_by_admin.v1` payload type in `packages/contracts/src/quote-requests.ts`; rebuild contracts
- [x] T114 [US10] `orders`: forward `origin` in `packages/modules/orders/src/backend/routes.ts`, `services/order-creation-admin-service.ts` and as an optional third argument of `placeOrder` in `services/order-service.ts`, spreading it into the existing `order.created.v1` emit only when present (`OrderPlacementPort` and the storefront schema unchanged); T108 green; the existing `backend/test/integration/orders/` and `backend/test/contract/orders/` suites still green
- [x] T115 [US10] `quote_requests`: emit `rfq.created_by_admin.v1` from `createOnBehalf` in `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts`; T109 green; the existing `quote_requests` suites still green
- [x] T116 [P] [US10] Admin: read the three query parameters and send `origin` in `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx` and `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx`; T112 green
- [x] T117 [US10] CRM: handle `origin` first in the `order.created.v1` subscriber and add `ctx.subscribe('rfq.created_by_admin.v1', …)` (link by origin; else automatic creation when US9's setting is on) in `packages/modules/crm/src/backend/compose/auto-create.ts` (create the file with only the origin branch if US9 has not landed); "Create order" and "Create quote request" buttons on `LinkedDocuments.tsx` navigating to `/orders/new?…` and `/quote-requests/new?…`, the second only while `quote_requests` is present; T110–T111 green
- [x] T118 [US10] Document `origin` in `packages/modules/orders/docs/orders.md` and `rfq.created_by_admin.v1` in `packages/modules/quote_requests/docs/quote_requests.md` (+ Polish copies) and the flow in `packages/modules/crm/docs/crm.md`; write a changeset naming both additive changes for the consumers of `mod-orders`, `mod-quote-requests` and `contracts`; regenerate; full gate **including the complete `orders` and `quote_requests` integration and contract directories**

---

## Phase 13: User Story 11 — Change history (Priority: P3)

**Goal**: a "Change history" tab fed by the audit trail.

**Independent Test**: `backend/test/integration/crm/history.test.ts`.

- [x] T119 [P] [US11] Integration test `backend/test/integration/crm/history.test.ts`: after an edit, a transition, a link and (where those stories have landed) a note, a tag change, an assignment and an attachment, `GET …/history` lists one entry each, newest first, with actor name, action and before/after; a system-caused transition shows `actor.kind: 'system'`; a user **without** `audit_log:read` but with `crm:read` gets the history; history of an out-of-scope Opportunity is 404; entries about other objects never appear
- [x] T120 [P] [US11] Contract test `backend/test/contract/crm/history.contract.test.ts` (`contracts/admin-api.md` §11) and a sweep test `backend/test/integration/crm/audit-coverage.test.ts` asserting that every CRM Command about an Opportunity records `objectType: 'crm_opportunity'` with the Opportunity's id (iterate the action list of `data-model.md`)
- [x] T121 [US11] Implement `packages/modules/crm/src/backend/services/opportunity-history-service.ts` (load the Opportunity through the scoped EM first; then the kernel `AuditPort.query({ objectType, objectId, limit })` — cradle name `auditLogService`, as `packages/modules/audit_logs/src/backend/routes.admin.ts` uses it; actor names via `adminUserReadPort.findByIds`), `routes/routes.history.ts`, `compose/history.ts`; register; fix any Command the sweep test finds recording the wrong object; T119–T120 green
- [x] T122 [P] [US11] Admin: `components/OpportunityHistory.tsx` (entry list with a readable before/after diff, action labels from `auditLog.crm.*`) and `opportunity-detail/tabs/HistoryTab.tsx`, one line in `tabs.ts`; test `admin/test/modules/crm/history.test.tsx`; strings under `history.*`
- [x] T123 [US11] **Both halves done** (backend: research N-E10…N-E12; admin: N-H4). Docs section (+ Polish), full gate

---

## Phase 14: User Story 12 — References to Products and Orders (Priority: P3)

**Goal**: tokens in the description, notes and messages, rendered as named links.

**Independent Test**: `backend/test/integration/crm/references.test.ts`.

- [x] T124 [P] [US12] Unit tests `packages/modules/crm/src/backend/domain/reference-tokens.test.ts`: extraction of `[[product:<uuid>]]` and `[[order:<uuid>]]`, duplicates collapsed, malformed tokens left as text, no catastrophic backtracking on a 10 000-character input
- [x] T125 [P] [US12] Integration test `backend/test/integration/crm/references.test.ts`: saving a description or a comment replaces that source's `crm_opportunity_references` rows; the response carries `references` with the Product's **current** name (rename the Product, re-read) and the Order's number, with admin URLs; a missing Product and an Order outside the reader's scope are `available: false` with no label and no URL; the stored text is returned unchanged and is never interpreted as HTML
- [x] T126 [US12] Implement `packages/modules/crm/src/backend/domain/reference-tokens.ts` (pure) and `packages/modules/crm/src/backend/services/reference-service.ts` (`syncForSource`, `resolve` — two batched calls, `catalogProductReadPort.findByIds` and `orderReadPort.findByIds`); call `syncForSource` from the Opportunity update and the comment Commands and `resolve` from their serializers; `compose/references.ts`; register; T124–T125 green
- [x] T127 [P] [US12] Admin: `components/ReferenceTextarea.tsx` (a `Textarea` with "Insert product" — admin-kit `ProductPicker` — and "Insert order" — a search over the Orders admin list endpoint — inserting the token at the caret) and `components/ReferenceText.tsx` (splits on tokens, renders chips as links, "unavailable" chips without a link); use them for the description and in `CommentComposer.tsx`; tests `admin/test/modules/crm/references.test.tsx` including that markup in the text is rendered as text; strings under `references.*`
- [x] T128 [US12] **Both halves done** (backend: research N-E13, N-E14; admin: N-H3). Docs section (+ Polish), full gate

---

## Phase 15: User Story 13 — CRM analytics (Priority: P3)

**Goal**: five figures over a date range.

**Independent Test**: `backend/test/integration/crm/analytics.test.ts`.

- [ ] T129 [P] [US13] Integration test `backend/test/integration/crm/analytics.test.ts` over a fixture whose figures are computed by hand in the test's comments: average handling time; time in each selected status (including an Opportunity still in the status); reps ranked by won count per calendar month; top Opportunities by effective value; average value per currency; every figure restricted to the caller's Organizations for a scoped admin; `salesChannelId` and `assignedAdminUserId` filters
- [ ] T130 [P] [US13] Contract test `backend/test/contract/crm/analytics.contract.test.ts` (`contracts/admin-api.md` §12; `crm:analytics` enforced, `crm:read` alone is 403)
- [ ] T131 [US13] Declare `crm:analytics` in `packages/modules/crm/src/manifest.ts` (label in both bundles) and implement `packages/modules/crm/src/backend/services/analytics-service.ts` (SQL aggregates through `em.execute`, every statement constrained by `orgConstraintFor()` — model `order-status-usage.ts`; effective value per `data-model.md`), `routes/routes.analytics.ts`, `compose/analytics.ts`; register; T129–T130 green; time each endpoint on 1 000 Opportunities and record it against SC-007
- [ ] T132 [P] [US13] Admin: `pages/AnalyticsPage.tsx` — date-range and status pickers, five cards, charts through `EChart` from `@endora-commerce/admin-kit/components` where a chart helps (bar for reps per month, bar for time in status), tables otherwise; route `/crm/analytics` and its nav row in `src/admin/index.ts`; test `admin/test/modules/crm/analytics.test.tsx`; strings under `analytics.*`
- [ ] T133 [US13] Docs section (+ Polish) defining each figure precisely; regenerate; full gate

---

## Phase 16: User Story 14 — CRM where the rest of the platform already is (Priority: P3)

**Goal**: published ports, the Organization panel, recent-activity labels, demo data.

**Independent Test**: `backend/test/integration/crm/ports.test.ts` and the admin zone test.

- [ ] T134 [P] [US14] Integration test `backend/test/integration/crm/ports.test.ts`: `opportunityReadPort.findById` / `findByDocument` / `listOpenForOrganization` return records and no entity, under the caller's scope; `opportunityTransitionPort.applyStatus` answers each member of `OpportunityTransitionOutcome` (`applied`, `already_there`, `not_found`, `unknown_status`, `not_permitted`, `vetoed`); both throw `ModuleDisabledError` while `crm` is deactivated
- [ ] T135 [P] [US14] Integration test `backend/test/integration/crm/audit-reference.test.ts`: `auditReferenceRegistry.resolve('crm_opportunity', ids)` returns title and `/crm/opportunities/:id`; nothing while `crm` is off
- [ ] T136 [P] [US14] Admin test `admin/test/modules/crm/organization-zone.test.tsx`: the panel renders in `organization.detail.after` for a holder of `crm:read` with the Organization's open Opportunities and a "New opportunity" link carrying `organizationId`; absent without the permission and when the module is not in the enabled-set
- [ ] T137 [US14] Implement `packages/modules/crm/src/backend/services/opportunity-read-port.ts` and `opportunity-transition-port.ts` (the graph consulted before `apply`, so `not_permitted` and `vetoed` stay distinguishable — model `order-transition-port.ts`) and `compose/ports.ts` with `ctx.di.providePort<OpportunityReadPort>('opportunityReadPort', …)` and `providePort<OpportunityTransitionPort>('opportunityTransitionPort', …)`, plus a contribution-only `ctx.onBoot` registering the `AuditReferenceResolver`; declare the `audit_logs` `contributes-to` edge; register; T134–T135 green; `check:port-shape`, `check:port-dependencies` green
- [ ] T138 [P] [US14] Admin: `packages/modules/crm/src/admin/zones/OrganizationOpportunities.tsx` and its `zoneComponent('organization.detail.after', …)` contribution in `src/admin/index.ts` (model: `packages/modules/carts/src/admin/index.ts`); T136 green; `check:admin-zones` green
- [ ] T139 [US14] Demo data (research R-24): replace `demo: false` in `src/manifest.ts` with `{ summary, seed, reset, after }` whose bodies are reached by a relative `await import()` of `packages/modules/crm/src/backend/demo/` — read `packages/modules/admin_roles/src/backend/demo/` and the `ModuleDemoManifest` doc block in `packages/contracts/src/modules.ts` first; about a dozen Opportunities across the default statuses for the demo Organizations, a few linked to demo Orders, a few tags; co-located `demo.test.ts`; `check:demo-data-budget` and `backend/test/integration/demo/demo-shop.test.ts` green
- [ ] T140 [US14] Docs (+ Polish): *For developers* — the events, the guard registry, the two ports, with the manifest edge a consumer declares; full gate

---

## Phase 16A: User Story 15 — Operator-defined fields on an Opportunity (Priority: P3)

**Added by the owner's second ruling of 2026-10-05.** Phases 16A–16C are numbered so that no
existing phase heading or task id moves; their ids continue from T152.

**Goal**: Opportunities are a custom-field host — define on the existing custom-fields
screen, fill in on create and detail, validated per field, absent from that screen while CRM
is off (research R-26).

**Independent Test**: `backend/test/integration/crm/custom-fields.test.ts`.

**Contracts note**: T006 wrote every contract known on its day. This story and the next two
**add** to `packages/contracts/src/crm.ts` (and to two other contract files); nothing existing
changes shape.

- [ ] T152 [P] [US15] Integration + contract test `backend/test/integration/crm/custom-fields.test.ts` with real `custom_fields`: with a required `select` and an optional `number` defined for `opportunity`, create without the required field is 422 `CUSTOM_FIELD_VALUE_INVALID` naming the field; an unknown option and a wrong type are refused per field; a valid create and a PATCH (`If-Match`) persist and the detail returns the projected values; a PATCH without `customFieldValues` leaves them untouched; the write is one audit entry (the Opportunity's own Command — no second one); a scoped admin cannot read another Organization's values (404, as for the Opportunity)
- [ ] T153 [P] [US15] `custom_fields` test first — `backend/test/integration/custom_fields/entity-owner-presence.test.ts`: `GET /api/v1/admin/custom-fields/entity-types` includes `opportunity` while `crm` is on and omits it while `crm` is deactivated (`withModuleOff`); creating, editing or deleting a definition for a type whose owner is absent is refused 409; **every existing type** (`category`, `order`, `organization`, `customer`, `quote_request`, `product`) answers exactly as before in both states
- [ ] T154 [P] [US15] Extend `backend/test/integration/crm/migration.test.ts` (the `custom_field_values` column: jsonb, not null, default `{}`) and `backend/test/integration/crm/off-state.test.ts` (definitions and stored values survive an off → on cycle unchanged)
- [ ] T155 [P] [US15] Admin test `admin/test/modules/crm/custom-fields.test.tsx`: the detail's Overview renders the fields for `entityType="opportunity"` and saves through the Opportunity PATCH with `If-Match`; the create form renders them and sends `customFieldValues`; a per-field refusal is shown at its field
- [ ] T156 [US15] One compile-coupled change (`SUPPORTED_ENTITIES` is a `Record` over the enum): add `'opportunity'` to `supportedEntityTypeSchema` in `packages/contracts/src/custom-fields.ts`; add the entry `opportunity: { labelKey: 'customFields.entity.opportunity', orgOwned: true, ownerModuleId: 'crm' }` and the optional `ownerModuleId` field on `SupportedEntityMeta` in `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts`; add `customFields.entity.opportunity` ("Opportunity" / "Szansa sprzedażowa") to `packages/modules/custom_fields/i18n/en.json` and `pl.json`; add `customFieldValues` (optional on create and update, present on detail) to the Opportunity schemas in `packages/contracts/src/crm.ts`; first `grep -rn "supportedEntityTypeSchema\|SUPPORTED_ENTITY_TYPES\|SupportedEntityType" packages backend/test admin/test` and update every exhaustive switch or enumerating test the new member breaks, naming them in the pull request
- [ ] T157 [US15] `custom_fields`: in `packages/modules/custom_fields/src/backend/routes.admin.ts`, omit from `entity-types` a type whose `ownerModuleId` is not `effectiveState.isPresent`, and refuse definition mutations for such a type beside `assertNotHostManaged` (generic — only the marker's presence is read, never which module it names); T153 green; the existing `backend/test/{contract,integration}/custom_fields/` suites still green
- [ ] T158 [US15] CRM schema: `pnpm --filter backend run migration:new -- --module crm --name opportunity_custom_field_values` (never pick a stamp) adding `custom_field_values jsonb not null default '{}'` to `crm_opportunities`; export it from `packages/modules/crm/src/migrations/index.ts`; add the `customFieldValues` property to `crm-opportunity.entity.ts`; `composer:generate` and commit the migrations registry — **this is the only story after Phase 2 that adds a migration; it adds no entity**; T154 (migration half) green
- [ ] T159 [US15] CRM service: add `custom_fields` to `dependencies` in `packages/modules/crm/src/manifest.ts` (non-deactivatable owner — a plain binding edge, as `quote_requests` declares it); in `opportunity-service.ts` call `lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService').validateAndMerge('opportunity', currentBag, patch)` **inside** the create and update Commands, mapping `isCustomFieldValidationFailure` to 422 `CUSTOM_FIELD_VALUE_INVALID` with per-field issues (model: `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts`), and `project('opportunity', bag)` in the detail serializer; T152 green; `check:port-dependencies`, `check:command-coverage` green
- [ ] T160 [US15] Admin: **read `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx` and `packages/modules/custom_fields/src/backend/services/custom-field-value.service.ts` first** (research R-26, [unverified]: can the panel be embedded in a form without its own save button; how is a required field treated on create). Render `CustomFieldValuesPanel` on `opportunity-detail/tabs/OverviewTab.tsx` (model: `RfqDetail.tsx`) and the same fields on `OpportunityCreatePage.tsx`; **only if** the panel cannot be embedded, add an optional controlled mode (`onChange`, no button) to the admin-kit panel — a host file, `contracts/foreign-module-changes.md` §G — with its own test and a line in the changeset; T155 green
- [ ] T161 [US15] Docs: a *Custom fields* section in `packages/modules/crm/docs/crm.md` and the new host type in `packages/modules/custom_fields/docs/` (+ Polish copies); changeset naming the new enum member and `ownerModuleId` for consumers of `contracts` and `mod-custom-fields`; regenerate; full gate

---

## Phase 16B: User Story 16 — Other systems are told when an Opportunity changes status (Priority: P3)

**Goal**: Opportunity events offered on the webhooks screen and delivered through the
existing queue; `webhooks` gains a contribution seam and names no CRM event (research R-27).

**Independent Test**: `backend/test/integration/crm/webhooks.test.ts`.

- [x] T162 [P] [US16] Contract test in `packages/contracts/src/crm.test.ts`: `OpportunityStatusChangedEventV1Schema`, `OpportunityCreatedEventV1Schema` and `OpportunityClosedEventV1Schema` are `.strict()`, carry `eventId`, `occurredAt`, `opportunityId`, `organizationId` and the fields of `contracts/events-and-ports.md` §6, and contain no free-text field (`description`, `title` excepted only where §6 lists it)
- [x] T163 [P] [US16] `webhooks` test first — `backend/test/integration/webhooks/contributed-events.test.ts`: a descriptor registered through `webhookEventRegistry` makes its event type bridged — an active subscription to it gets one job enqueued per emitted event, an Organization-bound subscription only for its Organization's events, none while `webhooks` is deactivated; `GET /api/v1/admin/webhooks/event-types` lists a contributed type while its owner is present and omits it while the owner is off; the two built-in types behave exactly as before; registering the same type twice does not double-deliver
- [x] T164 [P] [US16] Integration test `backend/test/integration/crm/webhooks.test.ts`: with a subscription to `crm.opportunity.status_changed.v1`, a transition (manual, and one caused by an Order) enqueues exactly one delivery whose payload parses under the strict schema; create and close enqueue theirs, `closed` carrying `outcome`; **every event CRM emits parses under its strict schema** (subscribe in the test and parse); with `webhooks` deactivated the transition succeeds and nothing is enqueued; with `crm` deactivated its three types are not offered
- [x] T165 [P] [US16] Admin test `admin/test/modules/webhooks/contributed-event-types.test.tsx`: the subscription form offers the types the endpoint returns in addition to its existing options, and is unchanged when the endpoint returns none
- [x] T166 [US16] Contracts: `WebhookEventDescriptor` and `WebhookEventRegistryPort` in `packages/contracts/src/webhooks.ts`; the three strict event schemas in `packages/contracts/src/crm.ts`, with the existing event payload types redefined as their inferred types so there is one definition; T162 green
- [x] T167 [US16] `webhooks` backend: `packages/modules/webhooks/src/backend/services/webhook-event-registry.ts` (records descriptors, de-duplicates, bridges each new type through the module's own `ctx.subscribe` reusing `bridgeEventHandler`, `list()` filtered by the owner's effective presence) registered **ungated** with `ctx.di.register` in `packages/modules/webhooks/src/backend/index.ts`, and `GET /api/v1/admin/webhooks/event-types` in `routes.ts` under the gate the module's other admin routes use. **Prove first** (research R-27, [unverified]) that a `ctx.subscribe` issued from the registry during the boot phase is accepted by the kernel and by `check:subscribe-seam`; if not, subscribe from a `webhooks` boot hook over `list()` and state how contributions registered by later boot hooks are still reached; T163 green; existing `webhooks` suites still green
- [x] T168 [P] [US16] `webhooks` admin: `packages/modules/webhooks/src/admin/pages/WebhooksPage.tsx` fetches `event-types` and offers them after `KNOWN_EVENT_TYPES`, which is **left as it is** (it lists eleven types nothing bridges — a pre-existing defect reported with this feature, not repaired in it); T165 green
- [x] T169 [US16] CRM: `packages/modules/crm/src/backend/compose/webhooks.ts` — a **contribution-only** `ctx.onBoot` (no presence probe) registering the three descriptors with `ownerModuleId: 'crm'`; declare `nonBindingDependencies: [{ moduleId: 'webhooks', name: 'webhookEventRegistry', kind: 'contributes-to' }]` in `src/manifest.ts`; make every emit site build its payload through the strict schema's type; register in `index.ts`; T164 green; `check:port-dependencies`, `check:entry-presence` green
- [x] T170 [US16] Docs: the three events with a payload example each and the versioning rule in `packages/modules/crm/docs/crm.md`; the contribution seam in `packages/modules/webhooks/docs/webhooks.md` (+ Polish copies); changeset for `contracts` and `mod-webhooks`; regenerate; full gate

---

## Phase 16C: User Story 17 — The Order and the Quote Request show their Opportunity (Priority: P3)

**Goal**: a panel contributed by CRM into a new zone on the Order screen and on the Quote
Request screen; neither host imports CRM, both look identical without it (research R-28).

**Independent Test**: `admin/test/modules/crm/linked-opportunity-panel.test.tsx` and
`backend/test/contract/crm/document-opportunity.contract.test.ts`.

**The Quote Request half** (the `RfqDetail.tsx` mount and its wrapper) needs User Story 8;
the Order half needs User Story 1 only. If US8 has not landed, do the Order half and leave
`quote_request.detail.after` out of the enum entirely — `check:admin-zones` refuses a member
nothing renders.

- [ ] T171 [P] [US17] Contract test `backend/test/contract/crm/document-opportunity.contract.test.ts`: `GET /api/v1/admin/crm/documents/:documentKind/:documentId/opportunity` answers the linked Opportunity's summary, `{ data: null }` for an unlinked document, 404 for a document outside the caller's scope, 422 for an unknown kind; gated `crm:read`
- [ ] T172 [P] [US17] Host tests first — `admin/test/modules/orders/OrderDetail.after-zone.test.tsx` and `admin/test/modules/quote_requests/RfqDetail.after-zone.test.tsx`: with a contribution registered, the zone renders it with `{ orderId }` / `{ quoteRequestId }`; **with none, the rendered screen is identical to today's** (no heading, no wrapper element, no spacing)
- [ ] T173 [P] [US17] Admin test `admin/test/modules/crm/linked-opportunity-panel.test.tsx`: linked → number, title, status badge, assignee, value and a link to `/crm/opportunities/:id`; unlinked → "Link to an opportunity" (a picker over open Opportunities of the document's Organization, then the link endpoint) and "Create opportunity" (navigates with `organizationId`, `linkDocumentKind`, `linkDocumentId`); absent without `crm:read`; the write actions absent without `crm:write`
- [ ] T174 [P] [US17] Extend `backend/test/integration/crm/off-state.test.ts` (the new route is 503 while off) and `admin/test/modules/crm/OpportunityCreatePage.test.tsx` (with the two link parameters, a successful create is followed by one link call and navigation to the detail; a failed link is shown, the Opportunity still exists)
- [ ] T175 [US17] Zones, each landing with its mount: `'order.detail.after'` (props `OrderDetailZoneProps`) and `'quote_request.detail.after'` (new `QuoteRequestDetailZoneProps { quoteRequestId }`) in `AdminZoneNameSchema` and `AdminZonePropsMap` in `packages/contracts/src/admin-contributions.ts`, each with a doc comment in the file's own style; `<AdminZone name="order.detail.after" props={{ orderId: id }} />` in `packages/modules/orders/src/admin/pages/OrderDetail.tsx` — decide the position with the file open (below the tab panels, visible on every tab, is the recommendation; research R-28, [unverified]) — and the Quote Request mount in `packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx`; T172 green; `check:admin-zones` green
- [ ] T176 [US17] CRM backend: `findByDocument` on the link service and `packages/modules/crm/src/backend/routes/routes.documents.ts` (validate the document through its owner's read port under the caller's scope first; the Quote Request kind only while `quote_requests` is present), composed in `compose/links.ts`; schema in `packages/contracts/src/crm.ts`; T171 green
- [ ] T177 [US17] CRM admin: `packages/modules/crm/src/admin/components/LinkedOpportunityPanel.tsx` and two thin wrappers `zones/OrderOpportunity.tsx`, `zones/QuoteRequestOpportunity.tsx`, contributed with `zoneComponent('order.detail.after', …)` and `zoneComponent('quote_request.detail.after', …)` in `src/admin/index.ts`, `requiredPermission: 'crm:read'`; strings under `links.*`; T173 green
- [ ] T178 [US17] `OpportunityCreatePage.tsx`: honour `linkDocumentKind` + `linkDocumentId` — after a successful create, call the link endpoint, then navigate; T174 green
- [ ] T179 [US17] Docs: the panel in `packages/modules/crm/docs/crm.md`; the new zone in `packages/modules/orders/docs/orders.md` and `packages/modules/quote_requests/docs/quote_requests.md` (+ Polish copies); changeset for `contracts`, `mod-orders`, `mod-quote-requests`; regenerate; full gate **including the `orders` and `quote_requests` admin test directories**

---

## Phase 17: Polish & Cross-Cutting Concerns

- [ ] T141 [P] Read `packages/modules/crm/docs/crm.md` end to end as an operator and as a developer; make it one coherent page; verify the Polish copy matches section for section; `pnpm --filter docs run build`
- [ ] T142 [P] Sweep `packages/modules/crm/i18n/en.json` and `pl.json`: no key in one and not the other, no unused key, Polish sentences read by a Polish speaker (the owner's terms: *Szansa sprzedażowa*, *Tablica*, *Statusy*); `i18n:hardcoded -- --strict` scoped to the module's admin directory shows zero
- [ ] T143 [P] Accessibility and UX pass over the seven screens against `.claude/skills/ux-laws/SKILL.md` (WCAG 2.2 AA: focus order, target sizes, non-drag alternative on the board, colour is never the only carrier of a status) — hand to `endora-commerce-designer`, fix what it reports
- [ ] T144 Read-size bands: run the read-size test; for an entry whose band **refuses** the new file count only, read `specs/conventions/check-estate.md` § *Measuring a read size* first, re-measure on a pristine clone and re-record; leave in-band drift for the release pull request
- [ ] T145 Deletion probe (Principle I): on a scratch branch, delete `packages/modules/crm/` and `packages/contracts/src/crm.ts` with its export, regenerate, and confirm `pnpm -r run typecheck` and `pnpm --filter backend run test:unit:fast` pass with nothing else changed but the generated files — record the result; do not commit the probe
- [ ] T180 Extend the deletion probe of T145 for the stories added on 2026-10-05: with `packages/modules/crm/` gone, confirm `custom_fields` hides the `opportunity` type (its owner is absent), `webhooks` offers no CRM event, the Order and Quote Request screens render with empty zones, and `KanbanBoard` still builds and passes T148 in `admin-kit` with no consumer — record the result; do not commit the probe
- [ ] T146 Full verification, as CI runs it: every command of `quickstart.md` § *Before calling any story done*, plus `pnpm --filter backend exec vitest run test/contract/crm test/integration/crm test/integration/orders test/integration/quote_requests test/contract/orders test/contract/quote_requests`; report each with its output (a merge-request pipeline does not run these — D-198)
- [ ] T147 Hand `spec.md` ↔ implementation consistency to `endora-commerce-product-owner`: every FR and acceptance scenario against the tests named in *Requirement traceability* below

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 → Phase 2 → Phase 3 (US1)**: strictly sequential. One developer, one worktree.
- **Phases 4–16 (US2–US14)**: each depends on US1 only, except as noted below, and may run in
  **parallel worktrees**.
- **Phase 17**: after the stories that are going to ship.

### Story dependencies

| Story | Needs | Notes |
| --- | --- | --- |
| US1 | Phases 1–2 | MVP |
| US2 | US1 | — |
| US3 | US1 | creates `crm-notifier.ts` (T069) |
| US4 | US1 | uses `crm-notifier.ts`; creates it if US3 has not landed (T075) |
| US5 | US1 | — |
| US6 | US1 | — |
| US7 | US1 | tag and assignee filters are inert until US6 / US3 land |
| US8 | US1 | — |
| US9 | US1 | merges its `order.created.v1` handler with US8's if US8 landed (T106) |
| US10 | US1 | the only story touching `orders` / `quote_requests`; its quote half needs US8's quote links |
| US11 | US1 | lists whatever Commands exist; its sweep test covers the stories landed so far |
| US12 | US1 | reaches into comments only if US4 landed |
| US13 | US1 | rep ranking is meaningful once US3 landed |
| US14 | US1 | demo data (T139) is best written last |
| US15 | US1 | the **only** story after Phase 2 that adds a migration (no entity); touches `custom_fields` |
| US16 | US1 | touches `webhooks`; needs only the events US1 emits |
| US17 | US1 (Order half), US8 (Quote Request half) | touches `orders` and `quote_requests` admin screens |

### Parallel worktrees without file collisions

No story after Phase 2 adds a migration or an entity, so **no two stories regenerate the
migration or entity registry**. Three groups can be in flight at once:

- **Wave A** (after US1): US2, US3, US5, US6, US8, US11, US13 — each owns its own
  `compose/<area>.ts`, service, routes file, admin page/tab and test files.
- **Wave B**: US4 (after or with US3), US7 (best after US3 + US6), US9 (best after US8), US12
  (best after US4).
- **Wave C**: US10 (after US8), US14 (last).

**The stories added on 2026-10-05:**

- **US16 joins Wave A.** Its CRM half is one new `compose/webhooks.ts`; its other files are
  `webhooks`' own, which no other story touches. Shared hot files: `src/backend/index.ts`,
  `src/manifest.ts`, `docs/crm.md`, and `packages/contracts/src/crm.ts`.
- **US15 joins Wave B.** It edits `opportunity-service.ts`, `OverviewTab.tsx` and
  `OpportunityCreatePage.tsx`, which US3, US6, US8 and US12 also extend, and it is the one
  story that regenerates `migrations-registry.generated.ts` — so it conflicts with no other
  story on a generated file, but **must re-run `composer:generate` after any rebase**. Shared
  hot files besides those: `src/manifest.ts`, `packages/contracts/src/crm.ts`, the i18n
  bundles, `docs/crm.md`, `migration.test.ts`, `off-state.test.ts`.
- **US17 joins Wave C.** It edits `OrderDetail.tsx` (no other story does — US10 edits
  `OrderCreatePage.tsx`) and `RfqDetail.tsx` (likewise), `OpportunityCreatePage.tsx`,
  `compose/links.ts`, `src/admin/index.ts`, and
  `packages/contracts/src/admin-contributions.ts` — the file Phase 1's T007 edits, so it
  rebases over that trivially.
- **`packages/contracts/src/crm.ts` is now a shared hot file** for US15, US16 and US17, each
  adding its own exports.
- **US7's primitive (T148–T150) touches `packages/admin-kit`, `admin/package.json` and
  `pnpm-lock.yaml`.** No other story adds a dependency, so the lockfile conflicts only with
  stories whose `manifests:generate` moves a module's rendered peers (US8 adds `bullmq` /
  `ioredis` to `mod-crm`): after a rebase, re-run `pnpm install --lockfile-only` rather than
  resolving the lockfile by hand.

**Shared hot files** — two stories both add *lines* here and the second to merge rebases:
`packages/modules/crm/src/backend/index.ts` (one `register<Area>(ctx)` line),
`src/manifest.ts` (a permission, action, setting or edge), `src/admin/index.ts` (a route / nav
row), `src/admin/pages/opportunity-detail/tabs.ts` (a tab line), `src/admin/api.ts`,
`i18n/en.json` and `pl.json` (keys under the story's own prefix), `docs/crm.md` (a section),
`backend/test/integration/crm/off-state.test.ts` (a case). Stories that also extend a file
another story created are called out in the table above (US2 and US8 extend
`order-status-propagation-service.ts` / `opportunity-link-service.ts` /
`workflow-config-service.ts`; US8 and US9 share the `order.created.v1` subscriber; US3 and US8
and US10 all edit `OverviewTab.tsx` / `LinkedDocuments.tsx`). After any rebase that brings in
another story: `bash scripts/setup-worktree.sh`, rebuild packages, re-run `composer:generate`
+ `manifests:generate` + `pnpm install --lockfile-only`, and commit what they change.

Every worktree branches off `origin/master` (or off the merged US1), is set up with
`bash scripts/setup-worktree.sh`, never with a symlinked `node_modules`, and runs its tests
with the binary in its own directory — a workspace-wide `pnpm` run interleaves with sibling
worktrees.

### Within a story

Tests first and seen red → domain (pure) → services → routes + compose → admin → manifest /
i18n / docs → regenerate → gate. `[P]` tasks inside a phase touch different files.

### Parallel example — User Story 1

```text
# tests, all at once (different files):
T027 T028 T029 T030 T031 T032 T033 T034 T035 T036 T037

# then, in parallel:
T039 workflow-config-service.ts      T041 opportunity-service.ts
T043 opportunity-link-service.ts     T045 opportunity-status-events.ts
T046 transition-guard-registry.ts    T051 admin/api.ts + admin/index.ts

# then the sequential spine:
T040 → T042 → T044 → T047 → T048 → T049

# admin screens in parallel once T051 exists:
T052 WorkflowConfigPage   T053 List + Create   (T054 Detail after T052's shared pieces)
```

---

## Implementation Strategy

### MVP first

Phases 1–3. Stop at the US1 checkpoint and demonstrate: configure the workflow, create an
Opportunity by hand, link an Order, walk it to *won*, show the Order's status after each
mapped step, show a refused Order with its reason, switch the module off and on. That is the
owner's success criterion and it is shippable on its own.

### Incremental delivery

One pull request per story after US1, each independently verifiable by the test named in its
header and each leaving the module releasable. Suggested order for a single developer:
US2 → US3 → US4 → US6 → US7 → US8 → US5 → US9 → US10 → US11 → US12 → US13 → US16 → US15 →
US17 → US14.

### Nothing is dropped

Every requirement of the owner's brief has a story (see the traceability table). Of the three
integrations first deferred, **two are in scope since the owner's second ruling of
2026-10-05** — custom fields on Opportunities (US15) and the linked-Opportunity panel on the
Order screen (US17, extended to the Quote Request screen) — together with outbound webhooks
(US16). **One stays deferred**, with its reason in `research.md` R-22: import/export, which is
not a one-declaration integration.

---

## Requirement traceability

| Requirement | Story | Proving test (task) |
| --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005 | US1 | T028, T030, T037 |
| FR-006 | US1 (+ every story adding a read) | T031, and the out-of-scope case in T074, T079, T084, T088, T119, T125, T129 |
| FR-010 – FR-014 | Foundational, US1 | T010, T012, T027, T036 |
| FR-015 | US1 | T032 |
| FR-016 | US1 | T030, T033 |
| FR-020 | US1 (orders), US8 (quote requests) | T029, T095, T097 |
| FR-021, FR-022, FR-023 | US1 | T030, T034 |
| FR-024, FR-025 | US2 | T058 |
| FR-026 | US10 | T108–T112 |
| FR-027 | US8 | T095 |
| FR-030 – FR-033 | US8 | T094, T095 |
| FR-040, FR-041 | US3 | T065, T066 |
| FR-042, FR-043 | US4 | T073, T074 |
| FR-044 | US5 | T078, T079 |
| FR-045 | US12 | T124, T125 |
| FR-050 | US6 (+ US7 for the board filter) | T084, T088 |
| FR-051 | US7 | T088, T089, T148 |
| FR-052 | US11 | T119, T120 |
| FR-053 | US13 | T129 |
| FR-060, FR-061 | US9 | T103 |
| FR-070 | Foundational + every story with a subscriber | T011, T060, T097, T104, T111 |
| FR-071 | Setup, US1, US6, US7, US13 | T005, T036, T037, and `check:action-route-permissions` |
| FR-072 | every story | `check:bundle-pairing`, `registered-bundles-shape.test.ts`, `i18n:hardcoded` |
| FR-073 | every story | `check:command-coverage`, T120 |
| FR-074 | US14 | T134 |
| FR-075 | Foundational, every story, Polish | `check:module-docs`, `check:docs-translations`, T141 |
| FR-076 | US15 | T152, T153, T155 |
| FR-077 | US16 | T162, T163, T164 |
| FR-078 | US17 | T171, T172, T173 |

## Notes

- A task that says "model: `<file>`" means *read that file and follow its shape*, not *copy
  it*; the named file is the tree's current answer to the same problem.
- Verify a phase by its subject, not by a checkbox: the proof of US1 is the Order's status in
  the database after the walk, not T057 being ticked.
- Commit after each task or logical group; never leave a generated artefact stale across a
  commit boundary.
