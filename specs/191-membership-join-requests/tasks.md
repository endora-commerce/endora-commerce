# Tasks: Membership moves and join requests on an existing tax ID

**Input**: `specs/191-membership-join-requests/` — plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md. **Ruling**: D-298, including the owner answers of 2026-11-23 (items 8 – 12:
OQ-1 = B, OQ-2 – OQ-4 confirmed, OQ-5 changed — approval into a branch is built here).
**Tests**: required (Principle III, NN). In every phase the test tasks come first and must fail
before the implementation tasks they cover.
**Preconditions**: #1866 (MikroORM 7.2.11) on `master` before Phase 2's entity work;
`specs/186-aggregate-ports/` on `master` before Phase 3; `specs/188-policy-points/` before T032
(else T032a, the interim).

## Format: `[ID] [P?] [Story] Description`

- **[P]** parallelisable (different files, no dependency on an unfinished task)
- **[USn]** the user story of `spec.md`; Setup, Foundational and Polish carry none
- Paths are repository-relative

---

## Phase 1 — Setup

- [ ] T001 Create the implementation branch `feat/191-membership-join-requests` from `origin/master` in its own worktree (`scripts/setup-worktree.sh`), run `pnpm run build:packages`, confirm #1866 and 186 are merged (`git log origin/master`)
- [ ] T002 [P] Read the routed conventions listed in plan.md § Handoff item 3 and the precedents in item 4; note in the MR description which 188 surface exists (point declaration field, participant seam, conformance helper)

## Phase 2 — Foundational (blocks every story)

### Contracts (WP-0) — tests first

- [ ] T003 [P] Failing schema tests for the membership types and `membershipChangeSourceSchema` in `packages/contracts/src/customer-accounts.membership.test.ts`
- [ ] T004 [P] Failing schema tests for `organizationJoinRequestViewSchema` (with `placementOrganizationId`), `RegistrantJoinRequestView`, `CompanyJoinRequestView` (with `placement`), `AdminJoinRequestView`, `joinRequestPlacementListSchema`, the request bodies (approve with optional `placementOrganizationId`) and `RegistrationConflictInputSchema` / `VerdictSchema` in `packages/contracts/src/organization-join-requests.test.ts`
- [ ] T005 [P] Failing test that `registerOrganizationResponseSchema` parses today's 201 body plus `outcome` and the 202 body, and that the 202 shape has no `organization` key, in `packages/contracts/src/organizations.register-response.test.ts`
- [ ] T006 [P] Failing test for the new hookable refs (`CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS.changeOrganization`, six `ORGANIZATION_HOOKABLE_ACTIONS.joinRequest*`, the approve hook data and outbox carrying `placementOrganizationId`) in `packages/contracts/src/command-hooks.test.ts`

### Contracts — implementation

- [ ] T007 Add `MembershipChangeInput`, `MembershipDetachInput`, `MembershipChangeResult`, `MembershipChangeCommand`, `MembershipPort` (with the `Container name:` marker), `MEMBERSHIP_CHANGE_SOURCES`, `membershipChangeSourceSchema` (186's source regex; an alias of 186's schema if it has landed), and `PreparedCustomerAccountCreate.customerAccountId`; mark `setOrganization`, `detachToPersonalOrganization`, `attachToOrganization` and `CustomerAccountOrganizationMoveInput.actorAdminUserId` `@deprecated` — `packages/contracts/src/customer-accounts.ts` (contracts/membership-port.md §1–2, §5)
- [ ] T008 [P] Create `packages/contracts/src/customer-account-hooks.ts` (hook data, outbox, ref, `CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT`) and export it from the package index
- [ ] T009 [P] Create `packages/contracts/src/organization-join-requests.ts` (states, views, bodies, the placement list, policy schemas, `OrganizationJoinRequestPort` with `approve({ placementOrganizationId? … })` and `listPlacements`) and append the six refs to `packages/contracts/src/organization-hooks.ts`
- [ ] T010 [P] Change `registerOrganizationRequestSchema` (`joinRequestNote`), `registerOrganizationResponseSchema` (union) and `registrationOptionsResponseSchema` (`joinRequestsOffered`) in `packages/contracts/src/organizations.ts` and `packages/contracts/src/organization-registry-lookup.ts`
- [ ] T011 [P] Add the five error codes to `packages/contracts/src/errors.ts` (contracts/join-requests.md §3; `NOT_APPROVABLE` with the four tokens including `placement_not_active`)
- [ ] T012 `pnpm run build:packages`; changeset for `@endora-commerce/contracts` (minor, additive; the union named in the body) per `specs/conventions/release-intent.md`

### Join-request storage (start of WP-2, after #1866)

- [ ] T013 Failing entity test: classification `@OrgScoped` (on the target, never on the placement), defaults, the partial unique index refusal mapped to `ORGANIZATION_JOIN_REQUEST_OPEN`, the check that `placement_organization_id` and `granted_organization_role_id` are set iff `approved` — `packages/modules/organizations/src/backend/entities/organization-join-request.entity.test.ts`
- [ ] T014 Create `OrganizationJoinRequest` with MikroORM 7 legacy decorators — `packages/modules/organizations/src/backend/entities/organization-join-request.entity.ts` (data-model.md §1)
- [ ] T015 Scaffold the migration with `pnpm --filter backend run migration:new` in `packages/modules/organizations/src/migrations/` (table, four indexes, partial unique index, checks, the three FKs — target, placement, account), run `composer:generate`, commit the registries
- [ ] T016 [P] Add `organization_join_requests → customer_accounts` to `backend/test/unit/db/acknowledged-fk-edges.ts` and run `backend/test/unit/db/fk-dependency-drift.test.ts` and `migration-ownership.test.ts`
- [ ] T017 [P] Add `ORGANIZATION_JOIN_REQUEST_AUDIT_KEYS` (with `placement`) and the snapshot helper to `packages/modules/organizations/src/backend/services/organization-audit-state.ts` with its subset unit test

**Checkpoint**: contracts built, table migrates up and down, tenancy classification green.

---

## Phase 3 — US1: a person is moved to another Organization (P1) — WP-1

**Goal**: #1831 and case 5. **Independent test**: spec US1.

### Tests first

- [ ] T018 [P] [US1] Failing unit tests for `customer_account.organization.change`: default *Member*, foreign role 404, same-place no-op (no audit, no event), company last-administrator `409 ORG_OWNER_DEPLETION` under the lock, personal source never refused, detach provisions the personal Organization — `packages/modules/customer_accounts/src/backend/commands/customer-account-change-organization.command.test.ts`
- [ ] T019 [P] [US1] Failing audit sentinel test (`expectNoAuditValues`; a fresh Organization id and name as sentinels; `changedFields`, `mode`, `source` present) — `packages/modules/customer_accounts/src/backend/services/customer-account-audit-sentinels.test.ts` (extend)
- [ ] T020 [P] [US1] Failing `expectHookableCommand` test and a `beforeCommit` veto test (nothing written, no event, no outbox row) — `packages/modules/customer_accounts/src/backend/commands/customer-account-change-organization.hooks.test.ts`
- [ ] T021 [P] [US1] Failing integration test: a worker under `enterSystemScope` moves an account to a branch with no administrator; actor kind `system` with `source: 'integration'` in the audit entry and the event (owner answer to 186 Q-1); one `customer_account.organization_changed.v1`; the next authenticated request resolves the branch; the old Organization's basket stays — `backend/test/integration/customer_accounts/membership-worker-move.test.ts`
- [ ] T022 [P] [US1] Failing tests that the deprecated lifecycle methods delegate (one audit row, new action) and that `customers`' assign / unassign still answer as before — `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.test.ts`, `packages/modules/customers/src/backend/services/customer-org-assignment-service.test.ts`
- [ ] T022a [P] [US1] Failing test that `PersonalOrganizationService.ensureForCustomerAccountId`'s repair arm binds through `membershipPort.detachToPersonal` (one `customer_account.organization.change` entry, `source: 'personal_organization_repair'`) and no longer calls `attachToOrganization` — `packages/modules/organizations/src/backend/services/personal-organization-service.link.test.ts` (extend)

### Implementation

- [ ] T023 [US1] Implement the Command — `packages/modules/customer_accounts/src/backend/commands/customer-account-change-organization.command.ts` (contracts/membership-port.md §3–4)
- [ ] T024 [US1] Implement `membershipPort` (`changeOrganization`, `detachToPersonal`, `changeCommand`) — `packages/modules/customer_accounts/src/backend/services/membership-port.ts`; register with `ctx.di.providePort('membershipPort', …)` in `packages/modules/customer_accounts/src/backend/index.ts`
- [ ] T025 [US1] Declare the hookable action in `packages/modules/customer_accounts/src/manifest.ts`; add `mode`, `source` to `CUSTOMER_ACCOUNT_AUDIT_KEYS` in `customer-account-audit-state.ts`
- [ ] T026 [US1] Delegate `setOrganization` / `detachToPersonalOrganization` to the Command and delete `#writeOrganization` and its hand-written audit — `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts`
- [ ] T026a [US1] Mark `attachToOrganization` `@deprecated` in `packages/modules/customer_accounts/src/backend/services/customer-account-ports.ts`; switch `ensureForCustomerAccountId`'s repair arm to `membershipPort.detachToPersonal` — `packages/modules/organizations/src/backend/services/personal-organization-service.ts` (contracts/membership-port.md §5)
- [ ] T027 [US1] Switch `CustomerOrgAssignmentService` to `lazyPort<MembershipPort>(ctx, 'membershipPort')`, keep `assertAuthorized` and `roleInTarget`, remove the duplicate depletion pre-check — `packages/modules/customers/src/backend/services/customer-org-assignment-service.ts`, `packages/modules/customers/src/backend/plugin.ts`
- [ ] T028 [US1] Run `check:port-dependencies`, `check:port-shape`, `check:port-catches`, `check:module-boundary`; changesets for `customer_accounts` and `customers`

**Checkpoint**: US1 passes alone; mergeable as its own MR.

---

## Phase 4 — US5: the store keeps control of the policy (P2, needed by US2) — WP-3 part 1

### Tests first

- [ ] T029 [P] [US5] Failing tests: default `refuse` on a fresh settings store; `join_request` from the setting; a participant that throws, times out or answers outside the schema → `refuse`; `ambiguous` → `refuse` — `packages/modules/organizations/src/backend/services/registration-conflict-policy.test.ts`
- [ ] T030 [P] [US5] Failing conformance test with a test participant answering `refuse` for one channel (188's helper) — `packages/modules/organizations/src/backend/services/registration-conflict-policy.conformance.test.ts`

### Implementation

- [ ] T031 [US5] Declare the four settings and their codes in `ORGANIZATIONS_SETTING_CODES`, with labels in `packages/modules/organizations/i18n/{en,pl}.json` — `packages/modules/organizations/src/manifest.ts`, `src/backend/schemas/settings.ts`
- [ ] T032 [US5] Declare the policy point and implement the default participant + owner validation — `packages/modules/organizations/src/manifest.ts`, `src/backend/services/registration-conflict-policy.ts` (contracts/registration-conflict-policy.md)
- [ ] T032a [US5] *Only if 188 is not merged*: the interim `decideRegistrationConflict` in the same file, behind the same schemas; open a follow-up issue to adopt the point
- [ ] T033 [US5] Include `conflict_policy` in `registrationOptionsRevalidation` and serve `joinRequestsOffered` — `packages/modules/organizations/src/backend/registry-lookup/registration-options-revalidation.ts`, `routes.public.ts`

---

## Phase 5 — US2: a registrant asks to join (P1) — WP-2 + WP-3 part 2 + WP-4

### Tests first

- [ ] T034 [P] [US2] Failing Command tests for `create` (registration origin): one transaction writes the personal Organization, the account (child entry), the request (`awaiting_email_confirmation`) and the token; any failure leaves none; the race answers `409 REGISTRATION_CONFLICT_CHANGED`; port origin with a confirmed e-mail creates `pending` — `packages/modules/organizations/src/backend/commands/join-request-create.command.test.ts`
- [ ] T035 [P] [US2] Failing tests for `submit` and `withdraw` (states, lock, version, `409 ORGANIZATION_JOIN_REQUEST_DECIDED`) — `packages/modules/organizations/src/backend/commands/join-request-transitions.command.test.ts`
- [ ] T036 [P] [US2] Failing audit sentinel tests for every join-request Command (note, typed name, reason, e-mail, target id, and for `approve` a branch placement's id and name as sentinels; `placement: 'branch'` present) — `packages/modules/organizations/src/backend/services/organization-audit-sentinels.test.ts` (extend)
- [ ] T037 [P] [US2] Failing `expectHookableCommand` tests for the six refs — `packages/modules/organizations/src/backend/commands/organization-hookable-actions.test.ts` (extend)
- [ ] T038 [P] [US2] Failing registration-service tests: `refuse` unchanged (SC-001); `join_request` branch skips the company Command, keeps the account's custom-field values, drops the organization group's; the note stored only on the join path — `packages/modules/organizations/src/backend/services/registration-service.join-request.test.ts`
- [ ] T039 [P] [US2] Failing contract test: `POST /api/v1/organizations/register` 202 shape (no `organization`, no target id, sentinels for the stored name and status absent — SC-006); 201 shape a superset of today's — `backend/test/contract/organizations/register-join-request.contract.test.ts`
- [ ] T040 [P] [US2] Failing verification tests: `verify` leaves a personal Organization's status alone (both `active` and `pending_verification` stay as they are), still activates a company in `pending_verification`, and submits the account's open request — `packages/modules/organizations/src/backend/services/email-verification-service.test.ts`
- [ ] T040a [P] [US2] Failing tests for OR-8 (FR-048): on a channel with `customers.allow_registration_without_organization = false` the join path's personal Organization is `pending_verification` and adding to a basket answers the existing not-active refusal; with `true` it is `active`; an unregistered setting code reads `false`; `provisionFor` without `status` stays `active` for every existing caller — `packages/modules/organizations/src/backend/services/personal-organization-service.status.test.ts`, `backend/test/contract/organizations/register-join-request.contract.test.ts` (extend)
- [ ] T041 [P] [US2] Failing contract tests for `GET /api/v1/me/join-request` and withdraw (own only; another account's id 404) — `backend/test/contract/organizations/registrant-join-request.contract.test.ts`
- [ ] T042 [P] [US2] Failing subscriber tests: anonymisation erases the three texts; a move with `source !== 'join_request'` withdraws the open request — `packages/modules/organizations/src/backend/services/join-request-subscribers.test.ts`

### Implementation

- [ ] T043 [US2] Implement `create`, `submit`, `withdraw`, `erase_texts` — `packages/modules/organizations/src/backend/commands/join-request-{create,submit,withdraw,erase-texts}.command.ts`
- [ ] T044 [US2] Implement the pre-assigned account id on `prepareCreate` (the owner side of T007) — `packages/modules/customer_accounts/src/backend/commands/customer-account-create.command.ts` and its preparation service; test in `customer-account-create.command.test.ts`
- [ ] T045 [US2] Implement routing (pure, R-12) — `packages/modules/organizations/src/backend/services/join-request-routing.ts` + `.test.ts`
- [ ] T046 [US2] Branch `RegistrationService.registerOrganization` on the policy verdict; build the join Command with the prepared account — `packages/modules/organizations/src/backend/services/registration-service.ts`
- [ ] T046a [US2] OR-8: `provisionFor`'s optional `status`; read the channel's private-registration gate by code in the pre-check (`settingsReadPort.get('customers.allow_registration_without_organization', salesChannelId, z.boolean())`, default `false`) and pass it into the Command — `packages/modules/organizations/src/backend/services/{personal-organization-service,registration-service}.ts`, `commands/join-request-create.command.ts` (research R-26)
- [ ] T047 [US2] Return 202 and send `organization_join_request_email_confirmation` after commit — `packages/modules/organizations/src/backend/routes.public.ts`
- [ ] T048 [US2] Change `EmailVerificationService.verify` (personal status untouched; run `submit`) — `packages/modules/organizations/src/backend/services/email-verification-service.ts`
- [ ] T049 [US2] Registrant routes — `packages/modules/organizations/src/backend/routes.customer.ts` (contracts/storefront-api.md §2), the hatch `withSystemScope('organizations: a registrant reads their own join request', …)`
- [ ] T050 [US2] Subscribers with `ctx.subscribe` — `packages/modules/organizations/src/backend/index.ts`, handlers in `services/join-request-subscribers.ts`
- [ ] T051 [US2] Templates (en + pl defaults, the approved template's two variants by `companyName`) and manifest `transactionalEmails` entries — `packages/modules/organizations/src/backend/email-templates/join-request-defaults.ts`, `src/manifest.ts`
- [ ] T052 [US2] `organizationJoinRequestPort` (`requestToJoin`, `withdraw`, `findOpenForAccount` now; `approve` / `reject` in Phase 6) — `packages/modules/organizations/src/backend/services/join-request-port.ts`, `providePort` in `index.ts`; acknowledged edge `membershipPort` in `src/manifest.ts`
- [ ] T053 [P] [US2] Storefront: register page `join-requested` state, note field when offered, refusal copy for the two new codes — `storefront/app/(auth)/register/{page.tsx,actions.ts}`, `storefront/lib/auth/register-form-state.ts`, messages en + pl; tests in `storefront/test/auth/register-join-request.test.tsx`
- [ ] T054 [P] [US2] Storefront: `JoinRequestNotice` with withdraw on the account home — `storefront/components/account/JoinRequestNotice.tsx`, `storefront/app/(account)/account/`, `storefront/lib/api/join-requests.ts`; test `storefront/test/account/join-request-notice.test.tsx`
- [ ] T055 [P] [US2] Storefront: a test that the account context is not cached across requests (R-6) — `storefront/test/account/account-context-no-cache.test.ts`

**Checkpoint**: with the policy at `join_request`, a registrant reaches *pending* after confirming.

---

## Phase 6 — US3: a company administrator decides (P1)

### Tests first

- [ ] T056 [P] [US3] Failing Command tests for `approve` (child move with `source: 'join_request'`, role default *Member*, `NOT_APPROVABLE` issues, race 409) and `reject` (reason ≤ 500) — `packages/modules/organizations/src/backend/commands/join-request-decide.command.test.ts`
- [ ] T056a [P] [US3] Failing unit tests for `JoinRequestPlacementService` (research R-27, R-30), one case per decider kind: company administrator **without** roll-up → the target only, a descendant `404`; **with** roll-up (tenant context `allowed` = the subtree) → the target and every active descendant; operator → descendants passing `canSeeOrganization`, all under a platform-wide scope; server-side caller → every active descendant; for all of them the parent, a sibling, another tree's Organization, a deleted one, a malformed id and an unreadable `path` `404`; blocked / `pending_verification` / `rejected` placements not listed; `path` order, target first, `depth`, `q`, `limit` ≤ 100, roles with *Member* as default; `list` and `assertEligible` agree on every fixture — `packages/modules/organizations/src/backend/services/join-request-placement.test.ts`
- [ ] T056b [P] [US3] Failing Command tests for `approve` **with a placement** (research R-28, R-29): the child move's `toOrganizationId` is the branch; no role → the branch's *Member*; a role of the target or of another branch → `404` from the child; a blocked branch → `409 NOT_APPROVABLE` `placement_not_active` with the request still `pending` and its `version` unchanged; the row records `placement_organization_id` and the role; hook data carries `placementOrganizationId` / `placementIsTarget`; the outbox carries `placementOrganizationId` and keeps `organizationId` = the target; `decided.v1` carries `placementOrganizationId`; a `beforeCommit` veto on `approve` and one on `customer_account.organization.change` each leave nothing written — `packages/modules/organizations/src/backend/commands/join-request-approve-placement.command.test.ts`
- [ ] T056c [P] [US3] Failing integration test for FR-104's race: an approval into branch C and C's block (`organization.blocked`), delete and re-parent each run concurrently; exactly one outcome per pair (either the approval commits and C's change waits, or C's change commits and the approval answers `placement_not_active` / `404`) — never a member placed in a branch that was blocked first — `backend/test/integration/organizations/join-request-placement-race.test.ts`
- [ ] T057 [P] [US3] Failing contract tests for `/api/v1/organizations/mine/join-requests*`: administrator lists only routed-to-company pending; non-administrator 403 `FORBIDDEN`; another Organization 404; approve with a role of another Organization 404 — `backend/test/contract/organizations/company-join-requests.contract.test.ts`
- [ ] T057a [P] [US3] Failing contract tests for the storefront placements route and branch approval (contracts/storefront-api.md §3, §5): without roll-up one item and naming a branch `404`; with roll-up the branch listed and accepted, the person's next authenticated request scoped to the branch with the role; a blocked branch unlisted and `409`; the target's parent and a sibling tree's Organization `404`; a decided row shows `placement.organization` only within the viewer's reach; a roll-up administrator of the root does not list or decide a request addressed to a branch (global scope) — `backend/test/contract/organizations/company-join-request-placements.contract.test.ts`
- [ ] T058 [P] [US3] Failing notification tests: `submit` routed to the company e-mails every active administrator in their language; `approve` / `reject` e-mail the registrant (reason included when given; an approval into a branch names the branch and the company, into the target only the target); the branch's administrators receive nothing; `customer_notifications` absent → e-mail only — `packages/modules/organizations/src/backend/services/join-request-notifications.test.ts`
- [ ] T059 [P] [US3] Failing integration test of the whole flow: register → confirm → administrator approves → the registrant's next request is scoped to the company with the role (SC-002, SC-005); a second run with a roll-up administrator approving into a branch, scoped to the branch (SC-009) — `backend/test/integration/organizations/join-request-flow.test.ts`
- [ ] T063a [P] [US3] Failing storefront Vitest for the approve dialog: no *Place in* select for one placement; with several, the company first and labelled, branches indented, the role list re-filled from the chosen placement with *Member* preselected; a `placement_not_active` refusal keeps the dialog open and reloads; en and pl strings of contracts/storefront-api.md §4 — `storefront/test/account/decide-join-request-dialog.test.tsx`

### Implementation

- [ ] T060 [US3] Implement `JoinRequestPlacementService` (`list`, `assertEligible`; the decider from the request's tenant context and actor, never from the body) — `packages/modules/organizations/src/backend/services/join-request-placement.ts` (research R-27, R-30)
- [ ] T060a [US3] Implement `approve` (with the placement steps and `for share` locks of research R-28) and `reject` — `packages/modules/organizations/src/backend/commands/join-request-{approve,reject}.command.ts`; add `approve`, `reject` and `listPlacements` to the port (T052)
- [ ] T061 [US3] Company routes (with `GET …/:id/placements` and the approve body's `placementOrganizationId`) and `pendingJoinRequestCount` on the members list — `packages/modules/organizations/src/backend/routes.members.ts`
- [ ] T062 [US3] Notices through `ctx.commandHooks` `afterCommit` on submit / approve / reject — `packages/modules/organizations/src/backend/services/join-request-notifications.ts`, `index.ts`
- [ ] T063 [P] [US3] Storefront: *Join requests* tab with approve (placement select when several, role select) and reject (reason dialog) — `storefront/components/account/{JoinRequestsTab.tsx,DecideJoinRequestDialog.tsx}`, `storefront/app/(account)/organization/members/`, `storefront/lib/api/join-requests.ts`, messages en + pl; test `storefront/test/account/join-requests-tab.test.tsx`

---

## Phase 7 — US6: requests do not pile up (P3)

### Tests first

- [ ] T064 [P] [US6] Failing tests: the store-day window; at the limit `429 ORGANIZATION_JOIN_REQUEST_LIMIT` before anything is written; two concurrent registrations never exceed the limit (lock on the target row) — `packages/modules/organizations/src/backend/services/join-request-daily-limit.test.ts`, `backend/test/integration/organizations/join-request-limit-race.test.ts`
- [ ] T065 [P] [US6] Failing tests for `expire` and the sweep (probe, batch, skipped race, never-confirmed request expires) — `packages/modules/organizations/src/backend/workers/join-request-expiry-sweep-worker.test.ts`

### Implementation

- [ ] T066 [US6] Daily limit (module-local store-day helper, pre-check + in-Command count under lock) — `packages/modules/organizations/src/backend/services/join-request-daily-limit.ts`, used by T043 and T046
- [ ] T067 [US6] `expire` Command and the sweep worker via `ctx.worker`; the expired notice — `packages/modules/organizations/src/backend/commands/join-request-expire.command.ts`, `src/backend/workers/join-request-expiry-sweep-worker.ts`, `index.ts`
- [ ] T068 [US6] Run `check:subscribe-seam` and `check:entry-presence`

---

## Phase 8 — US4: the operator's queue (P2) — WP-6

### Tests first

- [ ] T069 [P] [US4] Failing contract tests for `/api/v1/admin/organization-join-requests*`: filters, oldest first, reach 404, read-only operator 403 on approve, operator may decide a company-routed request — `backend/test/contract/organizations/admin-join-requests.contract.test.ts`
- [ ] T069a [P] [US4] Failing contract tests for the admin placements route and branch approval: an operator reaching the target but not branch C does not get C and gets `404` naming it; a platform-wide operator gets every active branch; a read-only operator `403` on the placements route; the detail shows *Placed in* only within reach — `backend/test/contract/organizations/admin-join-request-placements.contract.test.ts`
- [ ] T070 [P] [US4] Failing notification test: routed to the operator → one in-app notification; `admin_notifications` absent → none, no failure — `packages/modules/organizations/src/backend/services/join-request-notifications.test.ts` (extend)
- [ ] T071 [P] [US4] Failing admin Vitest: queue renders pl enum labels; approve dialog preselects *Member*; the *Place in* combobox absent for one placement and present for several, re-filling the roles; no raw enum values — `packages/modules/organizations/src/admin/pages/OrganizationJoinRequestsPage.test.tsx`

### Implementation

- [ ] T072 [US4] Admin routes (with `GET …/:id/placements` under `organizations:decide-join-requests` and reach) — `packages/modules/organizations/src/backend/routes.admin-join-requests.ts`; `pendingJoinRequestCount` on the admin Organization detail in `routes.admin.ts`
- [ ] T073 [US4] Permissions, palette action, sidebar entry and their i18n keys — `packages/modules/organizations/src/manifest.ts`, `src/admin/index.ts`, `i18n/{en,pl}.json`; icon in `packages/contracts/src/admin-actions.ts` + `admin/src/lib/admin-actions/icon-map.ts` if `UserPlus` is absent
- [ ] T074 [US4] Queue page, detail drawer (*Placed in*), decide dialogs (placement combobox, role select), enum labels, Organization detail link — `packages/modules/organizations/src/admin/{pages/OrganizationJoinRequestsPage.tsx,lib/labels.ts,api/join-requests.ts}`, `pages/OrganizationDetail.tsx`
- [ ] T075 [US4] Operator in-app notification on `submit` (non-binding `admin_notifications` edge as for new registrations) — `services/join-request-notifications.ts`
- [ ] T076 [US4] Run `permission-inventory.test.ts`, `check:action-route-permissions`, `palette-coverage.test.ts`, `registered-bundles-shape.test.ts`, `i18n:hardcoded`

---

## Phase 9 — Polish and cross-cutting (WP-7)

- [ ] T077 [P] Documentation (en): `packages/modules/organizations/docs/organization-join-requests.md` (new: both flows, settings, approval into a branch and who may choose it — roll-up for company administrators, reach for operators —, the closed-channel personal Organization, policy point for developers, the `organization.register` vs `join_request.create` hook note, the 202 union) and sections in `docs/organizations.md` and `packages/modules/customer_accounts/docs/customer_accounts.md` (`membershipPort`, the event, deprecations); run `check:module-docs`
- [ ] T078 [P] Documentation (pl) per `docs/docs/contributing/documentation-i18n.md`
- [ ] T079 [P] `docs/docs/architecture/customisation-ladder.md`: the conflict point as a worked example (only if 188 has not already added it)
- [ ] T080 Changesets for `@endora-commerce/contracts`, `organizations`, `customer_accounts`, `customers`, the storefront reference app; upgrade note (the deprecated methods; the reply union under a non-default policy)
- [ ] T081 `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`, `composer:check`; re-derive the module-removal and FK ledgers (AGENTS.md traps)
- [ ] T082 `pnpm -r run typecheck`, `pnpm -r run lint`, `test:unit:fast`, `pnpm --filter '!backend' run test`, the targeted contract/integration files above, `check:naming`, `check:language`, `check:custom-field-writes`, `check:error-translations`, `harness-parity.test.ts`
- [ ] T083 Walk `quickstart.md` §1–5 on the dev stack; record the result in the MR
- [ ] T084 Dispatch `.github/workflows/backend-suite.yml` before the 0.113.0 release PR (D-198)

---

## Dependencies

```text
Phase 1 → Phase 2 (contracts; storage after #1866)
Phase 2 → Phase 3 (US1)  ─┐
Phase 2 → Phase 4 (US5)   ├→ Phase 5 (US2) → Phase 6 (US3) → Phase 7 (US6)
                          │                 └──────────────→ Phase 8 (US4)
Phase 3 ─────────────────┘ (approve runs the move)
all → Phase 9
```

US1 is independently shippable. US2 needs US1 (approval later), US5 and the storage. US3 needs
US2. US4 and US6 need US2's Commands and can run in parallel with US3.

## Parallel examples

- Phase 2: T003–T006 together; then T008–T011 together after T007.
- Phase 3: T018–T022 together.
- Phase 5: T034–T042 (with T040a) together; T053–T055 together after T049.
- Phase 6: T056–T059 with T056a–T056c, T057a and T063a together; T060 before T060a.
- After Phase 6: Phase 7 and Phase 8 by two developers.

## Implementation strategy

1. **MVP-1**: Phases 1–3 — the membership move (case 5, ERP imports). Merge.
2. **MVP-2**: Phases 4–6 — join requests decided by companies; safe to switch on (confirmation,
   one open request). Merge with the policy still `refuse` by default.
3. Phases 7–8 — limits, expiry, operator queue. Then Phase 9 and the release.

## Traceability (FR → tasks)

| FR | Tasks |
| --- | --- |
| FR-001 – FR-004, FR-010 | T018, T023, T024 |
| FR-005 | T019, T025 |
| FR-006, FR-007 | T020, T021, T023 |
| FR-008, FR-009 | T021, T055 |
| FR-011 | T022, T026, T027 |
| FR-020 – FR-023 | T029, T030, T032 |
| FR-030, FR-031, FR-043 | T034, T038, T043, T044, T046 |
| FR-032, FR-033 | T035, T040, T043, T048 |
| FR-034, FR-035, FR-040 | T056, T056b, T060a |
| FR-036, FR-037 | T035, T056, T060a |
| FR-038 | T065, T067 |
| FR-039 | T036, T037, T043, T060 |
| FR-041 | T052, T060a |
| FR-042, FR-045 | T034, T045 |
| FR-044 | T038, T053 |
| FR-046, FR-047 | T042, T050 |
| FR-048 | T040, T040a, T046a, T048 |
| FR-050 | T039, T047 |
| FR-051, FR-052 | T041, T049, T054 |
| FR-053 | T051, T058, T062, T067 |
| FR-060 – FR-063 | T057, T058, T061, T062, T063 |
| FR-064, FR-065 | T045 |
| FR-070 – FR-074 | T069 – T076 |
| FR-080 – FR-082 | T013, T064, T066 |
| FR-090 | T031, T051, T053, T073, T076 |
| FR-091 | T031, T033 |
| FR-092 | T041, T057, T069 |
| FR-093 | T077, T078 |
| FR-100 – FR-102 | T056a, T057a, T060, T061, T069a, T072 |
| FR-103 | T056b, T060a |
| FR-104 | T056b, T056c, T060a, T063a |
| FR-105 | T013, T056b |
| FR-106 | T039 (no placement in any registrant reply), T057a |
| FR-107 | T063, T063a, T071, T074 |
| FR-011 (`attachToOrganization`) | T022a, T026a |
