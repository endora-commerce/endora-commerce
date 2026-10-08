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
sixteen later stories add one capability each and touch mostly disjoint files, so most can be
built in parallel worktrees. **One new runtime dependency, `@dnd-kit/core`**, by owner ruling
(2026-10-05, third round), carried by a reusable board primitive in `packages/admin-kit` and
justified in Complexity Tracking. The whole schema, every entity class and the Zod contracts
known at the outset land before the first story, which is what removes generated-file
collisions between parallel stories; one later story (US15) adds one migration and no entity.

**Amended 2026-10-05** for the owner's second and third rulings: three integrations first
deferred are in scope — custom fields on Opportunities (US15), outbound webhooks (US16), the
linked-Opportunity panel on the Order and Quote Request screens (US17) — and the board moves
from native drag-and-drop to `@dnd-kit`. Nothing tasked for Phases 1–3 changes.

**Amended 2026-10-08** with User Stories 21 and 22 — Events on an Opportunity, their
reminders, and a Calendar. Designed, not built; one new table, five routes, one sweep
worker, one screen and one tab, **no new runtime dependency**. Everything about them is in
§ *Events, reminders and the Calendar* below, which carries its own Constitution Check and
Complexity Tracking so that the sections written for the seventeen earlier stories stay as
they were built.

Decisions, with the alternatives rejected, are in [research.md](./research.md); the schema in
[data-model.md](./data-model.md); the interfaces in [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 through `@endora-commerce/admin-kit`, charts through the existing `<EChart>` wrapper (admin) — **one new runtime dependency: `@dnd-kit/core`**, see Complexity Tracking
`@dnd-kit` was *not* installed in this workspace when the design started (research M1). The
owner's third ruling of 2026-10-05 adds `@dnd-kit/core` for a reusable `KanbanBoard` primitive
in `packages/admin-kit`; the CRM module imports the primitive, never the library.
**Storage**: PostgreSQL — 13 tables and one sequence owned by `crm`, created by one init migration (plus one column added by US15), foreign keys to `organizations` and `sales_channels` only; one BullMQ queue (`crm-value-recalculation`) on Redis
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
7 admin pages, ~47 endpoints, 17 user stories; every file changed outside the module is listed
in `contracts/foreign-module-changes.md`.

## Constitution Check

*GATE: passed before Phase 0 research; re-checked after Phase 1 design — verdict at the end.*

| Principle | Verdict | How this design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | PASS | `crm` owns its entities, services, routes, migration, i18n, docs and tests. It reaches other modules only through published ports (`lazyPort<T>` with contract types) and EventBus events; no other module imports it. The one place owners change (US10) is an opaque `origin` pass-through that names no CRM concept. `contracts/foreign-module-changes.md` is the complete outside-the-module list and states what is left if the module is deleted. |
| **II. API-first** | PASS | `packages/contracts/src/crm.ts` is written in the Foundational phase, before any route; `contracts/admin-api.md` and `contracts/events-and-ports.md` are normative. Additive only — no existing API shape changes except two optional fields. |
| **III. TDD (NN)** | PASS | Every story in `tasks.md` opens with its failing tests (contract + integration, and admin interaction tests for screens); `quickstart.md` maps each story to the test that proves it; every FR traces to a test task (tasks.md § Requirement traceability). |
| **IV. YAGNI & minimal dependencies** | PASS with one justified dependency | **One new runtime dependency, `@dnd-kit/core`**, by owner ruling, with the written justification the principle requires in Complexity Tracking; `@dnd-kit/sortable` deliberately not added (nothing would use it). No graph cache, no rules engine, no rich-text editor, no materialised analytics, no currency conversion, no pipelines — each rejected in research with the reason. One queue, justified under X. |
| **V. TypeScript everywhere** | PASS | Strict TS; every request, query, event and queue payload parsed by a Zod schema whose inferred type is the only type. |
| **VI. Naming (NN)** | PASS with one note | Tables plural snake_case with the `crm_` prefix, columns snake_case, FKs `<singular>_id`, API camelCase, paths kebab-case. **Note**: the module id `crm` is an acronym, not a plural noun; the tree already carries `seo`, `pwa`, `mfa`, `cms`. T003 runs `check:naming` on the skeleton first and reports to the owner if it refuses. **As built**: it refused — none of those four passes by being an acronym — and the id, which is the owner's own (`spec.md` § Clarifications), was admitted by adding `crm` to the script's `allowed_proper_noun` list (research N-1; `contracts/foreign-module-changes.md` A8). |
| **VII. SEO & performance** | N/A | No storefront surface. Admin pages meet the targets above. |
| **VIII. English-only (NN)** | PASS | Source comments and the `/docs` page in English; the Polish docs copy is the translation workflow's, not authored prose. |
| **IX. UI reuse** | PASS with three justified new components | Reused from `@endora-commerce/admin-kit`: `PageHeader`, `ResponsiveTable`, `PaginationFooter`, `RouteTabs`, `Section`, `Badge`, `MultiSelect`, `Combobox`, `ColorPicker`, `StatusTransitionGraph`, `OrganizationPicker`, `CustomerPicker`, `AdminUserPicker`, `SalesChannelPicker`, `ProductPicker`, `AssetUploader`/`FileDropzone`, `EChart`. **Net-new in the design system**: `KanbanBoard` in `@endora-commerce/admin-kit/components` (no board/lane primitive exists — research R-20; promoted to the kit from the start because the owner wants it reusable), consumed by CRM's `OpportunityBoard`. **Net-new in the module**: `ReferenceTextarea` (no mention facility exists — R-21), `OpportunityHistory` (no per-record audit component exists — R-16). Each is written inside the module and named as a promotion candidate. |
| **X. Scalable queue consumers** | PASS | One queue-backed operation: recalculating every computed value after the counting configuration changes. The endpoint only enqueues; the consumer is a BullMQ `Worker` registered with `ctx.worker`, built only where `processRunsWorkers` is true, idempotent (recalculation is a pure function of current state). Low volume, co-located by default and separable without code change. Everything else is synchronous and not queue-backed by design (R-4). |
| **XI. Multi-tenant isolation (NN)** | PASS | **Decided explicitly**: `CrmOpportunity` is `@OrgScoped` on a non-null `organization_id` — the classification of the two comparable admin-side records about an Organization, `QuoteRequest` and `CreditLimit`. All seven child tables (this row first said eight — research N-7) are `@TransitivelyScoped('CrmOpportunity', 'opportunityId')`; five configuration tables are `@GlobalEntity`. Children are never loaded by id alone. Raw SQL takes `orgConstraintFor()`. Subscribers and the worker use `enterSystemScope` and constrain by `organizationId` (D-285); `withOrgScope` is not used. Cross-tenant tests in the Foundational phase and in every story that adds a read. No no-organization path exists. |
| **XII. Sales-channel scoping (NN)** | PASS | `sales_channel_id` is an admin-set attribution and a filter, not channel-scoped content: nothing storefront-facing reads it and no `sales_channel_*` bridge is touched (R-13). `null` means no channel. CRM contributes to `salesChannelAttributionRegistry` so the channel-delete guard sees it. The automatic-creation settings are read with the document's channel through `settingsReadPort`. |
| **XIII. Command Bus auditing (NN)** | PASS | Every write is a named Command through `CommandBus.run` (`data-model.md` § Audit actions); no hand-placed audit call. Actor from the ambient context. The history tab reads those entries, so it cannot disagree with the data. `computed_value` maintenance is a derived figure and uses `skipAudit` with a stated reason. `check:command-coverage` is in every story's verification. |
| **XIV. Entity-agnostic extensibility** | PASS | Opportunities become a custom-field host (US15, R-26) exactly as the principle prescribes: the value bag is a column on the host row, so it inherits the host's tenant scope; the host validates through `customFieldValueService` inside its own Command and audits its own write; the generic layer writes nothing into CRM's tables. The one change to the generic core — an optional `ownerModuleId` on the host registry entry, so a switched-off owner's type is not offered — is read for its presence only, never for which module it names (the rule `managedBy` already follows). `origin` (US10), the webhook event registry (US16) and the two new zones (US17) are the same shape: a host seam that names no contributor. |
| **XV. Untouched core & overlay** | PASS | A deployment customises CRM through an overlay module: `ctx.subscribe` on the templated events, a guard pushed into `opportunityTransitionGuardRegistry`, the two ports. Nothing deployment-specific is in the module. |
| **XVI. Command palette** | PASS | Four manifest `actions` (three when this was first written; analytics joined with US13) with the gating permission, labels in both bundles, each added by the story that ships its route (`contracts/admin-surfaces.md` §3). Tags and Workflow are sidebar-only on purpose: the principle asks for the landing surface plus the few highest-value actions and forbids enumerating every route, so `spec.md` FR-071's original "every screen" was amended to it, not the other way round. |
| **XVII. Operator-toggleable (NN)** | PASS | `activation: { settingCode: 'crm.enabled', default: true }`, not `nonDeactivatable`. Routes through `ctx.routes`, subscribers through `ctx.subscribe`, the worker through `ctx.worker`, published ports through `providePort`, the guard registry ungated with a stated absent-owner policy, boot hooks contribution-only. Admin surfaces resolve from the effective enabled-set; the "CRM" sidebar heading disappears with its last visible item. Off-state test with `expectModuleAbsent` in the Foundational phase, extended by each story that adds a subscriber. Switchable owners (`quote_requests`, `admin_notifications`) are `degrades-without` edges with operator-readable `whenAbsent` sentences, and `webhooks` is a `contributes-to` edge, so none of the three switches is deadened by CRM. The three later integrations each carry their own off-state proof: the `opportunity` host type is not offered by `custom_fields` while CRM is off (T153), CRM's events are not offered by `webhooks` (T163–T164), and the Order and Quote Request screens are identical without a contributor (T172). |

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
├── admin-contributions.ts               # + 'crm' nav section; + two detail zones   (US17)
├── custom-fields.ts                     # + 'opportunity' host type          (US15)
├── webhooks.ts                          # + WebhookEventRegistryPort         (US16)
├── common.ts                            # + OriginReferenceSchema            (US10)
├── orders.ts, quote-requests.ts         # + optional `origin`                (US10)

packages/admin-shell/src/components/AppShell.tsx      # + the `crm` section
packages/admin-kit/src/components/kanban/             # NEW — reusable KanbanBoard on @dnd-kit/core (US7)
packages/admin-kit/package.json, admin/package.json   # + @dnd-kit/core                        (US7)
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
    │   ├── <stamp>_crm_opportunity_custom_field_values.ts   # US15 — one column (as built)
    │   └── index.ts
    ├── backend/
    │   ├── index.ts                     # registerModule + `export const entities`; as built, ALL
    │   │                                # composition, one delimited section per area — there is
    │   │                                # no compose/ directory (Structure Decision 1, research N-6)
    │   ├── domain/                      # pure: opportunity-status-graph.ts, value-calculation.ts,
    │   │                                #       reference-tokens.ts, default-assignee.ts,
    │   │                                #       effective-value.ts (as built, research N-I2)
    │   ├── entities/                    # 13 *.entity.ts
    │   ├── events/                      # opportunity-status-events.ts
    │   ├── services/                    # one service per area
    │   ├── routes/                      # one routes.<area>.ts per area
    │   └── workers/value-recalculation-worker.ts
    │   └── demo/                        # rows.ts, seed.ts, reset.ts — the module's own demo rows: tags.
    │                                    # The pipeline is a step of packages/demo-composition (research N-DD1)
    └── admin/
        ├── index.ts                     # contributions: routes, nav, zones
        ├── api.ts                       # typed calls
        ├── pages/
        │   ├── OpportunitiesList.tsx  OpportunityCreatePage.tsx  OpportunityDetail.tsx
        │   ├── opportunity-detail/tabs.ts + tabs/*.tsx
        │   ├── WorkflowConfigPage.tsx  workflow/*.tsx
        │   ├── OpportunityBoardPage.tsx  TagsPage.tsx  AnalyticsPage.tsx
        ├── components/                  # StageBar (StatusControl until US20), LinkedDocuments, PropagationOutcomes,
        │                                # OpportunityBoard, ReferenceTextarea, OpportunityHistory, …
        └── zones/OrganizationOpportunities.tsx

packages/modules/orders/…                # US10 (§B) and one zone mount in OrderDetail.tsx (US17, §J)
packages/modules/quote_requests/…        # US10 (§C) and one zone mount in RfqDetail.tsx   (US17, §J)
packages/modules/custom_fields/…         # US15 — host registry entry + owner-presence filter (§H)
packages/modules/webhooks/…              # US16 — event registry, endpoint, page             (§I)

backend/test/contract/crm/               # endpoint × schema
backend/test/integration/crm/            # real DB, real orders/quote_requests
admin/test/modules/crm/                  # screen interaction tests
backend/src/db/*.generated.ts, admin/src/modules.generated.ts, docs/*generated*   # regenerated

.changeset/<name>.md                     # one per meaning
docs/i18n/pl/…                           # Polish copies of the docs pages touched
```

**Structure Decision**: one module package following the layout every module in
`packages/modules/` has. Two deliberate refinements serve parallel implementation:

1. **`backend/compose/<area>.ts` — NOT BUILT; the fallback this item names was taken.** T023
   proved the bracketed premise below false: `check:port-dependencies` derives a module's
   registered names and gated ports from the file exporting `registerModule` and from no
   other, so a `ctx.di.register` in a helper file reads as "registered by no module" and a
   `providePort` there would not read as a gated port at all — the fail-open direction
   (research N-6). The module therefore composes in **one** file,
   `packages/modules/crm/src/backend/index.ts`, with one commented section per area; a story
   adds a section, not a file. Services, routes, domain code and tests stay one file per
   area as planned. The original text is kept for the record:
   `backend/index.ts` stays a list of
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
stories rebase over these (as built `src/backend/index.ts` carries a whole section per
story rather than a line — Structure Decision 1); nothing generated is among them, because no story after the
Foundational phase adds an entity and only **one** (US15) adds a migration — so at most one
story regenerates the migration registry and no two collide on it. Since the second ruling,
`packages/contracts/src/crm.ts` is a shared hot file too (US15, US16, US17 each add exports).

## Implementation phases

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 1 · Setup | package skeleton, the `crm` nav section in the host, contracts file, generated artefacts, changeset | workspace installs, type-checks and builds with an empty module registered |
| 2 · Foundational | full schema + entities, manifest with activation and `crm:read`, workflow read endpoint, off-state / migration / tenant-isolation tests, docs skeleton | `off-state.test.ts` green — module is toggleable and absent when off |
| 3 · US1 (P1, MVP) | workflow configuration, Opportunity CRUD + list + detail, link an Order, forward mapping + propagation outcomes, transition events + guard registry | `workflow-walk.test.ts` green — the owner's success criterion |
| 4–10 · US2–US8 (P2) | reverse mapping · assignment · notes & messages · attachments · tags · board · quote requests & computed value | each story's test in `quickstart.md` |
| 11–16 · US9–US14 (P3) | automatic creation · create-from-Opportunity · history · references · analytics · platform cooperation & demo | same |
| 16A–16C · US15–US17 (P3) | custom fields · outbound webhooks · linked-Opportunity panel on Order and Quote Request | same |
| 17 · Polish | docs completion (EN + PL), full check sweep, read-size bands, release-intent | the `quality` job's set, locally |
| 24 · Contract (US21, US22) | the Zod schemas of `admin-api.md` §12d, the `auth` port method, the icon | contracts build; both tracks branch from this commit |
| 25 · Backend track | entity and migration, Events API, Calendar read, reminder sweep, bell, e-mail, `auth` presence, demo | `events.test.ts`, `event-reminders.test.ts` and the off-state cases green |
| 26 · Admin UI track | calendar model and component, Calendar page, Events tab and dialog, surfaces | the three screen tests green against the contract's types |
| 27 · Join | the two tracks together, docs EN + PL, the `quality` set, a browser, an independent review of the tenant path | the screens against the real API; reviewer's findings closed |

Dependencies between stories: everything needs Phases 1–2; US2–US14 need US1. US7 (board)
filters by tag and assignee and therefore *benefits* from US3 and US6 but is testable without
them (the filters are optional query parameters). US9's quote-conversion branch and US10's
quote half need US8's quote-request links. US14's demo data is best written last. US15 and
US16 need US1 only; US17's Order half needs US1 and its Quote Request half US8. Inside US7 the
admin-kit primitive (T148–T150) precedes CRM's board. No other ordering.

## Risks and how the plan contains them

| Risk | Containment |
| --- | --- |
| An unverified premise in `research.md` is executed as fact | each is tagged **[unverified]** and assigned to the first task that depends on it, which re-derives it by reading before writing |
| `order.created.v1` is emitted inside `placeOrder`'s transaction; a subscriber reading the Order may run before commit | follow the existing precedent exactly (`quote_requests/…/order-completion-reactor.ts` reads through `orderReadPort` in the same subscription); the US9 integration test places a real order through the API rather than emitting the event by hand, so the timing is measured, not assumed |
| The US10 change to `orders` / `quote_requests` regresses them | isolated in one story, behind optional fields; owners' own tests are written first; an off-state case proves identical behaviour with CRM off |
| Generated artefacts left stale | regenerate + `pnpm install --lockfile-only` are explicit tasks at the end of Phases 1, 2 and every story that changes imports; `composer:check`, `manifests:check`, `overlay:check` are in every verification |
| Adding ~80 files moves recorded read sizes | drift inside a band is left to the release pull request; only a refused band is re-measured, on a clean tree, after reading `check-estate.md` § *Measuring a read size* |
| A new enum member in `AdminNavSectionNameSchema` breaks a test that enumerates sections | T005 greps `admin/test` and `backend/test` for the section list before changing it |
| `@dnd-kit/core` misbehaves under React 19, or its new peer breaks `pnpm install --frozen-lockfile` for another consumer of admin-kit | the primitive's tests (T148) are written first and are the compatibility proof; T149 reads the install output for unmet peers and declares them in the same commit |
| A change to `custom_fields`, `webhooks` or the Order / Quote Request screens regresses its owner | each is one story, each opens with the owner's own test proving existing behaviour is unchanged (T153, T163, T172), and each is listed file by file in `contracts/foreign-module-changes.md` §H–§J |
| A new member of `supportedEntityTypeSchema` breaks an exhaustive switch or an enumerating test | T156 greps for every use of the enum before changing it and repairs them in the same change |

## Complexity Tracking

### The one new runtime dependency — `@dnd-kit/core` (Constitution IV)

| | |
| --- | --- |
| **What** | `@dnd-kit/core`, range `^6.3.1` — the latest stable on the public registry on 2026-10-05, **MIT**. Peers: `react >=16.8.0`, `react-dom >=16.8.0`, which admit the workspace's React 19. Brings `@dnd-kit/accessibility`, `@dnd-kit/utilities` and `tslib` transitively. **Nothing else from the family**: not `@dnd-kit/sortable` (`10.0.0`) — it orders items within a list and an Opportunity has no position inside its column. |
| **What problem** | The Opportunity board (FR-051) moves cards between lanes by dragging, on desktop, on touch devices and from the keyboard, with screen-reader announcements. |
| **Who decided** | The owner, 2026-10-05 (third round), reversing the native-drag default accepted earlier that day: *"I feel it may be useful not only in this module but in the future too."* |
| **Where it is declared** | `peerDependencies` and `devDependencies` of `packages/admin-kit/package.json`; `dependencies` of `admin/package.json` — the arrangement `echarts` already has in those two manifests. **Not** in `packages/modules/crm`: the module imports the `KanbanBoard` primitive from `@endora-commerce/admin-kit/components`, so the generator renders no `@dnd-kit` peer into `mod-crm` and a second consumer needs no second declaration. |
| **What was rejected** | *Native HTML5 drag-and-drop* (this plan's first answer, and the idiom of `useReorderList.ts`): no reliable touch support, no keyboard operation of the drag itself, hand-rolled announcements — and ruled out by the owner. *Declaring it in the CRM package*: a reusable capability would live in a detachable module. *`@dnd-kit/sortable` as well*: unused today. *Another library*: `react-beautiful-dnd` is unmaintained; the owner named this one. |
| **Cost accepted** | One more peer every application embedding `admin-kit` must provide (a breaking-in-spirit change for a consumer, released as a `minor` in `0.x` with a changeset that says so); bundle weight in the admin, paid only on the board route because the page is a lazy chunk **[unverified]** — T150 confirms the primitive is not pulled into the shell's entry chunk; a library to keep current. No backend, storefront or system-requirement impact, so the README owes nothing. |
| **What it does not buy** | A way around WCAG 2.2 SC 2.5.7: a keyboard-operable drag is not a single-pointer non-drag alternative, so each card keeps its "Move to…" menu (CRM's, in `renderCard`). |
| **`AGENTS.md`** | § Stack already says "`@dnd-kit` for drag-drop"; it was inaccurate until this lands and is accurate after. Not edited. |

### Other choices a reviewer is entitled to question

No constitutional violation needs justifying.

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| 13 tables in one module | each is one requirement of the owner's list (workflow ×2, mapping, counting, opportunities, links, history, propagation, tags ×2, comments, attachments, references) | merging any two loses a constraint the design relies on — e.g. the unique `(document_kind, document_id)` or the per-direction mapping uniqueness |
| The whole schema lands before the first story, with one exception | parallel stories would otherwise each regenerate `migrations-registry.generated.ts` and `entities-registry.generated.ts` and collide; US15's single column is the exception, added later because the story was brought into scope while Phase 2 was being implemented | per-story migrations are the textbook shape and cost a merge conflict in two generated files per pair of stories |
| A host change for navigation (files outside the module) | owner ruling, 2026-10-05: a "CRM" group of its own; sections are a closed host enum | placing entries under `sales` needs no host change and is what the owner ruled against |
| An `origin` pass-through in `orders` and `quote_requests` (US10) | the only way a created document reaches CRM deterministically and without a race against automatic creation | a guess-by-admin-and-organization "intent", or a client-side hand-back — both lose or mis-attribute links (research R-7) |
| A generic `ownerModuleId` on the custom-field host registry (US15) | without it "Opportunity" is offered for field definition while CRM is off — a Principle XVII leak | a manifest-contributed host registry is the better end state and a redesign of an enum that types the whole custom-fields API (research R-26) |
| A contribution seam in `webhooks` (US16) | the module has no way for an event to become subscribable except editing two hard-coded lists | appending CRM's event names to those lists makes `webhooks` name CRM and offer its events with CRM off (research R-27) |
| Two new admin zones (US17) | neither detail screen has a place another module can add a panel to | reusing `order.detail.payment` puts a sales panel in the payment tab; a new tab is heavier than a panel (research R-28) |
| A BullMQ queue for one operation | changing the counting configuration recalculates every computed Opportunity; Principle X forbids doing that inside the request | a synchronous loop is simpler and violates X's producer rule the day the pipeline is large |
| Net-new admin components | a board primitive (in admin-kit), a reference textarea, a per-record history list — none exists | composing existing primitives cannot express N lanes with moves between them, token insertion at a caret, or a before/after diff list |
| `crm_opportunity_status_history` beside the audit log | analytics need per-status intervals as rows | deriving intervals from JSON before/after pairs in `audit_log_entries` is slow and couples analytics to another table's shape |

## Events, reminders and the Calendar (User Stories 21 and 22) — designed 2026-10-08, not built

**Branch**: `feat/143-crm-calendar` (from `feat/143-crm-detail-layout`). **Spec**: User
Stories 21 and 22, FR-130 – FR-152, SC-013 – SC-015, open questions OQ-1 – OQ-9.
**Research**: N-CAL1 – N-CAL14. **Contracts**: `contracts/admin-api.md` §12d,
`contracts/admin-surfaces.md` §1b, `contracts/events-and-ports.md` §5a,
`contracts/foreign-module-changes.md` §CAL. **Tasks**: Phases 24 – 27.

### The design in one page

An **Event** is a row of one new table, `crm_opportunity_events`, hanging on an Opportunity
like a note does: transitively tenant-scoped through it, cascaded with it, written by three
Commands whose audit entries are the Opportunity's, so they are in its history tab with no
further code. An Event is one calendar day — a start and an end, or all day — and remembers
the time zone it was planned in. It may carry one reminder time.

**Nothing about a person is stored on an Event.** Whose calendar it is on, and who is
reminded, are both read from the Opportunity's current assignee at the moment of asking.
That one decision is what makes "changing the Sales Rep moves the entries" true with no
code, and makes it impossible for a calendar and an Opportunity to disagree.

**The Calendar is one bounded read**: Events overlapping at most 45 days, joined to their
Opportunity — which must be in an open status, within the caller's reach
(`orgConstraintFor()`), and, for a Sales Rep always and for anybody else on request,
assigned to the caller. The server decides which of *Mine* and *All* a caller is offered,
from the reach the platform already resolves; there is no new permission.

**Reminders are a sweep, not timers.** One BullMQ Job Scheduler ticks every 60 seconds and
its job carries nothing; the due reminders are read from the table, claimed with `for update
skip locked` before anything is sent, delivered, and their outcome recorded. So an edit is
an update, a delete is a delete, a Redis flush loses nothing, a closed Opportunity's
reminders simply stop matching and resume if it reopens, and no reminder can go out twice.
Delivery is the existing bell — always — plus a transactional e-mail in the recipient's
language when they have not been seen in the Admin UI for five minutes.

**The calendar UI is three plain renderings of one pure model** — a table for the month,
seven positioned lists for the week, a list for the agenda — over `Date` and
`Intl.DateTimeFormat`, with no library. The same component serves the Calendar page and the
Opportunity's *Events* tab. Every Event is a link.

### Scope cut, on purpose

Buildable in about a day per track because of what is **not** in it. Each is additive later
and none was asked for by the ten sentences:

| Cut | What is there instead |
| --- | --- |
| Events over several days; repeating Events | one day; two Events for a meeting over midnight |
| Drag to move or resize; click-a-slot to create | the Event's edit form, one press away |
| Creating an Event from the Calendar | *Add event* on the Opportunity's tab (OQ-7) |
| Day view; mini month navigator; "overdue / today" rail | Week, *Go to date*, Agenda |
| Entry kinds, colours, participants, location | one kind of Event; the description |
| `@` references in an Event's description | plain text |
| A per-user or platform time zone | the browser's zone; the Event's own zone in e-mail and bell (OQ-8) |
| "Next event" in the facts column and on the board card | the tab's count |
| Events in webhooks, import/export, analytics; ICS / Google sync | — |
| E-mail when the bell entry stays unread (attention, not presence) | e-mail when not seen for five minutes (OQ-1) |
| Reminder retry policy, per-user notification preferences | at most once; the operator can switch the e-mail off |

### Constitution Check — re-run for these two stories

| Principle | Verdict | How |
| --- | --- | --- |
| **I. Modular (NN)** | PASS | One entity, its migration, services, routes, worker, screens, i18n, docs and tests, all in `crm`. Other modules are reached through ports that exist (`adminNotificationRecordPort`, `adminUserReadPort`, `adminTenantScopePort`, `transactionalEmailSenderAccessor`, `emailDefaultsPort`, `authSessionReadPort`). Three changes outside the module, each generic and listed in `foreign-module-changes.md` §CAL: an icon name, an administrator's last-seen in `auth`, an environment-input ledger entry. Nothing imports `crm`. |
| **II. API-first** | PASS | `admin-api.md` §12d is written; its Zod schemas are Phase 24, before either track starts, and are the only thing the two tracks share. Additive: five routes and one member on `OpportunityDetail`. |
| **III. TDD (NN)** | PASS | Each track opens with its failing tests (T330 – T336; T360 – T365); every FR-130 – FR-152 maps to a test task in `tasks.md` § *Requirement traceability*. |
| **IV. YAGNI, dependencies** | PASS — **no new runtime dependency** | No calendar library, no date library, no time-zone library. Complexity Tracking below sets the no-dependency build beside the library it declines. No new Setting, permission, error code or event. |
| **V. TypeScript** | PASS | Strict; request, query and queue shapes are Zod-parsed. |
| **VI. Naming (NN)** | PASS | `crm_opportunity_events`, snake_case columns, `opportunity_id`; `/calendar/events`, `/opportunities/:id/events`; camelCase JSON. |
| **VII. SEO & performance** | N/A storefront; FR-151 bounds the one new heavy read. |
| **VIII. English (NN)** | PASS | The owner's Polish sentences are quoted in `spec.md` with a rendering, as earlier rulings are. |
| **IX. UI reuse** | PASS with one justified new component family | Reused: `PageHeader`, the module's `ModalDialog` and tab strip, native date and time inputs, the theme's tokens. **Net-new, in the module**: `EventCalendar` and its three views — no calendar or time-grid primitive exists in `packages/admin-kit/src/components/` (listed in N-CAL9). Module-private and a promotion candidate the day a second module wants a calendar; it takes plain entries and knows no CRM type, so promotion is a move. |
| **X. Queue consumers** | PASS | The sweep follows `orders/…/transition-effect-sweep-worker.ts`: a Job Scheduler as the clock, the table as the truth, `for update skip locked`, a `Worker` through `ctx.worker` built only where `processRunsWorkers` and `moduleQueueRedis` allow, idempotent by a claim taken before delivery. No timer in the API process. |
| **XI. Tenant isolation (NN)** | PASS | **Classified**: `CrmOpportunityEvent` is `@TransitivelyScoped('CrmOpportunity', 'opportunityId')`. Per-Opportunity paths load the parent through the scoped EntityManager first. The cross-Opportunity read joins the parent and carries `orgConstraintFor()` on its `organization_id` — there is no statement over the child without it. The sweep is a system scope that proves the *recipient's* reach before writing to their bell or mailbox. Cross-tenant cases in T331 – T333. No no-organization path: an Event cannot exist without an Opportunity. |
| **XII. Sales-channel scoping (NN)** | PASS | Nothing channel-scoped is read. The e-mail is sent with no channel — an administrator is not a channel's customer. |
| **XIII. Command Bus (NN)** | PASS | `crm.opportunity.event_add` / `.event_update` / `.event_remove`, audited on the Opportunity; the sweep's bookkeeping is a Command with `skipAudit` and its reason. `check:command-coverage` in the track's verification. |
| **XIV. Extensibility** | PASS | No custom fields on Events (not asked); nothing bespoke added to a generic layer. |
| **XV. Overlay** | PASS | Nothing deployment-specific. |
| **XVI. Palette** | PASS | One action, `open-crm-calendar`, added with its route; five actions in all, each a daily destination or the one screen behind a code of its own. |
| **XVII. Toggleable (NN)** | PASS | Routes in `ctx.routes`, the consumer in `ctx.worker`, the e-mail defaults from a contribution-only boot hook into an ungated registry that leaves out an absent contributor. With CRM off no reminder is delivered; back on, one up to 24 h late is delivered once. `admin_notifications` stays a `degrades-without` edge (bell off ⇒ e-mail regardless). The new hard edge, `transactional_emails`, names a module that cannot be switched off. Off-state cases in T333. |

**Docs sync**: two sections in `packages/modules/crm/docs/crm.md`, the Polish page and its
cache (T381). README: `ADMIN_BASE_URL` already exists as an input; nothing new to install.
**Performance & scale**: FR-151. **Infrastructure**: none.

**Constitution Check verdict for User Stories 21 and 22: PASS.** Two things a reviewer
should look at rather than take from this table: the departure from the "a bell entry names
no text" rule (OQ-5, N-CAL7), which is a product decision awaiting the owner; and §CAL-B,
the change in `auth`.

### Complexity Tracking — the calendar, with and without a library (Constitution IV)

The default answer is "no new dependency", and it is the answer given. The alternative is
written out because the owner asked for "a Google Calendar style" view and is entitled to
decide that a library is the faster road to it.

| | **A — built in the module (chosen)** | **B — a calendar library** |
| --- | --- | --- |
| What | `lib/calendar/date-math.ts`, `layout.ts` (pure, tested without a DOM) and four components: a `<table>`, seven positioned lists, a list, a toolbar | FullCalendar — `@fullcalendar/core`, `/react`, `/daygrid`, `/timegrid`, `/list` — the usual choice for month, week and list views; `react-big-calendar` is the other and needs a date library beside it. **[unverified]**: current versions, licences, React 19 peer ranges — nothing was installed or fetched for this design; to be established before choosing B |
| New runtime dependencies | **none** | five packages (six with `/interaction` for drag) in `admin`, or as peers of `admin-kit` if promoted as `@dnd-kit/core` was |
| Size, estimated | about 500 lines of module code and 400 of tests | on the order of 200 kB minified added to the Calendar's lazy chunk and to the *Events* tab's — **[unverified]**, to be measured before choosing B |
| Accessibility | ours to get right, and specified: real table, headings, links, time order (`admin-surfaces.md` §1b) | the library's markup; its time grid is positioned `div`s with its own focus model, to be audited against WCAG 2.2 AA and worked around where it falls short |
| Theming | the theme's tokens directly; the dark theme needs nothing | the library's own CSS variables mapped onto the tokens, and re-checked on each upgrade |
| What it buys that A lacks | — | drag to move and resize, multi-day bars, a day view, slot selection, recurrence display: **everything this plan cut** |
| What it costs later | each cut feature is ours to build if it is ever wanted; multi-day bars and drag are the two expensive ones | a dependency to keep current across React majors; behaviour we do not own in a screen people open daily |
| Fits "a day per track" | yes, because of the cuts | yes for the views; the accessibility audit and the theming are the unknown |

**Recommendation: A.** The ten sentences describe a calendar that is *read*: see the
Events, press one, land on the Opportunity. Every advantage of B is a feature that was cut
for not being asked for. If the owner answers OQ-6 or OQ-7 with "Events over several days"
or "drag them on the calendar", B becomes the right choice and the change is contained:
`EventCalendar`'s props are the boundary (`admin-surfaces.md` §1b), the page and the tab do
not change, and A's two pure files are deleted. **The owner decides; A is what Phases 24 –
27 build.**

Other choices a reviewer is entitled to question:

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A change in `auth` for a CRM feature (§CAL-B) | "e-mail if I am offline" needs to know whether an administrator is online, and nothing records it | CRM recording presence from its own routes sees only CRM's requests; "always e-mail" ignores the sentence; "e-mail if unread after N minutes" is a larger foreign change and is OQ-1 |
| A `time_zone` column on an Event | an all-day Event is a date, and an e-mail has no browser to localise a time | storing instants alone moves an all-day Event to the wrong day for a reader in another zone, and prints UTC in the e-mail |
| `reminder_handled_at` and `reminder_outcome` beside `remind_at` | at-most-once needs a claim recorded before delivery, and FR-141 needs to say what happened | a single "sent" flag set after delivery sends twice when the commit fails, and cannot tell "missed" from "nobody to remind" |
| A sweep every 60 s for a feature used a few times a day | it is the pattern the tree has, and the only one where edits, deletes, closing and reassignment need no queue bookkeeping | one delayed job per reminder — N-CAL5 lists what it loses |
| A second queue in the module | a different clock and a different payload from `crm-value-recalculation`; one queue with two job kinds would couple a periodic tick to a bulk recalculation's concurrency and retry settings | — |
| The reminder names the Event (OQ-5) | a reminder must say of what | the number-only sentence the other bell entries use |

### Source layout — what is added

```text
packages/contracts/src/crm.ts                      # + §12d schemas, upcomingEventCount   (Phase 24)
packages/contracts/src/auth.ts                     # + lastSeenByAdminUser               (Phase 24, §CAL-B1)
packages/contracts/src/admin-actions.ts            # + 'CalendarDays'                    (Phase 24, §CAL-A1)
packages/admin-kit/src/lib/admin-actions/icon-map.ts   #                                 (Phase 24, §CAL-A2)

packages/modules/crm/src/
├── manifest.ts                                    # B: transactionalEmails, dependencies, env · F: one action
├── migrations/<stamp>_crm_opportunity_events.ts   # B — scaffolded by migration:new
├── backend/                                       # ── backend track (B) ──
│   ├── index.ts                                   # + one section: Events, Calendar, reminders
│   ├── entities/crm-opportunity-event.entity.ts
│   ├── domain/event-time.ts (+ .test.ts)          # the day rule, allDayDate, `when`
│   ├── services/opportunity-event-service.ts      # the three Commands, the list
│   ├── services/calendar-service.ts               # the range read
│   ├── services/event-reminder-service.ts         # the sweep: claim, recipient, deliver, record
│   ├── services/event-reminder-email.ts           # the one send
│   ├── services/crm-notifier.ts                   # + one kind, two sentences, the link's query
│   ├── services/opportunity-service.ts            # + upcomingEventCount on the detail
│   ├── email-templates/event-reminder-defaults.ts # subject and body, en-US and pl-PL
│   ├── routes/routes.events.ts                    # the five routes
│   └── workers/event-reminder-worker.ts           # scheduler + consumer
└── admin/                                         # ── Admin UI track (F) ──
    ├── index.ts                                   # + route, + nav row
    ├── calendar-api.ts                            # typed calls (its own file, as analytics-api.ts)
    ├── lib/calendar/date-math.ts, layout.ts, calendar-address.ts (+ tests)
    ├── components/calendar/EventCalendar.tsx, MonthView.tsx, WeekView.tsx, AgendaView.tsx, EventChip.tsx
    ├── components/EventDialog.tsx
    ├── pages/CalendarPage.tsx
    └── pages/opportunity-detail/tabs.ts (+ one line), tabs/EventsTab.tsx

packages/modules/auth/src/backend/plugin.ts, services/session-port.ts     # B, §CAL-B
packages/demo-composition/src/sales-pipeline.ts                           # B, §CAL-D
backend/scripts/ledgers/module-environment-inputs/crm.ts                  # B, §CAL-C
backend/test/{contract,integration}/crm/…, admin/test/modules/crm/…       # B · F
```

**Files both tracks touch** — three, each by adding lines in a region of its own:
`src/manifest.ts` (B: `transactionalEmails`, `dependencies`, `env`; F: one `actions` entry),
`i18n/en.json` and `i18n/pl.json` (B: `notifications.*`, `auditLog.*`; F: `events.*`,
`calendar.*`, `nav.*`, `actions.*`, `opportunity.tabs.events`). `docs/crm.md` and the
changeset for `mod-crm` are written once, in Phase 27, by whoever joins the tracks.

### Risks

| Risk | Containment |
| --- | --- |
| The Calendar leaks an Event across tenants — the one read in the module that does not start from a parent | one statement, one predicate source (`orgConstraintFor()`), T332's cross-tenant and lost-reach cases written first; an independent review of exactly this path before the branch is called ready (T384) |
| A reminder is sent to somebody who may not see the Opportunity | the recipient's reach is established by `AdminReach` at send time, for the assignee and for the fallback creator alike; T333 |
| A reminder is sent twice, or reminders pile up after downtime | claim before delivery; 24 h limit; T333 runs two sweeps at once |
| Stamping `last_seen_at` on admin requests costs latency or load | fire-and-forget, throttled by an existing Redis marker to one row update per session per minute — the path customer requests already take |
| Time-zone arithmetic wrong around a DST change | the server only formats instants; the browser builds them; `event-time.test.ts` and `date-math.test.ts` each carry the two DST days of `Europe/Warsaw` |
| A hand-built calendar that looks unfinished | scope is three plain views; T383 is a look in a browser at both widths and both themes before "ready" — US20 was built blind and still owes that look (T310) |
| The two tracks drift from the contract | the schemas are the only shared code and land first; the Admin UI's fixtures are typed by them, so drift is a type error; Phase 27 runs the screens against the real API |
| An [unverified] premise is executed as fact | N-CAL14 lists the eight, each owned by a task that re-derives it first; two of them (T339, T322) say "stop and report" |

### Handoff — for `endora-commerce-dev`, two developers

- **Read first**: `contracts/admin-api.md` §12d (the contract), then your track's contract —
  backend: `data-model.md` § *`crm_opportunity_events`*, `contracts/events-and-ports.md`
  §5a, `foreign-module-changes.md` §CAL; Admin UI: `contracts/admin-surfaces.md` §1b and
  `.claude/skills/ux-laws/SKILL.md` §4 – §7. Then `research.md` N-CAL, at least N-CAL14.
- **Order**: Phase 24 lands first, as one commit, by either developer; both tracks branch
  from it. Phases 25 (backend) and 26 (Admin UI) run in parallel in separate worktrees.
  Phase 27 joins them.
- **Prior art**: backend — `orders/…/workers/transition-effect-sweep-worker.ts` (the
  sweep), `crm/…/services/opportunity-comment-service.ts` (a child of an Opportunity with
  Commands on the parent's audit object), `crm/…/services/analytics-service.ts` (a
  cross-Opportunity read under `orgConstraintFor()`), `shipments` (a declared transactional
  e-mail and its defaults), `returns/…/index.ts` (resolving the sender accessor),
  `auth/…/session-port.ts` (the method to twin). Admin UI — `tabs/LinksTab.tsx` and
  `tabs.ts` (a tab with a count), `components/ModalDialog.tsx`, `lib/board-fields.ts` (a
  screen's state in its address), `analytics-api.ts` (a typed API file of its own).
- **Never**: add a dependency (if the calendar seems to need one, stop — that is the
  owner's decision above); select from `crm_opportunity_events` without the parent; send
  before claiming; run `db:*` or `module:*`; touch a file outside the module that §CAL does
  not list.
- **Report**: the tests seen red and then green; the eight premises of N-CAL14 with what
  you found; anything §CAL did not foresee.
- **Open with the owner**: OQ-1 – OQ-9 (`spec.md` § *Clarifications*). Each has a default
  that is built; none blocks.

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
- **No owner question is open.** All three were decided on 2026-10-05 (quote requests
  degrade; a refused Order never undoes the Opportunity's move; the board is on `@dnd-kit`) —
  `spec.md` § Clarifications and `research.md`, last section.
- **Stories added on 2026-10-05** — US15 custom fields, US16 webhooks, US17 the panel on the
  Order and Quote Request screens — are Phases 16A–16C of `tasks.md`, ids T152–T179; the
  board's reusable primitive is T148–T151 inside US7. Their prior art: `quote_requests` as a
  custom-field host (`rfq-admin-service.ts`, `RfqDetail.tsx`); `audit_logs`'
  `auditReferenceRegistry` for the shape of a contribution registry; `organization.detail.after`
  for a detail-screen zone and `carts`' admin entry for contributing to one.
