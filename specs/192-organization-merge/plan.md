# Implementation Plan: Merging duplicate Organizations and duplicate Projects

**Branch**: `spec/1907-organization-merge` (design); implementation on `feat/1907-organization-merge-*`,
one branch per merge request | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md) |
**Ruling**: **D-299** (owner answers of 2026-11-25. The number is the next free one above D-298 and
the floor D-283, and must be re-checked against open pull requests before this design merges.)
**Input**: `specs/192-organization-merge/spec.md` (issue #1907).
**Companions**: [research.md](./research.md) (R-1 – R-22), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md), [tasks.md](./tasks.md).
**Built on (cite by slug)**:
- `specs/186-aggregate-ports/` (D-293): issues #1821 – #1829
- `specs/191-membership-join-requests/` (D-298): #1831, #1832
- `specs/176-command-hooks-outbox/` (D-289)
- `specs/188-policy-points/` (D-295)
- `specs/189-command-middleware/` (D-296)
- `specs/177-tax-id-scope/` (D-290)
- `specs/182-related-payers/`
- `specs/175-sales-rep-reach-rule/`
- `specs/187-side-table-extensions/` (D-294)

## Summary

A merge is an orchestration across owners, never one module writing another's tables. The work
splits three ways:

- **The platform** provides a generic merge mechanism ("merge points", research R-1):
  - a module that owns a mergeable record (a **host**: `organizations`, `projects`) declares it in
    its manifest;
  - every module whose records reference that host declares a **participation**, with its
    dispositions per entity property, and registers a participant;
  - a platform runner persists the merge and its steps (`record_merges`, `record_merge_steps`) and
    drives them phase by phase as a BullMQ job;
  - steps are retried, then *needs attention* with resume. Steps of modules that are off are
    *deferred* and run when the module is effectively present again (D-299);
  - the merging records are frozen through the tenant seams (R-6);
  - one analysis, run both as a static check (`check:merge-participation`) and at boot, refuses to
    start a merge while any present module holds an undeclared reference (R-9).
- **The host** owns the merge as a domain operation:
  - preview (read port), refusals (personal, tree, reach, in-flight), and the start / cancel / resume
    / finalize Commands (command port);
  - the field choice, the archived loser and its pointer, and the merged event and webhook;
  - its own records (roles, invitations, sales-rep assignments, allow-lists, children).
- **Every participant** moves its own records in bounded batches, each batch one audited Command of
  its own:
  - for the aggregates of D-293 (Order, QuoteRequest, Opportunity, Project, Product, Task,
    CustomerAccount membership) that Command is also published on the aggregate port, so server code
    can call it (R-4);
  - members move through 191's `membershipPort` in a new `merge` mode, exempt from the
    last-administrator refusal (contract `membership-merge-mode.md`).

**No new runtime dependency.** Migrations:

- one platform cross-cutting migration (the two merge tables and the merge lock table, plus an
  expression index on audit entries);
- one `organizations` migration (pointer columns and the tax-ID check relaxation);
- one `projects` migration (pointer columns).

Migrations are scaffolded with `migration:new`, never numbered by hand.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: Fastify, MikroORM (6 on `master` today; entity work follows #1866 →
7.2.11 per D-293.4, and `data-model.md` is idiom-neutral), Zod, BullMQ, ioredis, Meilisearch, all
existing. **No new dependency** (R-21).
**Storage**: PostgreSQL. Platform: `record_merges`, `record_merge_steps`, `record_merge_locks`.
`organizations`: `merged_into_organization_id`, `merged_at`, `merge_id`. `projects`: the same three
for projects.
**Testing**: Vitest. Tests are module-owned and co-located, plus `backend/test/{contract,integration}`
and the admin suites. A new test-kit helper `expectMergeParticipant` (conformance: idempotence,
batch bound, preview equals remaining, refusal when off), and `@endora-commerce/test-kit` `audit` and
`command-hooks`.
**Target Platform**: backend API and worker processes; admin SPA
**Project Type**: monorepo web platform (modules in `packages/modules/`, host in `packages/platform/`)
**Performance Goals**: SC-002. A loser with 10 000 orders and records in every participant merges
in ≤ 10 min. Each batch Command holds locks ≤ 5 s (batch size 500 by default, set per participant).
The freeze check adds no query to a request (in-process set, Redis pub/sub refresh, R-6).
**Constraints**:
- forward-only (D-299);
- no module writes another's table (Principle I);
- audit entries are never rewritten (FR-063);
- reads by a loser id resolve, and writes naming it are refused (OQ-6 assumption);
- a merge never runs outside a tenant context (system scope with a stated reason).
**Scale/Scope**:
- 29 modules plus the kernel hold Organization references (spec inventory), and three modules hold
  Project references;
- merges are rare (operator-driven) but individually large.

## Constitution Check

*Gate before Phase 0, re-checked after Phase 1. Both pass.*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | ✅ | Each owner moves its own rows with its own Commands (R-3). The host names no participant, and the platform composes them from manifests (R-1). `organizations` gains no dependency on any holder: holders already depend on `organizations` or reach it through the platform registry. |
| II API-first | ✅ | Every shape is in `packages/contracts/src/record-merge.ts` (platform types), `organizations.merge.ts` and `projects.merge.ts` first (MR-A/MR-B/MR-G). The changes to ports are additive. |
| III TDD (NN) | ✅ | `tasks.md` puts a failing test before every implementation task. The conformance helper is the failing test of every participant, and the FR → task map is in tasks § *Traceability*. |
| IV YAGNI / deps | ✅ | No new dependency and no new module. The merge mechanism lives in the platform only because two hosts need it today and both off-state and composition are platform concerns (R-1). No unmerge (D-299). No duplicate detection (spec Assumptions). |
| V TypeScript | ✅ | — |
| VI Naming (NN) | ✅ | Tables `record_merges`, `record_merge_steps`, `record_merge_locks`; columns `merged_into_organization_id`, `merged_at`, `merge_id`; actions `organization.merge.start` and so on; events `organization.merged.v1` and `project.merged.v1`; queue `platform.record-merge` (checked by `check:queue-names`). |
| VII SEO/perf | ✅ | No storefront page changes. An archived Organization never resolves for a storefront session (R-8). |
| VIII English (NN) | ✅ | Artefacts are in English. Polish appears only in bundles and translated docs. |
| IX UI reuse | ✅ | The merge flow uses the admin-kit dialog, stepper, table and badge primitives. The progress view reuses the job-progress pattern of import/export. |
| X Queues | ✅ | One BullMQ worker for the runner, plus a repeatable catch-up sweep for deferred steps (R-10), following the `quote_requests` sweep pattern. |
| XI Tenancy (NN) | ✅ | Steps run under `withSystemScope('record-merge:<id>')`. Every re-pointed row is written as the survivor's and passes the org write guard. A row is never left without an Organization: `kept` dispositions keep the loser's id, and the loser still exists, archived. Personal Organizations are refused (D-299). The merge tables are `@RuleScoped`, read only through the host's reach rule (R-15). |
| XII Channels (NN) | ✅ | Sales-channel memberships are unioned through `SalesChannelMembershipService` (the kernel's single mutator). There are no hand-rolled channel queries. |
| XIII Command Bus (NN) | ✅ | Start, cancel, resume and finalize are host Commands. Every participant batch is one Command of its owner. The member move is 191's Command. Each records the merge id in `stateAfter` (R-12). Undo is refused for every merge Command (`reversible: false`). |
| XIV Extensibility | ✅ | Custom-field values are chosen in the preview and written through the host's `setCustomFieldValues`. Deployment side tables (187) take part as participants. |
| XV Untouched core | ✅ | A deployment vetoes through a `beforeCommit` hook on `organization.merge.start`, reacts through the outbox, and contributes participations for its own tables. No edit of core is needed. |
| XVI Palette | ✅ | `merge-organizations`, `merge-projects` and `open-record-merges` actions, under the merge permissions and module state. |
| XVII Toggleable (NN) | ✅ | `organizations` is non-deactivatable. `projects` is deactivatable, and project merge is absent while it is off. A participant that is off is never called or shown, and its step is deferred, then caught up on activation without manual repair (D-299, R-10). |

**Verdict: PASS.** No violation to justify. Complexity Tracking records one placement decision
(the mechanism in the platform) for the record, though it is not a violation.

## Ruling D-299 (owner, 2026-11-25)

Answers to the first draft's blocking questions. Each took the recommendation.

1. **OQ-1:** any merge involving a personal (B2C) Organization is refused.
2. **OQ-2:** a forward-only resumable job (BullMQ, idempotent steps, *needs attention* and resume).
   It is cancellable only before records start moving, and there is no unmerge.
3. **OQ-3:** two roots, or two members of the same tree, and never the loser as an ancestor of the
   survivor. The loser's children move under the survivor.
4. **OQ-4:** modules that are off are skipped, and their part runs automatically when they are
   switched back on.

## Open items (assumptions the owner may still overturn)

These were not asked. The design implements the recommendation, and each item names the one place
that changes if it is overturned.

| # | Assumption | Changes only |
| --- | --- | --- |
| OQ-5 | Two deliveries: Organization merge first, Project merge (MR-G) after | MR order |
| OQ-6 | Writes naming the loser are refused with `ORGANIZATION_MERGED` / `PROJECT_MERGED` carrying the survivor's id, and are not redirected | the freeze/archive refusal (R-8) |
| OQ-7 | Only an in-flight placement or payment blocks the start | the `orders` participant's preview refusal |
| OQ-8 | The survivor's credit limit is kept and the exposure moves (may exceed it, with a warning) | the `credit_limits` participant |
| OQ-9 | API keys bound to the loser are re-pointed | the `api_keys` participant (revoke instead) |
| OQ-10 | External mappings: the survivor's wins, and the loser's is kept and listed | the `invoice_ledger` participant |
| OQ-11 | No merge-specific buyer notice | none (a template could be added later) |
| OQ-12 | Analytics events are re-pointed | the `analytics` participant (`kept` instead) |

## Project Structure

### Documentation (this feature)

```text
specs/192-organization-merge/
├── spec.md
├── plan.md                 # this file
├── research.md             # R-1 – R-22
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── merge-mechanism.md            # platform: hosts, participations, runner, phases, freeze, deferred
│   ├── merge-participant.md          # the per-module participant contract + conformance
│   ├── participant-dispositions.md   # every participant: records, disposition, Command, port, blocked-by
│   ├── organization-merge.md         # organizations: ports, admin API, refusals, permission, palette
│   ├── project-merge.md              # projects: the same for Project merge
│   ├── membership-merge-mode.md      # amendment to specs/191 membershipPort
│   ├── merge-participation-check.md  # check:merge-participation and its runtime twin
│   └── events-and-webhooks.md
├── checklists/requirements.md
└── tasks.md
```

### Source code (affected)

```text
packages/contracts/src/
├── record-merge.ts                    # NEW: host types, phases, states, dispositions, participant types, error codes
├── organizations.ts                   # + merge methods on OrganizationCommandPort / OrganizationDetailsPort, event, webhook types
├── organizations.merge.ts             # NEW: preview / start / record schemas, admin bodies
├── projects.ts / projects.merge.ts    # the same for projects (MR-G)
├── customer-accounts.membership.ts    # (191) + mode 'merge'
└── <owner>.ts                         # + reassign methods on aggregate ports (orders, quote-requests, crm, catalog, projects, tasks)

packages/platform/src/
├── kernel/merge/                      # NEW: manifest schema, registry/composition, runner, worker,
│   │                                  #      catch-up sweep, freeze set, completeness analysis
│   ├── record-merge.entity.ts / record-merge-step.entity.ts / record-merge-lock.entity.ts
│   └── ...
├── tenancy/org-write-guard.ts         # + frozen/archived organization refusal (R-6)
├── tenancy/resolve-tenant-context.ts  # + frozen/archived organization refusal for customer & API-key requests
└── migrations/                        # one cross-cutting migration (migration:new)

packages/modules/organizations/src/
├── manifest.ts                        # merge host + own participation + permission + palette + hookable action
├── backend/commands/merge-*.command.ts
├── backend/services/organization-merge-*.ts   # preview, refusals, field choice, structure/finalize steps
├── backend/routes.merge.ts
├── admin/merge/                       # flow, progress, attention list (MR-F)
├── migrations/                        # pointer columns, tax-ID check relaxation
├── i18n/{en,pl}.json
└── docs/                              # organization merge page (en + pl)

packages/modules/<participant>/src/
├── manifest.ts                        # participation declaration
└── backend/merge/<host>-merge-participant.ts (+ .test.ts) and backend/commands/<owner>-merge-reassign.command.ts

backend/scripts/check-merge-participation.ts
backend/scripts/ledgers/merge-participation-pending.ts   # seeded with every holder, empties by MR-E
packages/test-kit/src/merge/expect-merge-participant.ts
```

**Structure decision.** There is no new module. The mechanism goes in the platform kernel (R-1), the
host logic in `organizations` and `projects`, and each participation in its owner.

## Delivery and implementation order

Release: the first release after #1866 (MikroORM 7) for anything with an entity. Contracts and
pure logic may land earlier (the D-293.4 precedent).

| MR | Content | Blocked by | Can start |
| --- | --- | --- | --- |
| **MR-A** Framework | Contracts (`record-merge.ts`, error codes); platform merge mechanism: manifest schema, composition validation, registry, runner and worker, retry and *needs attention*, deferred catch-up (R-10), merge locks, freeze set with pub/sub (R-6), completeness analysis plus `check:merge-participation` with the pending ledger seeded with every holder; test-kit `expectMergeParticipant`; platform migration | #1866 for the entities and migration only | **Now** (contracts, registry, analysis, check). Entities after #1866 |
| **MR-B** Organizations host | Preview (read port), refusals, start/cancel/resume/finalize Commands, hookable `organization.merge.start`, field choice through existing Commands (`update`, `set_custom_field_values`, tax ID), children through `organization.move`, roles, invitations, sales-rep union, allow-lists, kernel sales-channel union, archive pointer, read resolution and write refusal, `organization.merged.v1` and its webhook type, permission, search removal | MR-A. **#1821** (`organizationCommandPort` widened) for the port methods: they are added to the same interface, so land after #1821 or rebase onto it. The route and Commands do not need it | **Now** (Commands, services, preview). The port methods after #1821 |
| **MR-C1** Participants, money and documents | `addresses`, `carts`, `invoices`, `invoice_ledger`, `credit_limits`, `related_payers`, `price_lists`, `promotions`, `returns` | MR-A (MR-B for an end-to-end test) | **Now**. None of these owns a D-293 aggregate |
| **MR-C2** Participants, the rest | `shopping_lists`, `comparisons`, `inventory`, `forms`, `newsletter`, `customer_notifications`, `pwa`, `quick_order`, `mfa`, `api_keys`, `webhooks`, `analytics`; `kept` declarations for `admin_users` and the kernel audit log | MR-A | **Now** |
| **MR-D1** `orders` | Reassign Command and participant (refuses while a placement or payment is in flight) | MR-A. **#1823** only for publishing `orderCommandPort.reassignOrganization` | Step **now**; port method after #1823 |
| **MR-D2** `quote_requests` | The same | MR-A. **#1824 / PR #1914 (in review)** for `quoteRequestCommandPort.reassignOrganization` | Step **now**; port method once PR #1914 merges |
| **MR-D3** `crm` | Opportunities (Organization), and references to a Project (used by MR-G) | MR-A. **#1827** for `opportunityCommandPort.reassignOrganization` | Step **now**; port method after #1827 |
| **MR-D4** `catalog` | Product and channel-scope allow-lists | MR-A. **#1825** for `productCommandPort.replaceAllowedOrganization` | Step **now**; port method after #1825 |
| **MR-D5** `projects` as an Organization holder | `project_organizations` union, `project_links.organization_id` | MR-A. **#1828** for `projectCommandPort.replaceOrganization` | Step **now**; port method after #1828 |
| **MR-E** Members | `customer_accounts` participant; `membershipPort` mode `merge` (the 191 amendment); join requests of the loser re-pointed if 191 WP-2 (#1832) is on `master` | MR-A, MR-B (role map). **#1831** (191 WP-1, `membershipPort`): hard. #1832: include its table only if merged first | **After #1831** |
| **MR-F** Admin flow and docs | Merge flow (picker, preview, choices, acknowledgement), progress, *needs attention* list, palette, en+pl i18n, module docs en+pl, changesets | MR-B | **Now**, in parallel with C/D/E |
| **MR-G** Project merge | `projects` host (preview, Commands, archive pointer, `project.merged.v1`), its own records, `tasks` participant (context move), `crm` reference participant, admin flow | MR-A, MR-F patterns. **#1828** (`projectCommandPort`), **#1829** (`taskCommandPort.moveContext`) | After #1828 and #1829 |

**What is not needed:** #1822 (CustomerAccount port: membership is the separate `membershipPort`,
D-293.2) and #1826 (Category: no Organization or Project reference).

**What ships usefully before every port exists:**

1. **MR-A + MR-B + MR-F give operators the merge preview.** It is a read-only duplicate assessment
   per pair (refusals, counts per participant, value differences, conflicts). The preview lists
   modules not yet supported. Starting is refused with `RECORD_MERGE_PARTICIPATION_INCOMPLETE` naming
   them, by the runtime twin of the check (R-9), so nothing can be stranded.
2. **Every participant step is built without waiting for its aggregate port.** The step runs the
   owner's own Command, and the port method that publishes the same Command is a small follow-up
   after each port issue lands (R-4).
3. **The start enables itself.** It opens when the last present holder declares its participation.
   In practice the long pole is MR-E (#1831), because every company has members.
4. **Server-side merge for integrations (US5)** comes with MR-B's port methods, after #1821.

## Test strategy (failing test first in every step)

- **Conformance**: `expectMergeParticipant` for every participant. It checks that:
  - preview counts equal the rows later moved;
  - a batch is bounded and moves only loser rows;
  - re-running after a mid-batch failure duplicates nothing (unions, sums);
  - zero is returned when done;
  - writes are refused for anything but the step's system scope while frozen;
  - the participant is never called when its module is off.
- **Completeness**: red proofs for `check:merge-participation` (an undeclared `organizationId`
  property, a declaration naming a missing property, a stale ledger entry), exit 2 on an empty
  population, and a read-size line. The runtime twin refuses the start naming the module.
- **Runner**: phase order; parallelism within `records`; retry then *needs attention*; resume
  continues without repeating done steps; cancel allowed before the first participant commit and
  refused after; a crash between batches resumes; two concurrent starts on overlapping records
  (exactly one wins, through `record_merge_locks`).
- **Deferred**: a participant off during the merge is recorded as `deferred`; switching it on runs
  the step through the pub/sub path and through the sweep with pub/sub lost.
- **Host**: every refusal of FR-020 – FR-027 is the same in preview and start, and writes nothing.
  Tree rules hold under both tax-ID scopes. Tax-ID take-over under `global` is one Command. A
  `beforeCommit` veto writes nothing. The archived loser is excluded from lists, pickers, search and
  storefront. Reads resolve and writes are refused with the survivor id.
- **Audit**: `expectNoAuditValues` sentinel on every merge Command (field choices as codes only).
  The merge id is present in every audit entry of a merge, and the expression index query lists
  them.
- **Integration**: a seeded Organization with records in every participant; merge; SC-001 query
  over every derived column returns zero; SC-002 timing at reference volume (perf suite).
- **Frontends**: flow states (loading, refusal, conflict, acknowledgement), progress, the attention
  list, the archived banner, pl labels, and palette coverage.

## Checks the merge requests must pass

The following must pass:

- builds and suites: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`,
  `pnpm --filter backend run test:unit:fast`, the targeted contract and integration files, and
  `pnpm --filter '!backend' run test`;
- port and boundary checks: `check:port-shape`, `check:port-dependencies`, `check:port-catches`,
  `check:module-boundary`, `check:kernel-boundary`, `check:platform-surface`;
- data and tenancy checks: `check:entity-tenant-classification`, `check:queue-names`,
  `check:shared-table-wipes`, `check:transaction-context`;
- off-state and permission checks: `check:off-state-coverage`, `check:action-route-permissions`;
- i18n, docs and naming: `check:error-translations`, `i18n:hardcoded`, `check:module-docs`,
  `check:docs-translations`, `check:naming`, `check:language`;
- **`check:merge-participation`** (new; registered in `check-inventory.test.ts` and the `endora
  check` estate per `specs/conventions/check-estate.md`);
- `check:release-intent` (additive port methods);
- `composer:check` and `manifests:check`.

Run `pnpm install --lockfile-only` after `manifests:generate`. The complete backend suite is
dispatched before the release (D-198).

## Risks

| Risk | Mitigation |
| --- | --- |
| A holder added after this feature forgets to participate | The check fails the MR, and the runtime twin refuses the start (R-9). The pending ledger can only shrink. |
| #1831 slips, so Organization merge cannot start | The preview still ships. Start opens automatically when MR-E lands. No interim member-move path is built on deprecated ports (R-5). |
| #1821 and MR-B edit the same interface | MR-B adds only new methods. It lands after #1821 or rebases. The Commands and routes do not depend on it. |
| A step's batch Command collides with a buyer write on the same row | The loser is frozen before any step (R-6). Survivor rows are written only by union inserts with on-conflict-do-nothing. |
| A straggler row is created for the loser through a seam the freeze does not cover (a `@RuleScoped` table written by an admin path) | Finalize re-runs every participant's preview. A non-zero count re-queues that step before archiving (R-6). After archive, the guard refuses writes. |
| Very large losers (analytics events) | Bounded batches per Command. The analytics step is the last of `records` and may run past finalize as a trailing step (R-16). |
| Reach widening (sales reps of the loser gain the survivor) | The preview lists the representatives added. The permission is not granted to sales reps by default (FR-050). |
| An operator merges the wrong pair | Preview, the explicit irreversible acknowledgement, and the permission. No unmerge (D-299) is stated in the UI and docs. |
| The ledger/derived-artefact trap (AGENTS.md) | Every MR re-runs `composer:generate`, `manifests:generate`, the module-removal ledger and the pending-participation ledger in the same MR. |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Merge mechanism in `@endora-commerce/platform` (`kernel/merge/`), not in `organizations` (not a constitution violation, recorded for review) | Two hosts now (Organization, Project) and more later. Activation catch-up and manifest composition are kernel concerns, and the completeness analysis must see every module's entities | An `organizations`-owned registry would be copied into `projects`, both would subscribe to activation separately, and `tasks`/`crm` would register into two different registries (R-1). |

No new runtime, dev or workspace dependency (R-21).

## Agent context

`.specify/scripts/bash/update-agent-context.sh` was **not** run, as instructed: it rewrites
`AGENTS.md`, and the plan declares no new technology. Run it in the first implementation MR if the
reviewer wants the *Recent Changes* line.

## Handoff to `endora-commerce-dev`

1. Start MR-A now. Contracts, the registry, the analysis and the check can land before #1866;
   entities and the migration follow #1866.
2. MR-B, MR-C1, MR-C2 and MR-D1 – MR-D5 (the steps) can run in parallel after MR-A's contracts.
   Publish each aggregate-port method only after its port issue merges (table above).
3. MR-E waits for #1831. MR-G waits for #1828 and #1829.
4. Read before writing:
   - `specs/conventions/module-composition.md` (ports, `lazyPort`, item 2a);
   - `module-activation.md` (deferred steps, off-state tests);
   - `audit-state.md` (merge id and field-choice codes only);
   - `module-migrations.md` (`migration:new`; the platform migration is cross-cutting);
   - `check-estate.md` (the new check's obligations);
   - `custom-field-writes.md` (custom-field choice through `setCustomFieldValues`);
   - `module-admin-surfaces.md` (permissions, palette);
   - `module-i18n.md`; `module-documentation.md`.
5. Precedents to copy, not import:
   - the command outbox drain worker (`packages/platform/src/commands/outbox/drain-worker.ts`) for
     the runner;
   - the address-book retirement merge pointer (`packages/modules/customers/src/backend/services/
     address-book-retirement-service.ts`: `mergedIntoAddressId`) for the archive pointer;
   - `SalesChannelMembershipService` for the union.
6. Never `git stash` in a shared worktree. Regenerate and commit generated artefacts in the same MR.
