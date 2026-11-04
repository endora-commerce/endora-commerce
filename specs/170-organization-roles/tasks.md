# Tasks: Organization roles and permissions

**Input**: design documents in `specs/170-organization-roles/` — [spec.md](./spec.md),
[plan.md](./plan.md) (work packages WP-00 … WP-15, waves, plan-phase rulings PR-1/PR-2, oracle
rulings PR-3 … PR-12, decomposition adjustments A-1 … A-4, the owner rulings OR-9 … OR-11 of
2026-11-04 and their design questions Q-R1 … Q-R3, answered the same day), [research.md](./research.md)
(R-14 … R-41),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Scope**: P1 + P2, one release, delivered on the integration branch `feat/170-organization-roles`
(PR-1). P3 (internal RFQ approval, OR-2 / Q-1 = B) is **not** in these tasks — see
[Deferred: P3](#deferred-p3--internal-rfq-approval-separate-plan).

**Tests are mandatory** (constitution III, NN): within every work package the failing-test task
comes first and is committed red (or shown red in the MR description) before the implementation
task that turns it green. Contract and integration files do not run on merge requests (D-198):
each WP author runs its targeted files locally against `pnpm run dev:infra:test` with
`pnpm --filter backend exec vitest run <paths>` and pastes the output into the MR.

## Format

`- [ ] T### [P?] [WP-nn] [USn?] Description — owner module — paths — depends on`

- **[P]** — parallelisable with the other [P] tasks of the **same** work package (disjoint files,
  no dependency on an incomplete task). Whole work packages are parallel with each other only where
  the wave tables say so (*Wave parallelism* below); a [P] never crosses a WP boundary.
- **[WP-nn]** — the work package (plan.md); its branch is `wp/170-<nn>-<slug>` off
  `feat/170-organization-roles` (WP-00: off `origin/master`).
- **[USn]** — the user story the task serves (spec.md); setup, foundation, generated-artefact,
  changeset and verification tasks carry none.
- Paths are repository-relative. `org` = `packages/modules/organizations`, `ca` =
  `packages/modules/customer_accounts`, `contracts` = `packages/contracts/src`, `platform` =
  `packages/platform/src`, `sf` = `storefront`, `plpage(<id>)` =
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/<id>.md`.

## Standing obligations of every work package (not repeated per WP)

Each WP's closing *verify* task means all of the following, and the MR description lists the
output:

1. `pnpm run build:packages` after editing any package; `pnpm -r run typecheck`; `pnpm -r run lint`.
2. `pnpm --filter backend run test:unit:fast`, `pnpm --filter '!backend' run test` for the touched
   packages, and the WP's targeted contract/integration files run locally (D-198). **From WP-13a's
   merge on, the targeted files always include
   `backend/test/integration/organizations/roles-upgrade-replay.test.ts`** (R-38): the MR pastes its
   output and names every row that moved; the WP-00 oracle test is no longer run on the branch.
3. The R-14 inventory over the WP's owned files reports zero (command in `quickstart.md` §8, run
   with the WP's paths) — Wave 2 onward.
4. `pnpm --filter backend run composer:check` and `manifests:check` green; if either refuses,
   `pnpm --filter backend run composer:generate`, then `manifests:generate`, then
   `pnpm install --lockfile-only`, and commit the regenerated files — never hand-merge
   `backend/src/db/*-registry.generated.ts`, `admin/src/modules.generated.ts` or the manifest index.
5. `pnpm run check:naming && pnpm run check:language`; `check:port-dependencies`,
   `check:port-catches`, `check:module-boundary`, `check:command-coverage`,
   `check:off-state-coverage`, `check:error-translations`, `check:bundle-pairing`,
   `i18n:hardcoded`, `check:docs-translations` where the WP's files reach them.
6. A changeset per published package whose output changed (`specs/conventions/release-intent.md`):
   `minor` for a break (D-225 — never `major`, never a version number), naming the exported symbol
   and, for a removal, the old and the new shape; an empty changeset when nothing published moves.
   No upgrade page (A-3).
7. A module page edited under `packages/modules/<id>/docs/` ships its PL page and pin in the same MR
   (A-2): edit `plpage(<id>)`, then `pnpm --filter backend run docs:translations:pin
   packages/modules/<id>/docs/<page>.md`.
8. User-facing strings in EN **and** PL (`specs/conventions/module-i18n.md`).
9. A daily `git merge origin/master` into the integration branch; a conflicting
   `docs/translation-cache/*` takes master's file and is re-pinned with
   `docs:translations:pin <page>`.

---

## Phase 1 — Wave 0: the pre-upgrade oracle (on `master`)

**Goal**: record today's outcome of every gated action per member, by today's code (R-27,
`contracts/migration-and-replay.md` §5), before any 170 code exists. **Gate**: #656 merged (PR-1).
**Independent test**: the oracle file is green on `master`.

- [x] T001 [WP-00] Confirm #656 is merged (`gh pr view 656 -R endora-commerce/endora-commerce`); branch `wp/170-00-oracle` from `origin/master` with `scripts/setup-worktree.sh` — no files — depends on #656
- [x] T002 [WP-00] [US2] Write the oracle data: `ORACLE_POPULATION` (Organization A without, B with cart approval, one personal Organization; per company Organization an administrator, a regular user, a blocked and a deleted regular user; pending/expired/accepted invitations of both kinds; B's regular user's carts in `not_required`, `pending`, `approved`, `rejected`), `ORACLE_REQUESTS` (every request family listed in `contracts/migration-and-replay.md` §5, one per member, each with a stable `id` and the tag `oneClickInApprovalOrg` on the one-click rows of B), a `roleToRoleId` body-mapping hook for WP-13, and an **empty** `PRE_UPGRADE_OUTCOMES` — test fixture (owner: `backend/test`) — `backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts` (new) — T001
- [x] T003 [WP-00] [US2] Write the failing oracle test: seed `ORACLE_POPULATION` through today's services/entities, replay `ORACLE_REQUESTS` against the test server, assert each `{ status, code }` equals `PRE_UPGRADE_OUTCOMES[id]` and that every request id has an expected entry (red: the table is empty) — `backend/test/integration/organizations/roles-upgrade-oracle.test.ts` (new) — T002
- [x] T004 [WP-00] [US2] Record the table: run T003 once locally, write the observed outcomes into `PRE_UPGRADE_OUTCOMES`, review every row by hand against today's behaviour (a surprising row is a question for the owner, not an edit), re-run green; paste both runs in the MR — `backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts` — T003
- [x] T005 [WP-00] Verify (standing obligations 1, 2, 5); add an empty changeset if `check:release-intent` asks; open the PR to `master` — `.changeset/170-00-roles-upgrade-oracle.md` (only if required) — T004
- [x] T006 Cut the integration branch: after WP-00 merges, `git fetch origin && git push origin origin/master:refs/heads/feat/170-organization-roles`; every later WP branches from it — no files — T005 merged

**Checkpoint**: oracle on `master`; integration branch exists.

---

## Phase 2 — Wave 1: foundation (serial on the integration branch: WP-01 → WP-02a → WP-02b)

No Wave 2 task may start before WP-02b is merged into `feat/170-organization-roles`.

### WP-01 — contracts and platform, additive

**Goal**: every new shape beside the old one (R-23), the bus extensions (R-21, R-22), the role id on
the actor (R-15). **Independent test**: unit tests on the contracts, the bus and the auth hook;
an empty organization-permission population passes the inventory.

Tests first:

- [x] T007 [P] [WP-01] [US1] Failing tests for the role contracts: `organizationRoleKindSchema`, `organizationRoleRefSchema`, `OrganizationRoleView`, the request schemas (`createOrganizationRoleRequestSchema`, `updateOrganizationRoleRequestSchema`, `deleteOrganizationRoleRequestSchema`, change-role `{ roleId }`, invite `{ email, roleId? }`, operator direct-create/invite with `roleId?`) each **refusing** an extra `role` key (`.strict()`, FR-073, R-24); `organizationPermissionPreHandler` by default (`guests: 'refuse'`) throws 401 for a non-customer actor; with `{ guests: 'pass' }` it lets every non-customer actor (an anonymous visitor with a guest basket) through **unjudged** and still judges a customer actor, impersonation included (PR-4, R-35); in both modes it builds the subject from `actor.organizationId`/`id`/`organizationRoleId`, calls the port's `assert` with the request language, and resolves the port per call (thunk, not at construction) — contracts — `packages/contracts/src/organization-roles.test.ts` (new) — T006
- [x] T008 [P] [WP-01] [US1] Failing tests for the manifest field: a valid `organizationPermissions` entry parses; a code not matching `ORGANIZATION_PERMISSION_CODE`, a code whose prefix is not the manifest id, and a duplicate code are refused by `defineModuleManifest` (FR-020, R-2) — contracts — `packages/contracts/src/modules.test.ts` — T006
- [x] T009 [P] [WP-01] [US1] Failing bus tests: `ctx.run(child)` — child's entry and parent's commit together; a throwing child rolls back the parent and every sibling's entry; a `skipAudit` child records nothing; the child's event is buffered and dispatched once on the parent's commit (R-22, FR-065); a customer acting for themselves lands on `actorCustomerAccountId`, impersonation still fills the two impersonation fields and leaves it `null` (R-21, SC-006) — platform — `packages/platform/src/commands/command-bus.test.ts`, `packages/platform/src/commands/actor.test.ts` — T006
- [x] T010 [P] [WP-01] [US1] Failing auth test: when `customerOrgResolver` answers `organizationRoleId`, the request actor carries it; when it answers none the actor's field is `null` and the request is not refused (the resolver gains the field only in WP-02b) — auth — `packages/modules/auth/src/backend/customer-actor-role.test.ts` (new) — T006
- [x] T011 [P] [WP-01] [US1] Failing storefront helper test: `can(session, code)` true only for a code in `session.permissions`; `isAdministrator(session)` from `organizationRole.kind`; both false for a signed-out or role-less session; the helper accepts a structural session type so WP-09/WP-10 need not wait for each other — storefront — `storefront/test/lib/organization-permissions.test.ts` (new) — T006
- [x] T012 [WP-01] [US1] Failing inventory describe `[organization-permissions]` with the manifest index as independent author and the estate's `read:` disclosure line: synthetic fixtures red for `cross-vocabulary`, `foreign-declarer`, `undeclared-check`, `unchecked-declaration`, `missing-label`, `split-label`, and an unresolvable code argument; the real (empty) population passes (FR-020, FR-021, FR-022 instrument; `contracts/organization-permissions-manifest.md` §4) — backend test — `backend/test/contract/admin_users/permission-inventory.test.ts` — T006

Implementation:

- [x] T013 [WP-01] [US1] Add `organization-roles.ts` (types, schemas, `OrganizationPermissionPort`, `OrganizationPermissionSubject`, `OrganizationEffectivePermissions`, `OrganizationRoleReadPort`, `organizationPermissionPreHandler` with its `guests` option) and export it; T007 green — contracts — `packages/contracts/src/organization-roles.ts` (new), `packages/contracts/src/index.ts` — T007
- [x] T014 [WP-01] [US1] Add `ORGANIZATION_PERMISSION_CODE`, `moduleOrganizationPermissionDeclarationSchema` and the optional `organizationPermissions` field; refusals in `defineModuleManifest`; T008 green — contracts — `packages/contracts/src/modules.ts` — T008
- [x] T015 [WP-01] [US1] `ActorCustomer.organizationRoleId?`; error codes `ORGANIZATION_PERMISSION_REQUIRED`, `ORGANIZATION_ROLE_NAME_TAKEN`, `ORGANIZATION_ROLE_STALE`, `ORGANIZATION_ROLE_LIMIT_REACHED`, `ORGANIZATION_ROLE_PROTECTED`, `ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`, `ORGANIZATION_PERMISSION_UNKNOWN`, `CART_APPROVAL_SELF_APPROVE`; `cartMergeOutcomeSchema.outcome` gains the internal value `skipped_permission`, narrowed to `noop` by `cartMergeOutcomePublicSchema`'s mapping (PR-12, additive); `@deprecated` on `organizationRoleSchema`, `OrganizationRole`, `CustomerAccountRole`, `countByOrganizationRole`, `RfqCustomerContext.isOrgAdmin`, the cart-policy schemas, `requiresCartApproval` and the legacy `role` fields; additive `organizationRole` / `permissions` / `roleId` response and request shapes beside them — contracts — `packages/contracts/src/{actor,errors,common,organizations,customer-accounts,carts,quote-requests,admin}.ts` — T013
  - *Done in WP-01 except the eight error codes*: adding them to `ERROR_CODES` before a manifest declares them reds `check:error-translations` (P3 `undeclared-enum-member`, no ledger), and declaring them before anything raises them reds its P7 (`unraised`, a shrink-only ledger). The seven `ORGANIZATION_*` codes land with their declaration and first raise in WP-02a (T035), `CART_APPROVAL_SELF_APPROVE` in WP-04 (T074) — each adds its line to `packages/contracts/src/errors.ts`.
- [x] T016 [WP-01] [US1] Bus extensions: `CommandActor.actorCustomerAccountId`, `actorFromContext` fills it, `CommandContext.run(child)` on the parent's `em`/actor/event scope, `RecordAuditInput.actorCustomerAccountId` through `AuditPort.recordWithin` and its writer, the entity property; T009 green — platform — `packages/platform/src/commands/{command,command-bus,actor}.ts`, `packages/platform/src/kernel/audit/audit-log-entry.entity.ts`, `packages/platform/src/kernel/ports/audit.ts`, `packages/platform/src/kernel/audit/audit-log-service.ts` — T009
- [x] T017 [WP-01] [US1] Failing migration test, then **M1**: scaffold `pnpm --filter backend run migration:new -- --module core --name audit_actor_customer_account` (`actor_customer_account_id uuid null`, `if not exists`; a written `down()`), and an integration test that a customer-issued Command's audit row carries the column — platform — `packages/platform/src/migrations/<stamp>_core_audit_actor_customer_account.ts` (scaffolded, never numbered by hand), `backend/test/integration/kernel/audit-actor-customer-account.test.ts` (new) — T016
- [x] T018 [WP-01] [US1] Pass `organizationRoleId` through `customerContextResolver` / `cartActorResolver` / `customerActorResolver` and the auth request hook; T010 green — platform, auth — `packages/platform/src/composition/compose-app.ts`, `packages/modules/auth/src/backend/{plugin.ts,index.ts}` — T015, T010
- [x] T019 [WP-01] [US1] Storefront helper `can(session, code)`, `isAdministrator(session)`; T011 green — storefront — `storefront/lib/organization-permissions.ts` (new) — T011
- [x] T020 [WP-01] Implement the organization-permissions scanner in the inventory; T012 green — backend test — `backend/test/contract/admin_users/permission-inventory.test.ts` — T014, T012
- [x] T021 [WP-01] Generated artefacts: `composer:generate` (M1 registered), `manifests:check`; commit `backend/src/db/*-registry.generated.ts` — generated — T017
- [x] T022 [WP-01] Changesets: `@endora-commerce/contracts` `minor` (new `organization-roles` exports, manifest field, actor field, error codes, deprecations named); `@endora-commerce/platform` `minor` (`CommandContext.run`, `CommandActor.actorCustomerAccountId`, the audit column); `auth` package `patch` or `minor` by judgement (actor field) — `.changeset/170-01-*.md` — T013…T020
- [x] T023 [WP-01] Verify (standing obligations) and merge into `feat/170-organization-roles` — T021, T022

### WP-02a — roles in `organizations`

**Goal**: the `organization_roles` table, the role Commands, the catalogue, the cache, the port, the
storefront and operator role routes. **Independent test**: create/update/delete roles over HTTP on
both surfaces; the port answers per role kind; the cache meets FR-081.

Tests first:

- [x] T024 [P] [WP-02a] [US2] Failing **M2** integration test: both predefined rows for every Organization (company, personal, suspended); the `after insert` trigger creates them for a new Organization (PR-2); an approval-requiring Organization's *Member* has `member_defaults_offered = {carts.order_without_approval, quick_order.one_click}` (FR-071, R-18); every invitation (pending, expired, revoked, accepted) has `organization_role_id` mapped from `role`; composite FK refuses another Organization's role; second `up()` changes nothing (FR-074); `down()` restores the schema (FR-001, FR-070) — organizations — `backend/test/integration/organizations/organization-roles-migration.test.ts` (new) — T023
- [x] T025 [P] [WP-02a] [US1] Failing catalogue and port unit tests: vocabulary/present sets from manifests and `effectiveState` (both axes); administrator → every present code; member → R-17 formula; custom → grants ∩ present; unknown role → fail closed and logged; `assert` throws 403 with `permission`/`permissionLabel` translated; `rolesHolding` includes the administrator role; an unknown code → `can` false, `assert` 500 (FR-002, FR-007, FR-025, FR-055, US 8; `contracts/organization-permission-port.md` §2) — organizations — `org/src/backend/services/organization-role-catalogue.test.ts`, `org/src/backend/services/organization-role-permission-port.test.ts` (new) — T023
- [x] T026 [P] [WP-02a] [US1] Failing cache tests after `custom-field-definitions-cache.test.ts`: writer-process immediacy, cross-process drop on `b2b:organization-roles:changed`, lost announcement bounded by 30 s, racing fill answered not stored, Redis unreachable degrades to source reads, rolled-back Command drops nothing (FR-080, FR-081, FR-082, R-16) — organizations — `org/src/backend/services/organization-role-cache.test.ts` (new) — T023
- [x] T027 [P] [WP-02a] [US1] Failing role-Command unit tests: create (name trim/case rules against custom roles and the EN+PL predefined labels → `ORGANIZATION_ROLE_NAME_TAKEN`; 51st → `ORGANIZATION_ROLE_LIMIT_REACHED`; unknown code → `ORGANIZATION_PERMISSION_UNKNOWN`); update (administrator → `ORGANIZATION_ROLE_PROTECTED`; *Member* rename refused; stale `expectedVersion` → `ORGANIZATION_ROLE_STALE`; save merge keeps absent-module grants and drops undeclared codes; *Member* save sets `member_defaults_offered ∪= vocabularyMemberDefaults` and an un-ticked default never returns across off/on and uninstall/reinstall; equal save `skipAudit`, no version bump; `organization_role.permissions_changed.v1` emitted with `added`/`removed`); delete (protected kinds refused; unheld role needs no replacement; held role without replacement → `ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`, which WP-02a returns for **any** held role until WP-02b); audit against `organization` with sorted permission lists (FR-002…FR-004, FR-023, FR-024, FR-025, FR-065, R-29, R-32) — organizations — `org/src/backend/commands/organization-role-commands.test.ts` (new) — T023
- [x] T028 [P] [WP-02a] [US1] [US7] Failing contract tests for the role routes: storefront `GET/POST/PATCH/DELETE /api/v1/organizations/mine/roles[/:id]`, `GET …/mine/permission-catalogue` (administrator only → others `403 FORBIDDEN`, FR-010; personal Organization → 404; another Organization's role id → 404, FR-005; body with `role` → 400); `GET …/mine/role` for every member (FR-058); `pendingInvitationCount` excludes expired invitations (FR-010a, PR-7); operator `GET/POST/PATCH/DELETE /api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue` gated by `organizations:read-roles` / `organizations:manage-roles` (403 without, FR-060, FR-061), the audit entry naming the operator; the refusal envelope for `ORGANIZATION_PERMISSION_REQUIRED` distinct from 401/503/404 (FR-055); permission labels translated per request language (R-31) — organizations — `backend/test/contract/organizations/roles.contract.test.ts`, `backend/test/contract/organizations/admin-roles.contract.test.ts` (new) — T023
  - *Done in WP-02a*: no module declares an organization permission yet (A-1), so no route can raise `ORGANIZATION_PERMISSION_REQUIRED` over HTTP; its envelope — label translated per language, `{permissionLabel}` filled, no `details.code` — is asserted from the real raise in `backend/test/unit/organizations/error-code-sentences.test.ts` and in the port's unit test. The catalogue route is asserted against its schema over the (empty) real population.
- [x] T029 [P] [WP-02a] [US1] Failing tenancy test: `OrganizationRole` classified organization-scoped and read through the global filter — tenancy — `backend/test/unit/tenancy/classification-check.test.ts` (fixture/expectation for the new entity, if the check enumerates entities) — T023

Implementation:

- [x] T030 [WP-02a] [US1] Entity `OrganizationRole` per data-model §1; invitation entity gains `organizationRoleId` (role kept, dual-written) — organizations — `org/src/backend/entities/organization-role.entity.ts` (new), `org/src/backend/entities/organization-invitation.entity.ts` — T024, T029
- [x] T031 [WP-02a] [US2] Scaffold and write **M2**: `pnpm --filter backend run migration:new -- --module organizations --name organization_roles` (table, constraints, idempotent backfill, FR-071 marker, R-28 trigger function and trigger, invitations column/backfill/`not null`/composite FK, written `down()`); T024 green — organizations — `org/src/migrations/<stamp>_organizations_organization_roles.ts` — T030
  - *Added in WP-02a*: a `before insert` trigger on `organization_invitations` fills a missing `organization_role_id` from `new.role` — the invitations' twin of M3's default (R-28), for raw inserts naming only the legacy column (the frozen WP-00 oracle seeds that way; `demo-reset-after-use.test.ts` too). WP-12's M4 drops it with `role`.
- [x] T032 [WP-02a] [US1] Catalogue and permission port; register with `ctx.di.providePort('organizationPermissionPort', …)`, and `organizationRoleReadPort` (`predefinedRoleId`, through the cache) beside it (`contracts/organization-permission-port.md` §1, R-34); T025 green — organizations — `org/src/backend/services/organization-role-catalogue.ts`, `org/src/backend/services/organization-role-permission-port.ts` (new), `org/src/backend/index.ts` — T030
  - *Done in WP-02a*: no actor carries `organizationRoleId` before WP-02b, so the port's account fallback maps the account's legacy `role` onto the predefined role (`organization_admin` or a personal Organization → *Administrator*, else *Member*; M3's mapping) in `services/organization-role-legacy.ts`; the roles list's `memberCount` uses the same mapping. WP-02b (T046) replaces both and deletes that file.
- [x] T033 [WP-02a] [US1] `OrganizationRoleCache` with `dropAndAnnounce`, the `onBoot` subscriber on `redisSubscriber`; T026 green — organizations — `org/src/backend/services/organization-role-cache.ts` (new), `org/src/backend/index.ts` — T032
- [x] T034 [WP-02a] [US1] [US6] Role service and Commands `organization_role.{create,update,delete}` (the role view's `pendingInvitationCount` counts not-accepted, not-revoked, not-expired invitations, FR-010a); remove nothing else yet; the invitation service dual-writes `organizationRoleId` + `role`; T027 green — organizations — `org/src/backend/services/organization-role-service.ts` (new), `org/src/backend/commands/organization-role-{create,update,delete}.command.ts` (new), `org/src/backend/services/invitation-service.ts` — T033
- [x] T035 [WP-02a] [US1] [US7] Routes: storefront `routes.roles.ts` (guards `requireCustomer` + administrator), operator `routes.admin-roles.ts` (`requireAdminAny` / `requireAdmin`), wiring in `plugin.ts`; manifest: operator codes `organizations:read-roles`, `organizations:manage-roles` (`requires`), the seven new `errorCodes`; T028 green — organizations — `org/src/backend/routes.roles.ts`, `org/src/backend/routes.admin-roles.ts` (new), `org/src/backend/plugin.ts`, `org/src/manifest.ts` — T034
- [x] T036 [WP-02a] i18n EN+PL in one pass for every P1 key: operator code labels `adminRoles.permission.organizations:{read,manage}-roles`, predefined role labels, the error sentences (with `{permissionLabel}`), the Admin UI Roles tab strings (consumed by WP-08), the e-mail role labels (consumed by WP-03); list them in the MR description — organizations — `org/i18n/en.json`, `org/i18n/pl.json` — T035
- [x] T037 [WP-02a] Docs: Roles section on the module page, EN + PL + pin (A-2) — organizations — `org/docs/organizations.md`, `plpage(organizations)`, `docs/translation-cache/pl/…organizations…json` (via `docs:translations:pin`) — T035
- [x] T038 [WP-02a] Generated artefacts (`composer:generate` for M2 and the entity; `manifests:check`) and changeset for `organizations` (`minor`: new routes, port, operator codes) — generated, `.changeset/170-02a-organization-roles.md` — T031…T037
- [x] T039 [WP-02a] Verify and merge into the integration branch — T038

### WP-02b — assignment in `customer_accounts`

**Goal**: every account and invitation holds a role id; the actor carries it; member Commands are
audited on the bus; role deletion reassigns atomically. **Independent test**: M3 backfill; change
role / remove member / promote over the Commands; deletion with holders.

Tests first:

- [x] T040 [P] [WP-02b] [US2] Failing **M3** integration test: every account (deleted and blocked included) mapped from `role`, and every account of a **personal** Organization mapped to *Administrator* whatever its `role` (PR-3, R-34), with the legacy `role` left untouched; the `before insert` trigger fills a missing id — *Administrator* in a personal Organization, else from `new.role` (administrator for `organization_admin`, else *Member*) (PR-2, R-23); `not null`; composite FK refuses a cross-Organization role and `restrict`s a held role's delete; second `up()` no-op; `down()` exact (FR-006, FR-070, FR-074) — customer_accounts — `backend/test/integration/customer_accounts/organization-role-assignment-migration.test.ts` (new) — T039
- [x] T041 [P] [WP-02b] [US1] Failing Command tests: `customer_account.change_role` (dual-writes `role`; refuses another Organization's role with not-found; last administrator `CANNOT_DEMOTE_LAST_ADMIN` under a `for update` lock — two concurrent demotions cannot both pass, R-29; emits `customer_account.organization_role_changed.v1`; audits against `organization`), `customer_account.remove_member` (`CANNOT_REMOVE_LAST_ADMIN`), `customer_account.promote_organization_admin`; no hand-placed `recordAuditFromContext` remains (FR-005, FR-065, R-32) — customer_accounts — `ca/src/backend/commands/customer-account-role-commands.test.ts` (new) — T039
  - *Done in WP-02b*: the lock's effect against a real database — two concurrent demotions, and a demotion racing a removal, of an Organization's two administrators — is `backend/test/integration/customer_accounts/last-administrator-lock.test.ts` (new); the unit file asserts the lock is taken before counting. Holders are locked in id order so the two Commands queue rather than deadlock. A blocked administrator no longer counts towards the last-administrator guard (§3's predicate; before, only removed accounts were excluded).
- [x] T042 [P] [WP-02b] [US6] Failing deletion integration test: deleting a role with three holders and one invitation names a replacement, runs one `customer_account.change_role` child per account plus the invitation moves, commits as one unit with one entry each; a failing child rolls back everything; `customerAccountRoleCommandPort` resolved via `lazyPort` (FR-024, FR-065, R-22, US 6) — organizations — `backend/test/integration/organizations/role-delete-reassigns.test.ts` (new) — T039
- [x] T043 [P] [WP-02b] [US1] Failing session test: `customerOrgResolver` returns `organizationRoleId`; the next request after a role change is judged by the new role on every process (FR-081, R-15) — customer_accounts — `backend/test/integration/customer_accounts/actor-carries-role.test.ts` (new) — T039
  - *Done in WP-02b*: the harness authenticates through its own hook (`backend/test/helpers/test-actors.ts`), which stamps no `organizationRoleId`, so the test drives `customerOrgResolver` and the permission port from the composed container; through the harness the port's account fallback answers instead, with the same result.
- [x] T117 [P] [WP-02b] [US2] Failing test — every path into a personal Organization assigns *Administrator* (PR-3, FR-070a): `customers`' self-registration (`createStandalone`), the federated sign-in's account creation, `ensureForCustomerAccount`, and the operator's unassign (detach to the personal Organization) each leave the account holding its personal Organization's *Administrator* role (`organizationPermissionPort.isAdministrator` true, the role id equal to `organizationRoleReadPort.predefinedRoleId(…, 'administrator')`); the provisioning answer carries `administratorRoleId` read inside the caller's transaction; the operator's assign to a company Organization lands on the target's predefined role of the kind held (*Administrator* stays *Administrator*, else *Member*); no path leaves a role of the previous Organization (the composite FK would refuse it) — customer_accounts — `backend/test/integration/customer_accounts/personal-organization-administrator.test.ts` (new) — T039

Implementation:

- [x] T044 [WP-02b] [US2] Entity property `organizationRoleId` (role kept, `@deprecated`); scaffold **M3** `pnpm --filter backend run migration:new -- --module customer_accounts --name organization_role_assignment` with the R-28 trigger and written `down()`; T040 green — customer_accounts — `ca/src/backend/entities/customer-account.entity.ts`, `ca/src/migrations/<stamp>_customer_accounts_organization_role_assignment.ts` — T040
- [x] T045 [WP-02b] [US1] Commands replacing `role-service.ts` (deleted), ports: records carry `organizationRoleId`, `countAdministrators`, write port requires `organizationRoleId` and dual-writes `role`, `customerAccountRoleCommandPort` (`changeRole` factory, `holdersOf`) via `ctx.di.providePort`; contracts types for the port and `countAdministrators`; T041 green — customer_accounts, contracts — `ca/src/backend/commands/customer-account-{change-role,remove-member,promote-admin}.command.ts` (new), `ca/src/backend/services/role-service.ts` (deleted), `ca/src/backend/services/customer-account-{ports,lifecycle-ports}.ts`, `ca/src/backend/index.ts`, `packages/contracts/src/customer-accounts.ts` — T044
  - *Done in WP-02b*: `@endora-commerce/contracts` names no platform type, so the port's Command is the structural `CustomerAccountRoleChangeCommand` (assignable to and from the platform's `Command`). `CustomerAccountRoleChangeInput.includeRemoved` lets the role deletion move removed holders, which the foreign key counts. `organizationRoleReadPort` gains `findRole(organizationId, roleId)` (the role cache carries custom names) so the Command refuses a role the Organization does not have with `404`. `customerRolePort` keeps its legacy `changeRole(…, newRole)` signature, mapped onto the predefined role of that kind, until WP-03 moves the member routes to `{ roleId }`; `promoteToOrganizationAdmin` stays on the member write port and runs its Command.
- [x] T046 [WP-02b] [US1] `customerOrgResolver` answers `organizationRoleId`; the permission port's account-read fallback turned on; T043 green — customer_accounts, organizations — `ca/src/backend/index.ts`, `org/src/backend/services/organization-role-permission-port.ts` — T045
- [x] T047 [WP-02b] [US6] Reassignment children in `organization_role.delete`; `acknowledgedDependencies` entry for the new port in the existing mutual pair; creation paths pass role ids (registration → administrator, personal Organization → administrator, operator create); T042 green — organizations — `org/src/backend/commands/organization-role-delete.command.ts`, `org/src/manifest.ts`, `org/src/backend/services/{registration-service,personal-organization-service}.ts`, `org/src/backend/commands/create-organization.command.ts` — T045
  - *Done in WP-02b*: `create-organization.command.ts` creates no account, so it passes nothing; the operator's direct member create (`routes.admin.ts`) and invitation acceptance (`invitation-service.ts`) pass the role id — both files are WP-03's in Wave 2 and change only by that argument. The invitation moves dual-write the invitation's legacy `role`.
- [x] T118 [WP-02b] [US2] Personal Organizations' *Administrator* on every path (PR-3, R-34): `PersonalOrganizationProvisionApi.provisionFor` and `personalOrganizationPort.provisionPersonalOrganization` answer `administratorRoleId` (read on the caller's `em` after the R-28 trigger); `createStandalone` and the federated sign-in create the account with it; the write port's `setOrganization`, `detachToPersonalOrganization` and `attachToOrganization` take `organizationRoleId` and write it with the Organization; `ensureForCustomerAccount` and `customers`' assign/unassign pass it (role-id pass-through only — the depletion guards stay WP-03's); contracts types for the two port answers and the write-port inputs; T117 green — customer_accounts, organizations, customers, contracts — `ca/src/backend/services/customer-account-lifecycle-ports.ts`, `ca/src/backend/index.ts`, `org/src/ports/index.ts`, `org/src/backend/index.ts`, `org/src/backend/services/personal-organization-service.ts`, `packages/modules/customers/src/backend/services/customer-org-assignment-service.ts`, `packages/contracts/src/customer-accounts.ts` — T045, T117
  - *Done in WP-02b*: a personal Organization's account keeps its legacy `role` (`regular_user` for a self-registered individual), as M3 leaves it, so `customers`' depletion guards — which read it until WP-03 (T120) — do not start refusing B2C deletions. `customers`' assign derives the kind held from the **company** it comes from: an account coming from its own personal Organization lands on *Member* (today's outcome) rather than becoming the company's *Administrator* — an open question in the WP-02b MR.
- [x] T048 [WP-02b] Seeds and helpers: demo composition and acceptance script pass role ids; the six shared helpers build roles; new `seed-organization-roles.ts` (create a custom role with given codes, assign it) for Wave 2 — demo-composition, backend test — `packages/demo-composition/src/composition.ts`, `backend/scripts/acceptance/instance-actor-scope.ts`, `backend/test/helpers/{seed-organizations,seed-commerce,seed-roles,seed-credit-limit,admin-search-fixtures,test-server}.ts`, `backend/test/helpers/seed-organization-roles.ts` (new) — T047
  - *Done in WP-02b*: `backend/scripts/acceptance/instance-actor-scope.ts` is unchanged — it creates its member through the operator route, whose body takes the legacy `role` until WP-03 (`roleId?`); `test-server.ts` needed no change. The demo buyer is created with — and moved back to — the demo organisation's *Administrator*.
- [x] T049 [WP-02b] Convert the WP's subject tests: `backend/test/integration/customer_accounts/*` (the three naming the enum), `backend/test/unit/customer_accounts/password-verification-port.unit.test.ts`, `backend/test/integration/demo/demo-reset-after-use.test.ts` — backend test — T048
  - *Done in WP-02b*: beyond the listed files, fixtures that moved an account between Organizations by hand now move its role with it (the composite foreign key refuses the old one): `backend/test/integration/customers/customer-deletion-service.test.ts`, `backend/test/integration/quote_requests/negotiation-{enforcement,policy-routes}.test.ts`; `backend/test/integration/mfa/factor-removal-withdraws-sessions.test.ts` passes the role id to the member write port; record fixtures in seven unit tests gained `organizationRoleId`; and M2's migration test steps M3 down before M2 and up after it.
- [x] T050 [WP-02b] Docs EN+PL+pin for `customer_accounts` (role reference, Commands) — `ca/docs/customer_accounts.md`, `plpage(customer_accounts)` — T045
- [x] T051 [WP-02b] Generated artefacts (M3); `check:command-coverage` with `customer_accounts` migrated; changesets: `customer_accounts` `minor`, `organizations` `patch`/`minor`, `contracts` `minor` (new port type), `demo-composition` by judgement — `.changeset/170-02b-*.md` — T044…T050
- [x] T052 [WP-02b] Verify and merge into the integration branch — T051

**Checkpoint (end of Wave 1)**: roles exist for every Organization, every subject carries a role id,
the port answers, the integration branch is green. Wave 2 may start.

---

## Phase 3 — Wave 2: conversion (WP-03, WP-04, WP-05, WP-07, WP-08 in parallel; WP-13a merges before WP-03, WP-04 and WP-06; WP-05 after WP-04; WP-06 after WP-04 and WP-05; WP-08 after WP-03)

### WP-13a — the upgrade replay, brought forward (R-38)

**Goal**: the integration branch's behaviour instrument from Wave 2 on is the replay of an
upgraded database, not the live oracle (`contracts/migration-and-replay.md` §5 *On the integration
branch*, §6, §6.2). Test only; owns only new files plus the retirement of the oracle test.
**Merge gate**: before WP-03, WP-04 and WP-06 (WP-05, WP-07 and WP-08 move no §6.1 row and may
merge either side of it). **Independent test**: the replay is green with an empty ledger and
reproduces `PRE_UPGRADE_OUTCOMES` on all 319 rows. Implemented by `endora-commerce-dev`, branch
`wp/170-13a-replay`.

T124 (the table's self-check) and T125 (the table) are WP-13a's; they stay listed under WP-13 below, where their full text is, carrying `[WP-13a]`.

- [x] T130 [WP-13a] [US2] The landing ledger: `LANDED` with `'WP-03'`, `'WP-04'`, `'WP-06'` all `false`, one entry per line separated by a comment line naming the package and its §6.1 rows (§6.2) — backend test — `backend/test/fixtures/organization-roles/landed-work-packages.ts` (new) — T125
- [x] T131 [WP-13a] [US2] The replay in its interim form, red first (no population yet): migrated clone → boot the test server against the clone (first, because `setupBackendServer` reseeds the tables the population needs) → `down()` of M3, M2 → `ORACLE_POPULATION` with raw SQL in the pre-170 shape (withdrawn members in the state the operator routes leave them; sessions through `SessionService` after the `up()`) → `up()` of M2, M3 → `ORACLE_REQUESTS` in order, bodies through `roleToRoleId` only when `LANDED['WP-03']` → per-row comparison on the whole `{ status, code }` per §6 step 5 and §6.2 → data assertions (§6 step 6) → second `up()` changes nothing. `send` and `observe` are copied from the oracle test unchanged. **First prove the boot**: the test server opens the ORM with `DATABASE_URL` captured at import, so set it to the clone before a dynamic `import()` of `backend/test/helpers/test-server.js`; if that cannot work, stop and report before writing more (an edit of the shared helper is a WP-02b-owned file and needs the architect) — backend test — `backend/test/integration/organizations/roles-upgrade-replay.test.ts` (new) — T130
- [x] T132 [WP-13a] [US2] Hand-over, on one tree: run the WP-00 oracle test (green against `PRE_UPGRADE_OUTCOMES`) and the replay (green, every `LANDED` entry `false`, all 319 rows) and paste both outputs; then `git rm backend/test/integration/organizations/roles-upgrade-oracle.test.ts` — content never edited, the fixture untouched — and grep `backend/test/**`, `backend/vitest*.ts`, `scripts/**` and `quickstart.md` for the path (AGENTS.md trap: a deleted file's reader fails only in the complete suite) — backend test — T131
- [x] T133 [WP-13a] Verify (standing obligations 1, 2, 5); an empty changeset if the gate asks for one; merge before WP-03, WP-04 and WP-06 — T132 *(merged in #712; `check:release-intent` asked for no changeset)*

**Obligations WP-13a places on the landing packages** (listed here, not in their sections, so the
open WP-04 and WP-06 PRs, which edit those sections, rebase without a conflict):

- [x] T134 [WP-04] After WP-13a merges: rebase; flip `LANDED['WP-04']` to `true`; run the replay — §6.1 rows 3–6 and 14–22 at `after`, every other row as §6.2 requires (`PRE_UPGRADE_OUTCOMES`, or `after` for a package already landed), **including** at `PRE_UPGRADE_OUTCOMES` `cart.read:B.regular@pl_b2b_vip`, `order.place:B.regular@pl_retail`, `order.place:B.regular@pl_b2b_vip` and `cart.submitForApproval:B.regular` (the migrated B's *Member* lacks `carts.order_without_approval`); restate the MR's oracle section against the replay output — backend test — `landed-work-packages.ts` — T133, T079
- [x] T135 [WP-03] After WP-13a merges: flip `LANDED['WP-03']` to `true` (which also sends `role` bodies as `roleId`); run the replay — rows 1–2, 8–13 and 25–26 at `after`, and the six `invitation.create*`/`member.changeRole` rows of `A.admin` and `B.admin` at `PRE_UPGRADE_OUTCOMES` (#710 saw them, and rows 9, 10, 13, at `400` only because the live oracle sends `role`) — backend test — `landed-work-packages.ts` — T133, WP-03's implementation tasks
- [x] T136 [WP-06] After WP-04, WP-05 and WP-13a merge: rebase; flip `LANDED['WP-06']` to `true`; run the replay — rows 7, 23 and 24 at `after` (#653 observed closed), and no B.regular row after them moved (§6.1 *How the table is used*); restate the MR's oracle section against the replay output — backend test — `landed-work-packages.ts` — T133, T134, T137
- [x] T137 [WP-06] The three cross-module gates in `carts`' routes, owned by WP-06 because it merges last of the three (lead's decision, Notes 7): `shopping_lists.convert` on from-shopping-list, `shopping_lists.create` on save-to-shopping-list, `quote_requests.create` on convert-to-quote-request; WP-04's `it.todo` cases in `cart-organization-permissions.contract.test.ts` become real tests, red before the gate — carts — `packages/modules/carts/src/backend/routes.ts`, `backend/test/contract/carts/cart-organization-permissions.contract.test.ts` — WP-04 and WP-05 merged

### WP-03 — members, invitations, session, addresses, reserved capabilities

**Goal**: US 1 (member side), US 5, FR-008, FR-010–FR-012, FR-014a, FR-056, FR-062, FR-073.
**Independent test**: member and invitation endpoints take `roleId`, session views carry
`organizationRole` + `permissions`, address writes need `addresses.manage`.

Tests first:

- [x] T053 [P] [WP-03] [US1] Failing session-view contract tests: login, `/api/v1/me`, `/api/v1/me/customer`, invitation accept answer `organizationRole` (translated predefined label in the request language, custom name verbatim) and `permissions`, and no `role` (FR-008, FR-056, FR-073) — organizations, customers — `backend/test/contract/organizations/me.test.ts`, `backend/test/contract/organizations/accept-invite.test.ts`, `backend/test/contract/organizations/session-role-views.contract.test.ts` (new) — T052
  - *Done in WP-03*: all four session views carry `permissions` beside `organizationRole` (the contract table names it for login and `/me`; T053 for all four). `organizationRoleReadPort` gains `roleRef(organizationId, roleId, language?)` — the translated `{ id, name, kind }` — so `customers` can name the role without reading `organizations`' bundle. The registration answer drops `role` too. The deprecated `role` of the three response schemas in `contracts` becomes optional (no longer sent); WP-12 deletes it.
- [x] T054 [P] [WP-03] [US1] [US5] Failing member/invitation contract tests: `PATCH …/members/:id/role { roleId }`; `role` in any body → 400; another Organization's role → 404; invite `{ email, roleId? }` defaults to *Member* and audits `organization_invitation.create`; last-admin refusals keep their codes; a custom role holding every code still cannot manage members, invitations or roles (FR-005, FR-010, FR-065, US 5.1/5.3) — organizations — `backend/test/contract/organizations/{invite,invitations-list-revoke,last-admin-protection}.test.ts`, `backend/test/contract/organizations/member-rollup.contract.test.ts`, `backend/test/contract/organizations/reserved-capabilities.contract.test.ts` (new) — T052
  - *Done in WP-03*: the shared `seedCustomOrganizationRole` binds its array through `em.execute`, which expands it into one parameter per element — PostgreSQL refuses the literal — so this package's tests use their own `backend/test/contract/organizations/organization-role-fixtures.ts` (`seedCustomRole`, `holdCustomRole`, and a role-cache drop: a fixture's SQL does not drop the cache a role Command would).
- [x] T055 [P] [WP-03] [US5] Failing e-mail test: the invitation e-mail's role label is the role's own — PL label for a predefined role in a PL e-mail, custom name verbatim, never a hard-coded English string (#667, FR-008, US 5.1a) — organizations — `org/src/backend/email-templates/invitation.test.ts`, `backend/test/integration/organizations/invitation-email.test.ts` — T052
- [x] T056 [P] [WP-03] [US1] Failing address-gate test: create/update/delete organization addresses refused `403 ORGANIZATION_PERMISSION_REQUIRED` without `addresses.manage`, allowed with it; list open to every member (FR-014a, OR-8) — organizations, addresses — `backend/test/contract/organizations/addresses-manage-permission.contract.test.ts` (new) — T052
- [x] T057 [P] [WP-03] [US7] Failing operator member tests: invite / direct create with `roleId?`, change role `{ roleId }` under `customers:manage` alone, recover-admin-access through `customer_account.change_role`, embedded members carry `organizationRole`, impersonation start response carries `organizationRole` and the impersonated member's permissions apply (FR-062, spec *Impersonation*) — organizations, customers — `backend/test/contract/organizations/admin-organization-members-roles.contract.test.ts` (new) — T052
- [x] T058 [P] [WP-03] Failing guard tests in `customers` (org assignment, deletion, moderation use `countAdministrators`; moving an account sets the target Organization's role in the same write) and `mfa` (MFA policy administrator-only by role kind, FR-011) — customers, mfa — `backend/test/integration/customers/customer-moderation-service.test.ts`, `backend/test/unit/customers/customer-detail-channels-port.test.ts`, `backend/test/integration/mfa/{account-identity-wiring,org-policy-tenant-isolation,enforcement-routing,customer-enrol-and-login}.test.ts` (the four naming the enum), `packages/modules/mfa/src/backend/services/account-identity.test.ts` — T052
- [x] T119 [P] [WP-03] [US2] Failing tests — the personal Organization's member is an administrator, and nothing it must not have is opened by that (PR-3, FR-070a, R-34): members list shows only themselves; invitations list empty; inviting (either role) → `422 VALIDATION_FAILED`, refused **before** `roleId` is resolved; revoking another Organization's invitation → `404`; removing or demoting themselves → `409 CANNOT_REMOVE_LAST_ADMIN` / `CANNOT_DEMOTE_LAST_ADMIN`; role routes `404` (T028's rule, re-asserted from the member side); the operator's delete and block of a personal Organization's member are **not** refused `409 ORG_OWNER_DEPLETION`, while the same operations on a company Organization's last administrator still are — organizations, customers — `backend/test/contract/organizations/personal-organization-administrator.contract.test.ts` (new), `backend/test/integration/customers/personal-organization-depletion.test.ts` (new) — T052
- [x] T122 [P] [WP-03] [US5] Failing test — `GET /api/v1/organizations/mine/invitations` lists an invitation that is neither accepted, revoked nor expired, and omits one whose `expiresAt` is in the past (seeded directly), beside the accepted and revoked omissions it already makes (FR-010a, PR-7, R-37) — organizations — `backend/test/contract/organizations/invitations-list-revoke.test.ts` — T052
- [x] T128 [P] [WP-03] [US3] Failing login test — with the login hook answering `cartMerge.outcome = 'skipped_permission'` (the value WP-01 declares; no dependency on WP-04), `POST /api/v1/auth/customer/login` answers `200` with `cartMerge.outcome = 'noop'` and **keeps** the `b2b_cart_anon` cookie, as for `noop_no_anon` (PR-12, FR-030a) — organizations — `backend/test/contract/organizations/login-cart-merge-skipped.contract.test.ts` (new) — T052

Implementation:

- [x] T059 [WP-03] [US1] Session views and login: `routes.public.ts`, `routes.customer.ts` (`/me`), `customers/routes.self.ts`; the request schemas in use switch to the strict ones; T053 green — organizations, customers — `org/src/backend/routes.public.ts`, `org/src/backend/routes.customer.ts`, `packages/modules/customers/src/backend/routes.self.ts`, `org/src/backend/services/organization-context-service.ts` — T053
- [x] T060 [WP-03] [US1] [US5] Members and invitations on the Commands; invitation service `roleId` API and last-admin invite rule; the invitation e-mail's `roleLabel` from the role; moderation-service recipient by administrator role kind; T054, T055 green — organizations — `org/src/backend/routes.members.ts`, `org/src/backend/services/{invitation-service,organization-moderation-service}.ts`, `org/src/backend/email-templates/invitation.ts` — T054, T055
  - *Done in WP-03*: invitation create and revoke are the Commands `organization_invitation.create` / `.revoke` (new files under `commands/`); the hand audits `organization.invite`, `organization.invite_revoke`, the operator's `organization.invite_sent` are gone. The template e-mail's `roleLabel` is translated in the system-default channel's language (what `templateEmailPort` sends in); the English in-code builder shows the English label. The legacy enum is dual-written through one helper, `legacyRoleOfKind` in `services/organization-role-store.ts`. The moderation recipient is read by the *Administrator* role id on this module's own table. `organization-context-service.ts`'s unused `loadCartApprovalPolicy` is removed with the platform `OrganizationReadPort` member.
- [x] T129 [WP-03] [US3] Login route: `skipped_permission` leaves the anonymous-cart cookie in place and narrows to `noop`; T128 green — organizations — `org/src/backend/routes.public.ts` — T059, T128
- [x] T123 [WP-03] [US5] `InvitationService.listPending` adds `expiresAt > now` to its consumed/revoked filter — the acceptance path's own expiry test; T122 green (FR-010a) — organizations — `org/src/backend/services/invitation-service.ts` — T060, T122
- [x] T061 [WP-03] [US1] Declare `addresses.manage` (member-default) in `addresses` with EN+PL label/description (A-1); gate the three address write routes with `organizationPermissionPreHandler`; T056 green — addresses, organizations — `packages/modules/addresses/src/manifest.ts`, `packages/modules/addresses/i18n/{en,pl}.json`, `org/src/backend/routes.customer.ts` — T056
- [x] T062 [WP-03] [US7] Operator member endpoints and impersonation response; T057 green — organizations, customers — `org/src/backend/routes.admin.ts`, `packages/modules/customers/src/backend/routes.admin.ts` — T057
  - *Done in WP-03*: the operator's role change and *recover administrator access* run `customer_account.change_role` on the bus, whose entry (against the Organization, naming the operator) replaces the hand audits `customer_account.admin_role_change` and `organization.break_glass_admin_promoted`. `customers`' two own-RFQ list calls stop passing `isOrgAdmin` (optional on `RfqCustomerContext` since this package). `GET /api/v1/admin/organizations/:id` also answers `predefinedRoles: OrganizationRoleRef[]` (Administrator, Member) — additive, for WP-08's role select when the operator cannot read the role list (`contracts/operator-api.md` §5, lead's request); `organizations`' bundle gains `organizationRoles.action.view` / `.close` (EN+PL) for WP-08.
- [x] T063 [WP-03] Reserved capabilities and guards in `customers` and `mfa` through `isAdministrator` / `countAdministrators`; T058 green — customers, mfa — `packages/modules/customers/src/backend/services/customer-{org-assignment,deletion,moderation}-service.ts`, `packages/modules/mfa/src/backend/services/account-identity.ts`, `packages/modules/mfa/src/backend/routes.org.ts` — T058
  - *Done in WP-03*: one `OrganizationDepletionGuard` (`customers/src/backend/services/organization-depletion-guard.ts`) asks the three guards' question by role id and `countAdministrators`, counting only unblocked administrators on all three paths (lead's ruling on the WP-03 question; before, deletion and unassign counted blocked ones). The last-administrator invitation rule likewise counts unblocked administrators and only unexpired administrator invitations (FR-010a).
- [x] T120 [WP-03] [US2] `customers`' depletion guards (deletion, block, unassign) apply to company Organizations only — `isPersonal` from `organizationDetailsPort`; the invitation service keeps the personal-Organization refusal first, before resolving `roleId`; T119 green — customers, organizations — `packages/modules/customers/src/backend/services/customer-{org-assignment,deletion,moderation}-service.ts`, `org/src/backend/services/invitation-service.ts` — T063, T119
- [x] T064 [WP-03] Convert the remaining subject tests listed in WP-03's *Owns* (`backend/test/integration/organizations/{customer-subtree-rollup,invite-and-scope,membership-shapes,moderation-email-language,moderation-notification-scope,unreadable-path-fails-closed}.test.ts`, `backend/test/unit/organizations/moderation-email-language.test.ts`, the second `org/src/backend/email-templates/*.test.ts`) — backend test — T059…T063
  - *Done in WP-03*: the four integration files that seed an account with `role: 'organization_admin'` through the entity (`customer-subtree-rollup`, `moderation-notification-scope`, `unreadable-path-fails-closed`, `moderation-email-language`) keep the seed — the M3 trigger maps it, and other modules' legacy readers still read the column until their packages merge; WP-12 converts them.
- [x] T065 [WP-03] i18n EN+PL for new `organizations` keys (only WP-03 edits this bundle in Wave 2) and `customers`/`mfa` where strings change; docs EN+PL+pin for `organizations` (members, invitations, addresses permission), `addresses`, `customers` — `org/i18n/*`, `org/docs/organizations.md`, `packages/modules/addresses/docs/addresses.md`, `packages/modules/customers/docs/customers.md`, `plpage(organizations|addresses|customers)` — T061…T063
- [x] T066 [WP-03] Changesets (`organizations`, `customers`, `mfa`, `addresses` — `minor` where a response/request shape breaks, naming `role` → `organizationRole`/`roleId`); verify; merge — `.changeset/170-03-*.md` — T064, T065 *(merged in #710; `.changeset/170-03-*.md`, six files)*

### WP-04 — carts (OR-3)

**Goal**: US 3; FR-030–FR-035, FR-040 (from-cart leg), FR-047 (save-to-list), FR-048 (from-list
leg). **Gate**: #656 merged (A-4). **Independent test**: `quickstart.md` §3–§4 over HTTP.

Tests first:

- [x] T067 [P] [WP-04] [US3] Failing gate contract tests per route family of `contracts/storefront-api.md` §5 (cart items, coupon, empty/batch, from-quote-request, from-shopping-list with both guards, save-to-shopping-list, convert-to-quote-request) — refused 403 naming the first missing code, allowed with it; `GET /api/v1/cart` ungated (FR-030, FR-040, FR-047, FR-048, SC-003) — carts — `backend/test/contract/carts/cart-organization-permissions.contract.test.ts` (new) — T052
  - *Partial (WP-04 MR)*: every `carts.create` family is asserted red-then-green; the three families judged by `shopping_lists.*` / `quote_requests.create` are `it.todo` until WP-05/WP-06 declare those codes (see T073).
- [x] T121 [P] [WP-04] [US3] Test, written before T073 and green before **and** after it — the guest basket is unchanged (PR-4, FR-030, R-35): an anonymous visitor's `POST /api/v1/cart/items` answers `200` and mints the anonymous cookie, `PATCH`/`DELETE …/items/:itemId` and `POST`/`DELETE /api/v1/cart/coupon` behave as today, and `GET /api/v1/cart` answers `200`; a signed-in member whose role lacks `carts.create` is refused `403 ORGANIZATION_PERMISSION_REQUIRED` on the same `POST` — carts — `backend/test/contract/carts/guest-basket-unchanged.contract.test.ts` (new) — T052
- [x] T126 [P] [WP-04] [US3] Failing sign-in merge test (PR-12, FR-030a): `mergeAnonymousIntoCustomer` for a member whose role lacks `carts.create` answers `skipped_permission`, moves no line, writes no audit row, and leaves the guest basket `active` with its token and lines; for a member holding it the four feature-037 outcomes are unchanged; the login itself succeeds in both cases — carts — `backend/test/integration/carts/merge-on-login-permission.test.ts` (new) — T052
- [x] T068 [P] [WP-04] [US3] Failing approval tests: `primaryCta` and the placement gate judged by `carts.order_without_approval`; `submit-for-approval` → `CART_APPROVAL_NOT_REQUIRED` for a holder; org carts list/read/approve/reject need `carts.approve` (or administrator) with today's reach, others 403; approving/rejecting one's own **pending** cart → `422 CART_APPROVAL_SELF_APPROVE`, a cart that is not pending → `422 CART_APPROVAL_NOT_PENDING` first, whoever owns it (R-36); an administrator's `submit-for-approval` → `CART_APPROVAL_NOT_REQUIRED`, `CART_APPROVAL_SELF_SUBMIT` no longer raised; the "submitted" e-mail goes to every member whose role holds `carts.approve` (`rolesHolding`), approval/rejection e-mails to the submitter (FR-031, FR-032, FR-033, FR-035, US 3.1–3.3, 3.6) — carts — `backend/test/contract/carts/cart-approval.contract.test.ts`, `backend/test/integration/carts/{cart-approval-flow,cart-approval-emails,cart-approval-refusal-codes,cart-approval-pending-edit}.test.ts`, `packages/modules/carts/src/backend/services/cart-approval-emails.test.ts` — T052
- [x] T069 [P] [WP-04] [US3] Failing cascade test: a role gaining `carts.order_without_approval` returns its members' `pending` carts to `not_required`; a member moved to such a role likewise; a role losing it leaves `approved` carts approved; with the subscriber disabled a `pending` cart is still placeable (FR-034, R-25, US 3.4/3.5) — carts — `backend/test/integration/carts/cart-approval-role-cascade.test.ts` (new) — T052
- [x] T070 [P] [WP-04] [US8] Failing off-state additions: with `carts` off its three codes leave the catalogue and every member's effective set, grants retained, back on reactivation (FR-007, FR-025, SC-007) — carts — `backend/test/integration/carts/off-state.test.ts` — T052
- [x] T071 [P] [WP-04] [US3] Failing removal tests: `PATCH /api/v1/organization/policies/cart-approval` and the operator `GET/PATCH …/cart-approval-policy` answer 404; the `organization.detail.after` zone no longer contributes `CartApprovalPolicy` (FR-031) — carts, admin — `backend/test/contract/carts/cart-approval-policy-read.contract.test.ts` (rewritten as a removal test), `admin/test/modules/organizations/organization-detail-after.two-contributors.test.tsx` — T052

Implementation:

- [x] T072 [WP-04] [US3] Declare `carts.create` (default), `carts.approve`, `carts.order_without_approval` (default) with EN+PL labels/descriptions — carts — `packages/modules/carts/src/manifest.ts`, `packages/modules/carts/i18n/{en,pl}.json` — T067
- [x] T073 [WP-04] [US3] Route gates — `{ guests: 'pass' }` on the routes that admit a guest today (`contracts/storefront-api.md` §5 `Pg`); T067 green and T121 still green — carts — `packages/modules/carts/src/backend/routes.ts` — T072
  - *Partial (WP-04 MR)*: every `carts.create` gate is in; the three gates naming another module's code — `shopping_lists.convert` on from-shopping-list, `shopping_lists.create` on save-to-shopping-list, `quote_requests.create` on convert-to-quote-request — wait for WP-05/WP-06 to declare those codes (a guard naming an undeclared code is a `500` and an `undeclared-check`); T067 carries them as `it.todo`.
- [x] T074 [WP-04] [US3] Approval by permission: `cartApprovalRequired` via the port, approvers via `carts.approve`, self-approval refusal after the not-pending check, `CART_APPROVAL_SELF_SUBMIT` no longer raised and removed from `carts`' manifest `errorCodes` and bundles, reach without `isOrgAdmin`, recipients via `rolesHolding`; remove the policy endpoints; T068, T071 (backend) green — carts — `packages/modules/carts/src/backend/routes.organization.ts`, `routes.admin.ts`, `services/cart-approval-service.ts`, `services/cart-approval-policy.ts` (from #656), `services/cart-approval-emails.ts`, `services/organization-cart-reach.ts`, `entities/cart.entity.ts` (comment) — T073
- [x] T127 [WP-04] [US3] `CartService.mergeAnonymousIntoCustomer` judges `carts.create` through `organizationPermissionPort.can` (via `lazyPort`, no bare `catch`) after locating the source basket and before any write, and answers `skipped_permission` when the member lacks it; T126 green — carts — `packages/modules/carts/src/backend/services/cart-service.ts` — T073, T126
- [x] T075 [WP-04] [US3] Cascade subscribers on `organization_role.permissions_changed.v1` and `customer_account.organization_role_changed.v1` through `ctx.subscribe`, transitions through carts' own audited path; T069 green — carts — `packages/modules/carts/src/backend/index.ts` — T074
- [x] T076 [WP-04] [US3] Remove the Admin UI zone and panel; T071 (admin) green; `carts/src/admin/index.ts` keeps its pages, so no layer disappears (run `manifests:check` to confirm) — carts — `packages/modules/carts/src/admin/index.ts`, `packages/modules/carts/src/admin/zones/CartApprovalPolicy.tsx` (deleted), `packages/modules/carts/src/admin/components/CartApprovalPolicyPanel.tsx` (deleted), `admin/test/modules/carts/cart-approval-policy-zone.test.tsx` (deleted) — T074
- [x] T077 [WP-04] Off-state wiring if any; T070 green; convert the remaining carts subject tests in WP-04's *Owns* (`backend/test/contract/carts/*` naming the enum, `backend/test/unit/carts/cross-module-ports.unit.test.ts`) — carts — T075, T076
- [x] T078 [WP-04] Docs EN+PL+pin (approval by permission, codes, removed switch) — `packages/modules/carts/docs/carts.md`, `plpage(carts)` — T074
- [x] T079 [WP-04] Generated artefacts (`composer:generate` for the admin registry), changeset `carts` `minor` (removed endpoints and zone named); verify; merge — `.changeset/170-04-carts.md` — T077, T078 *(merged in #709; `.changeset/170-04-carts.md`)*

### WP-05 — quote requests, P2 part

**Goal**: FR-040 (scratch and resubmit legs), FR-041 in its P2 form (visibility via
`isAdministrator`, R-30). **Independent test**: RFQ creation refused without `quote_requests.create`.

- [x] T080 [P] [WP-05] [US1] Failing tests: `POST /api/v1/quote-requests` and `…/:id/resubmit` need `quote_requests.create`; `POST …/:id/convert-to-order` needs `carts.create`; Organization-wide RFQ visibility only for the administrator role kind (unchanged outcome, R-30); off-state case for the code (FR-040, US 1.3, US 8) — quote_requests — `backend/test/contract/quote_requests/rfq-organization-permissions.contract.test.ts` (new), `backend/test/integration/quote_requests/off-state.test.ts` — T052
- [x] T081 [WP-05] [US1] Declare `quote_requests.create` (default) EN+PL; gates in `routes.customer.ts`; customer context without `isOrgAdmin`; visibility via `isAdministrator`; T080 green — quote_requests — `packages/modules/quote_requests/src/manifest.ts`, `packages/modules/quote_requests/i18n/{en,pl}.json`, `packages/modules/quote_requests/src/backend/{index.ts,routes.customer.ts}`, `packages/modules/quote_requests/src/backend/services/rfq-service.ts` — T080
- [x] T082 [WP-05] Convert subject tests in WP-05's *Owns* (`backend/test/integration/quote_requests/*` naming the enum, `backend/test/contract/quote_requests/pdf-export.test.ts`, `packages/modules/quote_requests/src/backend/**/*.test.ts`, `packages/contracts/src/quote-requests.test.ts`) — T081
- [x] T083 [WP-05] Docs EN+PL+pin, changeset `quote_requests` (`minor` if the published customer-context type changes), verify, merge — `packages/modules/quote_requests/docs/quote_requests.md`, `plpage(quote_requests)`, `.changeset/170-05-quote-requests.md` — T082 *(merged in #705; changeset and docs EN+PL+pin present)*

### WP-06 — shopping lists and quick order (OR-1, OR-6, #653)

**Goal**: US 4; FR-047, FR-048, FR-050, FR-012, FR-030 (quick-order leg). **Merge gate**: WP-04
merged (its codes must be declared for the inventory). **Independent test**: the three-member
one-click matrix of US 4.

- [x] T084 [P] [WP-06] [US4] Failing one-click tests: eligibility answers `permission_required` (no `quick_order.one_click`) and `cart_approval_required` (holds it, no `carts.order_without_approval`), in that order and before the setting/default reasons — a member lacking both reads `permission_required` (R-6, PR-6); `POST /api/v1/quick-order/one-click` refused 403 for the first missing code **before any basket write** (assert no cart row touched); a holder of both places as today (FR-050, US 4.1–4.3) — quick_order — `packages/modules/quick_order/src/backend/services/one-click-service.test.ts`, `backend/test/integration/quick_order/one-click-permissions.test.ts` (new) — T052
- [x] T085 [P] [WP-06] [US1] Failing quick-order build tests: `mode: cart` and `import` need `carts.create`; `mode: quote` needs `quote_requests.create` via `assert` in the handler; Organization-scope preferences administrator-only (FR-012, FR-030, FR-040); operator `onBehalfOf` stays operator-gated (R-26) — quick_order — `packages/modules/quick_order/src/backend/services/quick-order-build-service.test.ts`, `backend/test/contract/quick_order/quick-order-permissions.contract.test.ts` (new) — T052
- [x] T086 [P] [WP-06] [US1] Failing shopping-list tests: writes and set-default need `shopping_lists.create`; convert-to-cart needs `shopping_lists.convert` + `carts.create`, convert-to-rfq `shopping_lists.convert` + `quote_requests.create` (refusal names the first missing); reading own lists open; default list on customer create unaffected (FR-047, FR-048) — shopping_lists — `backend/test/contract/shopping_lists/shopping-list-permissions.contract.test.ts` (new), `backend/test/contract/shopping_lists/default-list-on-customer-create.test.ts` — T052
- [x] T087 [P] [WP-06] [US8] Failing off-state additions for `shopping_lists` and `quick_order` codes (US 8 scenario uses `shopping_lists`) — `backend/test/integration/shopping_lists/off-state.test.ts`, `backend/test/integration/quick_order/off-state.test.ts` — T052
- [x] T088 [WP-06] [US4] Declare `quick_order.one_click` (default) EN+PL; eligibility and placement in `one-click-service.ts`; route gates; preferences by administrator kind (drop `kind: 'org_admin'` spelling); T084, T085 green — quick_order — `packages/modules/quick_order/src/manifest.ts`, `packages/modules/quick_order/i18n/{en,pl}.json`, `packages/modules/quick_order/src/backend/services/{one-click-service,quick-order-build-service}.ts`, `packages/modules/quick_order/src/backend/{routes.ts,routes.one-click.ts,routes.preferences.ts,routes.admin.ts}` — T084, T085
- [x] T089 [WP-06] [US1] Declare `shopping_lists.create`, `shopping_lists.convert` (both default) EN+PL; gates; service without the role read; T086 green — shopping_lists — `packages/modules/shopping_lists/src/manifest.ts`, `packages/modules/shopping_lists/i18n/{en,pl}.json`, `packages/modules/shopping_lists/src/backend/routes.ts`, `packages/modules/shopping_lists/src/backend/services/shopping-list-service.ts` — T086
- [x] T090 [WP-06] T087 green; docs EN+PL+pin for both modules; changesets `quick_order`, `shopping_lists`; rebase on the integration branch after WP-04 merges; verify; merge — `packages/modules/{quick_order,shopping_lists}/docs/*.md`, `plpage(quick_order|shopping_lists)`, `.changeset/170-06-*.md` — T088, T089, WP-04 merged *(merged in #707; `.changeset/170-06-*.md` and both modules' docs EN+PL+pin present)*

### WP-07 — orders (OR-5)

**Goal**: FR-049, US 2.5. **Independent test**: colleague order list/read/reorder/clone/returns/
invoices only with `orders.view_organization`, otherwise 404.

- [x] T091 [P] [WP-07] [US2] Failing tests: a member without `orders.view_organization` sees only own orders and gets 404 on a colleague's order, its reorder, clone-to-quote, returns start and invoice; with it (or administrator) the administrator's reach including roll-up subtree (FR-049, OR-5) — orders — `backend/test/integration/orders/colleague-orders-permission.test.ts` (new), `backend/test/integration/orders/{order-access-service,buyer-order-actions-scope}.test.ts`, `packages/modules/orders/src/backend/services/{order-buyer-action-scope,order-clone-to-quote-scope}.test.ts` — T052
- [x] T092 [WP-07] [US2] Declare `orders.view_organization` (not default) EN+PL; `OrderAccessService` and clone-to-quote through `can(…, 'orders.view_organization')`; T091 green — orders — `packages/modules/orders/src/manifest.ts`, `packages/modules/orders/i18n/{en,pl}.json`, `packages/modules/orders/src/backend/services/{order-access-service,order-clone-to-quote-service}.ts` — T091
- [x] T093 [WP-07] Docs EN+PL+pin; changeset `orders`; verify; merge — `packages/modules/orders/docs/orders.md`, `plpage(orders)`, `.changeset/170-07-orders.md` — T092 *(merged in #708; `.changeset/170-07-orders.md` and docs EN+PL+pin present)*

*Off-state*: if `orders` is switchable, T091 also adds the off-state case to its existing off-state
test; if it is `nonDeactivatable`, nothing is added (record which in the MR).

### WP-08 — Admin UI (merges after WP-03)

**Goal**: US 7; FR-060–FR-062, FR-066 (link). **Independent test**: `quickstart.md` §5.

- [x] T094 [P] [WP-08] [US7] Failing admin tests: Roles tab hidden without both operator codes and for a personal Organization; read-only with `organizations:read-roles`; edit/create/delete with `organizations:manage-roles`, delete dialog requires a replacement for a held role; editor grouped by module with translated labels; members table role column and role select (data from `GET …/roles` with the read code, else members' roles + predefined); last-admin disabling by `organizationRole.kind`; *History* link to `/audit-log?objectType=organization&objectId=<id>`; axe clean (FR-060…FR-062, FR-066, US 7) — admin — `admin/test/modules/organizations/organization-roles-tab.test.tsx` (new), `admin/test/modules/organizations/organization-detail-members-role.test.tsx` (new) — T052
- [x] T095 [WP-08] [US7] `OrganizationRolesTab.tsx` with admin-kit primitives (designer-reviewed layout, R-12), API client calls, mount on `OrganizationDetail.tsx`, members table and forms; strings from the bundle WP-02a/WP-03 wrote (no bundle edit here); T094 green — organizations — `org/src/admin/components/OrganizationRolesTab.tsx` (new), `org/src/admin/pages/OrganizationDetail.tsx`, `org/src/admin/api/*` — T094
- [x] T096 [WP-08] Convert the other `admin/test/modules/organizations/*` files naming the enum; `composer:generate` if the admin registry moves; `i18n:hardcoded` at its ledger; changeset `organizations` (admin layer); rebase after WP-03 merges; verify; merge — `.changeset/170-08-admin-roles-tab.md` — T095, WP-03 merged *(merged in #706 with `.changeset/170-08-admin-roles-tab.md`; the one other file that named the legacy shape, `organization-detail-after.two-contributors.test.tsx` (`requiresCartApproval`), was converted by WP-04 in #709, and no file under `admin/test/modules/organizations/` names the legacy role since — checked in WP-13)*

**Checkpoint (end of Wave 2)**: every FR-022 P2 code declared and enforced (inventory green in both
directions), every backend legacy read removed from converted modules.

---

## Phase 4 — Wave 3: storefront (WP-09 ∥ WP-10; may draft during Wave 2, merge after their APIs), and the 2026-11-04 packages WP-15, WP-14, WP-14b, WP-16

### WP-09 — organization area (merge after WP-02a, WP-03, WP-04)

- [x] T097 [P] [WP-09] [US1] Failing tests: account nav shows *Members* and *Roles* to administrators and *Carts to approve* to `carts.approve` holders (no module-presence gate: `carts` and `organizations` are non-deactivatable, owner ruling on #715), **none of the three** for a personal Organization's member although they hold *Administrator*, and the members, roles and carts pages redirect such a member to `/account` — gated on `organization.isPersonal`, not the role (PR-3, FR-070a, R-34); roles list/create/edit/delete pages (replacement dialog, protected roles, name-taken and stale errors shown); **the create page opens with every catalogue permission unchecked, offers no "copy from *Member*" (nor any other role), shows `memberDefault` at most as a hint, and saving with nothing ticked posts `permissions: []`** (OR-9, FR-004a, R-39 — the backend already stores exactly that, so this is the storefront's own test); members page role select; account page shows the member's role and the plain-language list from `GET …/mine/role`; cart-approval settings page gone; EN+PL (FR-056, FR-057, FR-058, US 1, US 6) — storefront — `storefront/test/account/{i18n/account-pages,module-presence-nav,org-cart-detail,org-carts-list}.test.tsx`, `storefront/test/account/org-roles-pages.test.tsx` (new) — T052
- [x] T098 [WP-09] [US1] [US6] Implement: `app/(account)/layout.tsx`, `app/(account)/organization/roles/{page,new/page,[id]/page}.tsx` (new), `organization/members/**`, `organization/carts/**`, delete `organization/settings/cart-approval/`, the account page, `lib/api/{account,organization}.ts` (`CurrentOrganization` gains the `isPersonal` `/api/v1/me` already serves), `lib/i18n/messages/account.ts` (EN+PL); the role-create page's initial selection is empty and it has no copy control (OR-9, FR-004a; no backend change, R-39); Server Components preserved (VII); T097 green — storefront — T097, WP-02a/03/04 merged
- [x] T099 [WP-09] Verify (`pnpm --filter storefront run test`, typecheck, lint, `check:rsc-discipline`); merge — T098 *(merged in #715; `.changeset/170-09-storefront-organization-area.md`)*

### WP-10 — commerce surfaces (merge after WP-04, WP-05, WP-06)

- [x] T100 [P] [WP-10] [US4] [US3] Failing tests: one-click button not rendered when eligibility is disabled (FR-051); add-to-cart/cart editing, quick order, request-a-quote (PDP, cart, lists), save-to-list and list conversions hidden or disabled per `can(session, code)` for a signed-in member — **the quick-order import (paste and file upload) shown to a member holding `carts.create` or `quote_requests.create`, hidden to one holding neither; after an import, *add to cart* offered only with `carts.create` and *request a quote* only with `quote_requests.create`** (OR-10, FR-030b; a member holding only `quote_requests.create` imports and can only request a quote) — while a **signed-out visitor still sees add-to-cart and cart editing** (PR-4, R-35); `CartApprovalBanner` and primary CTA follow `primaryCta` without the Organization flag (FR-057) — storefront — `storefront/test/checkout/cart-approval-submit.test.tsx`, `storefront/test/components/permission-aware-actions.test.tsx` (new) — T052
- [x] T101 [WP-10] [US4] [US3] Implement in `components/CartApprovalBanner.tsx`, `components/CartPrimaryCta.tsx`, `components/CartConvertButtons.tsx`, `components/AddToShoppingListButton.tsx`, `components/pricing/QuoteRequestCta.tsx`, `app/(catalog)/p/[slug]/page.tsx`, the quick-order and shopping-list pages under `app/(account)/{quick-order,shopping-lists}/`, `lib/api/cart.ts`, `lib/actions/cart.ts`, `lib/i18n/messages/commerce.ts` (EN+PL); the quick-order import by OR-10's either-of rule (`can(session, 'carts.create') || can(session, 'quote_requests.create')`; the backend rule is WP-15's, and the storefront tests do not wait for it); T100 green — storefront — T100, WP-04/05/06 merged
- [x] T102 [WP-10] Verify; merge — T101 *(merged in #713; storefront only, `check:release-intent` asked for no changeset)*

### WP-15 — quick-order import by either target, and the OR-9 Admin UI lock (owner rulings OR-10, OR-9; 2026-11-04)

**Goal**: FR-030b, FR-004a (Admin UI). A follow-up of WP-06 (#707, merged), which gates
`POST /api/v1/quick-order/import` with `organizationPermissionPreHandler(organizationPermissions,
'carts.create')` in `packages/modules/quick_order/src/backend/routes.ts`. **Merge gate**: none beyond
WP-05, WP-06 and WP-08, all merged; may run beside WP-09, WP-10 and WP-14. **Independent test**: a
member holding only `quote_requests.create` imports a CSV and can build a quote request, not a cart.
Branch `wp/170-15-import-either`.

- [x] T139 [P] [WP-15] [US1] Failing tests (OR-10, FR-030b, R-40) — in the `POST /api/v1/quick-order/import` block of the contract file: (a) **new, red today** — a member whose role holds `quote_requests.create` and not `carts.create` is served (`200`, recognised rows); (b) kept — a holder of `carts.create` alone is served; (c) **rewritten** from *refuses a member without carts.create* — a member holding neither is refused `403 ORGANIZATION_PERMISSION_REQUIRED` with `details.permission = 'carts.create'`, and a malformed file body gets the same `403` (judged before the parse, not `422`); (d) the target stays gated — the quote-only member's `POST …/build` with `target: cart` → `403` naming `carts.create` with no basket line written, and the cart-only member's `target: quote_request` → `403` naming `quote_requests.create` with no quote request created; (e) a signed-out caller still `401`. In the off-state file: with `quote_requests` switched off, the quote-only member's import is refused naming `carts.create` (an absent module's code grants nothing, FR-007) and is served again after reactivation — quick_order — `backend/test/contract/quick_order/quick-order-permissions.contract.test.ts`, `backend/test/integration/quick_order/off-state.test.ts` — WP-06 merged
- [x] T140 [P] [WP-15] [US1] Characterization test, **green before and after** (as T121): the Admin UI Roles tab's create editor opens with every catalogue checkbox unchecked, shows the *member-default* hint without ticking it, offers no copy-from-role control, and saving with nothing ticked calls `organizationRolesClient.create` with `permissions: []` (OR-9, FR-004a, R-39) — admin — `admin/test/modules/organizations/organization-roles-tab.test.tsx` — WP-08 merged
- [x] T141 [WP-15] [US1] Replace the import's guard with a module-local pre-handler in `routes.ts` (R-40): after `requireCustomer`, before the body is parsed; the subject from `request.actor` as `organizationPermissionPreHandler` builds it (`organizationRoleId` included); `can(…, CARTS_CREATE)` then `can(…, QUOTE_REQUESTS_CREATE)` (module-local string constants, which the inventory resolves); neither → `assert(subject, CARTS_CREATE, { language: await request.responseLanguage() })`; no bare `catch` around the port (`check:port-catches`); the route's doc comment restated; `build` untouched; T139 green, T140 still green; docs EN+PL+pin (the import's rule) — quick_order — `packages/modules/quick_order/src/backend/routes.ts`, `packages/modules/quick_order/docs/quick_order.md`, `plpage(quick_order)` — T139
- [x] T142 [WP-15] Changeset `.changeset/170-15-quick-order-import.md` (`@endora-commerce/mod-quick-order`, `minor`: the import's guard widens from `carts.create` to either code; not a break for any member — *Member* holds both); verify (standing obligations 1–5, the replay among the targeted files — it must move no row, `contracts/migration-and-replay.md` §6.3; the permission inventory green); merge — T141 *(merged in #722; `.changeset/170-15-quick-order-import.md`)*

### WP-14 — returns and complaints by permission, backend (owner ruling OR-11; 2026-11-04)

**Goal**: FR-052–FR-054, FR-022's two `returns` codes, User Story 9 (backend), research R-41.
**Gate**: WP-07 merged (done). The owner answered Q-R1 = A, Q-R2 = A and accepted Q-R3 on 2026-11-04
(`plan.md` *OR-11's design questions*), so nothing waits. **Merge before** WP-11 and WP-12. **Independent test**: User Story 9's scenarios over HTTP.
Branch `wp/170-14-returns`. Moves no oracle row and flips no ledger entry (§6.3).

Tests first:

- [x] T143 [P] [WP-14] [US9] Failing submission-gate tests (FR-052): `POST /api/v1/returns` by a member whose custom role lacks `returns.create` → `403 ORGANIZATION_PERMISSION_REQUIRED` with `details.permission = 'returns.create'` and its EN/PL label, for `kind: 'return'` and `kind: 'complaint'`, with no `return_cases` row and no `return_case.create` audit entry, judged **before** the order is read (the same `403` for another Organization's order id); *Member* (implicit member default) and *Administrator* still `201` for their own order; a member lacking the code still reads `GET /api/v1/orders/:orderId/returnable` of their own order, `GET /api/v1/returns`, `GET …/:id`, and comments, attaches, selects the delivery method and cancels on a case they filed before the role change; a signed-out caller `401` — backend test — `backend/test/integration/returns/organization-permissions.test.ts` (new) — WP-07 merged
- [x] T144 [P] [WP-14] [US9] Failing visibility tests (FR-053): with cases filed by a colleague, by the caller and by another Organization's member — a member without `returns.view_organization` lists only their own and gets `404 NOT_FOUND` on the colleague's case; a custom role holding the code and *Administrator* list both Organization cases (not the foreign one, `404` on it) and read the colleague's (`200`), every summary carrying `customerAccountId` (the filer); a roll-up head-office login holding the code lists its subtree's cases, one without it only its own (roll-up never adds a permission); the holder's comment, attachment, delivery-method choice and cancel on the colleague's case → `404 NOT_FOUND`, the case unchanged (Q-R2 = A) — backend test — `backend/test/integration/returns/organization-returns-visibility.test.ts` (new) — WP-07 merged
- [x] T145 [P] [WP-14] [US9] Failing colleague-order tests (FR-054, Q-R1 = A): on a colleague's completed order, a custom role holding `returns.create` and `orders.view_organization`, and *Administrator*, get `200` on `GET /api/v1/orders/:orderId/returnable` and `201` on `POST /api/v1/returns`, the case's `customerAccountId` being the starter and its e-mail going to the starter; `returns.create` alone → `404` on both; `orders.view_organization` without `returns.create` → `returnable` `200`, the submission `403` naming `returns.create`; in WP-07's file, the two *gets the answer the administrator gets today on starting a return from it (placer only, 404)* cases (holder and *Administrator*) become `200`, with their comment rewritten (the widening is this package's, as the comment said) — backend test — `backend/test/integration/returns/colleague-order-returns.test.ts` (new), `backend/test/integration/orders/colleague-orders-permission.test.ts` — WP-07 merged
- [x] T146 [P] [WP-14] [US8] Failing off-state additions: with `returns` switched off its two codes leave the permission catalogue and every member's effective set (`GET …/mine/role`, the session's `permissions`), a custom role's grant of them is retained, and both come back on reactivation (FR-007, FR-025, SC-007) — backend test — `backend/test/integration/returns/off-state.test.ts` — WP-07 merged

Implementation:

- [x] T147 [WP-14] [US9] Contract first (Principle II): `returnCaseSummarySchema` gains `customerAccountId: uuidSchema` (additive; `returnCaseDetailSchema` already declares it and keeps it through `.extend`; `adminReturnRowSchema` inherits it), with a schema test; changeset `.changeset/170-14-contracts-return-summary.md` (`@endora-commerce/contracts`, `minor`, naming the field) — contracts — `packages/contracts/src/returns.ts`, its test — T144
- [x] T153 [WP-14] Fix the stale doc comment on `OrderReadPort.findByIdForCustomer` (it still says "a regular member reaches only the orders they placed, an `organization_admin` every order of their Organization", untrue since WP-07): a member whose role holds `orders.view_organization` (*Administrator* included) reaches every order of the Organization (its roll-up subtree through the tenant filter), anyone else only the orders they placed; name `returns` (FR-054) beside `invoices` as a consumer. Comment only; covered by T147's `@endora-commerce/contracts` changeset (mention it there) — contracts — `packages/contracts/src/orders.ts` — WP-07 merged
- [x] T148 [WP-14] [US9] Declare `returns.create` (member-default) and `returns.view_organization` (not) under `organizationPermissions` with EN+PL `organizationPermissions.<code>.{label,description}` in the package-root bundles (EN labels: FR-022; PL: *Zgłaszanie zwrotów i reklamacji*, *Wyświetlanie zwrotów i reklamacji organizacji*, for the product owner's review); add `organizations` to `dependencies` (R-41 item 7); in `index.ts` resolve `lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort')` and `lazyPort<OrderReadPort>(ctx, 'orderReadPort')` (string literals) into the plugin options; `routes.customer.ts`: `organizationPermissionPreHandler(() => permissions, 'returns.create')` after `requireCustomer` on `POST /api/v1/returns` only, and the routes pass the customer context `{ customerAccountId, organizationId, organizationRoleId }` from the actor; `return-case-service.ts`: a module-local scope helper (one method asking `can(…, 'returns.view_organization')`, as `OrderAccessService.scopedWhere` does) for `listForCustomer` and `getForCustomer`, the follow-up lookups left on `{ id, customerAccountId }` (Q-R2 = A); `getReturnable` and `createCase` judge the order with `orderReadPort.findByIdForCustomer` instead of `ctx.customerAccountId !== customerAccountId` (Q-R1 = A); `toSummary` and the operator's row mapper fill `customerAccountId`; extend `orders.view_organization`'s description (manifest, `orders/i18n/{en,pl}.json`) to name starting a return; `manifests:generate`/`composer:generate` as the checks ask (the dependency edge); T143–T146 green — returns, orders — `packages/modules/returns/src/manifest.ts`, `packages/modules/returns/i18n/{en,pl}.json`, `packages/modules/returns/src/backend/{index.ts,plugin.ts,routes.customer.ts}`, `packages/modules/returns/src/backend/services/{return-case-service.ts,return-list-service.ts}`, the new scope helper beside them, `packages/modules/orders/src/manifest.ts`, `packages/modules/orders/i18n/{en,pl}.json` — T143, T144, T145, T146, T147, T153
- [x] T149 [WP-14] Docs EN+PL+pin — the returns page's buyer section (who may open, see and act on a case; the two codes) and the orders page's `orders.view_organization` paragraph (it now names starting a return); changeset `.changeset/170-14-returns.md` (`@endora-commerce/mod-returns`, `minor`: the new `organizations` dependency, the gate, the widened list and read, the plugin options gaining `organizationPermissions` and `orderReadPort`) and `.changeset/170-14-orders-description.md` (`@endora-commerce/mod-orders`, `minor`: the `orders.view_organization` description names starting a return from a colleague's order; no behaviour of `orders` changes); verify (standing obligations 1–5 — the replay among the targeted files, moving no row, §6.3; the permission inventory green in both directions; `check:port-dependencies`, `check:module-boundary`, `check:off-state-coverage`); merge before WP-11 — `packages/modules/returns/docs/returns.md`, `plpage(returns)`, `packages/modules/orders/docs/orders.md`, `plpage(orders)` — T148 *(merged in #721; both changesets and the docs EN+PL+pin present)*

### WP-14b — returns and complaints by permission, storefront (owner ruling OR-11; merge after WP-14 and WP-09)

**Goal**: FR-052, FR-053 and FR-057 on the storefront's returns surfaces. Not WP-10's (its files are
the commerce surfaces) and not WP-09's (the organization area); it shares only
`lib/i18n/messages/account.ts` with WP-09, hence the merge order. May draft against the contract
(`storefront-api.md` §5) while WP-14 is open. Designer-reviewed against `.claude/skills/ux-laws/SKILL.md`.
Branch `wp/170-14b-returns-storefront`.

- [x] T150 [P] [WP-14b] [US9] Failing tests: the order detail's *Start a return* / *File a complaint* action is not rendered for a member without `returns.create` (`can(session, 'returns.create')`) and is rendered as today otherwise; `/returns/new` for such a member shows a plain-language notice naming the permission instead of the form, with no submit; the returns list of a member holding `returns.view_organization` marks a case whose `customerAccountId` is not the session's as filed by a colleague (EN+PL); a colleague's case detail renders no comment form, attachment upload, delivery-method choice or cancel (Q-R2 = A); a member without the code sees the page as today — storefront — `storefront/test/account/{order-detail-return-action,returns-new-returnable,i18n/orders-returns}.test.tsx`, `storefront/test/account/returns-organization-permissions.test.tsx` (new) — T147
- [x] T151 [WP-14b] [US9] Implement: `app/(account)/orders/[id]/page.tsx` (the action by `can`), `lib/returns/returnForm.ts` (`orderReturnAction` told whether the member may open one), `app/(account)/returns/{page,new/page,[id]/page}.tsx`, `lib/api/returns.ts` (`ReturnCaseSummary.customerAccountId`), the returns keys of `lib/i18n/messages/account.ts` (EN+PL); Server Components preserved (VII); T150 green — storefront — T150, WP-14 merged, WP-09 merged
- [x] T152 [WP-14b] Verify (`pnpm --filter storefront run test`, typecheck, lint, `check:rsc-discipline`, `i18n:hardcoded`); merge before WP-11 — T151 *(merged in #725; `.changeset/170-14b-storefront-returns.md`)*

### WP-16 — reorder and clone-to-quote by permission, approval wording, addresses controls (owner ruling of 2026-11-04 after the WP-11 review, #727)

**Goal**: FR-030 and FR-040 on the two buyer actions that build something from a past order, which
WP-07 left judged by the order scope alone; FR-057 on the order detail and `/organization/addresses`;
FR-031's wording in placement's `ORDER_CART_APPROVAL_REQUIRED` sentences. **Gate**: WP-04, WP-05,
WP-07, WP-09, WP-10 and WP-14b merged (all done); may run beside WP-11 and WP-12. **Merge before**
WP-13. **Independent test**: a member whose role lacks `carts.create` is refused the reorder of their
own order, and is not offered it on the order detail. Branch `wp/170-16-order-actions`. Moves no oracle
row and flips no ledger entry (§6.3): every oracle member holds *Member* or *Administrator*, both
holding the two codes.

**Check order** (the route comment states it): `requireCustomer` → the permission → the order scope —
as every composite gate of WP-04, WP-06 and WP-14 is judged. A member lacking the code gets `403
ORGANIZATION_PERMISSION_REQUIRED` whichever order the id names (their own, a colleague's, none), so the
refusal says nothing of the order; a holder then meets the FR-049 scope unchanged (`404
ORDER_NOT_FOUND` out of it).

- [x] T155 [P] [WP-16] [US1] Failing tests: `POST /api/v1/orders/:id/reorder` by a member whose custom role lacks `carts.create` → `403 ORGANIZATION_PERMISSION_REQUIRED`, `details.permission = 'carts.create'`, EN and PL sentence, on their own order, a colleague's and an id that is no order, with every basket of theirs unchanged; `POST …/clone-to-quote` likewise for `quote_requests.create`, with no quote request created; a holder of the code is served on their own order and still gets `404 ORDER_NOT_FOUND` on a colleague's without `orders.view_organization`; a signed-out caller `401`; off-state: with `quote_requests` off on either axis the clone is refused by the guard naming `quote_requests.create` (its code leaves the effective set, FR-007; it was `503 MODULE_DISABLED` from the service before; the owner kept `403` on 2026-11-04) and nothing is created, served again after; WP-07's and #665's viewers gain `carts.create` and `quote_requests.create` so their rows keep answering the scope — backend test — `backend/test/integration/orders/order-actions-permissions.test.ts` (new), `backend/test/integration/orders/{colleague-orders-permission,buyer-order-actions-scope}.test.ts` — WP-07 merged
- [x] T156 [P] [WP-16] [US1] Failing storefront tests: the order detail renders *Order again → cart* only with `carts.create` and *Order again → quote request* only with `quote_requests.create` (EN+PL; hidden, not explained, as WP-14b's return entry), both when the session cannot be read; the account i18n fixture's *Member* holds its defaults — storefront — `storefront/test/account/order-detail-buyer-actions.test.tsx` (new), `storefront/test/account/i18n/orders-returns.test.tsx` — WP-10, WP-14b merged
- [x] T157 [P] [WP-16] [US1] Failing storefront tests: `/organization/addresses` keeps the list for every member and renders the add form and the *Remove* buttons only with `addresses.manage`; a member without it reads one line saying why (EN+PL) in place of the form; today's page when the session cannot be read; the account i18n fixture's *Administrator* holds `addresses.manage` — storefront — `storefront/test/account/organization-addresses-permissions.test.tsx` (new), `storefront/test/account/i18n/account-pages.test.tsx` — WP-03, WP-09 merged
- [x] T158 [P] [WP-16] [US3] Failing bundle test: the three `errors.ORDER_CART_APPROVAL_REQUIRED.cart_approval_{not_submitted,pending,rejected}` sentences name no administrator and no Organization-wide requirement, and use the owner-accepted storefront wording (*your role requires approval of this cart*, *an approver in your organization*; PL *Twoja rola wymaga akceptacji tego koszyka*, *osoba zatwierdzająca w Twojej organizacji*) — orders — `packages/modules/orders/src/backend/cart-approval-wording.test.ts` (new) — WP-04 merged
- [x] T159 [WP-16] [US1] Gates: `organizationPermissionPreHandler(deps.organizationPermissions, CARTS_CREATE)` on the buyer's reorder and `(…, QUOTE_REQUESTS_CREATE)` on the buyer's clone, after `requireCustomer` (module-local string constants, which the inventory resolves); `OrdersDeps.organizationPermissions` resolved per request from the plugin's port; the check order in the route comment; operator routes untouched; T155 green — orders — `packages/modules/orders/src/backend/{routes.ts,plugin.ts}` — T155
- [x] T160 [WP-16] [US3] The three sentences EN+PL in the orders bundles; T158 green. `carts`' error sentences already follow the role (`CART_APPROVAL_NOT_REQUIRED`, `…_SELF_APPROVE`); its non-error `approval.banner.*` and `reject.email.body` keys still name an administrator but no code reads them (reported, not edited) — orders — `packages/modules/orders/i18n/{en,pl}.json` — T158
- [x] T161 [WP-16] [US1] Storefront: `lib/orders/order-actions.ts` (new, over `commerceAbilities`) read by `app/(account)/orders/[id]/page.tsx`, which now reads the session once for its three role-judged actions; `lib/account/organization-addresses.ts` (new, `can(…, 'addresses.manage')`) read by `app/(account)/organization/addresses/page.tsx`; `account.addresses.manageNotAllowed` EN+PL in `lib/i18n/messages/account.ts`; Server Components preserved (VII); T156, T157 green — storefront — T156, T157
- [x] T162 [WP-16] Docs EN+PL+pin after #727 merges: the orders page's buyer actions (the two codes) and its `ORDER_CART_APPROVAL_REQUIRED` sentence table, the addresses page's storefront controls — `packages/modules/orders/docs/orders.md`, `plpage(orders)`, `packages/modules/addresses/docs/addresses.md`, `plpage(addresses)` — T159, T160, T161, #727 merged
- [x] T163 [WP-16] Changesets `.changeset/170-16-orders-actions.md` (`@endora-commerce/mod-orders`, `minor`: the buyer's reorder refused `403 ORGANIZATION_PERMISSION_REQUIRED` without `carts.create`, the clone without `quote_requests.create`; the three sentences reworded) and the empty `.changeset/170-16-storefront-order-actions.md` (storefront only); verify (standing obligations 1–5, the replay among the targeted files — it must move no row, §6.3; the permission inventory green; `pnpm --filter storefront run test`, `check:rsc-discipline`); merge before WP-13 — T159, T160, T161 *(merged in #728; both changesets present)*

---

## Phase 5 — Wave 4: close-out (serial: WP-11 → WP-12 → WP-13 → integration PR)

### WP-11 — documentation (EN + PL)

- [x] T103 [WP-11] Architecture page: organization permissions, the `organizationPermissions` manifest field (custom and overlay modules declare their own, XIV/XV), the port and the guard; PL page and pin; `pnpm --filter backend exec vitest run test/unit/docs/` and `check:docs-translations` green; `build:docs` locally — docs — `docs/docs/architecture/permissions.md`, `docs/i18n/pl/docusaurus-plugin-content-docs/current/architecture/permissions.md`, its pin; the page's list of declared codes includes `returns.create` and `returns.view_organization` (OR-11) and the either-of import (OR-10) as the worked example of a module-local guard — Waves 1–3, WP-14, WP-14b and WP-15 merged
- [x] T104 [WP-11] Sweep: every module page touched in Waves 1–3 and in WP-14/WP-15 (`returns`, `orders`, `quick_order`) has a fresh PL pin; generated module-reference pages regenerated (`composer:generate`) and pinned; no edit to `docs/docs/upgrading-an-instance.md` (A-3) — docs — T103

### WP-12 — legacy removal

- [x] T105 [WP-12] [US2] Failing tests first: M4/M5 migration test (columns dropped; `down()` re-derives `role` and `requires_cart_approval` from the role reference exactly; M5 redefines the default trigger to plain *Member*); a contracts test that the legacy exports are gone; every touched request schema still refuses `role` (FR-073, FR-074) — organizations, customer_accounts, contracts — `backend/test/integration/organizations/legacy-role-columns-drop.test.ts` (new), `packages/contracts/src/organization-roles.test.ts` — T104
- [x] T106 [WP-12] Delete the legacy contract symbols (`organizationRoleSchema`, `OrganizationRole`, `CustomerAccountRole`, `countByOrganizationRole`, `RfqCustomerContext.isOrgAdmin`, cart-policy schemas, `requiresCartApproval` on the details record and write port, every `@deprecated` `role` field, and `CART_APPROVAL_SELF_SUBMIT`, unreachable since WP-04 (R-36) — **already removed from `ERROR_CODES` by WP-04** (Notes 7), so only its remaining contract mentions, if any) — contracts — `packages/contracts/src/{common,organizations,customer-accounts,carts,quote-requests,admin}.ts` — T105
- [x] T107 [WP-12] Delete in `organizations`: `commands/set-cart-approval-policy.command.ts`, the `organizationCartApprovalWritePort` registration, `Organization.requiresCartApproval`, its field in `services/organization-details-port.ts`, the invitation entity's `role`; in `customer_accounts`: the entity's `role` and the dual-write — organizations, customer_accounts — `org/src/backend/{commands/set-cart-approval-policy.command.ts,index.ts,entities/organization.entity.ts,entities/organization-invitation.entity.ts,services/organization-details-port.ts,services/invitation-service.ts}`, `ca/src/backend/{entities/customer-account.entity.ts,services/customer-account-ports.ts}` — T106
- [x] T138 [WP-12] [US2] In the merge request that adds M4/M5: add M5 and M4 to the replay's `down()` list (before M3, M2) and to both `up()` lists (after M2, M3); the replay green with the ledger as it stands (§6 step 2, R-38) — backend test — `backend/test/integration/organizations/roles-upgrade-replay.test.ts` — T108
- [x] T108 [WP-12] Scaffold **M4** (`--module organizations --name drop_legacy_role_columns`) and **M5** (`--module customer_accounts --name drop_legacy_role_column`) with exact `down()`s; T105 green — `org/src/migrations/<stamp>_organizations_drop_legacy_role_columns.ts`, `ca/src/migrations/<stamp>_customer_accounts_drop_legacy_role_column.ts` — T107
- [x] T109 [WP-12] Convert the incidental fixtures listed in plan.md *Test allocation* and every other test file the inventory still finds; delete `backend/test/integration/organizations/cart-approval-policy-audit.test.ts` with its Command — backend test, packages/modules/{pwa,search} — T108
- [x] T110 [WP-12] Whole-tree inventory (`quickstart.md` §8 `rg` command) prints nothing outside migrations, tests-by-design and ledgers; also grep `org_admin` and `role ===` by hand (plan *Risks*) — T109
- [x] T111 [WP-12] Generated artefacts (`composer:generate`, `manifests:generate` if any layer moved, `pnpm install --lockfile-only`); consumer changeset: `@endora-commerce/contracts` `minor` with the old → new mapping (`role` → `organizationRole` / `permissions` / `roleId`, removed cart-approval-policy endpoints and schemas, `isOrgAdmin` removed), plus `organizations` and `customer_accounts` `minor`; verify; merge — `.changeset/170-organization-roles.md` — T110 *(merged in #729; the consumer changeset is `.changeset/170-12-legacy-role-removal.md`, naming `contracts`, `organizations` and `customer_accounts` `minor`)*

### WP-13 — upgrade replay and performance

- [x] T124 [WP-13a] [US2] Failing self-check of the expected-differences table (no services; runs on every MR): every key is an `ORACLE_REQUESTS` id; every `before` equals `PRE_UPGRADE_OUTCOMES[id]`; every `after` differs from its `before`; the F4 keys are exactly the ids tagged `oneClickInApprovalOrg` (PR-6); 26 entries in the five families of `contracts/migration-and-replay.md` §6.1; every `landedBy` equals the §6.1 *Lands in* value and, while the ledger exists, is a key of `LANDED` (red: the table does not exist) — backend test — `backend/test/unit/organizations/roles-expected-differences.test.ts` (new) — T111
- [x] T125 [WP-13a] [US2] Write `EXPECTED_DIFFERENCES` — the §6.1 table verbatim, keyed by oracle request id, `{ family, ruling, landedBy, before, after }` in `OracleOutcome` shape; the oracle fixture is not edited; T124 green (PR-5, PR-6, FR-072) — backend test — `backend/test/fixtures/organization-roles/expected-differences.ts` (new) — T124
- [x] T112 [WP-13] [US2] Close the replay (written by T131, extended by T138): delete `landed-work-packages.ts`, the interim branch of the comparison and the self-check's ledger clause, so every §6.1 row must equal its `after`; the replay then is, in full: migrated clone → boot → `down()` M5, M4, M3, M2 → raw-SQL `ORACLE_POPULATION` in the pre-170 shape → `up()` M2–M5 → replay `ORACLE_REQUESTS` in order (body `role` → `roleId` via the fixture's mapping) → assert **per row** on the whole `{ status, code }`: a row of `EXPECTED_DIFFERENCES` equals its `after`, every other row equals `PRE_UPGRADE_OUTCOMES` (never a status-only comparison, PR-5) → data assertions (FR-071; `P.owner` holds *Administrator*, PR-3) → second `up()` changes nothing (FR-072, FR-074, SC-002) — backend test — `backend/test/integration/organizations/roles-upgrade-replay.test.ts` (new), imports `backend/test/fixtures/organization-roles/{pre-upgrade-outcomes,expected-differences}.ts` — T111, T125 *(WP-13: the ledger, its branch and the self-check clause deleted; the replay green, 26 rows at `after`, 293 at `PRE_UPGRADE_OUTCOMES`; a mutation returning `before` reds exactly the 26)*
- [x] T113 [WP-13] Fix whatever the replay reveals in the owning module (a separate commit per module, test first); neither a changed oracle row nor an edit of `EXPECTED_DIFFERENCES` is an allowed fix — a row of the table that does not reach its `after` goes to the owner — T112 *(WP-13: the replay revealed nothing. SC-004 revealed the cart answer's approval rule judging the buyer without `organizationRoleId`, so the port read the account and its MFA enrolments on every cart read and write (FR-080): fixed in `carts`, test first (`backend/test/contract/carts/cart-permission-reads.contract.test.ts`), with the harness's real-session actor made to carry the role as production's does. Placement likewise, after the lead's ruling: `CartPlacementApplyPort.awaitsApproval` takes the owner's optional `organizationRoleId` and `orders` passes the placer's for their own basket)*
- [x] T114 [WP-13] SC-004: run the `backend/test/perf/carts/` harness on cart, checkout and placement on the previous release and on the branch; p95 within 5 %; record numbers in the MR (FR-080) — backend perf — T113 *(WP-13: new `backend/test/perf/carts/member-checkout.bench.ts` for a signed-in member beside the anonymous `cart-routes.bench.ts`; six alternating rounds per tree, numbers in the MR)*
- [x] T115 [WP-13] Verify; merge into the integration branch — T114

### Integration-branch upkeep

Owned by no work package: a derived fixture that Waves 1–3 moved without re-recording.

- [x] T154 Re-record the OpenAPI baseline (`UPDATE_OPENAPI_BASELINE=1`, the test's header) after WP-02a (#701: `mine/roles[/:id]`, `mine/permission-catalogue`, `mine/role`, operator `…/:id/roles[/:roleId]`, `…/:id/permission-catalogue`) and WP-04 (#709: `PATCH /organization/policies/cart-approval` and operator `GET/PATCH …/cart-approval-policy` removed); the diff is those nine paths only, no surviving path or method changed (`contracts/storefront-api.md`, `contracts/operator-api.md` §4) — backend test — `backend/test/fixtures/openapi-baseline.json` — none

### Integration PR

- [x] T116 Open `feat/170-organization-roles` → `master`: complete suite locally (`pnpm --filter backend run test`, the one place it is required), `quickstart.md` walked §1–§8, every check of §8 pasted; no new changeset beyond the WPs' — T115 (done in #733 and #736; owner ruling 2026-11-04: quickstart §1–§6 are covered by the automated suites, with a manual pass on demo after the merge)

---

## Deferred: P3 — internal RFQ approval (separate plan)

Out of these tasks (OR-2, Q-1 = B; plan.md *Phase 3*, data-model §8). FR-041 (permission form),
FR-042–FR-046 and the declarations `quote_requests.approve` and
`quote_requests.send_without_approval` belong to WP-P3a/WP-P3b, which get their own
`/speckit.plan` refinement pass and their own `tasks.md` on a later integration branch after P1+P2
is released. Nothing here may declare those two codes (R-30).

---

## Dependencies and execution order

```text
#656 ─► WP-00 (T001–T005, master) ─► T006 cut branch
        ─► WP-01 (T007–T023) ─► WP-02a (T024–T039) ─► WP-02b (T040–T052, T117–T118)
            ─► WP-13a (T124, T125, T130–T133; before WP-03, WP-04, WP-06)
            ─► Wave 2 ∥ : WP-03 (T053–T066, T119, T120, T122, T123, T128, T129, T135) · WP-04 (T067–T079, T121, T126, T127, T134, #656) · WP-05 (T080–T083)
                          · WP-07 (T091–T093) · WP-08 (T094–T096, merges after WP-03)
                          · WP-06 (T084–T090, T136, T137, merges after WP-04 and WP-05)
            ─► Wave 3 ∥ : WP-09 (T097–T099, after 02a/03/04) · WP-10 (T100–T102, after 04/05/06)
                          · WP-15 (T139–T142, after 05/06/08 — all merged; OR-9, OR-10)
                          · WP-14 (T143–T149, T153, after 07 — merged; OR-11)
                          · WP-14b (T150–T152, after WP-14 and WP-09)
                          · WP-16 (T155–T163, after 04/05/07/09/10/14b — all merged; beside WP-11 and WP-12, before WP-13)
            ─► WP-11 (T103–T104; after WP-14, WP-14b, WP-15 too) ─► WP-12 (T105–T111, T138) ─► WP-13 (T112–T115; after WP-16 too) ─► T116
```

Inside the 2026-11-04 packages: T139 ∥ T140 → T141 → T142; T143 ∥ T144 ∥ T145 ∥ T146 → T147 →
T148 → T149, with T153 beside T147; T150 → T151 → T152; T155 ∥ T156 ∥ T157 ∥ T158 → T159, T160, T161 → T162 → T163.
WP-14, WP-14b, WP-15 and WP-16 flip no `LANDED` entry and add no
`EXPECTED_DIFFERENCES` row (`contracts/migration-and-replay.md` §6.3); each still pastes the replay's
run.

**Critical path**: #656 → WP-00 (M) → WP-01 (M) → WP-02a (L) → WP-02b (L) → WP-04 (L) → WP-06 (M)
→ WP-10 (M) → WP-11 (S) → WP-12 (M) → WP-13 (M) → T116. WP-03 (L) → WP-09 (L) is a parallel
branch of equal length to WP-04 → WP-06 → WP-10 and becomes critical if WP-09 slips. Since
2026-11-04 the branch WP-09 (L) → WP-14b (S) → WP-11 is one S longer than WP-09 → WP-11 and can
become the critical path.

### Wave parallelism

- Wave 1 is serial (one agent at a time).
- Wave 2: up to seven agents (WP-13a, WP-03, -04, -05, -06, -07, -08); WP-13a owns only new test files, and the one line per landing package in its ledger is the declared exception to disjointness (R-38); the other file sets are disjoint per
  plan.md *Owns* with A-1 applied. Shared helpers are WP-02b's; a Wave 2 package adds fixtures in
  new files only. `organizations`' i18n bundle is edited by WP-03 only in Wave 2.
- Wave 3: WP-09 ∥ WP-10 (disjoint storefront files; both read `storefront/lib/organization-permissions.ts`, edited by neither), with WP-14 and WP-15 beside them (backend and Admin-UI-test files no other open package edits; WP-15's admin test file is WP-08's, merged) and WP-14b after WP-09 (they share `lib/i18n/messages/account.ts`). Up to five agents.
- Within a WP, [P] marks the test-writing tasks, which touch disjoint new or existing files.

### Parallel example (WP-02a)

```text
T024 M2 migration test   ∥ T025 port/catalogue tests ∥ T026 cache tests
T027 Command tests       ∥ T028 route contract tests ∥ T029 classification
then T030 → T031 → T032 → T033 → T034 → T035 → T036/T037 → T038 → T039
```

## Implementation strategy

MVP is not shippable piecemeal (OR-4: one release, no window). The internal milestone is the end
of Wave 1 (roles, assignment and port working behind unchanged behaviour), then US 3 + US 4 (WP-04,
WP-06) as the business reason for the feature, then US 1's storefront (WP-09/10).

---

## FR → task coverage

| FR | Tasks (test → implementation) |
| --- | --- |
| FR-001 | T024 → T031; T040; T112 |
| FR-002 | T025, T027 → T032, T034 |
| FR-003 | T027 → T034, T036 |
| FR-004 | T027 → T034 |
| FR-004a | T025, T027 → T032, T034 (backend, existing: a custom role holds what was submitted, never a default — R-39); T140 (Admin UI, characterization); T097 → T098 (storefront) — OR-9 |
| FR-005 | T028, T040, T041, T054 → T035, T044, T045, T060 |
| FR-006 | T040 → T044 |
| FR-007 | T025, T070, T146, T139 (off-state leg) → T032, T148, T141 |
| FR-008 | T053, T055 → T059, T060; T097 → T098 |
| FR-010 | T028, T054 → T035, T060 |
| FR-010a | T122, T028 → T123, T034; T124/T125 (rows 25–26) → T112 |
| FR-011 | T058 → T063 |
| FR-012 | T085 → T088 |
| FR-013 | superseded by OR-5 → see FR-049 |
| FR-014 | T003/T004 (oracle) → T131 (replay, interim), T112 (replay, final) |
| FR-014a | T056 → T061 |
| FR-020 | T008, T012 → T014, T020 |
| FR-021 | T012 → T020; declarations T061, T072, T081, T088, T089, T092, T148 |
| FR-022 | T012 (inventory) with T061, T072, T081, T088, T089, T092, T148 (the two `returns` codes, OR-11) — **P2 codes only**; `quote_requests.approve` and `…send_without_approval` deferred to P3 |
| FR-023 | T027 → T034 |
| FR-024 | T027, T042 → T034, T047 |
| FR-025 | T025, T027, T070, T087, T146 → T032, T034, T148 |
| FR-030 | T067, T085, T121 (guest basket, PR-4) → T073, T088; T100 → T101 (signed-out add-to-cart); T155 → T159 (reorder, WP-16) |
| FR-030a | T126 → T127 (merge judged and skipped); T015 (outcome value); T128 → T129 (login keeps the cookie) — PR-12 |
| FR-030b | T139 → T141 (the import's either-of guard, OR-10); T100 → T101 (the import's visibility) |
| FR-031 | T068, T071 → T074, T076 |
| FR-032 | T068 → T074 (not-pending before self-approval, R-36) |
| FR-033 | T068 → T074 |
| FR-034 | T069 → T075 |
| FR-035 | T068 → T074 |
| FR-040 | T067, T080, T085, T086 → T073, T081, T088, T089; T155 → T159 (clone to quote, WP-16) |
| FR-041 | P2 form (administrator visibility, R-30): T080 → T081; permission form deferred to P3 |
| FR-042 – FR-046 | **deferred to P3** (no task here, by design) |
| FR-047 | T067, T086 → T073, T089 |
| FR-048 | T067, T086 → T073, T089 |
| FR-049 | T091 → T092; T145 → T148, T153 (the return start, Q-R1 = A) |
| FR-050 | T084 → T088 (check order pinned, R-6) |
| FR-051 | T100 → T101 |
| FR-052 | T143 → T148; T150 → T151 — OR-11 |
| FR-053 | T144 → T147, T148; T150 → T151 — OR-11, Q-R2 = A |
| FR-054 | T145 → T148 — OR-11, Q-R1 = A |
| FR-055 | T007, T025, T028 → T013, T032, T035 |
| FR-056 | T053 → T059; T097 → T098 |
| FR-057 | T097, T100, T150 → T098, T101, T151; T156, T157 → T161 (order-again actions, organization addresses, WP-16) |
| FR-058 | T028, T097 → T035, T098 |
| FR-060 | T028, T094 → T035, T095 |
| FR-061 | T028, T094 → T035, T036, T095 |
| FR-062 | T057, T094 → T062, T095 |
| FR-065 | T009, T027, T041, T042, T054 → T016, T034, T045, T047, T060 |
| FR-066 | T094 → T095 (history link; entries per R-32 from T034/T045) |
| FR-070 | T024, T040 → T031, T044 |
| FR-070a | T040, T117, T119, T097 → T044, T118, T120, T098 (PR-3) |
| FR-071 | T024 → T031; T112 |
| FR-072 | T003/T004 → T124 → T125 → T130 → T131 → T134/T135/T136 (per landing package) → T112 (expected differences per row, PR-5, PR-6, R-38); the changes outside the oracle (`contracts/migration-and-replay.md` §6.3): T143, T144, T145 (OR-11), T139 (OR-10) |
| FR-073 | T007, T053, T054, T105 → T013, T059, T060, T106 |
| FR-074 | T024, T040, T105 → T031, T044, T108; T112 |
| FR-080 | T026 → T033; T114 |
| FR-081 | T026, T043 → T033, T046 |
| FR-082 | T026 → T033 |

**FRs without a task**: none in P1+P2 scope. FR-042–FR-046, FR-041's permission form and FR-022's
two P3 codes are deliberately deferred to P3. SC-001 (two-minute task) is a usability measure with no
automated test; it is checked in the `quickstart.md` §2 walk-through (T116).

## Notes found while decomposing (for the product owner / architect)

1. **R-16 vs `contracts/commands-audit-events.md` §5** — R-16 says every *assignment* Command also
   drops the cache and publishes; §5 says only the three `organization_role.*` Commands do, because
   assignments are not cached (R-15). The contract is the later refinement; T041/T045 follow §5
   (no drop on assignment). *Aligned 2026-11-03*: R-16, R-9's status line and
   `contracts/organization-permission-port.md` §4 now say the same as §5.
2. **Spec Key Entity "Permission first-seen ledger … platform-wide"** — superseded by R-17's
   per-*Member* `member_defaults_offered`. *Aligned 2026-11-03*: the Key Entity now describes the
   per-*Member* ledger.
3. **FR-022 lists the two P3 codes** while R-30 forbids declaring them in P2; the coverage table
   records them as deferred. *Aligned 2026-11-03*: FR-022 carries a Phase column (nine P2, two P3)
   and FR-041 states its P2 form (R-30).
4. Adjustments A-1 (addresses declaration in WP-03), A-2 (PL with EN per WP), A-3 (no upgrade page)
   and A-4 (only #656 still open) are recorded in plan.md.
5. **The WP-00 oracle's surprising rows** (PR #689) went to the owner, as T004 requires, and came
   back as plan.md's oracle rulings PR-3 to PR-7 (2026-11-03). They add T117–T125 and amend T007,
   T013, T028, T032, T034, T040, T068, T073, T074, T084, T097, T098, T100, T106, T112 and T113. New
   ids are appended, never renumbered; each sits in its work package's section. The owner's
   confirmations PR-8 to PR-12 followed; PR-12 (the sign-in merge, FR-030a) adds T126–T129 and amends
   T015. No `[NEEDS CLARIFICATION]` remains.
6. **The live oracle on the integration branch** (raised by WP-04 in #709 and WP-06 in #707,
   decided 2026-11-03, research R-38). The WP-00 oracle test creates its Organizations on the
   migrated schema, so FR-071's mapping never reaches B and four B.regular rows outside §6.1 move from
   WP-04 on while rows 23–24 cannot move at all; it sends legacy `role` bodies, so WP-03 (#710) sees
   nine rows at `400` that the replay's `roleToRoleId` sends as `roleId`; it also turns red at the first merge that lands any
   §6.1 row and stops type-checking at WP-12. Decision: the replay is brought forward as **WP-13a**
   (T124, T125, T130–T133), which merges before WP-03, WP-04 and WP-06, retires the oracle test
   (never edited; the fixture stays frozen) after showing both green on one tree, and introduces a
   landing ledger that each landing package flips in its own MR (T134 WP-04, T135 WP-03, T136
   WP-06). WP-12 extends the replay with M4/M5 (T138); WP-13 deletes the ledger (T112).
   `contracts/migration-and-replay.md` §5, §6, §6.1 (*Lands in*) and §6.2 carry it. **Effect on the
   open PRs**: #709 (WP-04) and #707 (WP-06) wait for WP-13a, rebase, flip their entry and restate
   their oracle section against the replay; #710 (WP-03) likewise (T135); #705 (WP-05) and #708 (WP-07) move no row and may merge
   either side of WP-13a, running the replay if they merge after it.
7. **Lead's decisions, 2026-11-03** (recorded here; the WP-04 and WP-06 sections are left as the
   open PRs edit them):
   - The three cross-module gates in `carts`' routes that name other modules' codes —
     `shopping_lists.convert` on from-shopping-list, `shopping_lists.create` on
     save-to-shopping-list, `quote_requests.create` on convert-to-quote-request — are added by
     **WP-06** when it rebases after WP-04 and WP-05 merge (WP-06 merges last of the three); the tests
     WP-04 leaves as `it.todo` become real then (T137). T067 and T073 are complete only with T137.
   - `CART_APPROVAL_SELF_SUBMIT` leaves `ERROR_CODES` already in **WP-04** — part of T106 pulled
     forward, because `check:error-translations` refuses an `ERROR_CODES` member no manifest declares
     (`undeclared-enum-member`). T106 no longer removes it.
   - **Merge order** of the three: WP-04, then WP-05 (its convert-to-order is gated by
     `carts.create`), then WP-06 (after WP-04 and WP-05). T090's "rebase after WP-04 merges" reads
     "after WP-04 and WP-05 merge".
8. **Owner rulings of 2026-11-04** (the Wave 3 questions Q1–Q3; `spec.md` OR-9 to OR-11, `plan.md`).
   They add T139–T152 in three new packages — WP-15 (OR-10, OR-9's Admin UI lock), WP-14 (OR-11,
   backend) and WP-14b (OR-11, storefront) — and amend T097, T098 (OR-9), T100, T101 (OR-10), T103
   and T104 (their scope and dependencies). OR-9 needs no backend task: WP-02a already creates a
   custom role with exactly the submitted codes (R-39). None of the three moves an oracle row
   (`contracts/migration-and-replay.md` §6.3). OR-11 leaves three design questions to the owner,
   Q-R1 to Q-R3 (`plan.md` *OR-11's design questions*), answered the same day (A, A, accepted); WP-14's tasks
   follow those answers, and T153 (the stale `findByIdForCustomer` comment) was added with them.
9. **Owner ruling of 2026-11-04 after the WP-11 review (#727)** — adds WP-16 (T155–T163): the buyer's
   reorder and clone-to-quote judged by `carts.create` and `quote_requests.create` (permission before
   the order scope), placement's approval sentences in the storefront's wording, and the addresses
   page's controls by `addresses.manage`. It has no section in `plan.md`; this file and
   `contracts/storefront-api.md` §5 carry it. It moves no oracle row (§6.3).
