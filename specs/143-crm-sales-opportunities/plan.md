# Implementation Plan: CRM — Sales Opportunities

**Branch**: `feat/143-crm` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/143-crm-sales-opportunities/spec.md`

## Summary

A new operator-toggleable domain module, `crm` (`@endora-commerce/mod-crm`,
`packages/modules/crm/`), owning Sales Opportunities and their configurable status workflow.

The workflow is modelled on the Order lifecycle — a statuses table, a transitions table, a
pure graph class, a transition service that refuses before it writes — and exposes "business
logic on X → Y" through the same two mechanisms orders has: templated EventBus events and a
veto-capable guard registry, the second one published as a real port this time. An
Opportunity transition moves its linked Orders through the published
`orderTransitionPort.applyStatus`, records every outcome the port returns, and never swallows
a refusal; the reverse direction listens to `order.status_changed.v1` with a one-hop rule that
makes loops impossible. Opportunities are `@OrgScoped`, every write is a Command, and the
change-history tab is the audit log read through the kernel's `AuditPort`.

The owner's success criterion is User Story 1 and is delivered as one vertical slice; the
thirteen later stories add one capability each and touch disjoint files, so most can be built
in parallel worktrees. **No new runtime dependency.** The whole schema, every entity class and
every Zod contract land before the first story, which is what removes generated-file
collisions between parallel stories.

Decisions, with the alternatives rejected, are in [research.md](./research.md); the schema in
[data-model.md](./data-model.md); the interfaces in [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 through `@endora-commerce/admin-kit`, charts through the existing `<EChart>` wrapper (admin) — **no new runtime dependency**
`@dnd-kit` is *not* installed in this workspace (research M1) and is not added; the board uses
native drag-and-drop plus a non-drag control.
**Storage**: PostgreSQL — 13 tables and one sequence owned by `crm`, created by one init migration, foreign keys to `organizations` and `sales_channels` only; one BullMQ queue (`crm-value-recalculation`) on Redis
No column or table of another module changes.
**Testing**: vitest. Unit tests co-located as `*.test.ts` under
`packages/modules/crm/src/`; contract and integration tests under
`backend/test/{contract,integration}/crm/`; admin tests under `admin/test/modules/crm/`.
Integration tests use the real database and the real `orders` / `quote_requests` modules
(Principle III).
**Target Platform**: the existing backend (API and `BACKEND_ROLE=worker` processes) and the
admin SPA. No storefront surface.
**Project Type**: a module package in the monorepo, with backend, migrations and admin layers.
**Performance Goals**: list and board first paint < 1 s at 500 open Opportunities (SC-006);
each analytics figure < 2 s at 1 000 Opportunities per month (SC-007); a transition with N
linked Orders costs N in-process port calls, N expected ≤ 10.
**Constraints**: tenant isolation by the global filter (XI); every write a Command (XIII);
absent on all surfaces when off (XVII); `orders` and `quote_requests` may not import `crm` and
must behave identically without it; English + Polish for every user-facing string.
**Scale/Scope**: hundreds of Opportunities per month (constitution § Performance & Scale);
7 admin pages, ~45 endpoints, 14 user stories; every file changed outside the module is listed
in `contracts/foreign-module-changes.md`.

## Constitution Check

*GATE: passed before Phase 0 research; re-checked after Phase 1 design — verdict at the end.*

| Principle | Verdict | How this design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | PASS | `crm` owns its entities, services, routes, migration, i18n, docs and tests. It reaches other modules only through published ports (`lazyPort<T>` with contract types) and EventBus events; no other module imports it. The one place owners change (US10) is an opaque `origin` pass-through that names no CRM concept. `contracts/foreign-module-changes.md` is the complete outside-the-module list and states what is left if the module is deleted. |
| **II. API-first** | PASS | `packages/contracts/src/crm.ts` is written in the Foundational phase, before any route; `contracts/admin-api.md` and `contracts/events-and-ports.md` are normative. Additive only — no existing API shape changes except two optional fields. |
| **III. TDD (NN)** | PASS | Every story in `tasks.md` opens with its failing tests (contract + integration, and admin interaction tests for screens); `quickstart.md` maps each story to the test that proves it; every FR traces to a test task (tasks.md § Requirement traceability). |
| **IV. YAGNI & minimal dependencies** | PASS | No new dependency. No graph cache, no rules engine, no rich-text editor, no materialised analytics, no currency conversion, no pipelines — each rejected in research with the reason. One queue, justified under X. |
| **V. TypeScript everywhere** | PASS | Strict TS; every request, query, event and queue payload parsed by a Zod schema whose inferred type is the only type. |
| **VI. Naming (NN)** | PASS with one note | Tables plural snake_case with the `crm_` prefix, columns snake_case, FKs `<singular>_id`, API camelCase, paths kebab-case. **Note**: the module id `crm` is an acronym, not a plural noun; the tree already carries `seo`, `pwa`, `mfa`, `cms`. T003 runs `check:naming` on the skeleton first and reports to the owner if it refuses. |
| **VII. SEO & performance** | N/A | No storefront surface. Admin pages meet the targets above. |
| **VIII. English-only (NN)** | PASS | Source comments and the `/docs` page in English; the Polish docs copy is the translation workflow's, not authored prose. |
| **IX. UI reuse** | PASS with three justified new components | Reused from `@endora-commerce/admin-kit`: `PageHeader`, `ResponsiveTable`, `PaginationFooter`, `RouteTabs`, `Section`, `Badge`, `MultiSelect`, `Combobox`, `ColorPicker`, `StatusTransitionGraph`, `OrganizationPicker`, `CustomerPicker`, `AdminUserPicker`, `SalesChannelPicker`, `ProductPicker`, `AssetUploader`/`FileDropzone`, `EChart`. **Net-new**: `OpportunityBoard` (no board/lane primitive exists — research R-20), `ReferenceTextarea` (no mention facility exists — R-21), `OpportunityHistory` (no per-record audit component exists — R-16). Each is written inside the module and named as a promotion candidate. |
| **X. Scalable queue consumers** | PASS | One queue-backed operation: recalculating every computed value after the counting configuration changes. The endpoint only enqueues; the consumer is a BullMQ `Worker` registered with `ctx.worker`, built only where `processRunsWorkers` is true, idempotent (recalculation is a pure function of current state). Low volume, co-located by default and separable without code change. Everything else is synchronous and not queue-backed by design (R-4). |
| **XI. Multi-tenant isolation (NN)** | PASS | **Decided explicitly**: `CrmOpportunity` is `@OrgScoped` on a non-null `organization_id` — the classification of the two comparable admin-side records about an Organization, `QuoteRequest` and `CreditLimit`. All eight child tables are `@TransitivelyScoped('CrmOpportunity', 'opportunityId')`; five configuration tables are `@GlobalEntity`. Children are never loaded by id alone. Raw SQL takes `orgConstraintFor()`. Subscribers and the worker use `enterSystemScope` and constrain by `organizationId` (D-285); `withOrgScope` is not used. Cross-tenant tests in the Foundational phase and in every story that adds a read. No no-organization path exists. |
| **XII. Sales-channel scoping (NN)** | PASS | `sales_channel_id` is an admin-set attribution and a filter, not channel-scoped content: nothing storefront-facing reads it and no `sales_channel_*` bridge is touched (R-13). `null` means no channel. CRM contributes to `salesChannelAttributionRegistry` so the channel-delete guard sees it. The automatic-creation settings are read with the document's channel through `settingsReadPort`. |
| **XIII. Command Bus auditing (NN)** | PASS | Every write is a named Command through `CommandBus.run` (`data-model.md` § Audit actions); no hand-placed audit call. Actor from the ambient context. The history tab reads those entries, so it cannot disagree with the data. `computed_value` maintenance is a derived figure and uses `skipAudit` with a stated reason. `check:command-coverage` is in every story's verification. |
| **XIV. Entity-agnostic extensibility** | PASS (integration deferred) | CRM adds no generic layer. Runtime custom fields on Opportunities are deferred with the reason (R-22): the host-type enum is closed in contracts and would leak a switched-off module's type. `origin` (US10) follows the principle's shape — an opaque reference the host stores nowhere and never reads for meaning. |
| **XV. Untouched core & overlay** | PASS | A deployment customises CRM through an overlay module: `ctx.subscribe` on the templated events, a guard pushed into `opportunityTransitionGuardRegistry`, the two ports. Nothing deployment-specific is in the module. |
| **XVI. Command palette** | PASS | Three manifest `actions` with the gating permission, labels in both bundles, each added by the story that ships its route (`contracts/admin-surfaces.md` §3). |
| **XVII. Operator-toggleable (NN)** | PASS | `activation: { settingCode: 'crm.enabled', default: true }`, not `nonDeactivatable`. Routes through `ctx.routes`, subscribers through `ctx.subscribe`, the worker through `ctx.worker`, published ports through `providePort`, the guard registry ungated with a stated absent-owner policy, boot hooks contribution-only. Admin surfaces resolve from the effective enabled-set; the "CRM" sidebar heading disappears with its last visible item. Off-state test with `expectModuleAbsent` in the Foundational phase, extended by each story that adds a subscriber. Switchable owners (`quote_requests`, `admin_notifications`) are `degrades-without` edges with operator-readable `whenAbsent` sentences, so neither switch is deadened by CRM. |

**Other gates**: *Docs sync* — `packages/modules/crm/docs/crm.md` in the Foundational phase,
grown per story, Polish copy in the same change; README unaffected (no new service, env var or
runtime). *Performance & scale* — no design element fails the stated targets. *Infrastructure*
— no new service; single-VPS posture unchanged.

**Post-design re-check (after Phase 1)**: no violation. Complexity Tracking carries
justifications for the choices a reviewer would question; none is a principle violation.

**Constitution Check verdict: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/143-crm-sales-opportunities/
├── spec.md
├── plan.md                              # this file
├── research.md                          # 25 decisions, 7 measured contradictions, 3 owner questions
├── data-model.md                        # 13 tables, classification, settings, audit actions
├── quickstart.md                        # how to prove each slice
├── contracts/
│   ├── admin-api.md                     # HTTP endpoints and schema names
│   ├── events-and-ports.md              # events, guard registry, published and consumed ports
│   ├── admin-surfaces.md                # routes, nav, palette, permissions, zones, off-state
│   └── foreign-module-changes.md        # every file outside packages/modules/crm
├── checklists/requirements.md
└── tasks.md                             # /speckit.tasks output
```

### Source Code (repository root)

```text
packages/contracts/src/
├── crm.ts                               # NEW — every CRM schema, port and event type
├── index.ts                             # + export
├── admin-contributions.ts               # + 'crm' nav section
├── common.ts                            # + OriginReferenceSchema            (US10)
├── orders.ts, quote-requests.ts         # + optional `origin`                (US10)

packages/admin-shell/src/components/AppShell.tsx      # + the `crm` section
packages/modules/_i18n/i18n/{en,pl}.json              # + appShell.section.crm

packages/modules/crm/                    # NEW — the module
├── package.json                         # rendered by manifests:generate
├── tsconfig.json, tsconfig.build.json, tsconfig.ui.json, vitest.config.ts, tailwind.css
├── README.md, LICENSE, CHANGELOG.md
├── i18n/en.json, i18n/pl.json           # flat maps, package root
├── docs/crm.md                          # package root
└── src/
    ├── manifest.ts
    ├── migrations/
    │   ├── <stamp>_crm_init.ts          # scaffolded by migration:new
    │   └── index.ts
    ├── backend/
    │   ├── index.ts                     # registerModule + `export const entities`
    │   ├── compose/                     # one register<Area>(ctx) per area — see below
    │   │   ├── workflow.ts  opportunities.ts  transitions.ts  links.ts
    │   │   ├── reverse-mapping.ts  assignment.ts  comments.ts  attachments.ts
    │   │   ├── tags.ts  board.ts  value.ts  auto-create.ts  history.ts
    │   │   └── references.ts  analytics.ts  ports.ts
    │   ├── domain/                      # pure: opportunity-status-graph.ts, value-calculation.ts,
    │   │                                #       reference-tokens.ts, default-assignee.ts
    │   ├── entities/                    # 13 *.entity.ts
    │   ├── events/                      # opportunity-status-events.ts
    │   ├── services/                    # one service per area
    │   ├── routes/                      # one routes.<area>.ts per area
    │   ├── workers/value-recalculation-worker.ts
    │   └── demo/                        # US14
    └── admin/
        ├── index.ts                     # contributions: routes, nav, zones
        ├── api.ts                       # typed calls
        ├── pages/
        │   ├── OpportunitiesList.tsx  OpportunityCreatePage.tsx  OpportunityDetail.tsx
        │   ├── opportunity-detail/tabs.ts + tabs/*.tsx
        │   ├── WorkflowConfigPage.tsx  workflow/*.tsx
        │   ├── OpportunityBoardPage.tsx  TagsPage.tsx  AnalyticsPage.tsx
        ├── components/                  # StatusControl, LinkedDocuments, PropagationOutcomes,
        │                                # OpportunityBoard, ReferenceTextarea, OpportunityHistory, …
        └── zones/OrganizationOpportunities.tsx

packages/modules/orders/…                # US10 only — contracts/foreign-module-changes.md §B
packages/modules/quote_requests/…        # US10 only — §C

backend/test/contract/crm/               # endpoint × schema
backend/test/integration/crm/            # real DB, real orders/quote_requests
admin/test/modules/crm/                  # screen interaction tests
backend/src/db/*.generated.ts, admin/src/modules.generated.ts, docs/*generated*   # regenerated

.changeset/<name>.md                     # one per meaning
docs/i18n/pl/…                           # Polish copies of the docs pages touched
```

**Structure Decision**: one module package following the layout every module in
`packages/modules/` has. Two deliberate refinements serve parallel implementation:

1. **`backend/compose/<area>.ts`.** `backend/index.ts` stays a list of
   `register<Area>(ctx)` calls; each area file registers its own services, routes,
   subscribers and boot hooks through the same `ModuleContext`. A story adds one file and one
   line. (Registration must still happen from `registerModule`'s call tree — a subscription
   registered from a plugin body is what `check:subscribe-seam` refuses; a function called
   synchronously from `registerModule` with `ctx` is the composition itself. **[unverified]**
   that `check:subscribe-seam`, `check:port-dependencies` and `check:container-imports` follow
   a `ctx` passed into a helper in another file — T023 proves it on the first area file and
   falls back to one `index.ts` if any of them does not.)
2. **Data-driven tabs and area-prefixed i18n keys** (`contracts/admin-surfaces.md` §1, §7).

**Shared hot files** — the only places two stories edit the same file, always by adding a
line: `src/backend/index.ts`, `src/manifest.ts`, `src/admin/index.ts`,
`src/admin/pages/opportunity-detail/tabs.ts`, `src/admin/api.ts`, `i18n/en.json`,
`i18n/pl.json`, `docs/crm.md`, `backend/test/integration/crm/off-state.test.ts`. Parallel
stories rebase over these; nothing generated is among them, because no story after the
Foundational phase adds a migration or an entity.

## Implementation phases

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 1 · Setup | package skeleton, the `crm` nav section in the host, contracts file, generated artefacts, changeset | workspace installs, type-checks and builds with an empty module registered |
| 2 · Foundational | full schema + entities, manifest with activation and `crm:read`, workflow read endpoint, off-state / migration / tenant-isolation tests, docs skeleton | `off-state.test.ts` green — module is toggleable and absent when off |
| 3 · US1 (P1, MVP) | workflow configuration, Opportunity CRUD + list + detail, link an Order, forward mapping + propagation outcomes, transition events + guard registry | `workflow-walk.test.ts` green — the owner's success criterion |
| 4–10 · US2–US8 (P2) | reverse mapping · assignment · notes & messages · attachments · tags · board · quote requests & computed value | each story's test in `quickstart.md` |
| 11–16 · US9–US14 (P3) | automatic creation · create-from-Opportunity · history · references · analytics · platform cooperation & demo | same |
| 17 · Polish | docs completion (EN + PL), full check sweep, read-size bands, release-intent | the `quality` job's set, locally |

Dependencies between stories: everything needs Phases 1–2; US2–US14 need US1. US7 (board)
filters by tag and assignee and therefore *benefits* from US3 and US6 but is testable without
them (the filters are optional query parameters). US9's quote-conversion branch and US10's
quote half need US8's quote-request links. US14's demo data is best written last. No other
ordering.

## Risks and how the plan contains them

| Risk | Containment |
| --- | --- |
| An unverified premise in `research.md` is executed as fact | each is tagged **[unverified]** and assigned to the first task that depends on it, which re-derives it by reading before writing |
| `order.created.v1` is emitted inside `placeOrder`'s transaction; a subscriber reading the Order may run before commit | follow the existing precedent exactly (`quote_requests/…/order-completion-reactor.ts` reads through `orderReadPort` in the same subscription); the US9 integration test places a real order through the API rather than emitting the event by hand, so the timing is measured, not assumed |
| The US10 change to `orders` / `quote_requests` regresses them | isolated in one story, behind optional fields; owners' own tests are written first; an off-state case proves identical behaviour with CRM off |
| Generated artefacts left stale | regenerate + `pnpm install --lockfile-only` are explicit tasks at the end of Phases 1, 2 and every story that changes imports; `composer:check`, `manifests:check`, `overlay:check` are in every verification |
| Adding ~80 files moves recorded read sizes | drift inside a band is left to the release pull request; only a refused band is re-measured, on a clean tree, after reading `check-estate.md` § *Measuring a read size* |
| A new enum member in `AdminNavSectionNameSchema` breaks a test that enumerates sections | T005 greps `admin/test` and `backend/test` for the section list before changing it |
| The board's native drag-and-drop is poor on touch | the "Move to…" menu is a complete alternative and is the tested path; owner question Q3 covers adding a library |

## Complexity Tracking

No constitutional violation needs justifying. The entries below record choices a reviewer is
entitled to question.

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| **No new runtime dependency** (stated because the brief assumed one was present) | `@dnd-kit` is not in any `package.json` of this workspace; the board is built on native drag-and-drop | adding `@dnd-kit/core` + `sortable` would be a new peer the generator renders into `mod-crm` for every consumer, to buy touch polish the mandatory non-drag control already makes optional |
| 13 tables in one module | each is one requirement of the owner's list (workflow ×2, mapping, counting, opportunities, links, history, propagation, tags ×2, comments, attachments, references) | merging any two loses a constraint the design relies on — e.g. the unique `(document_kind, document_id)` or the per-direction mapping uniqueness |
| The whole schema lands before the first story | parallel stories would otherwise each regenerate `migrations-registry.generated.ts` and `entities-registry.generated.ts` and collide | per-story migrations are the textbook shape and cost a merge conflict in two generated files per pair of stories |
| A host change for navigation (files outside the module) | owner ruling, 2026-10-05: a "CRM" group of its own; sections are a closed host enum | placing entries under `sales` needs no host change and is what the owner ruled against |
| An `origin` pass-through in `orders` and `quote_requests` (US10) | the only way a created document reaches CRM deterministically and without a race against automatic creation | a guess-by-admin-and-organization "intent", or a client-side hand-back — both lose or mis-attribute links (research R-7) |
| A BullMQ queue for one operation | changing the counting configuration recalculates every computed Opportunity; Principle X forbids doing that inside the request | a synchronous loop is simpler and violates X's producer rule the day the pipeline is large |
| Three net-new admin components | board, reference textarea, per-record history — none exists in admin-kit | composing existing primitives cannot express N lanes with moves between them, token insertion at a caret, or a before/after diff list |
| `crm_opportunity_status_history` beside the audit log | analytics need per-status intervals as rows | deriving intervals from JSON before/after pairs in `audit_log_entries` is slow and couples analytics to another table's shape |

## Handoff summary for `endora-commerce-dev`

- **Read first**: `AGENTS.md`, then `specs/conventions/module-composition.md`,
  `module-activation.md`, `module-migrations.md`, `module-admin-surfaces.md`,
  `module-i18n.md`, `module-documentation.md`, `release-intent.md`; then this directory's
  `research.md` § 0 (what the tree actually holds) and `contracts/`.
- **Closest prior art to copy from**: `packages/modules/orders/` for the workflow
  (`services/order-status-graph-service.ts`, `order-transition-service.ts`,
  `order-transition-port.ts`, `events/order-status-events.ts`, `domain/order-status-graph.ts`,
  `admin/pages/OrderStatusConfigPage.tsx`); `packages/modules/quote_requests/` for an
  `@OrgScoped` admin-side record, its manifest and its off-state test
  (`backend/test/integration/quote_requests/off-state.test.ts`); `packages/modules/blog/` for
  a compact `registerModule` with the boot-hook split and an asset-reference contribution;
  `packages/modules/returns/` for the attachment link pattern.
- **Implement story by story, tests first**, in the order of `tasks.md`. Phases 1 and 2 are
  sequential; US1 is the MVP and is one pull request; US2–US14 are one each and may run in
  parallel worktrees — the task file marks which, and names the shared hot files.
- **Every premise tagged [unverified] is yours to re-derive**, at the task that names it. Do
  not carry one into code on this document's word.
- **Never**: import `@endora-commerce/mod-crm` from another module; pick a migration number;
  edit a generated file; wrap a port call in a bare `catch`; resolve a port into a singleton;
  call `eventBus.on` or build a `Worker` outside `ctx.worker`; run `db:fresh`, `db:reset`,
  `setup` or `module:*` unprefixed; add a `Co-Authored-By` or any AI trailer (a
  `Signed-off-by` for the DCO gate is required and is not one).
- **Report** for each story: the targeted tests with their output, the checks in
  `quickstart.md` § *Before calling any story done*, and any file you had to touch that is not
  in `contracts/foreign-module-changes.md`.
- **Open owner questions** (defaults applied, none blocking): Q1 quote requests binding vs
  degrading, Q2 refusal semantics, Q3 drag library — `research.md`, last section.
