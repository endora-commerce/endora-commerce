# Implementation Plan: Tax-ID scope, personal organizations without a tax ID, personal → company conversion

**Branch**: `spec/177-tax-id-scope` (spec) → integration branch `feat/177-tax-id-scope` | **Date**: 2026-11-10
| **Spec**: [spec.md](./spec.md)
**Input**: owner rulings of 2026-11-10 on instance extensibility (tax-ID scope option in core with
`global` | `per-tree-root`; synthetic personal tax ID removed in the same release; operator-only
conversion). One release, labelled **breaking change**.

## Summary

Three changes to the `organizations` module, delivered together:

1. **Personal organizations lose the synthetic tax ID.** `tax_id` becomes nullable, a database check
   makes "personal ⇔ no tax ID" a rule, and a new `personal_account_id` takes over the placeholder's
   second job (provisioning idempotency, the unassign destination). `taxId: string | null` in the
   contracts is the breaking part; every reader of the tax ID is walked
   (`contracts/personal-tax-id-removal.md` §3).
2. **Tax-ID scope.** `global` keeps today's unique constraint; `per-tree-root` swaps it for a deferred
   exclusion constraint over a generated `root_id`. An audited Command swaps the constraint and the
   policy row in one transaction. Every write path pre-checks for a readable 409 and maps the
   database's `23505`/`23P01` (MikroORM translates only `23505`) at the statement and at commit.
   `findByTaxId` / `resolveByTaxId` replace every `findOne({ taxId })`.
3. **Conversion.** `organization.convert_to_company` turns a personal organization into a company in
   one transaction, keeping its id; admin route + dialog + ⌘K screen under its own permission;
   published as `organizationCommandPort.convertToCompany`; emits
   `organization.converted_to_company.v1`; `returns` keeps consumer rights for orders placed before it.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17
**Primary Dependencies**: existing only — Fastify, MikroORM 6.6.16, Zod, React 19 admin, Next 15
storefront. PostgreSQL extension `btree_gist` (already created by `catalog`)
**Storage**: PostgreSQL — `organizations` (changed), `organization_tax_id_policy` (new)
**Testing**: Vitest — module co-located unit tests, `backend/test/{contract,integration}`, admin
component tests, storefront SSR tests; organizations suites in both scopes (R-16)
**Target Platform**: backend, admin, storefront
**Constraints**: one transaction per Command; no network call inside a transaction (R-13); migrations
independent of the runtime scope (data-model §3); no historical record rewritten
**Scale/Scope**: one module owns every table; 10 reader rows in 8 other modules + storefront

## Constitution Check

| Principle | Assessment |
| --- | --- |
| I. Modular (NN) | Every table is `organizations`'. Other modules change only their own code (readers widen a type; `returns` reads a new published field). No cross-module migration SQL. **PASS** |
| II. API-first | Contracts first (WP-1 T008/T009): nullable `taxId`, new schemas, the port, the event. Breaking change versioned through a `minor` changeset with a **Breaking** paragraph (D-225: `0.x`). **PASS** |
| III. TDD (NN) | Every task pair is test-first; FR → test table below; migration tests before migrations. **PASS** |
| IV. YAGNI / deps | No new runtime, dev or workspace dependency. No third scope, no join request, no policy chain beyond `refuse`. Runtime DDL and `btree_gist` recorded under Complexity Tracking. **PASS** |
| V. TypeScript | Strict; the nullable type is the mechanism that finds every reader (T027). **PASS** |
| VI. Naming (NN) | Command actions `organization.tax_id_scope.set`, `organization.convert_to_company`; event `organization.converted_to_company.v1`; permission codes `organizations:<verb-noun>`; migration class names from the scaffolder. **PASS** |
| VII. SEO/perf | Storefront change is a type and a hidden row; SSR intact. **PASS** |
| VIII. English (NN) | All artefacts English; user copy pl + en in bundles. **PASS** |
| IX. UI reuse | `PageHeader`, `Card`, `Alert`, `Badge`, `Button`, `Select`, `CountrySelect`, `ModalDialog`, `OrganizationPicker` (one optional prop added, not a new picker), `RowActionMenu`. No new primitive. **PASS** |
| X. Queues | No long-running work. The post-commit VAT validation is the existing synchronous admin path. **PASS** |
| XI. Tenancy (NN) | No "no-organization" path: a personal organization still exists for every B2C customer, it simply has no tax ID. `Organization` stays `@GlobalEntity`; the policy entity is `@GlobalEntity` (installation-wide). Conversion is gated by `organizationInReach`; scope changes and naming a parent require an unscoped context (D-260). **PASS** |
| XII. Channel scoping (NN) | No channel-scoped read changes; conversion keeps the organization's channel bindings. **PASS** |
| XIII. Command Bus (NN) | Both new writes are Commands with one audit entry; admin create's `parentId` stays inside `organization.create`; audit state per `audit-state.md` (names only for the conversion). The scope's DDL is inside its Command's transaction. **PASS** |
| XIV. Extensibility | Not a "add a field" requirement; the columns are core invariants, not custom fields. **PASS** |
| XV. Untouched core | This is the core option the owner chose *instead* of an instance-only constraint change; deployments select it by Command, never by editing core. **PASS** |
| XVI. Palette (NN-adjacent) | Two actions, both on static routes (R-17). **PASS** |
| XVII. Toggleable (NN) | `organizations` is non-deactivatable; `returns` reading `convertedToCompanyAt` goes through `organizationDetailsPort`, which fails closed. No new off-state surface. **PASS** |

**Verdict: PASS**, with two items under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/177-tax-id-scope/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── tax-id-scope.md
│   ├── personal-tax-id-removal.md
│   ├── convert-to-company.md
│   └── admin-surfaces.md
└── tasks.md
```

`/speckit.plan`'s `update-agent-context.sh` was **not** run: specs 176 and 178 are being written in
parallel and each run rewrites the same `AGENTS.md` appendix lines; the orchestrator runs it once when
the three merge (handoff item 6).

### Source code

```text
packages/contracts/src/
  organizations.ts            taxId nullable; TaxIdScope, TaxIdResolution, OrganizationCommandPort,
                              convert body, scope schemas, event type; create body parentId
  errors.ts                   ORGANIZATION_TAX_ID_SCOPE_DUPLICATES, ORGANIZATION_CONVERSION_REFUSED
  returns.ts                  OrderReturnContext.placedAt
packages/modules/organizations/
  src/migrations/             M1 personal_tax_id_removal, M2 tax_id_scope (scaffolded)
  src/backend/entities/       organization.entity.ts (changed), organization-tax-id-policy.entity.ts (new)
  src/backend/services/       tax-id-conflict.ts, tax-id-lookup-service.ts, tax-id-scope-service.ts,
                              organization-command-port.ts (new); personal-organization-service.ts,
                              organization-details-port.ts, organization-tree-service.ts,
                              organization-tax-id-validation-service.ts, registration-service.ts (changed)
  src/backend/commands/       set-tax-id-scope.command.ts, convert-to-company.command.ts (new);
                              create-organization.command.ts, set-parent.command.ts (changed)
  src/backend/routes.admin.ts scope GET/PUT, convert POST, create parentId, parent-route mapping
  src/backend/index.ts        providePort('organizationCommandPort'), boot probe, lookups on details port
  src/backend/demo/           seed.ts, reset.ts
  src/admin/                  pages/TaxIdScopePage.tsx, pages/ConvertToCompanyPage.tsx,
                              components/ConvertToCompanyForm.tsx (new); OrganizationDetail.tsx,
                              OrganizationCreate.tsx, OrganizationsList.tsx, index.ts (changed)
  src/manifest.ts             2 permissions, 2 actions, error codes
  i18n/{en,pl}.json, docs/organizations.md, docs/organization-hierarchy.md
packages/admin-kit/src/components/organization-picker/OrganizationPicker.tsx   kind prop
packages/modules/{orders,quote_requests,price_lists,pwa,returns,customer_accounts}/   reader rows
backend/src/composition.ts    promotions organization targets (X7)
backend/test/template-seed.ts establishTaxIdScope; .gitlab-ci.yml, .github/workflows/backend-suite.yml
storefront/app/(account)/organization/page.tsx, storefront/lib/api/account.ts
docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/organization{s,-hierarchy}.md
```

## Delivery — work packages, dependencies and merge order

All work lands on the integration branch `feat/177-tax-id-scope` (the 170 model), which merges to
`master` once, so the release contains all three changes or none (owner: one release).

| WP | Content | Depends on | Can merge before 176? |
| --- | --- | --- | --- |
| WP-1 | Foundation: M1, M2, contracts, entity, provisioning by link, conflict helper, lookups + port (US4) | — | **yes** |
| WP-2 | Reader inventory (US2) | WP-1 | **yes** |
| WP-3 | Scope backend: service, Command, routes, create `parentId`, tree pre-check, **registration Phase A**, boot probe, CI both scopes | WP-1 | **yes** |
| WP-4 | Scope admin UI | WP-3 API | **yes** |
| WP-5 | Conversion backend + `returns` + port | WP-1, WP-3's scope service | **yes** |
| WP-6 | Conversion admin UI | WP-5 API | **yes** |
| WP-R | Registration on 176's Command | **176 merged to master** and merged into the integration branch | no — by definition |
| WP-8 | Docs EN + PL, changesets, generated artefacts, verify, PR | all of the above | — |

WP-2, WP-3 and WP-5 run in parallel after WP-1 (disjoint files except `routes.admin.ts`, where WP-3
and WP-5 add separate route blocks — merge WP-3 first). WP-4 and WP-6 run in parallel.

**The 176 dependency.** 176 rewrites `registration-service.ts` into one Command. 177's registration
change has two layers (research R-15):

- **Phase A (T038/T039, WP-3)**: on today's service — `resolveByTaxId` at l. 152, `taxIdConflictOf`
  in the catch at l. 185–196. Small and local, and **sufficient for correctness in both scopes**, so
  177 does not block on 176.
- **Phase R (WP-R, T070/T071)**: the same two behaviours moved into 176's registration Command, the
  commit-time mapping around its `commandBus.run` call site, and `registrationConflictPolicy` declared
  as a participant if 176 ships policy chains.

**Recommended order**: 176's registration Command merges first; 177 then implements WP-R directly
and **skips T039**. If 177's other WPs are ready earlier, they merge to the integration branch with
T039, and whichever of 176 / WP-R lands second resolves the conflict in `registration-service.ts`
(the 176 author is told the two lines to carry).

**PR #990** (`organizationCustomFieldWritePort`): WP-5's `organizationCommandPort` is a separate port
built in #990's shape. No dependency either way; if #990 is on master first, register the new port
beside it in `backend/index.ts` and put the contract beside `OrganizationCustomFieldWritePort`.

**178** (extensible columns): independent. Its core-preservation test runs core migrations over a
table carrying `x_*` columns — M1/M2 only add columns and constraints and never select into a fixed
shape, so they satisfy it. If 178 lands first, run its preservation test on the integration branch in
T084.

## FR → work package → test

| FR | WP | Test (path) |
| --- | --- | --- |
| FR-001, FR-002 | WP-1 | `backend/test/integration/organizations/personal-tax-id-removal-migration.test.ts` |
| FR-003 | WP-1 | `organizations/src/backend/services/personal-organization-service.link.test.ts`; `backend/test/contract/organizations/personal-organization-link.contract.test.ts` |
| FR-004 | WP-1, WP-2 | `packages/contracts/src/organizations.tax-id.test.ts`; `backend/test/contract/organizations/me.test.ts` (extended); T027 typecheck |
| FR-005 | WP-2 | per reader, `contracts/personal-tax-id-removal.md` §3 → tasks T015–T026 |
| FR-006 | WP-2 | `backend/test/contract/organizations/vat-validation.test.ts` (extended) |
| FR-007 | WP-1 | migration test asserts `orders`/audit untouched (row counts and a sample) |
| FR-010, FR-011, FR-012, FR-013 | WP-1, WP-3 | `backend/test/integration/organizations/tax-id-scope-migration.test.ts`; `tax-id-scope-command.test.ts` |
| FR-014, FR-015, FR-016 | WP-3 | `backend/test/integration/organizations/tax-id-scope-command.test.ts` |
| FR-017 | WP-3 | `backend/test/contract/organizations/tax-id-scope-routes.contract.test.ts` |
| FR-018, FR-019 | WP-3 | `backend/test/contract/organizations/admin-organization-create.contract.test.ts` (extended) |
| FR-020 | WP-3 | `backend/test/contract/organizations/organization-tree.contract.test.ts` (extended) |
| FR-021 | WP-3, WP-5, WP-R | `backend/test/integration/organizations/tax-id-conflict-concurrency.test.ts`; `organizations/src/backend/services/tax-id-conflict.test.ts` |
| FR-022 | WP-3 / WP-R | `backend/test/contract/organizations/register.test.ts` (extended, both scopes) |
| FR-023, FR-024 | WP-1 | `backend/test/integration/organizations/tax-id-lookup.test.ts`; `demo.test.ts` (extended) |
| FR-025 | WP-4 | `admin/test/modules/organizations/tax-id-scope-page.test.tsx`; palette/bundle checks |
| FR-026 | WP-3 | `tax-id-scope-command.test.ts` (two `em`s: a write after a change in another connection sees it) |
| FR-027 | WP-3 | CI job `test:backend:organizations-per-tree-root`; `backend/test/unit/ci/organizations-scope-job.test.ts` |
| FR-030 … FR-037, FR-039 | WP-5 | `backend/test/integration/organizations/convert-to-company.test.ts`; `organizations/src/backend/commands/convert-to-company.command.test.ts` |
| FR-031 | WP-5 | `backend/test/contract/organizations/convert-to-company-not-customer-reachable.contract.test.ts` |
| FR-036 | WP-5 | `backend/test/contract/customers/unassign-after-conversion.contract.test.ts` |
| FR-038 | WP-5 | `backend/test/contract/organizations/convert-to-company.contract.test.ts` |
| FR-040 | WP-5 | `packages/modules/returns/src/backend/services/return-case-service.conversion.test.ts` |
| FR-041 | WP-5 | `convert-to-company.contract.test.ts` (no reverse action/route) |
| FR-042 | WP-6 | `admin/test/modules/organizations/convert-to-company-dialog.test.tsx`, `convert-to-company-page.test.tsx` |
| FR-050 | WP-4, WP-6 | `permission-inventory.test.ts`, `registered-bundles-shape.test.ts`, `error-code-sentences.test.ts`, `check:error-translations` |
| FR-051 | WP-3, WP-5 | sentinel tests with `expectNoAuditValues` in both Command tests |
| FR-052 | WP-8 | `check:module-docs` |
| FR-053 | WP-8 | `check:release-intent` |

## Risks

| Risk | Mitigation |
| --- | --- |
| A future core migration recreates `organizations_tax_id_unique` and breaks a `per-tree-root` installation | `tax-id-scope-migration-guard.test.ts` refuses a bare reference after M2 (data-model §3) |
| A new write path to `organizations.tax_id`/`path` forgets the commit-time mapping and answers 500 | `runOrganizationWrite` is the only call shape; `tax-id-write-paths.test.ts` lists the Commands that write those columns and fails on a new one not routed through it |
| M2's stored generated column rewrites `organizations` under an exclusive lock at upgrade | Stated in the migration header and the upgrade note; the table is small relative to orders |
| The scope switch pauses organization writes for the constraint build | Confirmation dialog says so; `share row exclusive` blocks writers, not readers |
| Overlay or instance code reads `taxId` as `string` | Breaking changeset with old/new call; `organizationCompanyTaxId` is the migration path |
| Personal rows with a non-placeholder tax ID lose their account link; an unassign then provisions a second personal organization for that account | Migration logs the count; only hand-made data is expected; documented in the upgrade note |
| 176 and WP-R / T039 conflict in `registration-service.ts` | Recommended order (176 first); the two lines to carry are named in this plan |
| Concurrency tests flaky under CI load | Paired writes on two dedicated connections with a barrier, not timing; 50 pairs per path |

## Decisions — resolved (owner, 2026-11-10, **D-290**)

The owner accepted every recommendation below on 2026-11-10; the ruling is recorded as **D-290**
(176 is D-289, 178 is D-291). Nothing here is open any more.

- **OD-1** `findByTaxId`/`resolveByTaxId` live on the read port (`organizationDetailsPort`), not on
  `organizationCommandPort` as the owner's working doc sketched — a read beside `findById`; the
  command port stays writes-only (R-8). **Resolved: read port.**
- **OD-2** VAT validation (VIES / MF) at conversion runs **after the conversion commits**, as a
  separate audited write, never inside the conversion transaction (R-13). **Resolved: after commit.**
- **OD-3** Historical orders, invoices, quote documents and audit entries that hold a personal
  placeholder are left as they are; the upgrade note gives the query (R-18). **Resolved: not
  rewritten.**
- **OD-4** #990's `organizationCustomFieldWritePort` is **not** folded into `organizationCommandPort`
  in this release — a rename of a just-published port is a second break for no consumer; a later
  release may add `setCustomFieldValues` to the command port as an alias. **Resolved: not folded.**
- **OD-5** The `returns` withdrawal-right fix — `convertedToCompanyAt` compared with the order's
  placement time (FR-040) — is in scope. **Resolved: in scope.**
- **OD-6** The owner's 2026-11-10 ruling is recorded as **D-290**, allocated centrally by the
  orchestrator because 176, 177 and 178 were written in parallel. **Resolved.**
- **OD-7** Conversion keeps the organization's status and stamps the operator's approval; it does not
  route through moderation even under `moderation_mode = manual` (R-11). **Resolved: keep status.**
- **OD-8** Soft-deleted organizations keep holding their tax ID for uniqueness (today's behaviour) —
  a deleted company's tax ID is not silently reusable. **Resolved: keep.**

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| DDL executed at runtime by `organization.tax_id_scope.set` (not by a migration) | The scope is an operator's runtime choice; the policy row and the constraint must change in one transaction | A Setting + subscriber is two transactions; a migration per scope makes migrations depend on runtime state; `create index concurrently` cannot share a transaction |
| PostgreSQL extension `btree_gist` (`create extension if not exists` in M2) | The exclusion constraint mixes `=` on `varchar` with `<>` on `uuid` | Already required by `catalog` (174's Complexity Tracking); a trigger needs explicit locking for the same guarantee |

**No new runtime, dev or workspace dependency.**

## Constitution Check — post-design

Re-checked after data-model and contracts: unchanged, **PASS**. The design adds no module, no package,
no dependency; the only non-`organizations` writes are each owner's code adapting to a widened type and
`returns` reading one new published field.

## Handoff to `endora-commerce-dev`

1. Read `spec.md`, `research.md` (R-1 … R-18), `data-model.md`, the four contracts, then `tasks.md`.
2. Create `feat/177-tax-id-scope` off `origin/master` (`scripts/setup-worktree.sh`); every WP branches
   off it as `wp/177-<nn>-<slug>`.
3. WP-1 first, test-first, serially; then WP-2 ∥ WP-3 ∥ WP-5 (merge WP-3 before WP-5 for
   `routes.admin.ts`); then WP-4 ∥ WP-6.
4. Before starting WP-3's T039, check whether 176's registration Command is on `master`; if so skip
   T039 and do WP-R instead.
5. Contract and integration tests do not run on merge requests (D-198): run the targeted files locally
   against `pnpm run dev:infra:test`, **in both scopes**
   (`ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root`), and paste the output into each PR.
6. At close-out: `composer:generate`, `manifests:generate` + `pnpm install --lockfile-only`, the
   changesets, docs EN + PL, label `breaking change`; the orchestrator runs
   `update-agent-context.sh` once for 176/177/178 (the D-number is D-290, OD-6).
