---
description: "Task list for 186 — aggregate ports"
---

# Tasks: Aggregate ports — one write port per core aggregate

**Input**: `specs/186-aggregate-ports/` — `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`.
**Tests**: required (Principle III). In every story the tests come first and must fail for the right
reason before the implementation task after them starts.
**Markers**: `[P]` parallelisable; `[USn]` user story; **(after #1866)** — may start only after the
MikroORM 7 switch merges (D-293.4, entity freeze); unmarked tasks may merge before it.
**Every task ends with** `pnpm run build:packages` after a package edit, `typecheck` + `lint` + the
targeted tests, and a changeset for anything a package publishes (`specs/conventions/release-intent.md`).

## Phase 1: Setup — inventory (confirms the `?` rows of research R-2)

Each task reads the admin route(s), the service and the Command (if any) for every operation in its
contract, and rewrites the contract's table with: Command action, readiness (C / H-in / H-post / N),
and every side effect the route performs outside its write (notices, cache invalidation, reindex,
events). No code change.

- [x] T001 [P] Inventory Organization operations, including the sales-channel write path through `sales_channels`, in `specs/186-aggregate-ports/contracts/organization-command-port.md` — #1821: the sales-channel write is the kernel membership writer (H-post), the sales-rep writes are H-in, seven findings for T019/T028 in § *Inventory findings*
- [ ] T002 [P] Inventory CustomerAccount operations (`createStandalone`, `updateProfile`, `markEmailVerified` actions and the session revocation on block) in `specs/186-aggregate-ports/contracts/customer-account-command-port.md`
- [ ] T003 [P] Inventory Order operations (status, payment status, comments, external reference; placement for US11) in `specs/186-aggregate-ports/contracts/order-command-port.md`
- [x] T004 [P] Inventory QuoteRequest operations, the send-document route path and whether admin custom-field values ride on `modify`, in `specs/186-aggregate-ports/contracts/quote-request-command-port.md` — done with #1824: `update` is `modify` only (`patch_draft` is the buyer's), values ride on `modify`, the path is `/pdf/send`
- [ ] T005 [P] Inventory Product and Attribute operations, the scoped-values route and the validator a caller uses for attribute values, in `specs/186-aggregate-ports/contracts/catalog-product-command-port.md`
- [ ] T006 [P] Inventory Project operations and the stage-move route in `specs/186-aggregate-ports/contracts/project-command-port.md`
- [ ] T007 [P] Inventory Category operations (move, values-only update, the threshold audit split with `inventory`) in `specs/186-aggregate-ports/contracts/catalog-category-command-port.md`
- [ ] T008 [P] Inventory Opportunity operations in `specs/186-aggregate-ports/contracts/opportunity-command-port.md`
- [ ] T009 [P] Inventory Task operations (`createMany`, child Commands on `update`, the 8 hand audits) in `specs/186-aggregate-ports/contracts/task-command-port.md`
- [ ] T010 Record in `specs/186-aggregate-ports/research.md` R-2 any readiness the inventory changed, and any operation it moves in or out of scope (an owner question if it changes FR-020–FR-028) — Organization recorded with #1821 (sales reps H-in, sales channels H-post through the kernel; one owner question for T028); the other eight inventories are open

---

## Phase 2: Foundational (blocks every story)

- [x] T011 [P] Write a failing type test for `AggregateCommandOptions` and `CustomFieldMerge` (`expectTypeOf`) in `packages/contracts/src/aggregate-ports.test.ts` — landed with #1824
- [x] T012 Add `packages/contracts/src/aggregate-ports.ts` (types per `data-model.md`) and export it from `packages/contracts/src/index.ts`; make `OrganizationCommandPortOptions` an alias in `packages/contracts/src/organizations.ts` — the file and the export landed with #1824 (plus `aggregateCommandSourceSchema`); the `OrganizationCommandPortOptions` alias is left to US1, whose port would otherwise advertise `expectedVersion` and `source` it does not honour; the alias landed with US1a (#1821), when the port honours both
- [x] T013 [P] Write a failing test that every `CUSTOM_FIELD_HOST_BINDINGS` entry carries a non-empty `aggregatePort` in `packages/contracts/src/custom-fields.test.ts`
- [x] T014 Add `aggregatePort` to each entry of `CUSTOM_FIELD_HOST_BINDINGS` in `packages/contracts/src/custom-fields.ts` (values per `data-model.md`)
- [x] T015 [P] Write `backend/test/helpers/aggregate-port-parity.ts`: `expectPortParity({ viaRoute, viaPort })` asserting the same audit action, object type, `stateBefore`/`stateAfter` shape (modulo actor and `source`), the same hooks fired and outbox rows written, and a caller-supplied side-effect probe; with its own test `backend/test/unit/helpers/aggregate-port-parity.test.ts` — #1821: `expectPortParity` plus `observeWrite`, the measurement of one path against PostgreSQL; the test sits in `backend/test/unit/harness/`, beside the other helpers' tests (`bounded-pool.test.ts`)
- [x] T016 Write the port-per-aggregate rule into `specs/conventions/module-composition.md` as item 2a from `specs/186-aggregate-ports/contracts/aggregate-port-convention.md`, and the server-side-writes paragraph of `specs/conventions/custom-field-writes.md` naming the aggregate ports instead of the two narrow ones — done as a pointer to item 2a (#1820); the list itself is rewritten by T033 and T053, when the two ports exist
- [x] T017 Create `specs/conventions/contract-surface.md` from `specs/186-aggregate-ports/contracts/contract-surface.md` (sanctioned-break section included), add its one router row to `AGENTS.md` § *Where the rest of it lives*, and run `pnpm --filter backend exec vitest run test/unit/docs/agents-router.test.ts`
- [x] T018 Add a paragraph on surface stability (OD-4, the deprecation grammar, the comparison inside `check:release-intent --since`, the D-293.7 ledger) to `specs/conventions/release-intent.md`, pointing at `contract-surface.md` rather than restating it

**Checkpoint**: shared types, conventions and parity helper in place.

---

## Phase 3: User Story 1 — Organization (Priority: P1) — MVP

**Goal**: `organizationCommandPort` is the Organization aggregate port (#1821).
**Independent test**: parity per operation; worker test with no administrator.

### Contracts (may merge before #1866)

- [x] T019 [US1] Widen `OrganizationCommandPort` in `packages/contracts/src/organizations.ts` with every method of `contracts/organization-command-port.md`, the template JSDoc, and `@deprecated since 0.113.0; use {@link …} instead.` on `OrganizationWritePort` (all three methods) and `OrganizationCustomFieldWritePort.setCustomFieldValues` — #1821 US1a: every method but `setSalesChannels` (US1b, R-16.9); `setParent` takes `parentId: string | null` (R-16.3), `reject` `OrganizationRejectInput` and `block` `OrganizationBlockInput` (R-16.4); new `OrganizationAllowListsReplace` / `OrganizationAllowListPatch` / `OrganizationRestrictions`; type test `packages/contracts/src/organizations.command-port.test.ts`
- [x] T020 [US1] Changeset (minor, consumer-facing: old call → new call) for `@endora-commerce/contracts` in `.changeset/` — #1821: `.changeset/1821-contracts-organization-command-port.md`

### Tests first (after #1866)

- [x] T021 [P] [US1] Failing co-located tests for the four moderation Commands (status guard, version conflict, audit inside the transaction, event on commit only, notice after commit) in `packages/modules/organizations/src/backend/commands/approve-organization.command.test.ts`, `reject-…`, `block-…`, `unblock-organization.command.test.ts` — #1821: `approve-organization.command.test.ts` carries the transaction properties (commit failure, optimistic lock, notice order, auto mode); the other three the guard, version and reason handling
- [ ] T022 [P] [US1] Failing co-located tests for the restriction Commands (`organization.allow_lists_replace`, `organization.allow_list_patch`) and `organization.sales_channels.set` in `packages/modules/organizations/src/backend/commands/` — US1a (#1821) did the restriction half, `commands/allow-list.commands.test.ts`, and the sales-rep Commands of R-16.7, `commands/sales-rep-assignment.commands.test.ts`; `organization.sales_channels.set` is US1b's
- [x] T023 [P] [US1] Failing parity contract test per method in `backend/test/contract/organizations/organization-command-port.test.ts` — #1821 US1a: every method but `setSalesChannels`; `update` and `setCustomFieldValues` against the deprecated narrow ports (R-16.2); plus `source`, unclaimed extension, `expectedVersion` and the refusals
- [x] T024 [P] [US1] Failing worker integration test (create under a parent, `setParent` of an existing branch, approve, block/unblock under `withSystemScope` with no administrator; hook veto rolls back; unclaimed extension refused; `source` recorded beside a `system` actor, a malformed `source` refused `VALIDATION_FAILED` with nothing written — D-293.6) in `backend/test/integration/organizations/organization-command-port.worker.test.ts` — #1821 US1a, without the sales-channel parts; the veto is the `example` deployment's `command_hook_fixture` on `organization.create`
- [x] T025 [P] [US1] Failing delegation tests (the deprecated ports write identical entries) in `backend/test/contract/organizations/organization-narrow-ports-delegate.test.ts` — #1821

### Implementation (after #1866)

- [x] T026 [US1] Convert approve/reject/block/unblock to Commands in `packages/modules/organizations/src/backend/commands/{approve,reject,block,unblock}-organization.command.ts`; `OrganizationModerationService.transition` runs them and loses its post-commit `auditLogService.record` (`packages/modules/organizations/src/backend/services/organization-moderation-service.ts`); `handleNewlyRegistered` approves through the same Command — **land this first** (unblocks `specs/188-policy-points/`) — #1821: one shared `commands/moderation-transition.ts`; the service now takes the Command Bus instead of the audit port and event bus, and the auto-approval runs under `withSystemScope`; contract test `backend/test/contract/organizations/moderation-commands.contract.test.ts`
- [x] T027 [US1] Convert restriction writes to Commands and remove their `recordAuditFromContext` calls in `packages/modules/organizations/src/backend/services/organization-restriction-service.ts` — #1821: the factories are `commands/allow-list.commands.ts`; the service runs them on the bus (its second constructor argument is the bus now). Also R-16.7: `commands/sales-rep-assignment.commands.ts`, the hand audits of `sales-rep-assignment-service.ts` removed. R-16.4: the moderation notice moved to an organizations subscriber of `organization.status_changed.v1`, whose payload gained `notifyCustomer`
- [ ] T028 [US1] Make the sales-channel assignment a Command `organization.sales_channels.set` in `packages/modules/organizations/src/backend/commands/set-sales-channels.command.ts`, writing through `sales_channels`' seam on the Command's transaction (per T001)
- [x] T029 [US1] Point every admin route of `contracts/organization-command-port.md` at the shared factories in `packages/modules/organizations/src/backend/routes.admin.ts` and `routes.sales-reps.ts` — #1821 US1a: the parent route through `makePlaceInTreeCommand` (shared with `setParent`), the sales-rep routes through the new Commands; the moderation and restriction routes through their services, which run the factories; `PUT …/sales-channels` is US1b's
- [x] T030 [US1] Implement the widened port in `packages/modules/organizations/src/backend/services/organization-command-port.ts` and register it in `packages/modules/organizations/src/backend/index.ts` — #1821 US1a, without `setSalesChannels`
- [x] T031 [US1] Make `organizationWritePort` and `organizationCustomFieldWritePort` delegate in `packages/modules/organizations/src/backend/services/organization-write-port.ts` and `organization-custom-field-write-port.ts` — #1821
- [ ] T032 [US1] Drain the `organization` entry of the aggregate-port ledger in `backend/scripts/check-port-shape.ts` (if US2's T042 landed first)
- [x] T033 [US1] "Server-side writes" section in `packages/modules/organizations/docs/organizations.md` per `specs/conventions/module-documentation.md`; changeset for `@endora-commerce/module-organizations` — #1821 US1a: *Server-side writes* in EN and PL (re-pinned), the hook-author note on `admin_patch` + `set_custom_field_values` (R-16.2), the `specs/conventions/custom-field-writes.md` list; `.changeset/1821-organizations-command-port.md`. The sales-channel row is US1b's

**Checkpoint**: Organization port complete; notify the owners of 188 and 191.

---

## Phase 4: User Story 2 — Contract surface, deprecation, and the check (Priority: P1)

**Goal**: #1820 — the rule is written, the surface classified, and the **existing**
`check:release-intent` (`backend/package.json` → `backend/scripts/check-release-intent.ts`) is extended
to enforce OD-4 with the D-293.7 exception. Nothing is built beside it
(`contracts/release-intent-contract-surface.md`).
**Independent test**: fixture pairs make every finding red and its twin green; a missing base is exit 2.
**Read first**: the header of `backend/scripts/check-release-intent.ts` (its modes, `ReleaseIntentFindingKind`,
the exit-2 rules, the `--since` / `release-changeset` placement) and `backend/test/unit/scripts/check-release-intent.test.ts`.

### Tests first

- [ ] T034 [P] [US2] Failing fixture tests over the pure analysis, one red/green pair per finding kind of `contracts/release-intent-contract-surface.md` §6 — port method removed with and without a base deprecation, container name changed (frozen), method gaining an optional parameter = green, a required one = red, return narrowed = green, widened = red, additive-only narrowing in both directions, unparseable deprecation, backdated deprecation (new marker naming the base version) — in `backend/test/unit/scripts/check-release-intent.contract-surface.test.ts`
- [ ] T035 [P] [US2] Failing tests in the same file for exit 2 (no reachable `v*` tag / shallow clone, unresolvable `--contract-base`, `--contract-base` without a value, failed `git archive`, empty base or HEAD port population, probe compiling no assertion) — the git cases over a temporary repository with a real tag — and that a `contained` branch skips the comparison
- [ ] T036 [P] [US2] Failing port-shape tests for the aggregate-port signal (named port unpublished, unregistered by `ownerModuleId`, lacking `setCustomFieldValues`; stale ledger entry) in `backend/test/unit/kernel/port-shape-check.test.ts`, the existing port-shape test file
- [ ] T037 [P] [US2] Failing sanctioned-break tests (D-293.7) in the same file as T034: live entry licenses exactly its finding kind (and not another kind on the same id); `contract-break-unannounced` when the `{#anchor}` is missing in EN, missing in PL, or the section omits the symbol or the D-number; `stale-contract-break`; spent entry green on an `ordinary` shape and `spent-contract-break` on a `release` shape; `contract-break-malformed` for a bad D-number, a non-tag base, a base newer than the run's, an empty `why`
- [ ] T038 [P] [US2] Failing real-branch case in `backend/test/release/changeset-gate.test.ts`: a branch removing an undeprecated port method reds `--since`; the same branch with a valid ledger entry and upgrade-note section is green

### Implementation

- [ ] T039 [US2] Move `modulePortsPopulation()` out of `backend/scripts/check-port-shape.ts` into `backend/scripts/lib/port-population.ts` (exported, unchanged behaviour) and import it back; `check:port-shape` output and read size unchanged (run `pnpm --filter backend run check:port-shape` before and after)
- [ ] T040 [US2] Write the pure analysis `backend/scripts/lib/contract-surface.ts`: the kind registry (rows of `contracts/contract-surface.md` owned by 186, ports first — `port:<containerName>` frozen, `port:<containerName>#<method>` stable — derived through `lib/port-population.ts`, no `@api` tag), the compile probe through the TypeScript compiler API, the deprecation grammar and the deprecation-release rule (§4), the sanctioned-break matching (§5); header states the overload and dependency-type limits. Create the ledger `backend/scripts/ledgers/contract-surface-breaks.ts` (`SanctionedContractBreak`, `SANCTIONED_CONTRACT_BREAKS = {}`), its header stating the two directions and the spent rule
- [ ] T041 [US2] Extend `backend/scripts/check-release-intent.ts`: add the ten `contract-*` / `deprecation-*` members to `ReleaseIntentFindingKind`; run the comparison inside `reportPublishedSurface` (the `--since` mode) after the existing analysis and for every shape but `contained`; add `--contract-base <ref>` (override, and alone = comparison only) beside `--since` in `main()`; base via `git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD`; materialise the base with `git archive`; print the `contract-base=` line; extend the header's mode list and exit-2 list. The default mode, `--print-publish-scope` and `--publish-registry` stay byte-identical
- [ ] T042 [US2] Add the aggregate-port signal to `packages/cli/src/rules/port-shape.ts` and its two-way ledger (nine hosts, each entry naming the story that drains it) to `backend/scripts/check-port-shape.ts`
- [ ] T043 [US2] Estate and inventory: one sentence in the `reason` of the existing `check:release-intent` entry in `packages/cli/src/check/estate.ts` (compares against this repository's `v*` tags); extend the existing `check:release-intent` row of `specs/conventions/check-inventory.md` (family, ledger, exit-2 list); a comment at `release-changeset`'s `fetch-depth: 0` in `.github/workflows/quality.yml` naming the comparison's tags. No `check-read-sizes.ts` change (the record runs the default mode). Run `backend/test/unit/scripts/check-inventory.test.ts`, `check-read-size.test.ts` and `backend/test/unit/ci/gate-coverage.test.ts`
- [x] T044 [P] [US2] Published guide `docs/docs/architecture/contract-surface.md` (tiers, kinds, deprecation grammar, the sanctioned-break rule) and its Polish translation under `docs/i18n/pl/docusaurus-plugin-content-docs/current/architecture/` (`docs/docs/contributing/documentation-i18n.md`); point rung 3 of `docs/docs/architecture/customisation-ladder.md` and the ports section of `docs/docs/architecture/kernel.md` at the rule and the guide, same in the Polish translations
- [ ] T045 [US2] Changesets for `@endora-commerce/cli` (port-shape signal, estate reason) and `@endora-commerce/contracts`

**Checkpoint**: from here on, every story's deprecations are checked, and a ruled break has one sanctioned path.

---

## Phase 5: User Story 3 — CustomerAccount (Priority: P2)

- [ ] T046 [US3] Declare `CustomerAccountCommandPort` and move `listDueForAnonymization` / `hasDueForAnonymization` to `CustomerAccountReadPort` in `packages/contracts/src/customer-accounts.ts`; `@deprecated` per `data-model.md` § *Port disposition* (not the membership methods — `specs/191-membership-join-requests/` marks those)
- [ ] T047 [P] [US3] (after #1866) Failing co-located Command tests for block, unblock, soft-delete, restore, set group, create standalone, anonymise (and update profile / mark verified if T002 found them hand-audited) in `packages/modules/customer_accounts/src/backend/commands/`
- [ ] T048 [P] [US3] (after #1866) Failing parity test in `backend/test/contract/customer_accounts/customer-account-command-port.test.ts`
- [ ] T049 [P] [US3] (after #1866) Failing worker test (block with no administrator ends sessions; audit actor system) in `backend/test/integration/customer_accounts/customer-account-command-port.worker.test.ts`
- [ ] T050 [US3] (after #1866) Convert the hand-audited writes of `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts` to Commands, removing `auditLog.record*` / `recordAuditFromContext` there in the same change
- [ ] T051 [US3] (after #1866) Implement `packages/modules/customer_accounts/src/backend/services/customer-account-command-port.ts`, register it in `packages/modules/customer_accounts/src/backend/index.ts`; narrow ports delegate
- [ ] T052 [US3] (after #1866) Move the admin routes onto the port: `packages/modules/customers/src/backend/` (customer routes) and `packages/modules/organizations/src/backend/routes.members.ts`; declare the edges in both manifests; regression `backend/test/contract/customers/`
- [ ] T053 [US3] Drain the `customer` ledger entry; docs section in `packages/modules/customer_accounts/docs/`; changesets

---

## Phase 6: User Story 4 — Order lifecycle (Priority: P2)

- [ ] T054 [US4] Declare `OrderCommandPort` (without `place`), add `isTerminal` to `OrderReadPort` and `payer` to `OrderRecord` in `packages/contracts/src/orders.ts`; `@deprecated` on `orderTransitionPort`, `orderPaymentStatusApplyPort` (in `packages/modules/orders/src/ports/index.ts` if declared there) and `OrderExternalReferencePort.set`
- [ ] T055 [P] [US4] (after #1866) Failing co-located Command tests for `order.status_transition`, `order.payment_status_transition`, `order.comment.add` in `packages/modules/orders/src/backend/commands/`
- [ ] T056 [P] [US4] (after #1866) Failing parity test (refusal outcomes write and audit nothing; `already_there` records nothing) in `backend/test/contract/orders/order-command-port.test.ts`
- [ ] T057 [P] [US4] (after #1866) Failing worker test (status and payment status from a worker with `source: 'payment'`; comment notice sent) in `backend/test/integration/orders/order-command-port.worker.test.ts`
- [ ] T058 [US4] (after #1866) Convert status and payment-status transitions to Commands in `packages/modules/orders/src/backend/services/order-transition-service.ts` and `order-service.ts`, removing their `recordWithin` calls; transition effects keep running on the Command's transaction
- [ ] T059 [US4] (after #1866) Make order comments a Command in `packages/modules/orders/src/backend/services/order-comment-service.ts` (new action `order.comment.add`; buyer notice after commit)
- [ ] T060 [US4] (after #1866) Implement `packages/modules/orders/src/backend/services/order-command-port.ts`, register it; routes in `packages/modules/orders/src/backend/routes.ts` use the factories; `orderTransitionPort`, `orderPaymentStatusApplyPort` and `orderExternalReferencePort.set` delegate (`order-transition-port.ts`, `order-payment-status-apply-port.ts`, `order-external-reference-service.ts`)
- [ ] T061 [US4] (after #1866) Move in-repo consumers of the deprecated ports (`payments`, `shipments`, `quick_order` stays on placement until US11) to `orderCommandPort`
- [ ] T062 [US4] Drain the `order` ledger entry; docs in `packages/modules/orders/docs/`; changesets

---

## Phase 7: User Story 5 — QuoteRequest (Priority: P2)

- [x] T063 [US5] Declare `QuoteRequestCommandPort` in `packages/contracts/src/quote-requests.ts`, with the "not offered" paragraph
- [x] T064 [P] [US5] (after #1866) Failing co-located Command tests (create on behalf, patch draft, modify, approve, assign, cancel, custom-field values) in `packages/modules/quote_requests/src/backend/commands/` — #1824: approve, cancel, assign and custom-field values in `quote-request-admin-commands.test.ts`; create on behalf and modify are measured against Postgres in the T065 parity test; patch draft is the buyer's and not on the port
- [x] T065 [P] [US5] (after #1866) Failing parity test and off-state test (owner off → 503, nothing written) in `backend/test/contract/quote_requests/quote-request-command-port.test.ts`
- [x] T066 [P] [US5] (after #1866) Failing worker test (create for a customer and approve) in `backend/test/integration/quote_requests/quote-request-command-port.worker.test.ts`
- [x] T067 [US5] (after #1866) Convert the `#audit` writes in `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts` and `rfq-service.ts` to Commands, removing `#audit` from each converted path (buyer-side paths keep theirs — out of scope) — #1824: the five operator writes on the port; every `#audit` of `rfq-service.ts` is buyer-side, and `quote_request.prepare_customer_basket` (an operator write the port does not offer) keeps its hand audit
- [x] T068 [US5] (after #1866) Implement and register `packages/modules/quote_requests/src/backend/services/quote-request-command-port.ts`; routes use the factories
- [ ] T069 [US5] Drain the `quote_request` ledger entry; docs; changesets — docs and changesets landed with #1824; the ledger does not exist yet (T042), so there is no entry to drain

---

## Phase 8: User Story 6 — Product and attributes (Priority: P2)

- [ ] T070 [US6] Declare `CatalogProductCommandPort` and `CatalogAttributeCommandPort` in `packages/contracts/src/catalog.ts`; `@deprecated` on `CatalogProductWritePort` (all) and `CatalogProductScopeWritePort.applyScopes` (`packages/contracts/src/product-scopes.ts`)
- [ ] T071 [P] [US6] (after #1866) Failing parity tests including reindex and cache side effects in `backend/test/contract/catalog/catalog-product-command-port.test.ts` and `catalog-attribute-command-port.test.ts`
- [ ] T072 [P] [US6] (after #1866) Failing worker test (PIM-style scoped apply with `source`) in `backend/test/integration/catalog/catalog-product-command-port.worker.test.ts`
- [ ] T073 [US6] (after #1866) Implement both ports in `packages/modules/catalog/src/backend/services/catalog-command-ports.ts` over the existing Commands of `catalog-admin.service.ts`; register in `packages/modules/catalog/src/backend/index.ts`; move any route-side side effect into the shared path
- [ ] T074 [US6] (after #1866) Make `catalogProductWritePort` and `catalogProductScopeWritePort` delegate (`packages/modules/catalog/src/backend/services/catalog-write-ports.ts`); move in-repo consumers (`pim_connector`, `import_export`, `erp_connector` where they use them)
- [ ] T075 [US6] Drain the `product` ledger entry; docs in `packages/modules/catalog/docs/`; changesets

---

## Phase 9: User Story 7 — Project (Priority: P2)

- [ ] T076 [US7] Declare `ProjectCommandPort` (with its `Container name:` marker in the registering change, per the file's rule) and add `customFieldValues` to `ProjectRecord` in `packages/contracts/src/projects.ts`
- [ ] T077 [P] [US7] (after #1866) Failing parity test (stage guard veto on `moveToStage`) and off-state test in `backend/test/contract/projects/project-command-port.test.ts`
- [ ] T078 [P] [US7] (after #1866) Failing record test (`projectReadPort` carries `customFieldValues`) in `backend/test/contract/projects/project-read-port.custom-fields.test.ts`
- [ ] T079 [P] [US7] (after #1866) Failing worker test in `backend/test/integration/projects/project-command-port.worker.test.ts`
- [ ] T080 [US7] (after #1866) Implement and register `packages/modules/projects/src/backend/services/project-command-port.ts`; fill `customFieldValues` in the read port's mapper
- [ ] T081 [US7] Drain the `project` ledger entry; docs (with the investor example of the contract); changesets

---

## Phase 10: User Story 8 — Category (Priority: P3)

- [ ] T082 [US8] Declare `CatalogCategoryCommandPort` in `packages/contracts/src/catalog.ts`; `@deprecated` on `CatalogCategoryWritePort` (`listAll` → `catalogCategoryReadPort.listAll`)
- [ ] T083 [P] [US8] (after #1866) Failing parity test (navigation cache refresh on move) and a no-double-audit test for thresholds in `backend/test/contract/catalog/catalog-category-command-port.test.ts`
- [ ] T084 [US8] (after #1866) Make thresholds a Command `category.inventory_thresholds.set` in `packages/modules/catalog/src/backend/services/category-admin.service.ts` (removing its `command-coverage-ignore`) and narrow `inventory`'s own audit to its settings in `packages/modules/inventory/src/backend/`
- [ ] T085 [US8] (after #1866) Implement and register the port; `catalogCategoryWritePort` delegates; move in-repo consumers (`inventory`)
- [ ] T086 [US8] Drain the `category` ledger entry; docs; changesets

---

## Phase 11: User Story 9 — Opportunity (Priority: P3)

- [ ] T087 [US9] Declare `OpportunityCommandPort` and add `customFieldValues` to `OpportunityRecord` in `packages/contracts/src/crm.ts`; `@deprecated` on `OpportunityTransitionPort.applyStatus`
- [ ] T088 [P] [US9] (after #1866) Failing parity test (guard veto outcome) and off-state test in `backend/test/contract/crm/opportunity-command-port.test.ts`
- [ ] T089 [P] [US9] (after #1866) Failing worker test in `backend/test/integration/crm/opportunity-command-port.worker.test.ts`
- [ ] T090 [US9] (after #1866) Implement and register `packages/modules/crm/src/backend/services/opportunity-command-port.ts`; the transition port delegates; fill `customFieldValues` in the read mapper
- [ ] T091 [US9] Drain the `opportunity` ledger entry; docs; changesets

---

## Phase 12: User Story 10 — Task (Priority: P3)

- [ ] T092 [US10] Declare `TaskCommandPort` and add `customFieldValues` to `TaskRecord` in `packages/contracts/src/tasks.ts`; `@deprecated` on `TaskWritePort`
- [ ] T093 [P] [US10] (after #1866) Failing parity and off-state tests in `backend/test/contract/tasks/task-command-port.test.ts`
- [ ] T094 [P] [US10] (after #1866) Failing worker test (publish notifies assignees) in `backend/test/integration/tasks/task-command-port.worker.test.ts`
- [ ] T095 [US10] (after #1866) Implement and register `packages/modules/tasks/src/backend/services/task-command-port.ts`; `taskWritePort` delegates (`task-write-port.ts`); move `projects`' stage-task calls to the new port with an unchanged `nonBindingDependencies` declaration
- [ ] T096 [US10] Drain the `task` ledger entry (the ledger is now empty — delete it, as its header says); docs; changesets

---

## Phase 13: User Story 11 — Order placement with a payer (Priority: P3)

**May ship in a later release than Phase 6, as an additive method.**

- [ ] T097 [US11] Add `place` and `OrderPlaceOptions` to `OrderCommandPort` in `packages/contracts/src/orders.ts`
- [ ] T098 [P] [US11] (after #1866) Failing integration tests: payer allowed (billed to payer, record carries `payer`), payer refused (related-payer refusal, nothing written), `related_payers` off, stock and credit effects identical to checkout, one audit entry, in `backend/test/integration/orders/order-command-port.place.test.ts`
- [ ] T099 [US11] (after #1866) Wrap placement in a Command `order.place` in `packages/modules/orders/src/backend/services/order-service.ts` (`order.place_on_behalf` stays the action when an administrator places for a customer; its post-commit `auditLog.record` moves inside), with the admin create route and the buyer checkout running it
- [ ] T100 [US11] (after #1866) Implement `place` on the port; `@deprecated` on `OrderPlacementPort` in the same change; move `quick_order` to the new method
- [ ] T101 [US11] Docs; changesets

---

## Phase 14: Polish and release preparation (0.113.0)

- [ ] T102 [P] Upgrade note for 0.113.0 (every deprecation: old call → new call; the comparison) in `docs/docs/upgrading-an-instance.md` and its Polish translation
- [ ] T103 [P] Open a tracking issue (labels per the repository's practice) for the paid modules' migration off the eight superseded ports, to be done after 0.113.0 publishes and before 0.114.0
- [ ] T104 Run `pnpm --filter backend exec tsx scripts/check-release-intent.ts --since origin/master --contract-base v0.112.0` on the release branch: expect zero contract findings, `ruled=0` (SC-003)
- [ ] T105 Full verification: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter backend run test:unit:fast`, `pnpm --filter '!backend' run test`, `check:port-shape`, `check:port-dependencies`, `check:port-catches`, `check:command-coverage`, `check:custom-field-writes`, `check:module-boundary`, and a `workflow_dispatch` of `.github/workflows/backend-suite.yml` on the branch (D-198)

---

## Phase 15: User Story 12 — Removal (Priority: P3) — on the 0.114.0 branch only

- [ ] T106 [US12] Failing check first: on a branch cut from the 0.113.0 tag, assert that removing one deprecated method reds `check-release-intent.ts --contract-base v0.112.0`, and the same removal passes with `--contract-base v0.113.0` (record both runs in the MR)
- [ ] T107 [US12] Remove every port and method listed as deprecated in `data-model.md` § *Port disposition* (not the membership methods, which spec 191 schedules) from `packages/contracts/src/` and their delegating implementations from the owner modules
- [ ] T108 [US12] Grep `backend/test/**` and `packages/**` for every removed name (AGENTS.md trap: deleting a file) and re-derive anything derived from them (port-dependency ledgers, read sizes)
- [ ] T109 [US12] Upgrade note for 0.114.0 (EN + PL) and changesets (minor in `0.x`, D-225); the 0.114.0 release pull request also removes every spent `SANCTIONED_CONTRACT_BREAKS` entry (SC-007)

---

## Dependencies and execution order

- Phase 1 (inventory) → Phase 2 (foundation) → everything else.
- US2 (Phase 4) is pure tooling: it may land before or in parallel with US1; its T042 ledger is drained
  by each story's last task. T039 (the population move) lands before T040 and T042.
- All "Declare" tasks (T019, T046, T054, T063, T070, T076, T082, T087, T092, T097) may merge before
  #1866. Everything marked (after #1866) waits for it.
- After #1866: **US1 first** (T026 before anything else in it). Then US3, US4, US5, US6, US7 may run in
  parallel — different owner modules — except that US3 touches `organizations` (`routes.members.ts`) and
  must not run beside US1's route work. US8–US10 after, US11 last, US12 only in the next release.
- Within a story: tests → conversion → port → delegation → consumers → ledger/docs/changeset.

## Parallel examples

- Phase 1: T001–T009 all at once (read-only).
- US1 tests: T021, T022, T023, T024, T025 together.
- After US1: US4 (orders), US5 (quote_requests), US6 (catalog products), US7 (projects) by four agents.

## Implementation strategy

MVP = Phase 1–3 (Organization port), which unblocks 188 and 191. Then Phase 4 so every later
deprecation is checked. Then the P2 aggregates, the P3 aggregates, placement, and — in the next
release — the removals. Each story is independently shippable; a story that slips leaves its narrow
ports undeprecated, which is safe.

## FR → task trace

| FR | Tasks |
| --- | --- |
| FR-001, FR-010, FR-011, FR-014 | T012–T014, T036, T042, each story's declare/drain task |
| FR-002, FR-003, FR-013 | T015, each story's parity test and conversion task |
| FR-004, FR-005, FR-007 | T024, T049, T057, T066, T072, T079, T089, T094 |
| FR-006, FR-008, FR-009, FR-012 | each story's declare task and parity test |
| FR-015 | T054, T076, T078, T087, T092 |
| FR-020 … FR-028 | Phases 3, 5–13 |
| FR-030 | T016, T044 |
| FR-031, FR-035 | T019 and each declare task, T106–T109 |
| FR-032 | T017, T044 |
| FR-033, FR-034 | T034, T035, T038–T041, T043 |
| FR-036 | each story's changeset task, T045 |
| FR-037 | T037, T038, T040, T041, T109 |
