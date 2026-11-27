# Tasks: Merging duplicate Organizations and duplicate Projects

**Input**: `specs/192-organization-merge/`: plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md. **Ruling**: D-299 (OQ-1 – OQ-4 as recommended). OQ-5 – OQ-12 are
assumptions, listed in plan § *Open items*.
**Tests**: required (Principle III, NN). In every phase the test tasks come first and must fail
before the implementation tasks they cover.
**Preconditions**: entity and migration tasks wait for #1866 (MikroORM 7.2.11). Per-task blockers
are tagged **⛔ #nnnn**. A task without a tag can start once its phase's predecessors are done.

## Format: `[ID] [P?] [Story] Description`

- **[P]** parallelisable (different files, no dependency on an unfinished task)
- **[USn]** the user story of `spec.md`. Setup, Foundational, Participant and Polish tasks carry
  none.
- **⛔** blocked by the named issue or PR, which is not yet on `master` (2026-11-25)
- Paths are repository-relative

---

## Stage 1 status (2026-11-25)

Phases 1 – 3 are implemented on `feat/1907-organization-merge`. What differs from the text below is
recorded in the contracts it changes (`organization-merge.md` §2 and §4, `merge-mechanism.md` §1,
§3 and §5, `merge-participation-check.md` §1 and §3, `participant-dispositions.md` §A,
`data-model.md` §1.1 and §6, `research.md` R-14a). Where a task's file name differs from the one
written here: T005's schema test is `packages/contracts/src/record-merge.test.ts` (the manifest
schema is in `@endora-commerce/contracts`), T016 and T031 are DB-backed in
`backend/test/integration/organizations/organization-merge.test.ts`, T017's tenant-resolution half
is `packages/platform/src/tenancy/merge-freeze.test.ts`, and T026 – T030 are
`packages/modules/organizations/src/backend/merge/organization-merge-rules.test.ts` (pure host rules)
plus the same integration file. Until the participants of Phases 4 – 6 land, a start is refused with
`409 RECORD_MERGE_PARTICIPATION_INCOMPLETE` by the runtime twin; the preview works.

## Phase 1: Setup

- [x] T001 (Stage 1, owner decision 2026-11-25: the whole feature is **one** pull request on `feat/1907-organization-merge` in `../wt-1907`; the MR letters below are ordering only) Create one implementation branch per MR from `origin/master` in its own worktree (`git worktree add ../wt-1907-<mr> -b feat/1907-<mr> origin/master`, `bash ../wt-1907-<mr>/scripts/setup-worktree.sh`), then run `pnpm run build:packages`
- [x] T002 [P] Read `specs/conventions/module-composition.md`, `module-activation.md`, `audit-state.md`, `module-migrations.md`, `check-estate.md`, `custom-field-writes.md`, `module-admin-surfaces.md`, `module-i18n.md`, and `specs/186-aggregate-ports/contracts/aggregate-port-convention.md`. Record in the MR description which of #1821 – #1829, #1831 and PR #1914 are merged

## Phase 2: Foundational, MR-A (framework; blocks everything)

### Contracts: tests first

- [x] T003 [P] Failing schema tests for host types, phases, states, dispositions, `RecordMergePreview`, `RecordMergeRecord`, `MergeStepInput` and `MergeParticipantPreview` in `packages/contracts/src/record-merge.test.ts`
- [x] T004 [P] Failing test that every error code of data-model §6 exists with en + pl messages, in `packages/contracts/src/record-merge.errors.test.ts`
- [x] T005 [P] Failing test for the manifest `merge` schema (hosts and participates, polymorphic references) in `packages/platform/src/kernel/merge/manifest-schema.test.ts`

### Contracts: implementation

- [x] T006 Implement `packages/contracts/src/record-merge.ts` and the error codes (T003, T004)
- [x] T007 Add the `merge` field to the platform manifest schema (T005)

### Completeness analysis and the static check: tests first

- [x] T008 [P] Failing red/green fixture tests for every finding of `contracts/merge-participation-check.md` §2, plus exit 2 and the read-size line, in `backend/test/unit/scripts/check-merge-participation.test.ts`
- [x] T009 [P] Failing test for the runtime twin (uncovered references per present module, off modules excluded) in `packages/platform/src/kernel/merge/completeness.test.ts`

### Completeness: implementation

- [x] T010 Implement the shared analysis in `packages/platform/src/kernel/merge/completeness.ts` (T009)
- [x] T011 Implement `backend/scripts/check-merge-participation.ts` and the `package` verdict in `packages/cli/src/check/estate.ts`. Register it in `check-inventory.test.ts`, the `quality` / `quality:static` blocks and `backend/package.json` (T008)
- [x] T012 Seed `backend/scripts/ledgers/merge-participation-pending.ts` with every reference of `contracts/participant-dispositions.md` §A. Each entry names the MR that removes it and its blocking issue

### Registry, runner, freeze: tests first

- [x] T013 [P] Failing composition tests (`contracts/merge-mechanism.md` §1 refusals; `ctx.merge.participate` / `ctx.merge.host`) in `packages/platform/src/kernel/merge/composition.test.ts`
- [x] T014 [P] Failing runner tests: phase order, parallelism within a phase, retry → `needs_attention`, resume skips done steps, cancel window, finalize residue sweep, trailing steps. In `packages/platform/src/kernel/merge/runner.test.ts`
- [x] T015 [P] Failing deferred and catch-up tests (pub/sub path and sweep path) in `packages/platform/src/kernel/merge/catch-up.test.ts`
- [x] T016 [P] Failing race test (two starts over overlapping ids → exactly one) in `packages/platform/src/kernel/merge/locks.test.ts`
- [x] T017 [P] Failing freeze/archive tests in `packages/platform/src/tenancy/org-write-guard.merge.test.ts` and `packages/platform/src/tenancy/resolve-tenant-context.merge.test.ts`
- [x] T018 [P] Failing tests for the conformance helper itself (it fails on a non-idempotent double participant, an over-sized batch, an event dispatched) in `packages/test-kit/src/merge/expect-merge-participant.test.ts`

### Registry, runner, freeze: implementation

- [x] T019 Composition and registry in `packages/platform/src/kernel/merge/registry.ts`, plus `ctx.merge` on the module context (T013)
- [x] T020 (written in MikroORM 6 style, ahead of #1866 by owner decision; rebased with the ORM 7 freeze) ⛔ #1866: Entities `record-merge.entity.ts`, `record-merge-step.entity.ts`, `record-merge-lock.entity.ts` (`@RuleScoped`), and the platform cross-cutting migration including the audit expression index (data-model §1). Use `migration:new`, then `composer:generate`
- [x] T021 `RecordMergeService` (begin, cancel, resume, get, list, preview aggregation) in `packages/platform/src/kernel/merge/record-merge-service.ts` (T014, T016, T020)
- [x] T022 Runner worker on queue `platform.record-merge` and catch-up repeatable job, through the platform worker seam (T014, T015)
- [x] T023 Frozen and archived sets, the `b2b:record-merge:changed` channel and the 5-min reload. Wire them into `org-write-guard.ts` and `resolve-tenant-context.ts` (T017)
- [x] T024 `expectMergeParticipant` in `packages/test-kit/src/merge/expect-merge-participant.ts` (T018)
- [x] T025 Kernel `kept` declaration for `AuditLogEntry` (merge participation with no participant step) and the ledger update

**Checkpoint MR-A**: no user-visible change. `check:merge-participation` is green with the pending
ledger.

## Phase 3: US1 + US2 + US3 host, MR-B (`organizations`)

### Tests first

- [x] T026 [P] [US2] Failing preview refusal tests, each FR-020 – FR-027 refusal under both tax-ID scopes (D-299 tree and personal rules), in `packages/modules/organizations/src/backend/services/organization-merge-preview.test.ts`
- [x] T027 [P] [US1] Failing tests for `organization.merge.start` (re-checks the preview, acknowledgement required, hook veto writes nothing, audit sentinel with field-choice codes only) in `packages/modules/organizations/src/backend/commands/merge-start.command.test.ts`
- [x] T028 [P] [US1] Failing structure-step tests (children through `organization.move`, role map by name or copy into `host_context`, invitations re-pointed with mapped role, sales-rep union, sales-channel union through `SalesChannelMembershipService`), with the conformance helper, in `.../services/organization-merge-structure.test.ts`
- [x] T029 [P] [US1] Failing finalize tests (field and custom-field choice through child Commands, union of order confirmation e-mails, tax-ID take-over under `global` in one Command (R-14a), pointer and `deleted_at`, event once, search removal), in `.../commands/merge-finalize.command.test.ts`
- [x] T030 [P] [US3] Failing read-resolution and write-refusal tests (`findById` of an archived loser, `resolveMerged`, `ORGANIZATION_MERGED` with `survivorId` from routes, guard and API key), in `.../services/organization-merge-identity.test.ts`
- [x] T031 [P] [US1] Failing contract tests for the admin routes (permission, reach 404, 202, list filtered by reach, resume/cancel version) in `backend/test/contract/organizations/organization-merge.routes.test.ts`
- [x] T032 [P] [US3] Failing webhook tests: `organization.merged.v1` offered and bridged (`bridged-equals-offered.test.ts`, `webhook-event-registry.test.ts`)

### Implementation

- [x] T033 (MikroORM 6 style, as T020) ⛔ #1866: `organizations` migration (pointer columns, CHECKs, relaxation of the 177 tax-ID constraint for merged rows, index), plus entity fields (data-model §2)
- [x] T034 [US2] Merge preview service and `organizationDetailsPort.previewMerge / resolveMerged / getMerge` (T026, T030)
- [x] T035 [US1] Commands `organization.merge.start` (declared hookable in the manifest), `.cancel`, `.resume`, `.structure`, `.finalize`, all `reversible: false` (T027 – T029)
- [x] T036 [US1] Host declaration (`merge.hosts`), the host's own participation declarations (§A `organizations` rows) and `ctx.merge.host(...)`. Remove the `organizations` and kernel-channel entries from the pending ledger
- [x] T037 [US3] Archived-loser exclusion check: lists, pickers, `admin-search-provider.ts` and storefront resolution use soft-delete already, so add tests only where a path reads with deleted rows included
- [x] T038 [US1] Admin routes `routes.merge.ts` and the schemas in `packages/contracts/src/organizations.merge.ts`. Permission `organizations:merge` in the manifest, not in the sales-rep role (T031)
- [x] T039 [US3] `organization.merged.v1` and `ORGANIZATION_WEBHOOK_EVENT_TYPES` (T032)
- [ ] T040 (**skipped in stage 1**: `organizationCommandPort` is not widened on `master` (#1821); `OrganizationMergeService.start / cancel / resume` are what the port methods will call) [US5] ⛔ #1821: `organizationCommandPort.startMerge / resumeMerge / cancelMerge`, plus the parity test `backend/test/contract/organizations/organization-command-port.merge.test.ts` and the worker test with `source` (US5)
- [ ] T041 (**not done in stage 1**: a seeded pair is only useful once the participants exist; the host's integration test seeds its own rows) [P] Test fixture `seed-merge-pair` for the integration suite and quickstart

## Phase 4: Participants without aggregate ports, MR-C1 / MR-C2 (parallel)

For each module below, the work is the same: (1) a failing `expectMergeParticipant` test
co-located at `packages/modules/<m>/src/backend/merge/organization-merge-participant.test.ts`;
(2) the batch Command in `src/backend/commands/<m>-merge-reassign.command.ts`; (3) the participant
and the manifest declaration; (4) cache and index refresh; (5) removal of the module's pending-ledger
entries. The disposition is in `contracts/participant-dispositions.md` §A.

**As implemented (MR-C1, T042 – T050).** Step (1) is DB-backed rather than co-located: a
participant's rows are only meaningful over the real schema (unions and sums ride on its unique
indexes, re-points on its foreign keys), so each conformance test is
`backend/test/integration/<m>/organization-merge-participant.test.ts`, driving the participant the
composition registered through `expectComposedOrganizationParticipant` in
`backend/test/helpers/organization-merge-conformance.ts` (merge scope, event count, audit read-back
by merge id, and a row trigger narrowed to the loser as the injected failure; the MR-D / MR-E tests
use the same file's `expectOrganizationParticipantConforms`, which injects the failure through a
wrapped Command Bus). The participant lives in `src/backend/merge/organization-merge-participant.ts`. Modules
whose rows sit in two phases declare two participations: `credit_limits` (`credit-limit`,
`credit-exposure`) and `invoice_ledger` (`client-maps`, `document-maps`).

- [x] T042 [P] `addresses`: R, survivor's defaults kept (C1)
- [x] T043 [P] `carts`: R, `buyingFor` cleared when equal to self, reprice mark (C1)
- [x] T044 [P] `invoices`: R, printed data unchanged (C1)
- [x] T045 [P] `invoice_ledger`: client map S+f with the loser's listed as a preview warning; document map R; deliveries K (C1)
- [x] T046 [P] `credit_limits`: limit S+f, reservations and top-ups R, over-limit warning (C1)
- [x] T047 [P] `related_payers`: links and requests R, self-links and duplicates revoked, self-requests closed with a merge reason (C1)
- [x] T048 [P] `price_lists`: audience U, ~~matrix S+f per product~~ (no Organization column on the price-book matrix, see `participant-dispositions.md` §A), display override S+f, pricing generation bumped with the changed books (C1)
- [x] T049 [P] `promotions`: promotions and usage R, per-Organization counters Σ (C1)
- [x] T050 [P] `returns`: cases, attachments, withdrawal statements R (C1)
- [x] T051 [P] `shopping_lists`, `comparisons`, `inventory`: R (C2)
- [x] T052 [P] `forms`, `newsletter`, `customer_notifications`: R (C2)
- [x] T053 [P] `pwa`: subscriptions R, preferences R (**corrected in C2**: a preference is unique per customer account, so there is nothing to de-duplicate) (C2)
- [x] T054 [P] `quick_order` (S+f), `mfa` (stricter) (C2)
- [x] T055 [P] `api_keys` (R, OQ-9) and `webhooks` (R, before finalize) (C2)
- [x] T056 [P] `analytics`: R, `trailing: true`, batch 500 (C2)
- [x] T057 [P] `admin_users`: `kept` declaration for `ImpersonationReason` (C2)

## Phase 5: Participants of aggregate owners, MR-D1 – MR-D5

Each step is built **now**. The port method that publishes the same Command waits for its port.

- [x] T058 [P] `orders` step: failing conformance test plus a refusal test (`RECORD_MERGE_BUSY` on an unsettled placement intent or a pending payment), then `order.merge_reassign` (`organizationId`, `payerOrganizationId`, external references, transition effects, settled intents) and the declaration (D1)
- [ ] T059 ⛔ #1823: `orderCommandPort.reassignOrganization` and its parity test against the participant (D1)
- [x] T060 [P] `quote_requests` step: conformance, `quote_request.merge_reassign`, org policy S+f (D2)
- [ ] T061 ⛔ #1824 (PR #1914, in review): `quoteRequestCommandPort.reassignOrganization` plus the parity test (D2)
- [x] T062 [P] `crm` step: opportunities R (D3)
- [ ] T063 ⛔ #1827: `opportunityCommandPort.reassignOrganization` plus the parity test (D3)
- [x] T064 [P] `catalog` step: allow-lists of products and channel scopes, loser → survivor, U, reindex products (D4)
- [ ] T065 ⛔ #1825: `productCommandPort.replaceAllowedOrganization` plus the parity test (D4)
- [x] T066 [P] `projects` (as Organization holder) step: `project_organizations` U, then `project_links.organization_id` R (D5)
- [ ] T067 ⛔ #1828: `projectCommandPort.replaceOrganization` plus the parity test (D5)

## Phase 6: Members, MR-E

- [x] T068 (#1907, ahead of #1831: `membership-merge-mode.md` §5) Failing tests for the `membershipPort` mode `merge` (`contracts/membership-merge-mode.md` §4) in `packages/modules/customer_accounts/src/backend/commands/customer-account-change-organization.merge.test.ts`
- [x] T069 (#1907, ahead of #1831; the port is published in part, 191 `membership-port.md` §8) Implement the mode (types in `packages/contracts/src/customer-accounts.membership.ts`, Command branch, scope check, event `mode: 'merge'`). Amend `specs/191-membership-join-requests/contracts/membership-port.md` with a pointer to this amendment
- [x] T070 (#1907, ahead of #1831) `customer_accounts` participant (members phase, batch of 50 accounts, role from `host_context.roleMap`), conformance test, declaration, ledger entry removed
- [ ] T071 (#1907: #1832 is not on `master` — no `OrganizationJoinRequest` entity, so nothing to declare or ledger yet) If #1832 (191 WP-2) is on `master`: `organizations` declares `OrganizationJoinRequest` target and placement references (R, pending only), with a test. Otherwise add it to the pending ledger in the #1832 MR
- [x] T072 [US1] Integration `backend/test/integration/organizations/organization-merge.e2e.test.ts`: seed every participant, merge, SC-001 zero-reference query over the derived columns, SC-003 fault injection plus resume, SC-004 merge id on every entry, and US4 deferred catch-up with `crm` switched off and then on. **As implemented:** the columns come from the composed registry's declarations and the ORM's metadata, and the test fails when a moving column has no seeded loser row (so a new participation must extend the seed). Two merges of the same seed — one uninterrupted, one with a row trigger failing the `orders` step and `crm` off throughout — are compared for SC-003; SC-001 holds two exceptions the inventory makes (§A: the loser's role definitions, a revoked related-payer self-link). The `beforeCommit` veto of the members step (`membership-merge-mode.md` §4) is in `backend/test/integration/customer_accounts/organization-merge-participant.test.ts`
- [x] T073 Assert that the pending ledger's Organization section is empty (the check fails otherwise). Start is now enabled on a full stack. **As implemented:** the ledger has no per-host sections, so `backend/test/unit/scripts/check-merge-participation.test.ts` asserts that no entry is an Organization reference by the population rule; the accepted start is asserted over the routes by `organization-merge.test.ts` and the e2e

## Phase 7: Admin flow and docs, MR-F (parallel with Phases 4 – 6 once MR-B is in)

### Tests first

- [x] T074 [P] [US1] Failing admin tests: flow states (loading, refusals, conflicts, value choices, acknowledgement, incomplete-participation notice), progress view, attention list with resume, archived banner (`packages/modules/organizations/src/admin/merge/*.test.tsx`)
- [x] T075 [P] Palette coverage (`merge-organizations`, `open-record-merges`) and permission inventory tests

### Implementation

- [x] T076 [US1] Merge flow dialog, progress view and attention list using admin-kit primitives. Apply the UX laws (`.claude/skills/ux-laws/SKILL.md`), with the irreversible confirmation as an explicit checkbox
- [x] T077 [US3] Archived banner and *Merged from* entries in the history
- [x] T078 Palette actions, i18n en + pl (labels, refusal messages, step names), and `check:error-translations`
- [x] T079 [P] Module docs: `packages/modules/organizations/docs/` merge page en + pl (what moves, what is kept, no unmerge, the off-module behaviour), the docs site page plus Polish translation, and the module-reference updates
- [x] T080 Changesets (consumer-facing: new port methods, events, webhook type, permission)

## Phase 8: US6 Project merge, MR-G (owner decision 2026-11-25: ships in the one #1907 PR, without waiting for #1828 / #1829)

The port methods of the two aggregate ports that do not exist yet are follow-ups, not part of this phase:
`projectCommandPort.startMerge / resumeMerge / cancelMerge` (#1828) and `taskCommandPort.moveContext`
(#1829). Everything else is delivered through the modules' own Commands and routes.

- [x] T081 Failing tests for the project preview, Commands, structure and records steps, finalize, archived reads and refusals, and the off-state: `packages/modules/projects/src/backend/merge/project-merge-rules.test.ts`, the hookable start in `services/project-hookable-actions.test.ts`, `backend/test/integration/projects/project-merge-participants.test.ts` (records step), `project-merge.e2e.test.ts` and `off-state.test.ts`
- [x] T082 `projects` migration (pointer columns, `20261125T124200_projects_merge_pointer.ts`, MikroORM-6 style) and the list and read filters (`LIVE_PROJECT_SQL` in `ProjectAccess`; the deadline-alert sweep)
- [x] T083 Host declaration, Commands, `projectReadPort.previewMerge / resolveMerged`, `getMerge`, `project.merged.v1` (plus a webhook type), permission `projects:merge`, routes. **Not done:** `projectCommandPort.startMerge / resumeMerge / cancelMerge` — follow-up of #1828; `ProjectMergeService` is what they will call
- [x] T084 `tasks` participant: `task.merge_move_context` (context moved, group mapped to the survivor's Stage of the same name, else its current Stage — owner decision 2026-11-26), task references R, conformance test (`backend/test/integration/tasks/project-merge-participant.test.ts`). **Not done:** `taskCommandPort.moveContext` — follow-up of #1829
- [x] T085 [P] `crm` participant for references with `targetType = project` (no port needed), conformance test (`backend/test/integration/crm/project-merge-participant.test.ts`)
- [x] T086 Mention rendering resolves merged projects through `resolveMerged` (projects, crm and tasks renderers)
- [x] T087 Admin flow for projects, palette `merge-projects` (and `open-project-merges`), i18n en + pl, docs en + pl (`packages/modules/projects/docs/projects.md` § *Merging duplicate projects*, *Project merge*)
- [x] T088 Integration `backend/test/integration/projects/project-merge.e2e.test.ts` (US6 scenarios), with the Project section of the pending ledger empty

## Phase 8a: Review of #1950 (2026-11-27)

- [x] T092 Chained merge: refuse a loser that is the survivor of a completed merge with a step left to catch up (platform `begin` and preview), re-point earlier pointers at finalize (`organizations`, `projects`), and the archived set's last survivor; C → A → D tests in both e2e files and the freeze unit test (FR-020, FR-020a)
- [x] T093 The reference guard: `MergeReferenceGuardSubscriber` over every declared, not `kept`, reference; `assertMergeWritable`; `freeze: 'guarded'` on the participations that set a reference in SQL, and each site guarded; `unguarded-reference-write` in `check:merge-participation`; unit, check and e2e tests (FR-046)
- [x] T094 FR-090 option C: `organizationsGainingAccess` in the preview, `acknowledgedOrganizationIds` checked under the start lock (`PROJECT_MERGE_ORGANIZATION_ACCESS_UNCONFIRMED`), the admin flow's second confirmation, i18n en + pl, tests

## Phase 9: Polish (each MR carries its own; T089 closes)

- [ ] T089 `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; the module-removal ledger and the pending ledger re-derived in the same MR; the full check list of plan § *Checks*
- [ ] T090 Perf: `backend/test/perf/organization-merge.perf.test.ts` at reference volume (SC-002)
- [ ] T091 Dispatch the complete backend suite before the release (D-198)

## Dependencies

```text
MR-A (T003–T025; T020 ⛔ #1866)
  ├─► MR-B (T026–T041; T033 ⛔ #1866; T040 ⛔ #1821)
  │     ├─► MR-F (T074–T080)
  │     └─► MR-E (T068–T073 ⛔ #1831)  ◄── needs every MR-C/MR-D step for T072–T073
  ├─► MR-C1 / MR-C2 (T042–T057)                       start now
  ├─► MR-D1–D5 steps (T058, T060, T062, T064, T066)   start now
  │     └─► port methods T059 ⛔#1823, T061 ⛔#1824/PR #1914, T063 ⛔#1827, T065 ⛔#1825, T067 ⛔#1828
  └─► MR-G (T081–T088; owner decision 2026-11-25: in the #1907 PR, the port methods of
        #1828 / #1829 follow those issues)
```

The start of an Organization merge is usable when MR-A, MR-B, MR-C1, MR-C2, the MR-D steps and MR-E
are merged. The port-method tasks (T040, T059, T061, T063, T065, T067) are additive follow-ups and
do not gate operators.

## Parallel examples

- After T006 and T007: T008, T009, T013 – T018 together.
- After MR-A: MR-B, every MR-C task (T042 – T057) and every MR-D step (T058, T060, T062, T064, T066),
  by different developers.
- After MR-B: MR-F alongside the participants.

## Implementation strategy

1. **MVP-0, preview (MR-A + MR-B + MR-F).** Operators can assess duplicates. Start is refused with
   `RECORD_MERGE_PARTICIPATION_INCOMPLETE`.
2. **MVP-1, Organization merge.** Add MR-C1, MR-C2, the MR-D steps and MR-E (#1831). Start opens
   by itself.
3. **Server-side merge and per-owner port methods.** These follow each port issue.
4. **Project merge** (MR-G), shipped in the same PR by owner decision (2026-11-25); its
   `projectCommandPort` and `taskCommandPort` methods follow #1828 and #1829.

## Traceability (FR → tasks)

| FR | Tasks |
| --- | --- |
| FR-001 – FR-004 | T014, T016, T021, T027, T035 |
| FR-005, FR-040 | T042 – T070, `contracts/participant-dispositions.md` |
| FR-006 | T014, T022 |
| FR-007, FR-010 | T018, T024, every conformance test |
| FR-008, FR-009, FR-011, FR-012 | T014, T021, T022, T035 |
| FR-020 – FR-027 | T026, T034, T058 |
| FR-030 – FR-034 | T029, T035, T045, T046, T048, T054 |
| FR-041 | T028, T068 – T070 |
| FR-042 | T028 |
| FR-043, FR-044 | T044, T045 |
| FR-045 | T008 – T012 |
| FR-046 | T093 |
| FR-050 | T031, T038, T075 |
| FR-051 – FR-053 | T030, T033, T037, T023 |
| FR-054 | T032, T039 |
| FR-055 | T029, each participant's refresh |
| FR-060, FR-063 | T020 (index), T027, T029, T072 |
| FR-061 | T027, T035 |
| FR-062 | T040, T059 – T067, T083, T084 |
| FR-070 – FR-073 | T015, T017, T022, T072, T081 |
| FR-080 – FR-083 | T074 – T079 |
| FR-090 – FR-094 | T081 – T088, T094 |
| FR-020, FR-020a (chains) | T092 |
