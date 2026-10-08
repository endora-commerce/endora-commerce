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

---

## Phase 6: User Story 4 — Notes and internal messages (Priority: P2)

**Goal**: notes (author-editable) and a message thread (immutable, notifying), both internal.

**Independent Test**: `backend/test/integration/crm/comments.test.ts`.

- [x] T073 [P] [US4] Contract tests `backend/test/contract/crm/comments.contract.test.ts` for the four endpoints of `contracts/admin-api.md` §6
- [x] T074 [P] [US4] Integration test `backend/test/integration/crm/comments.test.ts`: a note is listed with its author; only the author edits or deletes it (403 otherwise); a deleted note disappears from the list and stays in the audit trail; a message cannot be edited or deleted (409 `CRM_MESSAGE_IMMUTABLE`); a message notifies the assignee and earlier thread participants except the author; with `admin_notifications` off the message is still stored; comments of an out-of-scope Opportunity are 404; **no customer-facing route returns a note or a message** (assert the storefront order and quote endpoints for that Organization carry none)
- [x] T075 [US4] Implement `packages/modules/crm/src/backend/services/opportunity-comment-service.ts` (Commands `note_add`, `note_update`, `note_delete`, `message_add`; parent loaded through the scoped EM first; recipients computed from the assignee and prior message authors; notifications through `crm-notifier.ts` — **if US3 has not landed, create that file here per T069**), `routes/routes.comments.ts`, `compose/comments.ts`; register; T073–T074 green
- [x] T076 [P] [US4] Admin: `opportunity-detail/tabs/NotesTab.tsx` and `MessagesTab.tsx` with one shared `components/CommentComposer.tsx` (a plain `Textarea`; US12 swaps in the reference textarea), two lines in `tabs.ts`; tests `admin/test/modules/crm/comments.test.tsx` (author sees edit/delete on notes only; messages show none); strings under `comments.*`
- [x] T077 [US4] Docs section (+ Polish), full gate

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
- [x] T182 [US5] **Attachment upload for a role holding only CRM's permissions** (defect; `research.md` N-D8 (a), N-F1). `POST /api/v1/admin/crm/opportunities/:id/attachments/upload` (multipart, `crm:write`, `contracts/admin-api.md` §7a): the Opportunity loaded through the scoped EntityManager first, the file stored as a **private** asset through `assetsLibraryPort.upload` — an existing seam, so nothing in `assets_library` changes — and attached by the existing `crm.opportunity.attachment_add` Command, a stored-but-unattached file soft-deleted again. New files `services/opportunity-attachment-upload-service.ts` (+ co-located unit test), `routes/routes.attachment-upload.ts`, one delimited section of `src/backend/index.ts`; `OPPORTUNITY_ATTACHMENT_MAX_BYTES` and `CRM_ATTACHMENT_TOO_LARGE` in the contracts. Tests first, observed red: `backend/test/contract/crm/attachment-upload.contract.test.ts`, `backend/test/integration/crm/attachment-upload.test.ts` (a `crm:write`-only role uploads, downloads the bytes back, removes; the library's type and size refusals pass through; tenant isolation; deletion protection), the route added to `off-state.test.ts`, `admin/test/modules/crm/attachments.test.tsx` rewritten. Admin: `components/AttachmentUploader.tsx`, `lib/upload-attachment.ts`, *Add a file* for every holder of `crm:write`. Docs (+ Polish), changeset, OpenAPI baseline
- [x] T183 [US5] **Attaching a library file by its id asks for `assets.read` as well** (the coordinator's decision, the owner's to reverse; `research.md` N-B17, N-F1 (f), N-I5). `POST /api/v1/admin/crm/opportunities/:id/attachments` is gated `crm:write` **and** `assets.read`; the upload stays `crm:write` alone. Tests first: `backend/test/contract/crm/attachments.contract.test.ts` (the gate), `backend/test/integration/crm/attachment-upload.test.ts` (a private library file out of reach of `crm:write` alone). `contracts/admin-api.md` §7, the module page (+ Polish).

---

## Phase 8: User Story 6 — Tags (Priority: P2)

**Goal**: tag CRUD, tagging, AND-filter on the list.

**Independent Test**: `backend/test/integration/crm/tags.test.ts`.

- [x] T083 [P] [US6] Contract tests `backend/test/contract/crm/tags.contract.test.ts` (`contracts/admin-api.md` §8; `crm:configure` for CRUD, `crm:write` for tagging)
- [x] T084 [P] [US6] Integration test `backend/test/integration/crm/tags.test.ts`: create/rename/recolour/delete; a case-insensitively duplicate name is 409 `CRM_TAG_NAME_TAKEN`; deleting a tag in use removes it from its Opportunities; `PUT …/tags` replaces the set and is audited; the list with two `tagId` values returns only Opportunities carrying both; `usageCount` counts only Opportunities the caller may see
- [x] T085 [US6] Implement `packages/modules/crm/src/backend/services/tag-service.ts` (Commands per `data-model.md`), `routes/routes.tags.ts`, `compose/tags.ts`; add the `tagId` filter and `tags` to the summary in `opportunity-service.ts`; register; T083–T084 green
- [x] T086 [P] [US6] Admin: `pages/TagsPage.tsx` (table, dialog, delete confirmation naming the usage count), route `/crm/tags` and its nav row in `src/admin/index.ts`, a tag `MultiSelect` on the create form, on `OverviewTab.tsx` and as a list filter; tests `admin/test/modules/crm/tags.test.tsx`; strings under `tags.*`
- [x] T087 [US6] Docs section (+ Polish), regenerate (new admin route), full gate

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
  - **Docs half done 2026-10-06** (research N-P3): the page and its Polish copy say how a card is moved — drag by pointer, touch or keyboard, or the "Move to…" menu — and how the board scrolls. **Open:** the designer's audit on a physical touch device and with a screen reader; the drag announcements and the non-drag path were exercised in headless Chromium only.
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

- [x] T129 [P] [US13] Integration test `backend/test/integration/crm/analytics.test.ts` over a fixture whose figures are computed by hand in the test's comments: average handling time; time in each selected status (including an Opportunity still in the status); reps ranked by won count per calendar month; top Opportunities by effective value; average value per currency; every figure restricted to the caller's Organizations for a scoped admin; `salesChannelId` and `assignedAdminUserId` filters
- [x] T130 [P] [US13] Contract test `backend/test/contract/crm/analytics.contract.test.ts` (`contracts/admin-api.md` §12; `crm:analytics` enforced, `crm:read` alone is 403)
- [x] T131 [US13] Declare `crm:analytics` in `packages/modules/crm/src/manifest.ts` (label in both bundles) and implement `packages/modules/crm/src/backend/services/analytics-service.ts` (SQL aggregates through `em.execute`, every statement constrained by `orgConstraintFor()` — model `order-status-usage.ts`; effective value per `data-model.md`), `routes/routes.analytics.ts`, `compose/analytics.ts`; register; T129–T130 green; time each endpoint on 1 000 Opportunities and record it against SC-007
- [x] T132 [P] [US13] Admin: `pages/AnalyticsPage.tsx` — date-range and status pickers, five cards, charts through `EChart` from `@endora-commerce/admin-kit/components` where a chart helps (bar for reps per month, bar for time in status), tables otherwise; route `/crm/analytics` and its nav row in `src/admin/index.ts`; test `admin/test/modules/crm/analytics.test.tsx`; strings under `analytics.*`
- [x] T133 [US13] Docs section (+ Polish) defining each figure precisely; regenerate; full gate

---

## Phase 16: User Story 14 — CRM where the rest of the platform already is (Priority: P3)

**Goal**: published ports, the Organization panel, recent-activity labels, demo data.

**Independent Test**: `backend/test/integration/crm/ports.test.ts` and the admin zone test.

- [x] T134 [P] [US14] Integration test `backend/test/integration/crm/ports.test.ts`: `opportunityReadPort.findById` / `findByDocument` / `listOpenForOrganization` return records and no entity, under the caller's scope; `opportunityTransitionPort.applyStatus` answers each member of `OpportunityTransitionOutcome` (`applied`, `already_there`, `not_found`, `unknown_status`, `not_permitted`, `vetoed`); both throw `ModuleDisabledError` while `crm` is deactivated
- [x] T135 [P] [US14] Integration test `backend/test/integration/crm/audit-reference.test.ts`: `auditReferenceRegistry.resolve('crm_opportunity', ids)` returns title and `/crm/opportunities/:id`; nothing while `crm` is off
- [x] T136 [P] [US14] Admin test `admin/test/modules/crm/organization-zone.test.tsx`: the panel renders in `organization.detail.after` for a holder of `crm:read` with the Organization's open Opportunities and a "New opportunity" link carrying `organizationId`; absent without the permission and when the module is not in the enabled-set
- [x] T137 [US14] Implement `packages/modules/crm/src/backend/services/opportunity-read-port.ts` and `opportunity-transition-port.ts` (the graph consulted before `apply`, so `not_permitted` and `vetoed` stay distinguishable — model `order-transition-port.ts`) and `compose/ports.ts` with `ctx.di.providePort<OpportunityReadPort>('opportunityReadPort', …)` and `providePort<OpportunityTransitionPort>('opportunityTransitionPort', …)`, plus a contribution-only `ctx.onBoot` registering the `AuditReferenceResolver`; list `audit_logs` in `dependencies` (the edge the registry's other contributors declare; research N-G6); register; T134–T135 green; `check:port-shape`, `check:port-dependencies` green
- [x] T138 [P] [US14] Admin: `packages/modules/crm/src/admin/zones/OrganizationOpportunities.tsx` and its `zoneComponent('organization.detail.after', …)` contribution in `src/admin/index.ts` (model: `packages/modules/carts/src/admin/index.ts`); T136 green; `check:admin-zones` green
- [x] T139 [US14] Demo data — **built on 2026-10-08 after the owner lifted the stop of N-G5** ("Tak, dodajmy dane demo dla CRM do naszych danych demo w seed"), in the two places the demo-data rules leave it (research N-DD1 … N-DD4), which is not the single module-own body the original task text asked for: (a) `packages/modules/crm/src/backend/demo/` (`rows.ts`, `seed.ts`, `reset.ts`, co-located `demo.test.ts`) and `demo` in `src/manifest.ts` — the module's own rows, three tags, with no `after` because the body reads nothing; (b) the step `sales opportunities for the demo organisation` in `packages/demo-composition/src/sales-pipeline.ts` (+ `sales-pipeline.test.ts`), appended to `STEPS` in `composition.ts` — twelve Opportunities for the demo Organization, two per seeded status, with status history, tags, the contact person, notes, a message and references; `nextOpportunityNumber` exported from `@endora-commerce/mod-crm/backend` for it. **No Opportunity is linked to an Order or a Quote Request: the demo still has neither** (N-DD2). `backend/test/integration/demo/demo-shop.test.ts` holds the six `crm_` tables to a recorded delta and to the relations between the rows; `demo-pipeline-off-state.test.ts` (**new**) is the off-state case; `check:demo-data-budget` green. `contracts/foreign-module-changes.md` §N. *Original text, kept for the record:* **STOPPED — see research N-G5** (the demo body R-24 describes needs `packages/demo-composition`, a file `contracts/foreign-module-changes.md` does not list, and a demo Order that nothing creates; `demo: false` stands). Demo data (research R-24): replace `demo: false` in `src/manifest.ts` with `{ summary, seed, reset, after }` whose bodies are reached by a relative `await import()` of `packages/modules/crm/src/backend/demo/` — read `packages/modules/admin_roles/src/backend/demo/` and the `ModuleDemoManifest` doc block in `packages/contracts/src/modules.ts` first; about a dozen Opportunities across the default statuses for the demo Organizations, a few linked to demo Orders, a few tags; co-located `demo.test.ts`; `check:demo-data-budget` and `backend/test/integration/demo/demo-shop.test.ts` green
- [x] T140 [US14] Docs (+ Polish): *For developers* — the events, the guard registry, the two ports, with the manifest edge a consumer declares; full gate

---

## Phase 16A: User Story 15 — Operator-defined fields on an Opportunity (Priority: P3)

**Added by the owner's second ruling of 2026-10-05.** Phases 16A–16C are numbered so that no
existing phase heading or task id moves; their ids continue from T152.

> **Note on T161 (2026-10-06).** The task names `packages/modules/custom_fields/docs/` — that
> directory does not exist: `custom_fields` ships no documentation page, so the "new host
> type" half of T161 had nothing to edit and was documented on CRM's own page instead
> (`research.md` N-G3; `contracts/foreign-module-changes.md` H5, struck).

**Goal**: Opportunities are a custom-field host — define on the existing custom-fields
screen, fill in on create and detail, validated per field, absent from that screen while CRM
is off (research R-26).

**Independent Test**: `backend/test/integration/crm/custom-fields.test.ts`.

**Contracts note**: T006 wrote every contract known on its day. This story and the next two
**add** to `packages/contracts/src/crm.ts` (and to two other contract files); nothing existing
changes shape.

- [x] T152 [P] [US15] Integration + contract test `backend/test/integration/crm/custom-fields.test.ts` with real `custom_fields`: with a required `select` and an optional `number` defined for `opportunity`, create without the required field is 422 `CUSTOM_FIELD_VALUE_INVALID` naming the field; an unknown option and a wrong type are refused per field; a valid create and a PATCH (`If-Match`) persist and the detail returns the projected values; a PATCH without `customFieldValues` leaves them untouched; the write is one audit entry (the Opportunity's own Command — no second one); a scoped admin cannot read another Organization's values (404, as for the Opportunity)
- [x] T153 [P] [US15] `custom_fields` test first — `backend/test/integration/custom_fields/entity-owner-presence.test.ts`: `GET /api/v1/admin/custom-fields/entity-types` includes `opportunity` while `crm` is on and omits it while `crm` is deactivated (`withModuleOff`); creating, editing or deleting a definition for a type whose owner is absent is refused 409; **every existing type** (`category`, `order`, `organization`, `customer`, `quote_request`, `product`) answers exactly as before in both states
- [x] T154 [P] [US15] Extend `backend/test/integration/crm/migration.test.ts` (the `custom_field_values` column: jsonb, not null, default `{}`) and `backend/test/integration/crm/off-state.test.ts` (definitions and stored values survive an off → on cycle unchanged)
- [x] T155 [P] [US15] Admin test `admin/test/modules/crm/custom-fields.test.tsx`: the detail's Overview renders the fields for `entityType="opportunity"` and saves through the Opportunity PATCH with `If-Match`; the create form renders them and sends `customFieldValues`; a per-field refusal is shown at its field
- [x] T156 [US15] One compile-coupled change (`SUPPORTED_ENTITIES` is a `Record` over the enum): add `'opportunity'` to `supportedEntityTypeSchema` in `packages/contracts/src/custom-fields.ts`; add the entry `opportunity: { labelKey: 'customFields.entity.opportunity', orgOwned: true, ownerModuleId: 'crm' }` and the optional `ownerModuleId` field on `SupportedEntityMeta` in `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts`; add `customFields.entity.opportunity` ("Opportunity" / "Szansa sprzedażowa") to `packages/modules/custom_fields/i18n/en.json` and `pl.json`; add `customFieldValues` (optional on create and update, present on detail) to the Opportunity schemas in `packages/contracts/src/crm.ts`; first `grep -rn "supportedEntityTypeSchema\|SUPPORTED_ENTITY_TYPES\|SupportedEntityType" packages backend/test admin/test` and update every exhaustive switch or enumerating test the new member breaks, naming them in the pull request
- [x] T157 [US15] `custom_fields`: in `packages/modules/custom_fields/src/backend/routes.admin.ts`, omit from `entity-types` a type whose `ownerModuleId` is not `effectiveState.isPresent`, and refuse definition mutations for such a type beside `assertNotHostManaged` (generic — only the marker's presence is read, never which module it names); T153 green; the existing `backend/test/{contract,integration}/custom_fields/` suites still green
- [x] T158 [US15] CRM schema: `pnpm --filter backend run migration:new -- --module crm --name opportunity_custom_field_values` (never pick a stamp) adding `custom_field_values jsonb not null default '{}'` to `crm_opportunities`; export it from `packages/modules/crm/src/migrations/index.ts`; add the `customFieldValues` property to `crm-opportunity.entity.ts`; `composer:generate` and commit the migrations registry — **this is the only story after Phase 2 that adds a migration; it adds no entity**; T154 (migration half) green
- [x] T159 [US15] CRM service: add `custom_fields` to `dependencies` in `packages/modules/crm/src/manifest.ts` (non-deactivatable owner — a plain binding edge, as `quote_requests` declares it); in `opportunity-service.ts` call `lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService').validateAndMerge('opportunity', currentBag, patch)` **inside** the create and update Commands, mapping `isCustomFieldValidationFailure` to 422 `CUSTOM_FIELD_VALUE_INVALID` with per-field issues (model: `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts`), and `project('opportunity', bag)` in the detail serializer; T152 green; `check:port-dependencies`, `check:command-coverage` green
- [x] T160 [US15] Admin: **read `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx` and `packages/modules/custom_fields/src/backend/services/custom-field-value.service.ts` first** (research R-26, [unverified]: can the panel be embedded in a form without its own save button; how is a required field treated on create). Render `CustomFieldValuesPanel` on `opportunity-detail/tabs/OverviewTab.tsx` (model: `RfqDetail.tsx`) and the same fields on `OpportunityCreatePage.tsx`; **only if** the panel cannot be embedded, add an optional controlled mode (`onChange`, no button) to the admin-kit panel — a host file, `contracts/foreign-module-changes.md` §G — with its own test and a line in the changeset; T155 green
- [x] T161 [US15] Docs: a *Custom fields* section in `packages/modules/crm/docs/crm.md` and the new host type in `packages/modules/custom_fields/docs/` (+ Polish copies); changeset naming the new enum member and `ownerModuleId` for consumers of `contracts` and `mod-custom-fields`; regenerate; full gate

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

- [x] T171 [P] [US17] Contract test `backend/test/contract/crm/document-opportunity.contract.test.ts`: `GET /api/v1/admin/crm/documents/:documentKind/:documentId/opportunity` answers the linked Opportunity's summary, `{ data: null }` for an unlinked document, 404 for a document outside the caller's scope, 422 for an unknown kind; gated `crm:read`
- [x] T172 **(both halves done; the Quote Request half on 2026-10-06 — research N-I6)** [P] [US17] Host tests first — `admin/test/modules/orders/OrderDetail.after-zone.test.tsx` and `admin/test/modules/quote_requests/RfqDetail.after-zone.test.tsx`: with a contribution registered, the zone renders it with `{ orderId }` / `{ quoteRequestId }`; **with none, the rendered screen is identical to today's** (no heading, no wrapper element, no spacing)
- [x] T173 [P] [US17] Admin test `admin/test/modules/crm/linked-opportunity-panel.test.tsx`: linked → number, title, status badge, assignee, value and a link to `/crm/opportunities/:id`; unlinked → "Link to an opportunity" (a picker over open Opportunities of the document's Organization, then the link endpoint) and "Create opportunity" (navigates with `organizationId`, `linkDocumentKind`, `linkDocumentId`); absent without `crm:read`; the write actions absent without `crm:write`
- [x] T174 [P] [US17] Extend `backend/test/integration/crm/off-state.test.ts` (the new route is 503 while off) and `admin/test/modules/crm/OpportunityCreatePage.test.tsx` (with the two link parameters, a successful create is followed by one link call and navigation to the detail; a failed link is shown, the Opportunity still exists)
- [x] T175 **(both halves done; the Quote Request half on 2026-10-06 — research N-I6)** [US17] Zones, each landing with its mount: `'order.detail.after'` (props `OrderDetailZoneProps`) and `'quote_request.detail.after'` (new `QuoteRequestDetailZoneProps { quoteRequestId }`) in `AdminZoneNameSchema` and `AdminZonePropsMap` in `packages/contracts/src/admin-contributions.ts`, each with a doc comment in the file's own style; `<AdminZone name="order.detail.after" props={{ orderId: id }} />` in `packages/modules/orders/src/admin/pages/OrderDetail.tsx` — decide the position with the file open (below the tab panels, visible on every tab, is the recommendation; research R-28, [unverified]) — and the Quote Request mount in `packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx`; T172 green; `check:admin-zones` green
- [x] T176 **(both halves done; the Quote Request half on 2026-10-06 — research N-I6)** [US17] CRM backend: `findByDocument` on the link service and `packages/modules/crm/src/backend/routes/routes.documents.ts` (validate the document through its owner's read port under the caller's scope first; the Quote Request kind only while `quote_requests` is present), composed in `compose/links.ts`; schema in `packages/contracts/src/crm.ts`; T171 green
- [x] T177 **(both halves done; the Quote Request half on 2026-10-06 — research N-I6)** [US17] CRM admin: `packages/modules/crm/src/admin/components/LinkedOpportunityPanel.tsx` and two thin wrappers `zones/OrderOpportunity.tsx`, `zones/QuoteRequestOpportunity.tsx`, contributed with `zoneComponent('order.detail.after', …)` and `zoneComponent('quote_request.detail.after', …)` in `src/admin/index.ts`, `requiredPermission: 'crm:read'`; strings under `links.*`; T173 green
- [x] T178 [US17] `OpportunityCreatePage.tsx`: honour `linkDocumentKind` + `linkDocumentId` — after a successful create, call the link endpoint, then navigate; T174 green
- [x] T179 **(both halves done; the Quote Request half on 2026-10-06 — research N-I6)** [US17] Docs: the panel in `packages/modules/crm/docs/crm.md`; the new zone in `packages/modules/orders/docs/orders.md` and `packages/modules/quote_requests/docs/quote_requests.md` (+ Polish copies); changeset for `contracts`, `mod-orders`, `mod-quote-requests`; regenerate; full gate **including the `orders` and `quote_requests` admin test directories**

---

## Phase 17: Polish & Cross-Cutting Concerns

- [x] T141 [P] Read `packages/modules/crm/docs/crm.md` end to end as an operator and as a developer; make it one coherent page; verify the Polish copy matches section for section; `pnpm --filter docs run build`
- [x] T142 [P] Sweep `packages/modules/crm/i18n/en.json` and `pl.json`: no key in one and not the other, no unused key, Polish sentences read by a Polish speaker (the owner's terms: *Szansa sprzedażowa*, *Tablica*, *Statusy*); `i18n:hardcoded -- --strict` scoped to the module's admin directory shows zero
- [x] T143 [P] Accessibility and UX pass over the seven screens against `.claude/skills/ux-laws/SKILL.md` (WCAG 2.2 AA: focus order, target sizes, non-drag alternative on the board, colour is never the only carrier of a status) — hand to `endora-commerce-designer`, fix what it reports
  - **Done by instrument 2026-10-06** (research N-P3, N-P4): axe-core and a target-size measurement over every screen, tab and contributed panel at 1440 and 390 px, and the board's dragging in a browser. Not handed to `endora-commerce-designer`; what was left for the kit is listed in N-P4.
- [x] T144 Read-size bands: run the read-size test; for an entry whose band **refuses** the new file count only, read `specs/conventions/check-estate.md` § *Measuring a read size* first, re-measure on a pristine clone and re-record; leave in-band drift for the release pull request
- [x] T145 Deletion probe (Principle I): on a scratch branch, delete `packages/modules/crm/` and `packages/contracts/src/crm.ts` with its export, regenerate, and confirm `pnpm -r run typecheck` and `pnpm --filter backend run test:unit:fast` pass with nothing else changed but the generated files — record the result; do not commit the probe
- [x] T180 Extend the deletion probe of T145 for the stories added on 2026-10-05: with `packages/modules/crm/` gone, confirm `custom_fields` hides the `opportunity` type (its owner is absent), `webhooks` offers no CRM event, the Order and Quote Request screens render with empty zones, and `KanbanBoard` still builds and passes T148 in `admin-kit` with no consumer — record the result; do not commit the probe
- [x] T184 **Independent review, findings 1–12** (2026-10-06; `research.md` N-R1 … N-R12): active content refused as an attachment and every link a download; notifications by number only and only to somebody with reach; `orders:read` to link, follow or see an Order; a closed Opportunity never reopened by an Order; a failed Order-caused move recorded; the retry locked; note and message text out of the audit trail; calendar dates, `If-Match` and the tag filter; eleven untested guards given tests; status rows locked against a move in flight. `backend/test/integration/crm/review-regressions.test.ts`, `review-guards.test.ts`. Left: finding 12 (c), one `getAsset` per attachment — needs a batch read on `assets_library`' port.
- [x] T185 **Each review fix held to the code written after it** (`research.md` N-R13): the owner's read permission for a linked Quote Request (`rfqs:handle`), for a document a computed value leaves out, for a mentioned Order or Product (`catalog:read`) and for `GET /documents/:kind/:id/opportunity`; number-only notification for an automatically created Opportunity; automatic creation retried once when the start status has gone; the link sections and the change-history tab on the screens. `backend/test/integration/crm/review-extensions.test.ts`, `admin/test/modules/crm/owner-permissions.test.tsx`; module page (+ Polish), `contracts/admin-api.md` §1, §3, §6, §9, §10a, §12b.
- [x] T146 Full verification, as CI runs it: every command of `quickstart.md` § *Before calling any story done*, plus `pnpm --filter backend exec vitest run test/contract/crm test/integration/crm test/integration/orders test/integration/quote_requests test/contract/orders test/contract/quote_requests`; report each with its output (a merge-request pipeline does not run these — D-198)
  - **Done 2026-10-07** (research N-P8, N-P9): the complete contract and integration trees on `32775d506`, the targeted list and everything else on `b76c4727a` after two further merges. Read the two apart.
- [x] T147 Hand `spec.md` ↔ implementation consistency to `endora-commerce-product-owner`: every FR and acceptance scenario against the tests named in *Requirement traceability* below — done 2026-10-06 by the product-owner audit (15 requirements met, 8 met with a stated limitation, none unmet; findings carried into the review-2 fixes and `research.md`)

---

## Phase 18: User Story 18 — Mention a person, an Order or a Product by typing `@` (Priority: P3)

*Added 2026-10-07 at the owner's request (`spec.md` User Story 18; research N-M1 … N-M8).*
**Independent test**: in a message type `@`, a few letters of a colleague's name, Enter, the
rest of the sentence; send; the message shows `@` and the name, and the colleague — nobody
else — has one bell entry naming the Opportunity by its number.

- [x] T186 [US18] Spec first: User Story 18, FR-081 … FR-084 in `spec.md`; the token and the lookup in `contracts/admin-api.md` §9, §10a, §11; `data-model.md` (the third target type, the third bell kind); research N-M1 … N-M8.
- [x] T187 [P] [US18] Contracts, test first (`packages/contracts/src/crm.test.ts`, six cases seen red): `admin_user` in `opportunityReferenceTypeSchema` and in the one token expression; `mentionedAdminUserIds`; `OpportunityMentionLookupQuerySchema` / `…OptionSchema` / `…ResponseSchema`; `references` on `OpportunityHistoryEntrySchema`.
- [x] T188 [US18] Migration `packages/modules/crm/src/migrations/20261007T180600_crm_opportunity_reference_admin_user.ts` (scaffolded by `migration:new`): the `target_type` check gains `admin_user`; barrel updated; `composer:generate` run and `backend/src/db/migrations-registry.generated.ts` committed.
- [x] T189 [P] [US18] Backend unit tests beside their subjects, no database: `services/mention-service.test.ts` (13 cases; each of the six guards taken out in turn and seen red — research N-M8), `services/reference-service.test.ts` (4), `services/opportunity-history-service.test.ts` (2).
- [x] T190 [US18] `services/mention-service.ts` (who may be mentioned, who is told, `newlyMentioned`); `ReferenceService` resolves a person; `GET /lookups/mentionable`; the comment and the Opportunity services tell the newly mentioned after their commit; the history service returns `references`; composition in `backend/index.ts`.
- [x] T191 [P] [US18] **Written without a database (research N-M8); run green by the review of 2026-10-07 (N-M10).** `backend/test/integration/crm/mentions.test.ts` (resolution; the notification: once, by number and author, no text, not the author, not without `crm:read`, not deactivated, not out of reach, not on re-save, description on create and edit, a message's single entry, the bell switched off; the history's `references`), the `mentionable` cases of `backend/test/contract/crm/lookups.contract.test.ts` (gate, exclusions, id + name only, the Organization filter, the caller's own reach, limit, 400), and the route in `backend/test/integration/crm/off-state.test.ts`. The hand-written entry for the new route in `backend/test/fixtures/openapi-baseline.json` is held by `backend/test/contract/kernel/openapi-baseline.test.ts`, run with them.
- [x] T192 [P] [US18] Admin, the typing grammar test first: `src/admin/lib/mention-trigger.ts` + `.test.ts` (11 cases: the three runs, the search, an e-mail address, a space after the `@`, four `@`s, the caret, the length limit; `clipReferenceText`).
- [x] T193 [US18] Admin tests `admin/test/modules/crm/mentions.test.tsx` (16 cases) and the description cases of `history.test.tsx` (seen red without the change); `ReferenceTextarea.tsx` (the list under the field, combobox/listbox ARIA while open, the third button, the shortcut line), `ReferenceText.tsx` (the `@Name` chip), `OpportunityHistory.tsx` (a description through `ReferenceText`), `api.ts`, both bundles; `src/admin/index.test.ts` enumerates the new key families.
- [x] T194 [US18] Docs: `packages/modules/crm/docs/crm.md` § *Mentioning a person, an order or a product with @* and the sentences it changes elsewhere; the Polish page and its translation-cache entry; the two CRM changesets amended (the module is unreleased — N-P7).
- [x] T196 [P] **Second review, the history's reach** (research N-S8, N-M9), tests first and seen red: `packages/contracts/src/crm.test.ts` (`truncated` on the response), `packages/modules/crm/src/backend/services/opportunity-history-service.test.ts` (six cases over a stub port: a short history, exactly the reach, one past it, far past it, the flag on the last page only, the port never asked past its cap), `admin/test/modules/crm/history.test.tsx` (the tab says earlier changes exist instead of calling the history whole).
- [x] T197 The history serves 499 entries and answers `truncated`; the tab's two endings (`history.end`, `history.truncated`, both bundles); docs EN + PL, the translation cache, `contracts/admin-api.md` §11, both changesets. The one line added to `backend/test/contract/crm/history.contract.test.ts` was run with T191.
- [x] T195 [US18] The story walked in headless Chromium, in English and Polish, at 1440 px and 390 px, keyboard only, with axe-core over the open list (research N-M10). **Still not done**: a screen reader's reading of the active option, and choosing an Order with `@@` — the instance walked held no Order.
- [x] T199 [US18] **The editing field shows names, never tokens; the list opens at the caret** (owner ruling 2026-10-07; research N-M11). `src/admin/lib/reference-editor-dom.ts` and `components/ReferenceField.tsx` replace `ReferenceTextarea.tsx` in the four places that used it; `admin/test/modules/crm/reference-field.test.tsx` (35 cases) and the port of `mentions.test.tsx`, `references.test.tsx`, `comments.test.tsx`, `OpportunityEdit.test.tsx` to the field. Written with the code, not before it. The review's seven front-end guards (T198) are kept and their tests ported; a run's first search is delayed so `@@@` opens one list (two cases).
- [x] T200 [US18] The field walked in headless Chromium by `page.keyboard.type`, English and Polish, 1440 px and 390 px: 37 checks each, plus 9 accessibility checks per width with axe-core (WCAG 2.2 AA) over the empty field, its error state, the open list and a chip. Screenshots and scripts in the handover directory `mentions/editor-walk/`. **Not exercised**: an Order chosen from real data (the preview has none — the list's answer was supplied by the walk), a person other than the walker (mentioning the only other one would have written a bell entry on a real account), Firefox, Safari, a touch keyboard, an input method, a screen reader.
- [x] T198 [US18] **Review of 2026-10-07** (research N-M10), tests first: the active option is scrolled into view; a keystroke of a composing input method is left alone; `admin/test/modules/crm/mentions.test.tsx` gains seven cases, `mention-service.test.ts` one, `backend/test/integration/crm/mentions.test.ts` two, `backend/test/integration/crm/migration.test.ts` the migration's way down and back.


---

## Phase 19: Bell entries in the reader's language (FR-085)

*Added 2026-10-07 at the owner's request (research N-BT1 … N-BT4). A platform change made
inside this feature: the port, its owner and the shell's bell change additively, and CRM is
the first writer to use it. Task ids start at T210 — T198 … T209 are left free for work on a
parallel branch.*
**Independent test**: with the Admin UI in Polish, have a colleague mention you in a note; the
bell entry reads in Polish. Switch the language to English: the same entry reads in English.

- [x] T210 Spec first: FR-085 and the narrowed FR-072 / A-5 in `spec.md`; research N-BT1 … N-BT4; `contracts/foreign-module-changes.md` §L and the amended first line of §F.
- [x] T211 [P] Backend tests first, seen red (16 of 19 cases): `backend/test/integration/admin_notifications/translatable-messages.test.ts` (**new** — a message is stored and answered as given; a caller that gives none is recorded as before; ten refusals, none of which writes a row) and the *translatable messages* cases of `backend/test/contract/admin_notifications/list.test.ts` (the feed answers the message, and `null` for an entry without one).
- [x] T212 `packages/contracts/src/admin-notifications.ts` (`AdminNotificationMessage`; optional `titleMessage` / `bodyMessage` on the input and on the record); `admin_notifications`: the migration `20261007T194748_admin_notifications_message_keys.ts` (scaffolded by `migration:new`, two nullable `jsonb` columns), its barrel, the entity, the service's validation, the port adapter and the list route; `composer:generate` (`backend/src/db/migrations-registry.generated.ts`).
- [x] T213 [P] Admin test first, seen red (5 of 14 cases; 13 after one duplicate case was merged): `admin/test/components/NotificationBell.translation.test.tsx` (**new** — Polish and English readers, the English template when Polish lacks the key, seven ways of falling back to the recorded sentence and never to a raw key, the body, a param drawn as text).
- [x] T214 `packages/admin-shell/src/components/notifications/notification-text.ts` (**new**), `NotificationBell.tsx`, `useAdminNotifications.ts`, the barrel.
- [x] T215 [P] CRM tests first: `packages/modules/crm/src/backend/services/crm-notifier.test.ts` (**new** — every sentence has a key in both bundles, the English template filled with the params is the sentence, the params are exactly the placeholders, no orphan `notifications.*` key), the expectations of `mention-service.test.ts`, and the stored message in `backend/test/integration/crm/{assignment-notification,comments,mentions,review-regressions}.test.ts` — whose `SECRET` assertions now read the message too. **Not seen red in a run**: the unit file could not compile before `crmNotificationText` existed.
- [x] T216 `crm-notifier.ts` (`crmNotificationText`, `titleMessage` required on `CrmNotification`) and its three callers; the four keys in `packages/modules/crm/i18n/{en,pl}.json`; `src/admin/index.test.ts` names `notifications.` as a family the host reads.
- [x] T217 Docs: the three sentences of `packages/modules/crm/docs/crm.md` that said the entry is in English, the Polish page and its translation-cache entry; `docs/docs/contributing/translations.md` § *Notification bell entries* for module authors (English only — the page is on the translation skip list); changesets for `contracts`, `mod-admin-notifications`, `admin-shell` and the amended CRM one.
- [ ] T218 **Not done**: the entry read in a real browser in both languages, and with the CRM module switched off. Proven in jsdom and against the test database only.
- [ ] T219 **Follow-up, not this feature's**: `organizations`, `catalog` and `product_feeds` (and `pim_ergonode`, outside this repository) still record English only; each owes a key in its own bundle and a `titleMessage`. The bell's own `just now` / `5m` relative times are hard-coded English in `NotificationBell.tsx` and were so before this change.

## Phase 20: Demo data for CRM (User Story 14, scenario 3)

*Added 2026-10-08 at the owner's request (research N-DD1 … N-DD4). T139 is the task; the ids
below record what it left. Task ids start at T250 — T220 … T249 are left free for work on
parallel branches.*

- [ ] T250 **Not done**: the demo pipeline seeded into a running instance and looked at in a browser — the board, the analytics screen, an Opportunity's notes with the product and the person rendered as names. Proven against throwaway test databases only (`demo-shop.test.ts`, `demo-pipeline-off-state.test.ts`).
- [ ] T251 **Follow-up, needs the owner**: a demo Order and a demo Quote Request, so an Opportunity can be linked to each and one computed value is non-zero (N-DD2). That is demo data for `orders` and `quote_requests` — a placement path through two other modules — and was not invented here.
- [ ] T252 **Follow-up, platform**: `demo reset` while a module with rows against the demo Organization is switched off stops at `organizations` with a foreign-key refusal (N-DD4; `credit_limits` has the same shape). Loud and recoverable, but the report could say "switch `crm` on and run it again" instead of leaving the operator to read a constraint name.

---

## Phase 22: An Order records the Quote Request it was placed from (FR-100 … FR-104)

*Added 2026-10-08 at the owner's request ("Ad 2) tak, jak możesz to dorób" — the answer to
A-1). A platform change made inside this feature: `carts`, `quote_requests` and `orders`
change, CRM does not. Research N-QS1 … N-QS6. Task ids start at T270 — T220 … T269 are left
free for work on parallel branches.*
**Independent test**: link an accepted Quote Request to an Opportunity whose value is
computed; as the customer, order that quote in the storefront and check out. The Order
appears on the Opportunity by itself, the value is the Order's figure and not the two added,
the Quote Request reads *Completed*, and no second Opportunity exists.

- [x] T270 Trace every road from a Quote Request to an Order on this tree and write it down with file and line before designing (research N-QS1): one conversion, one re-priced copy that is not a conversion, and no request body that can name a Quote Request.
- [x] T271 [P] Tests first, seen red (the Order named nothing; 2 of the first 15 cases, the rest being controls and refusals that must hold before and after): `backend/test/integration/orders/place-order-from-quote-request.test.ts` (**new** — the real road; the control; a basket changed, emptied, stripped of its agreed line, seeded again as a reorder seeds it, replaced by an admin-created Order; the re-priced copy; a forged source of another Organization, of no request, of a cancelled one, of a request the basket holds no line of; a source in the request body; `quote_requests` off on both axes) with `backend/test/helpers/quote-conversion.ts` (**new**).
- [x] T272 `packages/contracts/src/carts.ts` (`CartRecord.sourceQuoteRequestId`, `CartSeedOptions`, the third argument of `replaceItemsForCustomer`); `carts`: the migration `20261008T061751_carts_cart_source_quote_request.ts` (scaffolded by `migration:new`, one nullable `uuid` column), its barrel, the entity, `cart-read-port.ts` (the seed writes the mark, on the `EntityManager` it flushes — N-QS5 (a)), `cart-service.ts` (`#forgetSourceWhenEmptied`); `composer:generate`.
- [x] T273 `quote_requests`: `rfq-service.ts` hands the request's id to the seed; `order-completion-reactor.ts` looks again for an Order whose commit is in flight and refuses another Organization's (N-QS5 (b)), with `order-completion-reactor.test.ts` (**new**, six cases) and the four new cases of `backend/test/integration/quote_requests/conversion.test.ts`; the composition supplies `deferAfterCommit` and `isStillPresent`.
- [x] T274 `orders`: `domain/quote-request-source.ts` and its test (**new**, fourteen cases), `#vouchedQuoteRequestSource` in `order-service.ts`, the `quoteRequestRead` accessor through `plugin.ts` and `index.ts`, the `degrades-without` entry in `manifest.ts`; `composer:generate` (the module-reference page) and its Polish mirror.
- [x] T275 [P] CRM on the real road: `backend/test/integration/crm/quote-conversion.test.ts` (**new**, six cases — research N-QS6). No file under `packages/modules/crm/src/` changes.
- [x] T276 Docs: the three passages of `packages/modules/crm/docs/crm.md` that said "not effective yet"; `quote_requests.md` § *Conversion to order*; `carts.md` § *Conversions*; `orders.md` § *An order placed from an accepted quote request* (**new**); the four Polish pages and their translation-cache entries. Spec: FR-100 … FR-104, the seven "not reachable" marks and A-1 in `spec.md`, `contracts/events-and-ports.md` §2, `contracts/foreign-module-changes.md` §QS, the two traceability rows below. Changesets for `contracts`, `mod-carts`, `mod-quote-requests`, `mod-orders` and the amended CRM one.
- [ ] T277 **Not done**: the road walked in a storefront browser, and the joined Order seen on the Opportunity's screen. Proven against the test database through the HTTP routes only.
- [ ] T278 **Follow-up, not this feature's (the owner's to schedule)**: `orders` announcing `order.created.v1` after its commit, which removes the wait in `crm` and in `quote_requests` (N-E7, N-QS5); the *Place order* button of the Admin UI's Quote Request screen, which posts to the customer route (N-QS1 (c)); whether a basket seeded from a quote should stop being orderable at the agreed prices once the quote's validity has ended (N-QS3).
- [x] T280 Independent review of T270 … T276 (research N-QSR1 … N-QSR5): the diff read against the surrounding code, fourteen mutations of the new rules run against the suites, every survivor given a test. No file under `packages/modules/crm/src/` changes.
- [x] T281 **One request, one Order** (FR-104, N-QSR1). Test first, seen red: `backend/test/integration/orders/quote-request-source-review.test.ts` (**new**) — *one request, two baskets*: placed after an Order that already names the request while it still reads `Approved` (red before the repair), a placement waiting its turn behind another of the same request (red without the lock), and two placed at once. Then `orders`: `alreadyOrdered` / `already-ordered` in `domain/quote-request-source.ts` and its test, and the transaction-scoped advisory lock and own-table count in `#vouchedQuoteRequestSource` (`order-service.ts`).
- [x] T282 The completion reactor says when it gives up (FR-104, N-QSR3): `order-completion-reactor.ts` throws after the last pause, for `deferAfterCommit` to log; `order-completion-reactor.test.ts` gains the logged give-up and two cases nothing held — the same Order announced twice, and a completed request left with the Order that completed it.
- [x] T283 [P] Tests for the mutants that survived (N-QSR2): in `quote-request-source-review.test.ts`, a placement in a system scope with a basket naming another Organization's request (and its control), the agreed line swapped for a list-priced one in a basket that was never empty, a second request converted into the same basket; `backend/test/integration/carts/seed-bookkeeping.test.ts` (**new**) — the seed moves `lastActivityAt` (N-QSR4).
- [x] T284 Docs and release intent for T281 – T282: `orders.md` § *An order placed from an accepted quote request* (four conditions), its Polish mirror and translation-cache entry; the `mod-orders` and `mod-quote-requests` changesets; `spec.md` FR-104; `contracts/foreign-module-changes.md` §QS.
- [ ] T285 **Reported, not changed — the owner's to schedule** (N-QSR5): the money rules a quote-seeded basket has never had (no ceiling on the quantity of an agreed line, a reorder re-seeding at an Order's snapshot prices, the validity date unread at placement, a line with no agreed price seeded at zero); the basket page showing the recomputed list price beside an Order charged at the agreed one; a recovery pass for a request whose completion never arrived; an index on `orders.source_quote_request_id`.

---

## Dependencies & Execution Order

> **Note on file names (2026-10-06).** This section and a task line in almost every story —
> from T023 to T176; `grep -n 'compose/' tasks.md` lists them — name
> `src/backend/compose/<area>.ts` files. **None of them exists.** The premise was measured false at T023: composition is the single
> file `packages/modules/crm/src/backend/index.ts`, one delimited section per area
> (`research.md` N-6). Read every `compose/<area>.ts` below as "the `<area>` section of
> `index.ts`"; the task lines are left as they were written.

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
| US14 | US1 | demo data (T139) is best written last — and was: 2026-10-08, research N-DD1 |
| US15 | US1 | the **only** story after Phase 2 that adds a migration (no entity); touches `custom_fields` |
| US16 | US1 | touches `webhooks`; needs only the events US1 emits |
| US17 | US1 (Order half), US8 (Quote Request half) | touches `orders` and `quote_requests` admin screens |

### Parallel worktrees without file collisions

No story after Phase 2 adds an entity, and exactly one — US15, see below — adds a migration
(`20261005T215329_crm_opportunity_custom_field_values.ts`, one column), so **no two stories
regenerate the migration or entity registry**. (This sentence first read "No story after
Phase 2 adds a migration or an entity", which stopped being true when US15 came into scope;
corrected 2026-10-06.) Three groups can be in flight at once:

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
| FR-006 | US1 (+ every story adding a read) | T031, and the out-of-scope case in T074, T079, T084, T088, T119, T125, T129, T182; the owner-permission cases of T184 and T185 |
| FR-010 – FR-014 | Foundational, US1 | T010, T012, T027, T036 |
| FR-015 | US1 | T032 |
| FR-016 | US1 | T030, T033 |
| FR-020 | US1 (orders), US8 (quote requests) | T029, T095, T097 |
| FR-021, FR-022, FR-023 | US1 | T030, T034 |
| FR-024, FR-025 | US2 | T058 |
| FR-026 | US10 | T108–T112 |
| FR-027 | US8, Phase 22 | T095 (an Order whose source is written by hand) and T275 (an Order placed through the storefront routes, research N-QS6) |
| FR-030 – FR-033 | US8, Phase 22 | T094, T095; FR-033's "counted once" also on the real road, T275 |
| FR-040, FR-041 | US3 | T065, T066 |
| FR-042, FR-043 | US4 | T073, T074 |
| FR-044 | US5 | T078, T079, T182, T183 |
| FR-045 | US12 | T124, T125 |
| FR-050 | US6 (+ US7 for the board filter) | T084, T088 |
| FR-051 | US7 | T088, T089, T148 |
| FR-052 | US11 | T119, T120 |
| FR-053 | US13 | T129 |
| FR-060, FR-061 | US9 | T103 |
| FR-070 | Foundational + every story with a subscriber | T011, T060, T097, T104, T111 |
| FR-071 | Setup, US1, US6, US7, US13 | T005, `packages/modules/crm/src/admin/index.test.ts` (T055, research N-29 — every sidebar row and palette action points at a declared route), the palette case of `off-state.test.ts` (T057), and `check:action-route-permissions`. The palette carries four curated actions; *Tags* and *Workflow* are reached from the sidebar only (`contracts/admin-surfaces.md` §3), which FR-071's "every screen" does not yet say |
| FR-072 | every story | `check:bundle-pairing`, `registered-bundles-shape.test.ts`, `i18n:hardcoded` |
| FR-073 | every story | `check:command-coverage`, T120 |
| FR-074 | US14 | T134 |
| FR-075 | Foundational, every story, Polish | `check:module-docs`, `check:docs-translations`, T141 |
| FR-076 | US15 | T152, T153, T155 |
| FR-077 | US16 | T162, T163, T164 |
| FR-078 | US17 | T171, T172, T173, and `admin/test/modules/crm/quote-request-opportunity-panel.test.tsx` for the Quote Request half |
| FR-079 | Polish (independent review) | `backend/test/integration/crm/review-extensions.test.ts`, `backend/test/contract/crm/links-and-transition.contract.test.ts` (the `orders:read` cases), `admin/test/modules/crm/owner-permissions.test.tsx`, `backend/test/contract/crm/attachments.contract.test.ts` (the `assets.read` gate) |
| FR-081 | US18 | T187, T189, T191, T193 |
| FR-082 | US18 | T192, T193 |
| FR-083 | US18 | T189, T191 |
| FR-086 | US18 | T199, T200 |
| FR-084 | US18 | T189, T191, T193 (the description); T196, T197 (the reach) |
| FR-085 | Phase 19 | T211, T213, T215 |
| FR-080 | Polish (independent review) | `backend/test/integration/crm/attachment-upload.test.ts` (the active-content cases and the size limit), `backend/test/contract/crm/attachment-upload.contract.test.ts` |
| FR-090 | US19 | T230, T231, T233 |
| FR-091 | US19 | T231, T232 (the statement count), T233 |
| FR-092 | US19 | T230, T232, T233 |
| FR-093 | US19 | T232 |
| FR-090 – FR-093 | US19 (independent review) | T240 – T244 |
| FR-110 | US20 | T302 — the meta line, the heading outline; T310 for the width (not done) |
| FR-111 | US20 | T308 — every earlier case of the nine files still runs against the new structure; T302 — *a reader changing nothing* |
| FR-110 (as amended) | US20 | T315 — the facts card and the markup order |
| FR-112, FR-113 | US20 | T312; T315 — both sides, one side only, none and closed, reopening, no status that is not a move, no position |
| FR-114 | US20 | T312 (no move added or dropped, nothing guessed); T315 — a reader, the order unreadable; the vetoed and moved cases of T036 |
| FR-115 | US20 | T315 — a move by keyboard, the button names with their direction, the spoken kinds; the wrap at 390 px is T310 (not done) |
| FR-116 – FR-118 | US20 | T301; T302 — the tabs group |
| FR-119 | US20 | T302 — the four groups, empty facts, a reader changing nothing; the earlier cases of `assignment`, `tags` and `value` |
| FR-120 | US20 | the refused-Order cases of T036, now rendered from the page (T308) |
| FR-121 | US20 | T302 — the heading outline, the history tab's heading, arrow keys; `index.test.ts` (44 px on every button); the colours are T310 (not done) |
| FR-100 | Phase 22 | T271 (the Order names its request; both order serialisers answer it), T273 (the basket is marked), T275 |
| FR-101 | Phase 22 | T271 — *a basket the buyer changed after the conversion* (five cases) and the re-priced copy |
| FR-102 | Phase 22 | T274 (`quote-request-source.test.ts`), T271 — *a source the basket claims and placement does not believe* (four cases) and the request-body case; T275 (nothing crosses the tenant) |
| FR-103 | Phase 22 | T271 — *with quote_requests off*, both axes, and the ordinary basket beside them |
| FR-104 | Phase 22 | T273 (`order-completion-reactor.test.ts`; the lost race and the foreign Order in `conversion.test.ts`), T271 (completed, and a second conversion refused), T281 (one request, two baskets — three cases), T282 (the give-up is logged; a redelivery completes nothing twice) |
| FR-130, FR-131 | US21 | T320, T330, T331 (each refusal by its rule), T365 (the dialog builds what the rules accept) |
| FR-132, FR-135, FR-136 | US21 | T332 |
| FR-133 | US21 | T362 (the tab's place and count), T365; `upcomingEventCount` in T331, T332 |
| FR-134 | US21, US22 | T331 (the 404s), T332 — *Tenant isolation* |
| FR-137 | US21 | T331 (`reminder_in_past`), T365 (the default and its following the start) |
| FR-138, FR-139, FR-140 | US21 | T333; the sentence and its params T334; presence T335; the off-state half of FR-140 in `off-state.test.ts` (T333) |
| FR-141 | US21 | T320 (the states), T365 (each in words) |
| FR-142 | US22 | T364, T369 (`check:action-route-permissions`) |
| FR-143, FR-144, FR-145 | US22 | T332 — *The Calendar*; the switch's presence and absence T364 |
| FR-146, FR-147 | US22 | T360, T361, T362, T363, T364 |
| FR-148, FR-149, FR-150 | US22 | T363; by eye and with axe T383 |
| FR-151 | US22 | T320 (45 days), T332 (`truncated`, the statement count) |
| FR-152 | US22 | T336 |

## Phase 21: User Story 19 — Choose what a board card shows, and filter the board by it (Priority: P3)

**Source**: the owner's request of 2026-10-08, recorded with the story in `spec.md`.
**Goal**: FR-090 – FR-093. **Independent test**: the story's own. Research: N-BF1 – N-BF9.
**Contract**: `contracts/admin-api.md` §12c.

### Tests first

- [X] T230 [US19] `packages/contracts/src/crm.test.ts` — the field reference, the card-field
  configuration request (six at most, no duplicate), the field-filter parameter (a JSON
  object per field, refused when malformed) and `cardValues` on a summary.
- [X] T231 [US19] `backend/test/contract/crm/board-card-fields.contract.test.ts` — the
  configuration read (`crm:read`) and write (`crm:configure`), the default, the refusals
  (unknown field, a seventh field, a duplicate), and the board answering `cardFields` and,
  per card, exactly the values of the chosen fields.
- [X] T232 [US19] `backend/test/integration/crm/board-card-fields.test.ts` — every filter
  kind against the cards, the counts and the totals; the list answering the same for a
  lane's continuation; a filter on a field that is not on the card ignored; a deleted custom
  field dropping out; tenant isolation of the filters; the statement count independent of the
  number of cards.
- [X] T233 [US19] `admin/test/modules/crm/board-card-fields.test.tsx` — the configuration
  section (choose, order, the limit of six said and enforced, save, refusal), the card
  rendering the chosen fields, the filter for each kind, the address carrying the filters and
  *Clear* emptying it.

### Implementation

- [X] T234 [US19] `packages/contracts/src/crm.ts` — §12c's schemas.
- [X] T235 [US19] `packages/modules/crm/src/manifest.ts` — the `crm.board_card_fields`
  setting; `src/backend/domain/board-card-fields.ts` (with its co-located test) — the
  catalogue of built-in fields and the filter conditions;
  `src/backend/services/board-card-field-service.ts` — the stored choice resolved against the
  catalogue and the definitions, and its write.
- [X] T236 [US19] `opportunity-service.ts` and `board-service.ts` — card values on a summary
  when asked for, field filters in the list and in the board's figures from one function;
  `routes/routes.board.ts` — the two configuration routes; composition in `backend/index.ts`.
- [X] T237 [US19] Admin: `components/BoardCardFieldsEditor.tsx` on the Workflow screen,
  `components/BoardCardFields.tsx` and `components/BoardFieldFilters.tsx` on the board,
  `lib/board-fields.ts` — the board's filters in its address — and a link from the board to
  the configuration (`contracts/admin-surfaces.md` §9).
- [X] T238 [US19] i18n EN + PL, `docs/crm.md` EN + PL with the translation cache, the
  changeset, the OpenAPI baseline, the off-state probes for the two new routes. **Not seen in
  a browser**: the change is to the API as well as the screens, and the preview instance runs
  the base.

### Independent review (2026-10-08, research N-BFR1 – N-BFR10)

- [X] T240 [US19] `backend/test/integration/crm/quote-requests-off.test.ts` — the
  linked-Quote-Requests field neither offered, shown, filtered by nor choosable while
  `quote_requests` is off, on both axes, and a stored choice of it left as it is (N-BFR10).
- [X] T241 [US19] `domain/board-card-fields.ts`, `opportunity-service.ts` — a card's Sales
  Channel as one name in the reader's language (N-BFR1); an instant's `to` bound counted by
  the database, so the last day a date can name is not a 500 (N-BFR4). Tests first, in
  `board-card-fields.test.ts` (integration and co-located).
- [X] T242 [US19] `packages/contracts/src/crm.ts` — a refused field filter located once
  (N-BFR6).
- [X] T243 [US19] `admin/lib/board-fields.ts`, `OpportunityBoardPage.tsx` — the address read
  by the server's own schemas (N-BFR2) and the board read once whatever order the address
  names its filters in (N-BFR3).
- [X] T244 [US19] Tests for what was true and unheld: a field key and every value bound
  (N-BFR5), values of another type than the definition's (N-BFR7), the statement count with
  a contact person and a Sales Channel on every card (N-BFR8).

## Phase 23: User Story 20 — An Opportunity screen that reads in order (Priority: P3)

**Source**: the owner's request of 2026-10-08, recorded with the story in `spec.md`.
**Goal**: FR-110 – FR-121. **Independent test**: the story's own. Research: N-DL1 – N-DL8.
**Contract**: `contracts/admin-surfaces.md` §1a. Admin UI, bundles, tests and documents
only — nothing under `src/backend/`, `packages/contracts/` or the OpenAPI baseline.

### Tests first

- [X] T300 [US20] `packages/modules/crm/src/admin/lib/stage-model.test.ts` — what the stage
  bar claims, with no DOM: the operator's order, open statuses before closing ones, the
  position counted over the open ones, none for a closed Opportunity, the server's allowed
  transitions as the only targets (a backward one included), no "passed" state, and the two
  fallbacks.
- [X] T301 [US20] `packages/modules/crm/src/admin/pages/opportunity-detail/tabs.test.ts` —
  the tab order, unique ids, the count on *Links* alone, and the address: `?tab=`, an unknown
  id, `?created=` landing on *Links*, the default tab as the bare address, the round trip.
- [X] T302 [US20] `admin/test/modules/crm/OpportunityDetail.test.tsx` — three new groups:
  the stage bar on the screen (order and current mark, buttons for allowed moves only, a
  non-linear workflow, a closed Opportunity, a read-only user, a move by keyboard carrying
  the reason, the workflow unreadable); the tabs (order and default, links on *Links* only,
  the Quote Requests section, the count and its absence, the address read and written, the
  return from a create screen, arrow keys, the history tab's heading); the header and the
  sidebar (the meta line, the four groups and what is in each, empty facts, the closing
  date, a reader changing nothing, *Edit* from another tab, the heading outline).

### Implementation

- [X] T303 [US20] `src/admin/lib/stage-model.ts` and `src/admin/components/StageBar.tsx` —
  the bar, on `GET /workflow` and the Opportunity's own `allowedTransitions`;
  `components/StatusControl.tsx` is removed, its transition call, reason field, refusal and
  announcement carried over unchanged.
- [X] T304 [US20] `src/admin/pages/opportunity-detail/tabs.ts` — the order, the `links` tab,
  `count`, `tabFromSearch` / `searchForTab`; `tabs/LinksTab.tsx` (new), `tabs/OverviewTab.tsx`
  (description, custom fields and the edit form only), `tabs/HistoryTab.tsx` (the `h2` its
  entries hang from).
- [X] T305 [US20] `src/admin/pages/opportunity-detail/OpportunitySidebar.tsx` (new) —
  the four groups; `components/OpportunityValue.tsx`, `AssigneeSection.tsx` and
  `TagsSection.tsx` become labelled groups under an `h3` instead of landmarks under an `h2`.
- [X] T306 [US20] `src/admin/pages/OpportunityDetail.tsx` — the header's meta line and
  actions, the bar, the propagation outcomes under it, the two columns, the tab in the
  address, the tab strip's keyboard handling, the loading skeleton.
- [X] T307 [US20] `i18n/en.json`, `i18n/pl.json` — `opportunity.stage.*`,
  `opportunity.facts.*`, `opportunity.tabs.links`, `opportunity.tabs.label`,
  `opportunity.field.number`, `opportunity.field.closed`, `opportunity.description.empty*`;
  `opportunity.detail.subtitle`, `opportunity.status.current` and
  `opportunity.status.moveTo` removed with their last reader.
- [X] T308 [US20] Existing tests follow the structure (research N-DL6 lists each change and
  why; no assertion was dropped): `OpportunityDetail.test.tsx`, `OpportunityEdit.test.tsx`,
  `assignment.test.tsx`, `tags.test.tsx`, `value.test.tsx`, `create-from-opportunity.test.tsx`,
  `owner-permissions.test.tsx`, `references.test.tsx`, `custom-fields.test.tsx`.
- [X] T309 [US20] Documents: `spec.md` (User Story 20, FR-110 – FR-121),
  `contracts/admin-surfaces.md` §1 and §1a, `research.md` N-DL, `packages/modules/crm/docs/crm.md`
  § *The opportunity's screen* with its Polish page and translation cache,
  `.changeset/crm-opportunity-detail-layout.md`.

### Amendment after the owner saw the first build (2026-10-08, research N-DL9, N-DL10)

- [X] T312 [US20] `src/admin/lib/stage-model.ts` and its test, rewritten test-first — the
  model is the allowed moves sorted into `back`, `forward` and `unsorted`: closing is
  forward whatever its weight, reopening is back, two open statuses go by the operator's
  order, nothing is guessed without it, and no move is added or dropped.
- [X] T313 [US20] `src/admin/components/StageBar.tsx` — the current status and the moves on
  their sides; no list of the workflow and no "Stage n of N"; `GET /workflow` read only when
  there is a move to sort. Bundles: `opportunity.stage.back`, `.forward`, `.other`,
  `.moveBack`, `.moveForward` added; `opportunity.stage.position` and `.list` removed with
  their last reader; `.current`, `.hint` and `.partial` reworded.
- [X] T314 [US20] `src/admin/pages/OpportunityDetail.tsx` and
  `opportunity-detail/OpportunitySidebar.tsx` — one grid under the header, the facts in the
  kit's `Card` in the right column beside the stage bar, the Order outcomes and the tabs;
  markup order stage, outcomes, facts, tabs. `tabs.ts` and the tab strip are untouched.
- [X] T315 [US20] `admin/test/modules/crm/OpportunityDetail.test.tsx` — the stage-bar group
  rewritten for the new subject (both sides, forward only, back only, none and closed,
  reopening, a reader, the keyboard move with its reason, the order unreadable, and the case
  where its absence changes nothing); one new case for the facts card and the markup order.
  The helper waits for the bar to stop being busy instead of for a list it no longer has.
- [X] T316 [US20] Documents amended: `spec.md` (the story, FR-110, FR-112 – FR-115, FR-119),
  `contracts/admin-surfaces.md` §1a, `research.md` N-DL9 and N-DL10, the module page with
  its Polish mirror and cache, and the same changeset.

### Not done

- [ ] T310 [US20] **Looked at in a browser.** The story was built without one (research
  N-DL7). The coordinator saw the *first* build at desktop width and moved an Opportunity
  through its bar; the amended one (T312 – T314) has not been seen. Still owed: the grid at
  desktop width — no gap opening between the left cards under a tall facts card — and at
  390 px, both themes, a status with many allowed moves, a long title, a long tag list, the
  focus order and an axe pass.
- [ ] T311 [US20] **Reported, not changed — the owner's to schedule** (research N-DL8): the
  bell opening the tab a notification is about; a stage bar that knows which statuses an
  Opportunity has been through; the facts a reference CRM shows that this one does not hold.

## Phases 24 – 27: User Stories 21 and 22 — Events, reminders and the Calendar (Priority: P3)

**Source**: the owner's request of 2026-10-08, quoted with the stories in `spec.md`.
**Goal**: FR-130 – FR-152. **Independent tests**: the two stories' own. **Research**:
N-CAL1 – N-CAL14. **Design**: `plan.md` § *Events, reminders and the Calendar*.
**Status: designed, nothing built.** T312 – T319 are left free.

**Two developers, in parallel.** The work is split by layer, not by story, because that is
where the files divide:

| Track | Phase | Owns | Never touches |
| --- | --- | --- | --- |
| — | **24 · Contract** | `packages/contracts/src/crm.ts`, `auth.ts`, `admin-actions.ts`; the icon map | — |
| **B — backend** | **25** | `packages/modules/crm/src/backend/**`, `src/migrations/**`, `packages/modules/auth/**`, `packages/demo-composition/**`, `backend/test/**`, `backend/scripts/ledgers/**`, generated registries, the OpenAPI baseline | `src/admin/**`, `admin/test/**` |
| **F — Admin UI** | **26** | `packages/modules/crm/src/admin/**`, `admin/test/modules/crm/**` | `src/backend/**`, `backend/**`, `packages/contracts/**` |
| — | **27 · Join** | `docs/crm.md` and its Polish page, changesets, the sweep of checks | — |

**The shared contract task is Phase 24 and it lands first**, as one commit on
`feat/143-crm-calendar`; both tracks branch from that commit and neither edits
`packages/contracts/` afterwards — a needed change to the contract is raised with the other
developer and made once, there. The contract is `contracts/admin-api.md` §12d: track B
serves it, track F is built against it with fixtures typed by its schemas, so a drift is a
type error and not a surprise in Phase 27.

**Three files both tracks add lines to**, each in a region of its own (`plan.md` § *Source
layout*): `src/manifest.ts` (B: `transactionalEmails`, `dependencies`, `env` — F: one
`actions` entry), `i18n/en.json`, `i18n/pl.json` (B: `notifications.*`, `auditLog.*` — F:
everything else). Whoever merges second rebases over line adjacency. Nothing else overlaps.

**Standing for all four phases**: the *Standing rules for every task* at the top of this
file; a task that names a premise of N-CAL14 re-derives it **before** writing and reports
what it found; `[P]` means parallel inside its own track.

## Phase 24: The contract (shared — one developer, before either track)

### Tests first

- [x] T320 [US21] [US22] `packages/contracts/src/crm.test.ts` — the schemas of
  `contracts/admin-api.md` §12d, red for not existing: an Event write (name bounds; `endsAt`
  not after `startsAt` refused; a span over 25 hours refused; `timeZone` required;
  `remindAt` nullable and optional), the update as its partial, `OpportunityEvent` with
  each reminder state and `channels`, the calendar query (`to` not after `from` refused; a
  range over 45 days refused; `scope` optional), `CalendarEvent` (no description member),
  `CalendarEventsMeta`, and `upcomingEventCount` on `OpportunityDetail`.

### Implementation

- [x] T321 [US21] `packages/contracts/src/auth.ts` — `AuthAdminLastSeen` and
  `AuthSessionReadPort.lastSeenByAdminUser` (`foreign-module-changes.md` §CAL-B1).
  **Premise 8 of N-CAL14 first**: `grep -rn 'AuthSessionReadPort' packages backend admin`
  for every implementer and test double; each must gain the method in this commit or
  type-checking reds in a file nobody touched.
- [x] T322 [US22] `packages/contracts/src/admin-actions.ts` — `'CalendarDays'` on
  `KnownIconNameSchema`; `packages/admin-kit/src/lib/admin-actions/icon-map.ts` — its
  component (§CAL-A). **Premise 5 first**: `git log -S"'LineChart'" --oneline` to see every
  file the last icon touched, and touch the same set. If a test enumerates the allowlist,
  it moves here.
- [x] T323 [US21] [US22] `packages/contracts/src/crm.ts` — the schemas and their inferred
  types, turning T320 green. Then `pnpm run build:packages`, `pnpm -r run typecheck`,
  `.changeset/` entries for `@endora-commerce/contracts` and `@endora-commerce/admin-kit`.
  **This commit is the base of both tracks.**

## Phase 25: Track B — backend

**Contract**: `contracts/admin-api.md` §12d, `data-model.md` § *`crm_opportunity_events`*,
`contracts/events-and-ports.md` §5a, `foreign-module-changes.md` §CAL.

### Tests first (each seen red for the stated reason)

- [x] T330 [P] [US21] `packages/modules/crm/src/backend/domain/event-time.test.ts` — no
  database: an Event inside one local day accepted; one crossing local midnight in its zone
  refused (`spans_days`) though it is inside one UTC day, and the reverse accepted; all-day
  accepted only as local midnight to the next (`not_whole_day`), at 23, 24 and 25 hours on
  the two DST days of `Europe/Warsaw`; an unknown zone refused; `allDayDate` for a zone east
  and a zone west of UTC; `when` for a timed and an all-day Event.
- [x] T331 [P] [US21] [US22] `backend/test/contract/crm/events.contract.test.ts` — the five
  routes against their schemas; `crm:read` reads and cannot write (403); the 404s
  (`CRM_OPPORTUNITY_NOT_FOUND` for the parent, `NOT_FOUND` for an Event under the wrong
  Opportunity); 400 for a malformed body and a 46-day range; 422 with each `details.rule`;
  `GET /opportunities/:id` carrying `upcomingEventCount`.
- [x] T332 [US21] [US22] `backend/test/integration/crm/events.test.ts` — real database:
  add, edit and delete, each leaving one history entry on the Opportunity that carries the
  name and times and **not** the description's text; any holder of `crm:write` edits
  another's Event; deleting the Opportunity deletes its Events; `upcomingEventCount` counts
  the not-yet-ended. **Tenant isolation** (FR-134): an Opportunity outside the caller's
  Organizations answers 404 on all four per-Opportunity routes, and its Events are on no
  Calendar the caller can ask for, under either scope. **The Calendar**: only Opportunities
  in an open status — close one, its Events leave; reopen, they return (FR-143); a
  full-reach caller gets `all` by default and both scopes offered, and `mine` narrows; a
  Sales Rep gets `mine` whatever is asked, sees a colleague's Opportunity of a shared
  Organization on **no** scope, and loses an Opportunity still assigned to them once its
  Organization is taken away (FR-144); reassigning moves every Event between two callers'
  answers with no Event row written (FR-145 — assert `updated_at` unchanged); overlap at
  both edges of the range; an all-day Event of a far zone found by the widened range;
  `truncated` at 501; **the statement count equal at 5 and at 500 Events** (FR-151).
- [x] T333 [US21] `backend/test/integration/crm/event-reminders.test.ts` — the sweep driven
  directly with a given `now`, as the orders sweep's tests drive theirs: the assignee at
  that moment is reminded, a former one is not (FR-138); unassigned → the creator; an
  inactive assignee, and one who cannot reach the Organization → the creator under the same
  tests → otherwise `no_recipient` and nothing written; the bell entry's kind, subject,
  `linkPath` with `?tab=events&event=`, and `titleMessage` whose English template filled
  with its params is the `title` (FR-139); seen within five minutes → no e-mail; not seen →
  one e-mail, to their address, in `pl-PL` for a Polish preference and `en-US` otherwise,
  with `salesChannelId: null`; an e-mail outcome other than `sent`, and a transport that
  throws → the bell entry stands and the outcome is `bell`; `admin_notifications` off →
  e-mail regardless of presence, outcome `email`; both unavailable → `undeliverable`.
  **Once** (FR-140): two sweeps in a row, and two at once, write one entry; a closed
  Opportunity's reminder is neither sent nor consumed, and is sent late after a reopening
  inside 24 hours; one found later is `missed`; a claim left `sending` for ten minutes
  becomes `interrupted` and is not retried; a thrown bell write releases the claim and the
  next sweep delivers; a changed `remindAt` arms a handled reminder again; a deleted Event
  sends nothing. And in `backend/test/integration/crm/off-state.test.ts`: the five routes
  in the `routes` probe; a due reminder delivered while on, **not** while deactivated,
  once after reactivation — **premise 7 first**: read how that file exercises the
  recalculation worker's gate and use the same road.
- [x] T334 [P] [US21] `packages/modules/crm/src/backend/services/crm-notifier.test.ts` — the
  new kind's two sentences under the file's existing property. (`opportunity-history-labels.test.ts`
  needs no edit: it reds by itself when the three Commands appear without labels, and when
  the reminder Command is given one.)
- [x] T335 [P] [US21] `auth` — co-located test of `lastSeenByAdminUser` (newest per user;
  `since` respected; a row with a `customerAccountId` is not the administrator's presence;
  empty input) and, in `backend/test/integration/auth/`, an authenticated admin request
  stamping `sessions.last_seen_at`, a second inside the minute writing nothing, and a
  customer request behaving as before (§CAL-B4).
- [x] T336 [P] [US22] `packages/demo-composition/src/sales-pipeline.test.ts` and
  `backend/test/integration/demo/demo-shop.test.ts` — Events on the open demonstration
  Opportunities, dated from the seed's day, none with a reminder; `crm_opportunity_events`
  in the recorded delta; the reset removing them (FR-152).

### Implementation

- [x] T337 [US21] `src/backend/entities/crm-opportunity-event.entity.ts`; the migration,
  scaffolded with `pnpm --filter backend run migration:new -- --module crm --name
  opportunity_events` (table, check constraints, the three indexes, the cascade);
  `src/migrations/index.ts`; the class in `export const entities`; `composer:generate`,
  committed. `backend/test/integration/crm/migration.test.ts` gains the table.
- [x] T338 [P] [US21] The reminder e-mail: `src/backend/email-templates/event-reminder-defaults.ts`
  (subject and body, `en-US` and `pl-PL`), `src/backend/services/event-reminder-email.ts`
  (the one send and its named outcomes — model: `shipments/…/shipment-email-notifier.ts`),
  the manifest's `transactionalEmails` entry and `transactional_emails` in `dependencies`,
  the defaults pushed from `ctx.onBoot`. **Premises 1 – 3 first**: what `email`'s console
  driver reports and what `salesChannelId: null` renders; whether `simpleEmailBodyTree`
  carries a link; the values of `preferredLanguage`. Then `manifests:generate` and
  `pnpm install --lockfile-only`.
- [x] T339 [P] [US21] `ADMIN_BASE_URL` in the manifest's `env` and
  `backend/scripts/ledgers/module-environment-inputs/crm.ts` (§CAL-C). **Premise 4 first —
  and stop and report if one input admits one owner**; the fallback that needs no ruling is
  an e-mail with the Opportunity's number and no link.
- [x] T340 [US21] `src/backend/domain/event-time.ts` — T330 green.
- [x] T341 [US21] `src/backend/services/opportunity-event-service.ts` (the list; the three
  Commands on the Opportunity's audit object; the re-arming rule),
  `src/backend/routes/routes.events.ts` (four routes), `upcomingEventCount` in
  `opportunity-service.ts`, the composition section in `src/backend/index.ts`; the three
  `auditLog.crm.opportunity.event_*` labels in both bundles. Model:
  `opportunity-comment-service.ts`, `routes.comments.ts`.
- [x] T342 [US22] `src/backend/services/calendar-service.ts` — the one statement under
  `orgConstraintFor()`, the scope rule, the assignees' names in one port call — and
  `GET /calendar/events` in `routes.events.ts`. Model: `analytics-service.ts`'s scope
  predicate. T331 and T332 green.
- [x] T343 [P] [US21] `packages/modules/auth/src/backend/services/session-port.ts`,
  `plugin.ts` (§CAL-B2, B3) — T335 green; a changeset for `@endora-commerce/mod-auth`.
- [x] T344 [US21] `src/backend/services/crm-notifier.ts` — the kind
  `crm.opportunity.event_reminder`, its two sentences with their keys, and a link that can
  carry `?tab=events&event=`; the two `notifications.eventReminder*` keys in both bundles.
- [x] T345 [US21] `src/backend/services/event-reminder-service.ts` — the tick of N-CAL5:
  expire, claim, resolve the recipient, deliver, record — and
  `src/backend/workers/event-reminder-worker.ts` (queue `crm-event-reminders`, the scheduler,
  the consumer through `ctx.worker`), composed where the recalculation worker is. Needs
  T338, T343, T344. Model: `orders/…/workers/transition-effect-sweep-worker.ts`. T333 green.
- [x] T346 [US22] `packages/demo-composition/src/sales-pipeline.ts` — T336 green.
- [x] T347 [US21] [US22] The track's close: the OpenAPI baseline regenerated; `composer:check`,
  `manifests:check`; `check:command-coverage`, `check:port-dependencies`,
  `check:off-state-coverage`, `check:bundle-pairing`; `pnpm --filter backend exec vitest run
  test/contract/crm test/integration/crm test/integration/auth`; the module's own unit
  tests; the eight premises reported.

**Phase 25 as built** (research N-CAL15 has the premises and the reasons):

- T339 **stopped where it says to**: `ADMIN_BASE_URL` is declared by nobody new, there is no
  `module-environment-inputs/crm.ts`, and the e-mail carries the Opportunity's number and no
  link. The `opportunity.url` variable of `events-and-ports.md` §5a is not declared.
- T341: the audited state of an Event adds six keys (`eventId`, `eventName`, `allDay`,
  `startsAt`, `endsAt`, `remindAt`). Their `history.field.*` labels are in both bundles;
  **their membership in `src/admin/lib/history-fields.ts` is not** — that file is track F's —
  so `src/admin/index.test.ts` › *labels every audited state key* is red on this track until
  the join adds them (T380).
- T334: `opportunity-history-labels.test.ts` **did** need an edit — the reminder's bell kind
  and the sweep's three Commands match its scan — and has it.
- T333: the existing off-state test drives no worker's gate (premise 7), so the sweep's is
  proved by the tick the module registers, resolved from the container.
- Not seen red before their implementation, and said so: the migration test of T337, the
  worker's unit test of T345 and the pure demo test of T336; each was held by a mutation or
  by the integration test beside it instead.

## Phase 26: Track F — Admin UI

**Contract**: `contracts/admin-api.md` §12d (the shapes), `contracts/admin-surfaces.md` §1b
(the screens), §2, §3, §7. Fixtures in every test are typed by the contract's types.

### Tests first (each seen red for the stated reason)

- [x] T360 [P] [US22] `packages/modules/crm/src/admin/lib/calendar/date-math.test.ts` — the
  month grid (six rows of seven from Monday, for a month starting on a Monday, on a Sunday,
  and February of a leap year), the week of a date, the agenda's 30 days, the request range
  one day wider each side and never over 45 days, previous / next per view, the range
  title, the day key of an instant in local time across the two DST days, an all-day Event
  placed by `allDayDate` whatever the local zone.
- [x] T361 [P] [US22] `packages/modules/crm/src/admin/lib/calendar/layout.test.ts` — a
  day's timed entries: none overlapping (one lane each, full width); two overlapping (two
  lanes); a chain A–B–C where A and C do not meet (two lanes, C back in the first); six at
  once; a 15-minute entry at the minimum height; an entry past local midnight cut and
  flagged; top and height from start and length. The month cell: three shown and the rest
  counted, all-day first.
- [x] T362 [P] [US21] [US22] `src/admin/lib/calendar/calendar-address.test.ts` — `view`,
  `date`, `scope` read and written, malformed values falling back, the round trip; and
  `src/admin/pages/opportunity-detail/tabs.test.ts` — *Events* third with the id `events`,
  its count from `upcomingEventCount`, zero not shown (the existing order and "count on
  *Links* alone" assertions move, and say why — as N-DL6 did).
- [x] T363 [US22] `admin/test/modules/crm/EventCalendar.test.tsx` — month: a table with
  seven column headers, today marked in words, three entries and "+N more" that navigates
  to that day's week; week: seven sections each under a heading that counts its Events, an
  ordered list in time order, the all-day row first, the current-time line on today only
  and hidden from assistive technology; agenda: only days with Events; every entry a link
  with the complete accessible name; Tab order equal to time order; the toolbar (Today,
  Previous / Next named per view, *Go to date*, the view switch as a radio group); the four
  states in words; under 640 px (a `matchMedia` stub) the agenda whatever `view` says and
  no switch.
- [x] T364 [US22] `admin/test/modules/crm/CalendarPage.test.tsx` — the address read and
  written with `replace`; the request's `from` / `to` for each view; moving inside a loaded
  range asking nothing; *Mine / All* rendered from `meta.scopes` — a radio group for two,
  **absent** for one — and showing `meta.scope` as chosen; each entry's `href` to
  `?tab=events&event=`; no write control for a holder of `crm:write`.
- [x] T365 [US21] `admin/test/modules/crm/events-tab.test.tsx` — *Upcoming* and *Past*
  with their order; each reminder state in words; a reader with no *Add*, *Edit* or
  *Delete*; add, edit and delete, each re-reading the list and the Opportunity; the dialog:
  focus on the name, *All day* removing the times, *To* following *From*, *Remind at*
  appearing with the start, following it until edited and not after, 09:00 for all-day,
  the two client-side refusals under their fields, a 422 placed by `details.field`, the
  body sent (instants, `timeZone`, local midnights for all-day); `?event=` marking one row
  and ignoring an unknown id; the paused notice on a closed Opportunity; the tab's label
  with and without a count; the embedded calendar absent under 640 px.

### Implementation

- [x] T366 [P] [US21] [US22] `src/admin/calendar-api.ts` — the five typed calls, parsing
  answers with the contract's schemas.
- [x] T367 [P] [US22] `src/admin/lib/calendar/date-math.ts`, `layout.ts`,
  `calendar-address.ts` — T360 – T362 green.
- [x] T368 [US22] `src/admin/components/calendar/EventChip.tsx`, `MonthView.tsx`,
  `WeekView.tsx`, `AgendaView.tsx`, `EventCalendar.tsx`; the `calendar.*` keys in both
  bundles. T363 green.
- [x] T369 [US22] `src/admin/pages/CalendarPage.tsx`; the route and the sidebar row in
  `src/admin/index.ts`; the `open-crm-calendar` action in `src/manifest.ts` — in **this**
  change, with the route, never before; `nav.calendar.label` and
  `actions.openCrmCalendar.*`. T364 green; `check:action-route-permissions`; the module's
  `src/admin/index.test.ts` and `src/backend/manifest.test.ts` follow if they count routes,
  rows or actions.
- [x] T370 [US21] `src/admin/components/EventDialog.tsx`,
  `src/admin/pages/opportunity-detail/tabs/EventsTab.tsx`, the line in `tabs.ts`; the
  `events.*` keys and `opportunity.tabs.events`. T365 green.
- [x] T371 [US21] Existing screen tests that hold the tab order follow the structure
  (`admin/test/modules/crm/OpportunityDetail.test.tsx`); no assertion is dropped, and each
  change is listed with its reason in the pull request.
- [x] T372 [US21] [US22] The track's close: `pnpm --filter admin exec vitest run
  test/modules/crm`, the module's unit tests, `typecheck`, `lint`, `i18n:hardcoded`,
  `check:bundle-pairing`; the UX checklist of `.claude/skills/ux-laws/SKILL.md` §7 walked
  and reported item by item.

## Phase 27: Join

- [ ] T380 [US21] [US22] The two tracks on one branch: rebase over the three shared files,
  `bash scripts/setup-worktree.sh`, rebuild the packages, `composer:generate`,
  `manifests:generate`, `pnpm install --lockfile-only`; the Admin UI run against the real
  API — every fixture of Phase 26 that the real answers contradict is a contract defect and
  is fixed in the contract, the route and the screen together.
- [ ] T381 [US21] [US22] `packages/modules/crm/docs/crm.md` — two sections, *Events and
  reminders* and *The calendar* (what a reminder is and when it is and is not sent, what
  "online" means, how to edit or switch off the e-mail, what a Sales Rep's calendar shows,
  `ADMIN_BASE_URL`), and the lines of *Permissions*, *Switching it on and off*, *What the
  module does not do* and *Demo data* that change; the Polish page and the translation
  cache by `docs/docs/contributing/documentation-i18n.md`;
  `pnpm --filter backend run check:docs-translations`. `.changeset/crm-events-calendar.md`.
- [ ] T382 [US21] [US22] The `quality` job's set, run the way the job runs it — not the
  five checks a brief names: `typecheck`, `lint`, `check:naming`, `check:language`,
  `check:release-intent --since origin/master`, the OpenAPI check, the read-size bands
  (re-measured on a clean tree only if one refuses, after `check-estate.md` § *Measuring a
  read size*), and `pnpm --filter '!backend' run test`.
- [ ] T383 [US21] [US22] **Looked at in a browser** — and T310, still owed, with it: the
  Calendar in each view at desktop width and at 390 px, both themes; a week with six
  overlapping Events; a month day with "+N more"; a 15-minute Event; a long name; the
  dialog by keyboard alone; focus order by eye; an axe pass; one reminder end to end
  against a real mail catcher, in Polish and in English, with the Admin UI open and closed.
- [ ] T384 [US21] [US22] **An independent review of the tenant and delivery paths**, by an
  agent that did not write them: the Calendar's statement and its scope rule, the
  recipient's reach in the sweep, the claim. It mutates each (drop the reach predicate;
  drop the assignee test under `mine`; deliver before claiming) and confirms a test reds,
  then runs the whole `test/contract/crm` and `test/integration/crm` trees — a green pull
  request does not run them (`AGENTS.md`, D-198).
- [ ] T385 [US21] [US22] **The owner's nine questions** (OQ-1 – OQ-9) put to the owner with
  what reversing each default costs: OQ-5 one param; OQ-3 one branch; OQ-4 one scope value
  offered to confined callers; OQ-2 one condition; OQ-1 a change in `admin_notifications`
  and a second sweep stage; OQ-6 and OQ-7 the library decision of `plan.md`; OQ-8 a
  platform capability.

## Phase 28: What the independent review found (T384, 2026-10-08)

Research N-CALR1 … N-CALR9. Each repair had a failing test first.

- [x] T390 [US21] [US22] An instant of §12d stays inside the years the database holds:
  `0001-01-03` … `9999-12-30` (UTC), 400 outside — `packages/contracts/src/crm.ts`, the one
  contract change of the review (N-CALR4).
- [x] T391 [US21] The recipient of a reminder holds `crm:read` as well as reaching the
  Organization — `event-reminder-service.ts` (N-CALR1).
- [x] T392 [US21] A claim is read again before its turn and settled by its stamp: an Event
  deleted or a reminder removed or moved meanwhile is not delivered, and a delivered
  reminder never reads `interrupted` (N-CALR2, N-CALR3).
- [x] T393 [US21] A reminder says the Event's name on one line (N-CALR5).
- [x] T394 [US21] Test: the Events tab does not put an older list back when a slow read
  answers late — a surviving mutant (N-CALR8).
- [x] T395 [US21] A bell sentence longer than the bell stores is cut, so an Event with a
  long name gets its reminder — `crm-notifier.ts` (N-CALR6).
- [x] T396 [US21] Test: starting the reminder consumer installs its schedule and reaches the
  worker seam — a surviving mutant (N-CALR8).
- [x] T397 [US21] [US22] An all-day date before the year 1000 is `YYYY-MM-DD` —
  `domain/event-time.ts` (N-CALR4).
- [x] T398 [US21] [US22] This record: N-CALR1 … N-CALR9, the three sentences of
  `contracts/` and `data-model.md` the repairs made untrue, and the judgement on the
  `transactional_emails` edge (N-CALR7 — it stays).

### Not in these phases, by decision (`plan.md` § *Scope cut, on purpose*)

Events over several days and repeating Events; drag on the Calendar; creating an Event
from the Calendar; a day view and a mini month; references in an Event's description; a
"next event" fact or board-card field; Events in webhooks, import/export and analytics.

## Notes

- A task that says "model: `<file>`" means *read that file and follow its shape*, not *copy
  it*; the named file is the tree's current answer to the same problem.
- Verify a phase by its subject, not by a checkbox: the proof of US1 is the Order's status in
  the database after the walk, not T057 being ticked.
- Commit after each task or logical group; never leave a generated artefact stale across a
  commit boundary.
