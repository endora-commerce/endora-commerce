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

## Phase 1: Setup

- [ ] T001 Create one implementation branch per MR from `origin/master` in its own worktree (`git worktree add ../wt-1907-<mr> -b feat/1907-<mr> origin/master`, `bash ../wt-1907-<mr>/scripts/setup-worktree.sh`), then run `pnpm run build:packages`
- [ ] T002 [P] Read `specs/conventions/module-composition.md`, `module-activation.md`, `audit-state.md`, `module-migrations.md`, `check-estate.md`, `custom-field-writes.md`, `module-admin-surfaces.md`, `module-i18n.md`, and `specs/186-aggregate-ports/contracts/aggregate-port-convention.md`. Record in the MR description which of #1821 – #1829, #1831 and PR #1914 are merged

## Phase 2: Foundational, MR-A (framework; blocks everything)

### Contracts: tests first

- [ ] T003 [P] Failing schema tests for host types, phases, states, dispositions, `RecordMergePreview`, `RecordMergeRecord`, `MergeStepInput` and `MergeParticipantPreview` in `packages/contracts/src/record-merge.test.ts`
- [ ] T004 [P] Failing test that every error code of data-model §6 exists with en + pl messages, in `packages/contracts/src/record-merge.errors.test.ts`
- [ ] T005 [P] Failing test for the manifest `merge` schema (hosts and participates, polymorphic references) in `packages/platform/src/kernel/merge/manifest-schema.test.ts`

### Contracts: implementation

- [ ] T006 Implement `packages/contracts/src/record-merge.ts` and the error codes (T003, T004)
- [ ] T007 Add the `merge` field to the platform manifest schema (T005)

### Completeness analysis and the static check: tests first

- [ ] T008 [P] Failing red/green fixture tests for every finding of `contracts/merge-participation-check.md` §2, plus exit 2 and the read-size line, in `backend/test/unit/scripts/check-merge-participation.test.ts`
- [ ] T009 [P] Failing test for the runtime twin (uncovered references per present module, off modules excluded) in `packages/platform/src/kernel/merge/completeness.test.ts`

### Completeness: implementation

- [ ] T010 Implement the shared analysis in `packages/platform/src/kernel/merge/completeness.ts` (T009)
- [ ] T011 Implement `backend/scripts/check-merge-participation.ts` and the `package` verdict in `packages/cli/src/check/estate.ts`. Register it in `check-inventory.test.ts`, the `quality` / `quality:static` blocks and `backend/package.json` (T008)
- [ ] T012 Seed `backend/scripts/ledgers/merge-participation-pending.ts` with every reference of `contracts/participant-dispositions.md` §A. Each entry names the MR that removes it and its blocking issue

### Registry, runner, freeze: tests first

- [ ] T013 [P] Failing composition tests (`contracts/merge-mechanism.md` §1 refusals; `ctx.merge.participate` / `ctx.merge.host`) in `packages/platform/src/kernel/merge/composition.test.ts`
- [ ] T014 [P] Failing runner tests: phase order, parallelism within a phase, retry → `needs_attention`, resume skips done steps, cancel window, finalize residue sweep, trailing steps. In `packages/platform/src/kernel/merge/runner.test.ts`
- [ ] T015 [P] Failing deferred and catch-up tests (pub/sub path and sweep path) in `packages/platform/src/kernel/merge/catch-up.test.ts`
- [ ] T016 [P] Failing race test (two starts over overlapping ids → exactly one) in `packages/platform/src/kernel/merge/locks.test.ts`
- [ ] T017 [P] Failing freeze/archive tests in `packages/platform/src/tenancy/org-write-guard.merge.test.ts` and `packages/platform/src/tenancy/resolve-tenant-context.merge.test.ts`
- [ ] T018 [P] Failing tests for the conformance helper itself (it fails on a non-idempotent double participant, an over-sized batch, an event dispatched) in `packages/test-kit/src/merge/expect-merge-participant.test.ts`

### Registry, runner, freeze: implementation

- [ ] T019 Composition and registry in `packages/platform/src/kernel/merge/registry.ts`, plus `ctx.merge` on the module context (T013)
- [ ] T020 ⛔ #1866: Entities `record-merge.entity.ts`, `record-merge-step.entity.ts`, `record-merge-lock.entity.ts` (`@RuleScoped`), and the platform cross-cutting migration including the audit expression index (data-model §1). Use `migration:new`, then `composer:generate`
- [ ] T021 `RecordMergeService` (begin, cancel, resume, get, list, preview aggregation) in `packages/platform/src/kernel/merge/record-merge-service.ts` (T014, T016, T020)
- [ ] T022 Runner worker on queue `platform.record-merge` and catch-up repeatable job, through the platform worker seam (T014, T015)
- [ ] T023 Frozen and archived sets, the `b2b:record-merge:changed` channel and the 5-min reload. Wire them into `org-write-guard.ts` and `resolve-tenant-context.ts` (T017)
- [ ] T024 `expectMergeParticipant` in `packages/test-kit/src/merge/expect-merge-participant.ts` (T018)
- [ ] T025 Kernel `kept` declaration for `AuditLogEntry` (merge participation with no participant step) and the ledger update

**Checkpoint MR-A**: no user-visible change. `check:merge-participation` is green with the pending
ledger.

## Phase 3: US1 + US2 + US3 host, MR-B (`organizations`)

### Tests first

- [ ] T026 [P] [US2] Failing preview refusal tests, each FR-020 – FR-027 refusal under both tax-ID scopes (D-299 tree and personal rules), in `packages/modules/organizations/src/backend/services/organization-merge-preview.test.ts`
- [ ] T027 [P] [US1] Failing tests for `organization.merge.start` (re-checks the preview, acknowledgement required, hook veto writes nothing, audit sentinel with field-choice codes only) in `packages/modules/organizations/src/backend/commands/merge-start.command.test.ts`
- [ ] T028 [P] [US1] Failing structure-step tests (children through `organization.move`, role map by name or copy into `host_context`, invitations re-pointed with mapped role, sales-rep union, sales-channel union through `SalesChannelMembershipService`), with the conformance helper, in `.../services/organization-merge-structure.test.ts`
- [ ] T029 [P] [US1] Failing finalize tests (field and custom-field choice through child Commands, union of order confirmation e-mails, tax-ID take-over under `global` in one Command (R-14a), pointer and `deleted_at`, event once, search removal), in `.../commands/merge-finalize.command.test.ts`
- [ ] T030 [P] [US3] Failing read-resolution and write-refusal tests (`findById` of an archived loser, `resolveMerged`, `ORGANIZATION_MERGED` with `survivorId` from routes, guard and API key), in `.../services/organization-merge-identity.test.ts`
- [ ] T031 [P] [US1] Failing contract tests for the admin routes (permission, reach 404, 202, list filtered by reach, resume/cancel version) in `backend/test/contract/organizations/organization-merge.routes.test.ts`
- [ ] T032 [P] [US3] Failing webhook tests: `organization.merged.v1` offered and bridged (`bridged-equals-offered.test.ts`, `webhook-event-registry.test.ts`)

### Implementation

- [ ] T033 ⛔ #1866: `organizations` migration (pointer columns, CHECKs, relaxation of the 177 tax-ID constraint for merged rows, index), plus entity fields (data-model §2)
- [ ] T034 [US2] Merge preview service and `organizationDetailsPort.previewMerge / resolveMerged / getMerge` (T026, T030)
- [ ] T035 [US1] Commands `organization.merge.start` (declared hookable in the manifest), `.cancel`, `.resume`, `.structure`, `.finalize`, all `reversible: false` (T027 – T029)
- [ ] T036 [US1] Host declaration (`merge.hosts`), the host's own participation declarations (§A `organizations` rows) and `ctx.merge.host(...)`. Remove the `organizations` and kernel-channel entries from the pending ledger
- [ ] T037 [US3] Archived-loser exclusion check: lists, pickers, `admin-search-provider.ts` and storefront resolution use soft-delete already, so add tests only where a path reads with deleted rows included
- [ ] T038 [US1] Admin routes `routes.merge.ts` and the schemas in `packages/contracts/src/organizations.merge.ts`. Permission `organizations:merge` in the manifest, not in the sales-rep role (T031)
- [ ] T039 [US3] `organization.merged.v1` and `ORGANIZATION_WEBHOOK_EVENT_TYPES` (T032)
- [ ] T040 [US5] ⛔ #1821: `organizationCommandPort.startMerge / resumeMerge / cancelMerge`, plus the parity test `backend/test/contract/organizations/organization-command-port.merge.test.ts` and the worker test with `source` (US5)
- [ ] T041 [P] Test fixture `seed-merge-pair` for the integration suite and quickstart

## Phase 4: Participants without aggregate ports, MR-C1 / MR-C2 (parallel)

For each module below, the work is the same: (1) a failing `expectMergeParticipant` test
co-located at `packages/modules/<m>/src/backend/merge/organization-merge-participant.test.ts`;
(2) the batch Command in `src/backend/commands/<m>-merge-reassign.command.ts`; (3) the participant
and the manifest declaration; (4) cache and index refresh; (5) removal of the module's pending-ledger
entries. The disposition is in `contracts/participant-dispositions.md` §A.

- [ ] T042 [P] `addresses`: R, survivor's defaults kept (C1)
- [ ] T043 [P] `carts`: R, `buyingFor` cleared when equal to self, reprice mark (C1)
- [ ] T044 [P] `invoices`: R, printed data unchanged (C1)
- [ ] T045 [P] `invoice_ledger`: client map S+f with the loser's listed as a preview warning; document map R; deliveries K (C1)
- [ ] T046 [P] `credit_limits`: limit S+f, reservations and top-ups R, over-limit warning (C1)
- [ ] T047 [P] `related_payers`: links and requests R, self-links and duplicates revoked, self-requests closed with a merge reason (C1)
- [ ] T048 [P] `price_lists`: audience U, matrix S+f per product, display override S+f, price cache invalidated for both ids (C1)
- [ ] T049 [P] `promotions`: promotions and usage R, per-Organization counters Σ (C1)
- [ ] T050 [P] `returns`: cases, attachments, withdrawal statements R (C1)
- [ ] T051 [P] `shopping_lists`, `comparisons`, `inventory`: R (C2)
- [ ] T052 [P] `forms`, `newsletter`, `customer_notifications`: R (C2)
- [ ] T053 [P] `pwa`: subscriptions R, preferences de-duplicated per account (C2)
- [ ] T054 [P] `quick_order` (S+f), `mfa` (stricter) (C2)
- [ ] T055 [P] `api_keys` (R, OQ-9) and `webhooks` (R, before finalize) (C2)
- [ ] T056 [P] `analytics`: R, `trailing: true`, batch 500 (C2)
- [ ] T057 [P] `admin_users`: `kept` declaration for `ImpersonationReason` (C2)

## Phase 5: Participants of aggregate owners, MR-D1 – MR-D5

Each step is built **now**. The port method that publishes the same Command waits for its port.

- [ ] T058 [P] `orders` step: failing conformance test plus a refusal test (`RECORD_MERGE_BUSY` on an unsettled placement intent or a pending payment), then `order.merge_reassign` (`organizationId`, `payerOrganizationId`, external references, transition effects, settled intents) and the declaration (D1)
- [ ] T059 ⛔ #1823: `orderCommandPort.reassignOrganization` and its parity test against the participant (D1)
- [ ] T060 [P] `quote_requests` step: conformance, `quote_request.merge_reassign`, org policy S+f (D2)
- [ ] T061 ⛔ #1824 (PR #1914, in review): `quoteRequestCommandPort.reassignOrganization` plus the parity test (D2)
- [ ] T062 [P] `crm` step: opportunities R (D3)
- [ ] T063 ⛔ #1827: `opportunityCommandPort.reassignOrganization` plus the parity test (D3)
- [ ] T064 [P] `catalog` step: allow-lists of products and channel scopes, loser → survivor, U, reindex products (D4)
- [ ] T065 ⛔ #1825: `productCommandPort.replaceAllowedOrganization` plus the parity test (D4)
- [ ] T066 [P] `projects` (as Organization holder) step: `project_organizations` U, then `project_links.organization_id` R (D5)
- [ ] T067 ⛔ #1828: `projectCommandPort.replaceOrganization` plus the parity test (D5)

## Phase 6: Members, MR-E

- [ ] T068 ⛔ #1831: Failing tests for the `membershipPort` mode `merge` (`contracts/membership-merge-mode.md` §4) in `packages/modules/customer_accounts/src/backend/commands/customer-account-change-organization.merge.test.ts`
- [ ] T069 ⛔ #1831: Implement the mode (types in `packages/contracts/src/customer-accounts.membership.ts`, Command branch, scope check, event `mode: 'merge'`). Amend `specs/191-membership-join-requests/contracts/membership-port.md` with a pointer to this amendment
- [ ] T070 ⛔ #1831: `customer_accounts` participant (members phase, batch of 50 accounts, role from `host_context.roleMap`), conformance test, declaration, ledger entry removed
- [ ] T071 If #1832 (191 WP-2) is on `master`: `organizations` declares `OrganizationJoinRequest` target and placement references (R, pending only), with a test. Otherwise add it to the pending ledger in the #1832 MR
- [ ] T072 [US1] Integration `backend/test/integration/organizations/organization-merge.e2e.test.ts`: seed every participant, merge, SC-001 zero-reference query over the derived columns, SC-003 fault injection plus resume, SC-004 merge id on every entry, and US4 deferred catch-up with `crm` switched off and then on
- [ ] T073 Assert that the pending ledger's Organization section is empty (the check fails otherwise). Start is now enabled on a full stack

## Phase 7: Admin flow and docs, MR-F (parallel with Phases 4 – 6 once MR-B is in)

### Tests first

- [ ] T074 [P] [US1] Failing admin tests: flow states (loading, refusals, conflicts, value choices, acknowledgement, incomplete-participation notice), progress view, attention list with resume, archived banner (`packages/modules/organizations/src/admin/merge/*.test.tsx`)
- [ ] T075 [P] Palette coverage (`merge-organizations`, `open-record-merges`) and permission inventory tests

### Implementation

- [ ] T076 [US1] Merge flow dialog, progress view and attention list using admin-kit primitives. Apply the UX laws (`.claude/skills/ux-laws/SKILL.md`), with the irreversible confirmation as an explicit checkbox
- [ ] T077 [US3] Archived banner and *Merged from* entries in the history
- [ ] T078 Palette actions, i18n en + pl (labels, refusal messages, step names), and `check:error-translations`
- [ ] T079 [P] Module docs: `packages/modules/organizations/docs/` merge page en + pl (what moves, what is kept, no unmerge, the off-module behaviour), the docs site page plus Polish translation, and the module-reference updates
- [ ] T080 Changesets (consumer-facing: new port methods, events, webhook type, permission)

## Phase 8: US6 Project merge, MR-G (⛔ #1828, #1829)

- [ ] T081 ⛔ #1828: Failing tests for the project preview, Commands, structure and records steps, finalize, archived reads and refusals, and the off-state, in `packages/modules/projects/src/backend/...merge*.test.ts`
- [ ] T082 ⛔ #1866: `projects` migration (pointer columns) and the list and read filters
- [ ] T083 ⛔ #1828: Host declaration, Commands, `projectCommandPort.startMerge / resumeMerge / cancelMerge`, `projectReadPort.previewMerge / resolveMerged`, `project.merged.v1` (plus a webhook type), permission `projects:merge`, routes
- [ ] T084 ⛔ #1829: `tasks` participant: `taskCommandPort.moveContext` and `task.merge_move_context` (context moved, group cleared), task references R, conformance test
- [ ] T085 [P] `crm` participant for references with `targetType = project` (no port needed), conformance test
- [ ] T086 Mention rendering resolves merged projects through `resolveMerged`
- [ ] T087 Admin flow for projects, palette `merge-projects`, i18n en + pl, docs en + pl
- [ ] T088 Integration `backend/test/integration/projects/project-merge.e2e.test.ts` (US6 scenarios), with the Project section of the pending ledger empty

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
  └─► MR-G (T081–T088 ⛔ #1828, #1829)
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
4. **Project merge** (MR-G) after #1828 and #1829.

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
| FR-050 | T031, T038, T075 |
| FR-051 – FR-053 | T030, T033, T037, T023 |
| FR-054 | T032, T039 |
| FR-055 | T029, each participant's refresh |
| FR-060, FR-063 | T020 (index), T027, T029, T072 |
| FR-061 | T027, T035 |
| FR-062 | T040, T059 – T067, T083, T084 |
| FR-070 – FR-073 | T015, T017, T022, T072, T081 |
| FR-080 – FR-083 | T074 – T079 |
| FR-090 – FR-094 | T081 – T088 |
