# Tasks: Tax-ID scope, personal organizations without a tax ID, personal → company conversion

**Input**: [spec.md](./spec.md), [plan.md](./plan.md) (work packages, merge order, decisions
OD-1 … OD-8, resolved by the owner 2026-11-10 as D-290), [research.md](./research.md) (R-1 … R-18), [data-model.md](./data-model.md),
[contracts/](./contracts/).

**Scope**: the whole feature, one release, on the integration branch `feat/177-tax-id-scope`.

**Tests are mandatory** (constitution III, NN): a `[test]` task is committed red (or shown red in the
PR description) before the implementation task that turns it green. Contract and integration files do
not run on merge requests (D-198): run them locally against `pnpm run dev:infra:test`, **in both
scopes** (`ORGANIZATIONS_TAX_ID_SCOPE` unset and `=per-tree-root`), and paste the output into the PR.

## Format

`- [ ] T### [P?] [WP-n] [USn?] Description — paths — depends on`

- **[P]** parallel with other [P] tasks of the same WP (disjoint files).
- `org` = `packages/modules/organizations`, `contracts` = `packages/contracts/src`,
  `bt` = `backend/test`, `sf` = `storefront`, `plpage(x)` =
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/x.md`.

## Standing obligations of every WP's verify step

`pnpm run build:packages`; `pnpm -r run typecheck`; `pnpm -r run lint`;
`pnpm --filter backend run test:unit:fast`; the WP's targeted contract/integration files in both
scopes; `pnpm --filter '!backend' run test` when a package changed; `pnpm run check:naming && pnpm run
check:language`; `composer:generate` + `composer:check` when a migration, entity, manifest or admin
route changed; after a deletion, `grep -rn <symbol> backend/test` (AGENTS.md traps).

---

## WP-0 — Setup

- [x] T001 [WP-0] Create `feat/177-tax-id-scope` off `origin/master`; worktree via `scripts/setup-worktree.sh`; `pnpm run build:packages` — —
- [ ] T002 [WP-0] Baseline: run `bt/contract/organizations`, `bt/integration/organizations`, `org/src/**/*.test.ts` green on the branch; record counts in the WP-1 PR — T001

## WP-1 — Foundation (blocking; serial)

- [x] T003 [WP-1] [US2] [test] Migration M1: fixture database with company rows, personal rows with the 32-hex placeholder and one with a hand-made tax ID; after `up` personal `tax_id` is null, `personal_account_id` equals the dashed placeholder, the unlinked count is noticed, `organizations_tax_id_presence` refuses a personal row with a tax ID and a company row without one, `organizations_tax_id_unique` still refuses a duplicate company tax ID; `down` restores placeholders; `orders` and `audit_log_entries` row samples unchanged (FR-001, FR-002, FR-007) — `bt/integration/organizations/personal-tax-id-removal-migration.test.ts` — T002
- [x] T004 [WP-1] [US1] [test] Migration M2: `root_id` equals the first path segment for roots and children, follows a re-parent of a subtree, is null for an empty path; policy row is `global`; no `organizations_tax_id_one_tree`; `btree_gist` present; `down` raises while the row says `per-tree-root` — `bt/integration/organizations/tax-id-scope-migration.test.ts` — T002
- [x] T005 [WP-1] [US2] Scaffold and write M1 (`pnpm --filter backend run migration:new -- --module organizations --name personal_tax_id_removal`) per data-model §3 — `org/src/migrations/` — T003
- [x] T006 [WP-1] [US1] Scaffold and write M2 (`--name tax_id_scope`); `composer:generate`; commit the registry — `org/src/migrations/`, `backend/src/db/migrations-registry.generated.ts` — T004, T005
- [x] T007 [P] [WP-1] [test] Migration guard: any `org` migration stamped after M2 naming `organizations_tax_id_unique` or `organizations_tax_id_one_tree` must also name `organization_tax_id_policy`; red proof with a fixture string — `org/src/backend/tax-id-scope-migration-guard.test.ts` (not under `migrations/`, which `migrations-registry.test.ts` keeps to migration classes) — T006
- [x] T008 [P] [WP-1] [US2] [test] Contracts: `organizationSchema` accepts `taxId: null`; `organizationCompanyTaxId` answers `null` for personal, null and blank, the trimmed value otherwise; new schemas (`taxIdScopeSchema`, `adminTaxIdScopeSetBodySchema`, `adminOrganizationConvertToCompanyBodySchema` normalising the tax ID, `AdminOrganizationCreateBodySchema.parentId`) parse and refuse as specified — `contracts/organizations.tax-id.test.ts` — T002
- [x] T009 [WP-1] [US2] Contracts: data-model §5 types and schemas; `ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES`, `ORGANIZATION_CONVERSION_REFUSED`; `OrganizationCommandPort`, `OrganizationConvertedToCompanyEvent`; `TaxIdResolution`; `OrderReturnContext.placedAt`; doc comments at l. 561–573 and l. 749 rewritten — `contracts/organizations.ts`, `contracts/errors.ts`, `contracts/returns.ts` — T008 *(the two `ERROR_CODES` members moved to the WPs that raise them — T033 and T053: `check:error-translations` refuses a declared code nothing raises, and forbids ledgering it; `OrganizationCommandPort` moved to T056 likewise: `check:port-shape` refuses a documented container name nothing registers)*
- [x] T010 [WP-1] [US2] [test → impl] Entity: `taxId` nullable without `@Unique()`, `personalAccountId`, `convertedToCompanyAt`; `OrganizationTaxIdPolicy` entity (`@GlobalEntity`); a metadata test asserting the three properties and that `root_id` is not mapped; `composer:generate` (entities registry) — `org/src/backend/entities/`, `org/src/backend/entities/organization-tax-id-columns.test.ts` — T006, T009
- [x] T011 [WP-1] [US2] [test] Provisioning by link: `provisionFor` twice for one account returns one row with `taxId: null` and `personalAccountId` set; `provisionPersonalOrganizationFor` for an account currently in a company returns its own personal org; a concurrent pair yields one row (FR-003) — `org/src/backend/services/personal-organization-service.link.test.ts`, `bt/contract/organizations/personal-organization-link.contract.test.ts` — T010
- [x] T012 [WP-1] [US2] Provisioning implementation: find by `personalAccountId`, create with `taxId: null`; delete `personalTaxId()`; rewrite the comments in `org/src/ports/index.ts` l. 32, 55 and `customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts` l. 158–170 (inventory O2, X10) — `org/src/backend/services/personal-organization-service.ts` — T011
- [x] T013 [WP-1] [US4] [test] `taxIdConflictOf` (unit: 23505/23P01 on each constraint name, on `err`, `err.cause`, `err.previous`; other codes/constraints → null) and `TaxIdLookupService` (integration: normalisation, root-first order, deleted excluded unless asked, `resolveByTaxId` none/one; `ambiguous` unreachable over every state each scope permits) — `org/src/backend/services/tax-id-conflict.test.ts`, `bt/integration/organizations/tax-id-lookup.test.ts` — T010
- [x] T014 [WP-1] [US4] Implement `tax-id-conflict.ts`, `tax-id-lookup-service.ts`; publish `findByTaxId`/`resolveByTaxId` on `organizationDetailsPort` — `org/src/backend/services/`, `organization-details-port.ts`, `org/src/backend/index.ts` — T013
- [x] T005a [WP-1] [US2] [test → impl] D-290 / OD-9 — M1 upgrade precondition. **Test**: (a) a database with organizations rows and no `mikro_orm_migrations` row for `Migration20260825T141659CustomerAccountsOrganizationRequired` → M1 `up` raises with a message naming both migrations and "0.100.0", and leaves `tax_id` `not null` and no new column (the whole migration rolls back); (b) the same database with that row present → M1 applies; (c) a fresh database (empty `organizations`) → the full migration chain applies, including `customer_accounts`' migration after M1. **Impl**: the guarded `do $$ … raise exception … $$` block as M1's first statement — `bt/integration/organizations/personal-tax-id-removal-migration.test.ts` (extended), `org/src/migrations/20261110T135922_organizations_personal_tax_id_removal.ts` — T005
- [ ] T014v [WP-1] Verify (standing obligations); PR to the integration branch — T003–T014

## WP-2 — Reader inventory (US2; after WP-1; tasks [P] across modules)

Rows refer to `contracts/personal-tax-id-removal.md` §3.

- [ ] T015 [P] [WP-2] [US2] [test] Organizations serializers: `GET /api/v1/me` for a B2C customer → `organization.taxId === null`; admin `GET /organizations/:id` for a personal org → `null`; admin list `q` never matches a personal org by a former placeholder; admin search subtitle omits it (O6–O11, O13) — `bt/contract/organizations/me.test.ts`, `bt/contract/organizations/personal-organization-administrator.contract.test.ts` (extended), `org/src/backend/admin-search-provider.test.ts` — T014v
- [ ] T016 [WP-2] [US2] Widen types in `routes.admin.ts` l. 1182, `routes.customer.ts` l. 255, `routes.public.ts` l. 342, `organization-details-port.ts` l. 70, `org-registration-notifier.ts`, `email-templates/transactional-defaults.ts` — `org/src/backend/` — T015
- [x] T017 [P] [WP-2] [US2] [test] VAT validation of a personal org → `422`, no validation row, no provider call (O12, FR-006) — `bt/contract/organizations/vat-validation.test.ts` — T014v *(landed with WP-1: the nullable `taxId` made the guard a compile-time necessity)*
- [x] T018 [WP-2] [US2] Refuse in `OrganizationTaxIdValidationService.triggerValidation` before `pickProvider` — `org/src/backend/services/organization-tax-id-validation-service.ts` — T017 *(landed with WP-1: the nullable `taxId` made the guard a compile-time necessity)*
- [ ] T019 [P] [WP-2] [US2] [test] Admin list/detail render no tax ID for `null`; `VatValidationPanel` absent for a personal org (O14) — `admin/test/modules/organizations/organization-null-tax-id.test.tsx` — T014v
- [ ] T020 [WP-2] [US2] `OrganizationsList.tsx` l. 12, 121, `OrganizationDetail.tsx` l. 42, 361 types and rendering; hide the VAT panel for personal — `org/src/admin/pages/` — T019
- [ ] T021 [P] [WP-2] [US2] [test → impl] Orders (X1, X2): a B2C order placed after the upgrade has no `billingAddress.taxId`; the admin order organization panel gets `taxId: null`; type widened at `order-service.ts` l. 478 — `packages/modules/orders/src/backend/services/order-service.test.ts` (or the nearest existing), `bt/contract/orders/` — T014v
- [ ] T022 [P] [WP-2] [US2] [test → impl] Quote requests (X3, X4): document data and RFQ panel answer `taxId: null` for a personal org — `packages/modules/quote_requests/src/backend/document/data-builder.test.ts`, `rfq-admin-service` test — T014v
- [ ] T023 [P] [WP-2] [US2] [test → impl] Price lists and PWA pickers (X5, X6): personal rows `taxId: null`; delete the #767 placeholder comment in `PushAudienceRuleBuilder.tsx` l. 549 — `packages/modules/price_lists/`, `packages/modules/pwa/` — T014v
- [ ] T024 [P] [WP-2] [US2] [test → impl] Promotion rule targets (X7): `backend/src/composition.ts` l. 729–736 returns `null` for personal rows (now by data) — test in `bt/contract/promotions/` (extend the targets test) — T014v
- [ ] T025 [P] [WP-2] [US2] [test → impl] Storefront (X8, X9): `lib/api/account.ts` l. 38 `taxId: string | null`; `(account)/organization/page.tsx` hides the row when null; checkout prefill unchanged — SSR tests under `sf/test/` — T014v
- [ ] T026 [P] [WP-2] [US2] [test → impl] Demo seed/reset (O5): seed finds with `findByTaxId(...)[0]`; reset deletes the found id only — in `per-tree-root` a branch sharing the demo tax ID survives `reset` — `org/src/backend/demo/demo.test.ts` (extended), `seed.ts`, `reset.ts` — T014v
- [ ] T027 [WP-2] [US2] Workspace sweep: `pnpm -r run typecheck`; fix every remaining `taxId: string` assumption in its own module; list each file in the PR (FR-005) — T015–T026
- [ ] T027v [WP-2] Verify; PR — T027

## WP-3 — Tax-ID scope backend (US1; after WP-1)

- [ ] T030 [WP-3] [US1] [test] Scope Command: `global → per-tree-root` swaps the constraints and the row in one transaction; back to `global` refused with `ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` `{ sharedTaxIdCount, examples ≤ 20 }` while duplicates exist and succeeds after; same scope → no audit, missing constraint re-created; injected DDL failure leaves row and constraints unchanged; two concurrent set Commands serialise; a write on another connection after a change sees the new scope (FR-026); audit `{ scope }` before/after — `bt/integration/organizations/tax-id-scope-command.test.ts` — T014v
- [ ] T031 [WP-3] [US1] `TaxIdScopeService` (read in-tx, swap, duplicate report) + `set-tax-id-scope.command.ts` — `org/src/backend/services/tax-id-scope-service.ts`, `org/src/backend/commands/` — T030
- [ ] T032 [WP-3] [US1] [test] Routes `GET`/`PUT /api/v1/admin/organizations/tax-id-scope`: 401/403 without the code, 403 for a scoped admin holding it, 409 shape, 200 shape incl. `enforcement` (FR-017) — `bt/contract/organizations/tax-id-scope-routes.contract.test.ts` — T031
- [ ] T033 [WP-3] [US1] Routes; manifest permission `organizations:manage-tax-id-scope` (+ labels en/pl); error code + sentences en/pl (`shared_tax_ids`); `permission-inventory.test.ts`, `error-code-sentences.test.ts`, `check:error-translations` — `org/src/backend/routes.admin.ts`, `org/src/manifest.ts`, `org/i18n/` — T032 *(adds `ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` to `contracts/errors.ts` too — moved here from T009)*
- [ ] T034 [WP-3] [US1] [test] Admin create: `parentId` creates a child with the right path; scoped admin + `parentId` → 403; `global`: any existing X → 409; `per-tree-root`: X under the same root → 201, X as a root or under another tree → 409; 50 concurrent pairs → one 201 / one 409, no 500 (FR-018, FR-019, FR-021) — `bt/contract/organizations/admin-organization-create.contract.test.ts` (extended), `bt/integration/organizations/tax-id-conflict-concurrency.test.ts` — T031
- [ ] T035 [WP-3] [US1] Create Command (`parentId`, depth check, in-tx scope pre-check via `TaxIdLookupService`, `taxIdConflictOf` at flush) and `runOrganizationWrite` at the route (inventory O4) — `org/src/backend/commands/create-organization.command.ts`, `routes.admin.ts` — T034
- [ ] T036 [WP-3] [US1] [test] Set-parent/move in `per-tree-root`: detaching or moving a sharer → 409 `tax_id_shared_across_trees` with `taxIds`; moving a whole sharing subtree to a tree without X → 200; concurrency pairs; in `global` behaviour unchanged (FR-020, FR-021) — `bt/contract/organizations/organization-tree.contract.test.ts` (extended), `tax-id-conflict-concurrency.test.ts` — T031
- [ ] T037 [WP-3] [US1] Tree pre-check (one SQL over `root_id` and the subtree prefix) in `makeReparentCommand`; `runOrganizationWrite` at the parent route; token sentence en/pl — `org/src/backend/commands/set-parent.command.ts`, `services/organization-tree-service.ts`, `routes.admin.ts`, `org/i18n/` — T036
- [ ] T038 [WP-3] [US1] [test] Registration in both scopes: an existing X → 409 (including X held only by a branch); 50 concurrent registrations with one X → one 201, rest 409, no 500 (FR-022) — `bt/contract/organizations/register.test.ts` (extended), `tax-id-conflict-concurrency.test.ts` — T031
- [ ] T039 [WP-3] [US1] **Phase A — skip if 176's registration Command is on `master` (do T070/T071 instead).** `registration-service.ts` l. 152 → `resolveByTaxId`; catch at l. 185–196 → `taxIdConflictOf` (inventory O3) — T038
- [ ] T040 [P] [WP-3] [US1] [test → impl] Boot probe: mismatched row/constraint logs one `error` naming both; consistent logs nothing — `org/src/backend/services/tax-id-scope-probe.test.ts`, `org/src/backend/index.ts` — T031
- [ ] T041 [WP-3] [US1] [test → impl] CI in both scopes: `establishTaxIdScope` in `bt/template-seed.ts` (template name includes the scope); job `test:backend:organizations-per-tree-root` in `.gitlab-ci.yml` and `.github/workflows/backend-suite.yml` running `bt/contract/organizations bt/integration/organizations` and `org/src`; register it wherever `bt/helpers/ci-jobs.ts` / `ci-gate-coverage.ts` require; a unit test asserting the job exists with the variable (FR-027) — T031
- [ ] T041a [P] [WP-3] [test] `tax-id-write-paths.test.ts`: the Commands that write `organizations.tax_id` or `path` are exactly {create, set_parent, move, convert_to_company, register}, each called through `runOrganizationWrite` — `org/src/backend/tax-id-write-paths.test.ts` — T035, T037
- [ ] T041v [WP-3] Verify in both scopes; PR (merge before WP-5) — T030–T041a

## WP-4 — Tax-ID scope admin UI (US1; after T033)

- [ ] T042 [WP-4] [US1] [test] `TaxIdScopePage`: loading skeleton; current scope badge; Apply disabled on the current scope with a hint; confirm dialog; success in a pre-mounted `role="status"`; duplicates alert with ≤ 20 links; mismatch alert; 403 state; axe clean (FR-025) — `admin/test/modules/organizations/tax-id-scope-page.test.tsx` — T033
- [ ] T043 [WP-4] [US1] Page, admin route, list header menu entry, palette action `open-tax-id-scope`, i18n keys en/pl (`contracts/admin-surfaces.md` §2–§4.1, §6); run `registered-bundles-shape.test.ts`, `check:action-route-permissions`, `palette-coverage.test.ts` — `org/src/admin/`, `org/src/manifest.ts`, `org/i18n/` — T042
- [ ] T044 [WP-4] [US1] [test → impl] Admin create parent picker (unscoped admins only) and the shared-tax-ID hint (inventory O15, §4.4) — `admin/test/modules/organizations/organization-create-parent.test.tsx`, `org/src/admin/pages/OrganizationCreate.tsx` — T035, T043
- [ ] T044v [WP-4] Verify; PR — T042–T044

## WP-5 — Conversion backend (US3; after WP-1 and T031)

- [ ] T050 [WP-5] [US3] [test] Command: id unchanged; `isPersonal=false`, the five fields written, `personalAccountId` null, `convertedToCompanyAt` set, approval stamped only when absent; both predefined roles present and the member holds Administrator; refusals `not_personal`, `deleted`, `owner_not_administrator`, `ORGANIZATION_TAX_ID_EXISTS` in both scopes; a throw after the write rolls everything back; event dispatched once on commit and never on rollback; sentinel audit test with `expectNoAuditValues` and `changedFields` (FR-030, FR-032 … FR-037, FR-039, FR-051) — `org/src/backend/commands/convert-to-company.command.test.ts`, `bt/integration/organizations/convert-to-company.test.ts` — T031
- [ ] T051 [WP-5] [US3] `convert-to-company.command.ts`; `OrganizationEvents` gains the event — `org/src/backend/commands/`, `services/registration-service.ts` (event map only) — T050
- [ ] T052 [WP-5] [US3] [test] Route: 403 without `organizations:convert-to-company`; 404 out of reach; `validateTaxId: true` runs a validation after commit, and a failing provider leaves the conversion committed with `vatValidation.outcome = 'deferred'|'failed'`; the role cache entry is dropped and announced; no reverse route (FR-031, FR-038, FR-041) — `bt/contract/organizations/convert-to-company.contract.test.ts` — T051
- [ ] T053 [WP-5] [US3] Route through `runOrganizationWrite`; manifest permission + labels en/pl; `ORGANIZATION_CONVERSION_REFUSED` + three token sentences en/pl — `routes.admin.ts`, `manifest.ts`, `org/i18n/` — T052 *(adds `ERROR_CODES.ORGANIZATION_CONVERSION_REFUSED` to `contracts/errors.ts` too — moved here from T009)*
- [ ] T054 [P] [WP-5] [US3] [test] Not customer-reachable: route enumeration with a recording bus + source scan (`contracts/convert-to-company.md` §5) (FR-031, SC-005) — `bt/contract/organizations/convert-to-company-not-customer-reachable.contract.test.ts` — T053
- [ ] T055 [P] [WP-5] [US3] [test] Port: `resolve<OrganizationCommandPort>('organizationCommandPort').convertToCompany` runs the Command with the ambient admin actor, and under `withSystemScope` with a null actor; no VAT validation — `bt/integration/organizations/organization-command-port.test.ts` — T051
- [ ] T056 [WP-5] [US3] `OrganizationCommandService` + `providePort` (beside #990's port if merged) — `org/src/backend/services/organization-command-port.ts`, `org/src/backend/index.ts` — T055 *(adds the `OrganizationCommandPort` contract too — moved here from T009)*
- [ ] T057 [P] [WP-5] [US3] [test] Unassign after conversion provisions a **new** personal org for the member, the converted company keeps its id (FR-036) — `bt/contract/customers/unassign-after-conversion.contract.test.ts` — T053
- [ ] T058 [P] [WP-5] [US3] [test] Storefront after conversion: `/me` organization is a company, the account area offers Members/Roles (SSR, `organization-area.ts`) — `sf/test/` — T053
- [ ] T059 [P] [WP-5] [US3] [test] Returns: an order placed before the conversion and returned within the period is a consumer withdrawal; one placed after is not (FR-040) — `packages/modules/returns/src/backend/services/return-case-service.conversion.test.ts` — T009
- [ ] T060 [WP-5] [US3] Returns: `OrderReturnContext.placedAt` filled from returns' order read; `isConsumerWithdrawal` uses `isPersonal || (convertedToCompanyAt && placedAt < convertedToCompanyAt)` (inventory X11) — `packages/modules/returns/src/backend/services/return-case-service.ts` — T059
- [ ] T060v [WP-5] Verify in both scopes; PR — T050–T060

## WP-6 — Conversion admin UI (US3; after T053)

- [ ] T061 [WP-6] [US3] [test] Detail dialog: button only for a personal org and the permission; form validation linked with `aria-describedby`; tax ID normalised on blur; 409 tax ID on the field; refusal as an alert; `aria-busy` submit; success refreshes and the Roles tab renders; axe clean (FR-042) — `admin/test/modules/organizations/convert-to-company-dialog.test.tsx` — T053
- [ ] T062 [WP-6] [US3] `ConvertToCompanyForm.tsx`, the dialog in `OrganizationDetail.tsx`, i18n en/pl — `org/src/admin/` — T061
- [ ] T063 [WP-6] [US3] [test → impl] `ConvertToCompanyPage` with steps; `OrganizationPicker` `kind` prop (default unchanged) and the list endpoint's `filter[isPersonal]`; empty state; palette action `convert-personal-organization`; list header menu entry — `admin/test/modules/organizations/convert-to-company-page.test.tsx`, `packages/admin-kit/src/components/organization-picker/`, `org/src/admin/`, `routes.admin.ts`, `manifest.ts` — T062
- [ ] T063v [WP-6] Verify incl. `palette-coverage.test.ts`, `registered-bundles-shape.test.ts`, `check:action-route-permissions`; PR — T061–T063

## WP-R — Registration on 176's Command (after 176 is on `master` and merged into the integration branch)

- [ ] T070 [WP-R] [US1] [test] 176's registration Command in both scopes: pre-check through `resolveByTaxId` and `registrationConflictPolicy` (`refuse`); a deferred `23P01`/`23505` at commit → `409 ORGANIZATION_TAX_ID_EXISTS`; 50 concurrent pairs; a `beforeCommit` hook throwing after the organization insert leaves no row (FR-021, FR-022) — `bt/contract/organizations/register.test.ts`, `tax-id-conflict-concurrency.test.ts` — 176, T014v
- [ ] T071 [WP-R] [US1] Move the pre-check and policy into the Command; wrap its `commandBus.run` call site with `runOrganizationWrite`; remove T039's patch if it landed; if 176 ships policy chains, declare `registrationConflictPolicy` as a participant with `refuse` as the deepest default; update `tax-id-write-paths.test.ts` — `org/src/backend/` — T070

## WP-8 — Close-out

- [ ] T080 [WP-8] Docs EN: `org/docs/organizations.md` (null tax ID for personal orgs; tax-ID scope screen and rules; conversion; `findByTaxId`/`resolveByTaxId`; `organizationCommandPort`; the event); `org/docs/organization-hierarchy.md` (branches sharing a tax ID; moves refused across trees) (FR-052) — all WPs
- [ ] T081 [WP-8] Docs PL: `plpage(organizations)`, `plpage(organization-hierarchy)` and their translation caches (`docs/docs/contributing/documentation-i18n.md`); `check:module-docs` — T080
- [ ] T082 [WP-8] Changesets (`specs/conventions/release-intent.md`): `@endora-commerce/contracts` + `@endora-commerce/organizations` `minor` with the **Breaking** paragraph of `contracts/personal-tax-id-removal.md` §1; `minor` for `returns` (placedAt), `@endora-commerce/admin-kit` (`OrganizationPicker` `kind`); `patch` for `orders`, `quote_requests`, `price_lists`, `pwa`, `customer_accounts`; upgrade note (**minimum upgrade-from version 0.100.0**, D-290 / OD-9; lock cost of M2, historical placeholders query, unlinked count); no client or deployment named (`commercial-data.md`); `check:release-intent` (FR-053) — all WPs
- [ ] T083 [WP-8] `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; commit every artefact — T082
- [ ] T084 [WP-8] Full verify on the integration branch in both scopes: standing obligations + `pnpm --filter backend run test` once per scope + 178's preservation test if it has landed; `grep -rn personalTaxId backend/test packages` empty — T083
- [ ] T085 [WP-8] PR `feat/177-tax-id-scope` → `master`, label `breaking change`, FR → test table from `plan.md` in the description — T084
