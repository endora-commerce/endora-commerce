# Implementation Plan: Organization roles and permissions

**Branch**: `plan/170-organization-roles` (this plan, merged in #681) → implementation on the
integration branch `feat/170-organization-roles` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)
| **Tasks**: [tasks.md](./tasks.md)
**Input**: Feature specification from `specs/170-organization-roles/spec.md` (merged in #664; owner
rulings OR-1 to OR-8; plan-phase rulings PR-1 and PR-2 and oracle rulings PR-3 to PR-12 below; owner
rulings OR-9 to OR-11 of 2026-11-04 below, with OR-11's design questions Q-R1 to Q-R3, answered the
same day)

## Plan-phase owner rulings *(binding; recorded 2026-11-03, after #681 merged)*

The plan put two decisions to the owner before decomposition; both are **resolved** and
`tasks.md` is built on them.

- **PR-1 — Integration branch: yes.** P1 and P2 are delivered on `feat/170-organization-roles`;
  every work-package PR targets that branch, and one PR merges it to `master` at the end (after
  WP-13). WP-00 (the behaviour oracle) goes to `master` first, on its own, and **depends on #656
  being merged**. Research R-23, *Delivery model* item 1.
- **PR-2 — The R-28 database triggers: accepted.** M2 installs the `after insert on organizations`
  trigger that creates both predefined roles; M3 installs the `before insert on customer_accounts`
  trigger that assigns the default role to an account inserted without one. Research R-28.

## Oracle rulings *(binding; owner, 2026-11-03, from the WP-00 oracle in PR #689)*

The WP-00 oracle (`backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts`, recorded by
today's code) surfaced five rows the plan as written would have changed silently. Each is
**resolved**; `tasks.md` T117–T129 and the edited tasks carry them out.

- **PR-3 — A personal Organization's member holds *Administrator*.** Today `createStandalone` and
  the federated sign-in leave the individual a `regular_user`; the spec (*Edge Cases*) is kept, and
  M3 maps a personal Organization's account to *Administrator* whatever its `role`. Every path
  that puts an account into a personal Organization after the upgrade — self-registration,
  federated sign-in, `ensureForCustomerAccount`, the operator's detach — assigns *Administrator*.
  Surfaces that must stay hidden for a personal Organization are gated by `isPersonal`, never by
  the role (research R-34). FR-072 gains the exception: the personal Organization's rows change.
- **PR-4 — The guest basket is unchanged.** `P(carts.create)` judges a signed-in customer only; an
  anonymous visitor keeps adding to the guest basket (`POST /api/v1/cart/items` → `200`). The guard
  takes `{ guests: 'pass' }` on the routes that admit guests today (research R-35). The sign-in merge
  of a guest basket is ruled by PR-12.
- **PR-5 — Changed refusal codes are expected differences, listed per row.** WP-13 does not compare
  statuses only: `contracts/migration-and-replay.md` §6 holds a table keyed by oracle request id with
  the old and new `{ status, code }` of every row the design knowingly changes (26 rows, five
  families), and the replay asserts exactly that table (research R-36).
- **PR-6 — One-click differences are B.regular's rows only** — the two rows tagged
  `oneClickInApprovalOrg`. Confirmed; recorded in `contracts/migration-and-replay.md` §5 and §6.
- **PR-7 — The pending-invitations list excludes expired invitations.** `listPending` filters only
  consumed and revoked today; FR-010a fixes it inside this feature, in WP-03 (research R-37).

The owner then confirmed five design decisions the rulings above needed (2026-11-03), binding as well:

- **PR-8 — One-click judges `quick_order.one_click` first** (FR-050's order), in the eligibility
  reason and the placement refusal alike; a member lacking both reads `permission_required`
  (research R-6, R-36; §6.1 rows 23–24).
- **PR-9 — Approve and reject check "not pending" before "own cart"**: `CART_APPROVAL_NOT_PENDING`
  first, `CART_APPROVAL_SELF_APPROVE` only for one's own pending cart (R-36; §6.1 rows 5–6).
- **PR-10 — A personal Organization's administrator routes answer as for any administrator.**
  Members and invitations lists, organization carts, the MFA policy and Organization one-click
  defaults answer normally; only the storefront hides them, by `isPersonal`. This is deliberate: the
  routes do **not** answer `404` (only the role routes do, as designed) (R-34).
- **PR-11 — Moving an account to a company Organization keeps the kind**: *Administrator* stays
  *Administrator*, anyone else becomes *Member*; a custom role does not travel (R-34).
- **PR-12 — The sign-in merge of a guest basket is judged against `carts.create`.** For a member
  whose role lacks it the merge is skipped: the guest basket is not merged and stays as it was
  (FR-030a; research R-35; tasks T126–T129). No oracle row covers sign-in, so the expected-differences
  table is unchanged.

**Decomposition adjustments made by `/speckit.tasks`** (each keeps the plan's file-disjointness;
the *Owns* columns below are read with them applied):

- **A-1 — `addresses.manage` is declared by WP-03, not WP-02a.** WP-03 is the package that
  enforces it on `organizations/routes.customer.ts`; declaring it in Wave 1 would leave the
  permission inventory's `unchecked-declaration` finding red on the integration branch from
  WP-02a until WP-03 merges, contradicting *Delivery model* item 4. `addresses`' `manifest.ts` and
  `i18n/*` move to WP-03's set; no other Wave 2 package touches `addresses`.
- **A-2 — Polish module pages travel with their English edit.** `specs/conventions/module-documentation.md`
  requires the PL page and its translation pin in the **same** merge request as the EN change
  (`check:docs-translations`), so each work package that edits `packages/modules/<id>/docs/*.md`
  updates `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/<id>.md` and re-pins it.
  WP-11 keeps the site pages (`docs/docs/architecture/permissions.md` and its PL page) and a final
  pin sweep.
- **A-3 — No upgrade page in this feature.** `docs/docs/upgrading-an-instance.md` gains its
  per-release section at release time, not on the feature branch; the spec's *Upgrade note* is
  its source, and WP-12's consumer changeset carries the old → new field mapping now.
- **A-4 — Gate status at tasks time.** #655 and #680 are **merged**; #656 is **open** and is the
  only remaining external gate (WP-00 and WP-04).

## Owner rulings of 2026-11-04 *(binding; the Wave 3 questions Q1–Q3, recorded in `spec.md` as OR-9 to OR-11)*

- **OR-9 (Q1 = a) — a new custom role starts with no permissions**, on the storefront and the Admin
  UI create forms alike; no "copy from *Member*". FR-004a, research R-39. **The backend already
  behaves so** (WP-02a: `organization_role.create` stores only the submitted present codes and
  `grantedCodes` adds unoffered defaults to *Member* only); the Admin UI form already opens empty
  (WP-08). What the ruling adds: WP-09's create page (T097/T098, amended) and a regression test on the
  Admin UI form (T140, WP-15).
- **OR-10 (Q2 = b) — quick-order import needs `carts.create` or `quote_requests.create`**; the build
  that follows stays gated by its target. FR-030b, research R-40. WP-06 (#707, merged) gates the import
  on `carts.create` alone, so the change is a follow-up package, **WP-15** (T139–T142), plus the
  storefront's visibility rule in WP-10 (T100/T101, amended).
- **OR-11 (Q3 = b) — returns and complaints by permission, in this feature.** `returns` declares
  `returns.create` (member-default) and `returns.view_organization` (not member-default); *Member*
  keeps today's placer-only reach. FR-052–FR-054, User Story 9, research R-41. New packages **WP-14**
  (backend, docs; T143–T149) and **WP-14b** (storefront; T150–T152). It moves no oracle row
  (`contracts/migration-and-replay.md` §6.3).

## OR-11's design questions *(answered by the owner, 2026-11-04 — binding)*

- **Q-R1 — May a member who sees a colleague's order start a return from it? Answered: A.** Yes —
  `returns.create` **and** the order within the member's order scope, i.e. `orders.view_organization`
  (or *Administrator*), judged by `orderReadPort.findByIdForCustomer`; the case is filed in the
  starter's name and the placer sees it only through `returns.view_organization`. It is what FR-049
  already says (*returns started from it*) and how reorder and clone-to-quote behave for the same
  holder. (Rejected: B, placer-only submission for every role.)
- **Q-R2 — What may a holder of `returns.view_organization` do on a colleague's case? Answered: A.**
  Read only — comments, attachments, the return delivery method and cancelling stay the filer's,
  answered `404 NOT_FOUND` to anyone else as today. (Rejected: B, the holder may also act on it.)
- **Q-R3 — The administrator's upgrade change. Answered: accepted.** *Administrator* holds every code
  (FR-002), so from the upgrade on an administrator's `GET /api/v1/returns` lists every member's cases,
  opens a colleague's case, and starts returns from colleagues' orders (before: their own only). The
  oracle has no returns family, so this is listed in `contracts/migration-and-replay.md` §6.3 and
  FR-072 rather than §6.1.

## Summary

An Organization gets **roles**: two predefined (*Administrator* — every permission, immutable;
*Member* — editable, starting as exactly today's regular user) and up to 50 custom ones, each a set
of **organization permissions** declared by the module whose buyer action they gate. Every member
holds one role; every invitation names one. The *requires cart approval* switch is replaced by the
`carts.order_without_approval` permission (OR-3), one-click becomes a permission (OR-1, OR-6,
closing #653), colleagues' orders become `orders.view_organization` (OR-5) and organization addresses
`addresses.manage` (OR-8). The legacy `role` field is removed from every request and response in the
same release (OR-4).

Technically: `organizations` owns the `organization_roles` table, the role Commands, the merged
catalogue and a published **`organizationPermissionPort`** with a per-process cache dropped over
Redis pub/sub; `customer_accounts` owns the account's role reference and the audited member
Commands; each gating module declares its codes in a new manifest field `organizationPermissions`
and gates its routes with a shared pre-handler. The member's role id rides on the request actor,
which `auth` already reads once per request, so a permission check on the cart path costs no
database read. Two small platform extensions make the auditing honest: the customer actor is
recorded on the audit row, and a Command can run child Commands in its own transaction.

**Phasing.** P1 (mechanism) and P2 (commerce permissions) are one release, built on one integration
branch and merged to `master` once. P3 (internal RFQ approval, OR-2) is a later release with its own
branch. There is no removal phase (OR-4): legacy fields and columns go in the same release, through a
deprecate-then-delete sequence inside the integration branch (research R-23).

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17; React 19 (admin, storefront)
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, ioredis (pub/sub, as
`custom_fields` already uses it), Next.js 15 App Router, admin-kit. No new runtime, dev or
workspace dependency.
**Storage**: PostgreSQL — new table `organization_roles` (`organizations`); new columns
`customer_accounts.organization_role_id`, `organization_invitations.organization_role_id`,
`audit_log_entries.actor_customer_account_id`; dropped `organizations.requires_cart_approval`,
`organization_invitations.role`, `customer_accounts.role`. Redis — one pub/sub channel
`b2b:organization-roles:changed`; no stored keys.
**Testing**: Vitest — package-local `*.test.ts` beside their subjects (normative,
`specs/106-module-owned-tests/`), `backend/test/{unit,contract,integration,perf}`, admin and
storefront suites. Contract and integration suites are off merge requests (D-198), so each work
package runs its targeted files locally against `pnpm run dev:infra:test` and pastes the output.
**Target Platform**: backend (Fastify API + worker processes), storefront (Next.js SSR), admin (Vite SPA)
**Project Type**: pnpm monorepo web application
**Performance Goals**: no added database read per request on cart, checkout, placement and
one-click once an Organization's roles are cached (FR-080); p95 of those paths within 5 % of the
previous release (SC-004)
**Constraints**: a revoked permission stops working immediately in the writing process and within
30 s everywhere, never open beyond (FR-081, FR-082); every pre-upgrade outcome reproduced after the
upgrade except the rows of the expected-differences table (FR-072, PR-5; `contracts/migration-and-replay.md` §6)
**Scale/Scope**: 11 organization permission codes (9 in P2, 2 in P3), 2 operator codes, ~25 new or
re-gated endpoints, 5 migrations; 155 legacy references in 59 non-test files plus 79 test files and
6 shared helpers to convert (research R-14, measured at `d31bab44b`)

No `NEEDS CLARIFICATION` remains. Research R-14 to R-33 record the plan-phase decisions, R-34 to
R-37 the oracle rulings PR-3 to PR-12, R-38 how the replay replaces the live oracle on the
integration branch (WP-13a).

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1. Final verdict at the end.*

| Principle | How this design meets it |
| --- | --- |
| **I. Modular architecture (NN)** | Each gating module declares and enforces its own codes (`carts`, `quote_requests`, `shopping_lists`, `quick_order`, `orders`, `addresses`); `organizations` owns roles, catalogue, port and cache and names no other module's action at runtime (R-1, R-2). `customer_accounts` owns the assignment column and its Commands; its FK into `organizations`' table follows the dependency it already declares. Every consumer reaches the mechanism through `lazyPort(ctx, 'organizationPermissionPort')`; **one new lifecycle edge** — all eight original consumers already list `organizations` in `dependencies` (measured); `returns`, added by OR-11, does not and gains it in WP-14 (R-41 item 7), onto a `nonDeactivatable` target, so no operator control is lost. The one new cross-module reach — `organizations` running `customer_accounts`' role-change Command as a child of a role deletion — goes through a published Command-factory port and joins the existing mutual-pair acknowledgements in `organizations`' manifest (`contracts/commands-audit-events.md` §2). Two literals of `carts`/`quick_order` codes appear in one frozen `organizations` data migration that translates that module's own column; accepted and bounded in R-18. Detachability: a removed module's codes leave the vocabulary; stored grants of unknown codes are ignored on read and dropped on save. |
| **II. API-first** | Every shape in `packages/contracts` first (WP-01): `organization-roles.ts`, the manifest field, the actor field, the error codes, the request and response schemas. The breaking change is versioned per OR-4 and D-225 as a `0.x` `minor` of `@endora-commerce/contracts` with an upgrade note naming the old and new fields (R-8); request schemas are `.strict()`, so a stale client is refused rather than silently ignored (R-24). |
| **III. TDD (NN)** | Every work package starts red against the FR → test map below; the oracle is written **before** any change (WP-00, R-27) and the replay proves FR-072 against it (WP-13a on the integration branch from Wave 2, R-38; closed by WP-13). Off-state, cross-tenant and cache-bound tests are named per package. |
| **IV. YAGNI & minimal dependencies** | No new dependency. No shared Redis cache layer (R-16), no boot reconciler (R-17), no new operator Setting, no deny rules or amount thresholds. Complexity Tracking is empty. |
| V / VI / VIII | TypeScript with Zod-inferred types; codes `<module>.<action>` in snake case, Commands dot-namespaced, migrations scaffolded (`<stamp>_<module>_<slug>`); English everywhere. |
| VII. SEO & performance | Storefront pages stay Server Components; permission-aware rendering reads the session view the account layout already fetches. Hot-path cost: no added read (R-15). |
| IX. UI reuse | The storefront role editor reuses the account area's table, form and dialog primitives; the Admin UI tab reuses admin-kit primitives and the existing `OrganizationSalesRepsTab` pattern. The designer owns the layout (R-12). |
| X. Queue consumers | Not applicable: no new background work. The FR-034 cascade is an in-process, post-commit event subscriber; a lost event is harmless by construction (R-25). |
| **XI. Multi-tenant isolation (NN)** | `organization_roles` is organization-scoped, classified for the entity-classification check and read through the tenant filter; a request naming another Organization's role answers as "not found" (FR-005), and the composite FKs `(organization_id, organization_role_id)` make a cross-Organization assignment impossible in the database itself. The cache loader and the auth-hook read are the only system-scoped reads (`withSystemScope` with a reason), the first keyed by the caller's own Organization, the second pre-tenancy as today. There is **no no-organization path**: every subject carries an `organizationId`; a personal Organization's sole member is its administrator. Cross-tenant tests are required in WP-02a, WP-02b and WP-03. |
| XII. Sales-channel scoping (NN) | Unchanged: permissions are per Organization, not per channel; every commerce path keeps its resolved-channel reads, and one-click and quick order run their channel checks after the permission gate. |
| **XIII. Command Bus auditing (NN)** | Every write is a Command (`contracts/commands-audit-events.md`): role create, update and delete, change role, remove member, promote administrator, invitation create. `role-service.ts`'s hand-placed `recordAuditFromContext` calls are removed in the same change. The actor is server-derived, and the bus now records a customer actor (R-21), so a storefront administrator's change is attributable (SC-006). A deletion and its reassignments commit as one unit with one entry each, through child Commands on the parent's transaction (R-22): no hand audit, no second transaction. No-op saves record nothing. |
| XIV. Extensibility | The vocabulary is extensible by manifest: a custom or overlay module declares `organizationPermissions` and is listed, cached and enforced with no core edit (upgrade note). |
| XV. Untouched core | Generic capability; deployments customise by granting, never by editing core. Overlay modules declare codes exactly as core modules do. |
| XVI. Command palette | No new static admin route: the Roles tab lives on `/organizations/:id`, a detail screen (`specs/conventions/module-admin-surfaces.md`, palette item 7); `open-organizations` remains `organizations`' landing action. Removing `carts`' zone leaves no palette debt. |
| **XVII. Operator-toggleable modules (NN)** | Presence is read per call from `effectiveState` (both axes). A switched-off module's codes are not listed, not effective and not editable; its grants are retained and return on reactivation (FR-025, US 8, SC-007); off is non-destructive. The mechanism lives in `organizations` and `customer_accounts`, both already `nonDeactivatable` with stated reasons; nothing is added to that set. Each switchable gating module's existing off-state test gains a case: its codes leave the catalogue and the member's effective set while off, and come back on. |

**Cross-cutting checklist (architect brief).** Admin permission manifest: two new codes in
`organizations` with EN+PL labels, enforced on WP-02a's routes (inventory green in both
directions). Command palette: no new destination. pl + en: module bundles for permission labels,
role names, errors and the Admin UI tab; storefront catalogues `account.ts` and `commerce.ts`.
Settings: none introduced (the 50-role limit is fixed by the spec's *Assumptions*). Command Bus:
above. Tenant scoping: above. Redis cache invalidation: a write-path drop plus a pub/sub
announcement, a lost announcement bounded by the 30 s LRU age (R-16).

**Gate result (pre-research)**: PASS — no violation.

## Project Structure

### Documentation (this feature)

```text
specs/170-organization-roles/
├── spec.md                      # merged in #664
├── research.md                  # R-1 … R-13 (specify phase), R-14 … R-33 (this plan), R-34 … R-37 (oracle rulings), R-38 (the replay on the integration branch)
├── plan.md                      # this file
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── organization-permissions-manifest.md
│   ├── organization-permission-port.md
│   ├── storefront-api.md
│   ├── operator-api.md
│   ├── commands-audit-events.md
│   └── migration-and-replay.md
├── checklists/requirements.md
└── tasks.md                     # /speckit.tasks
```

### Source code (what each area gains or loses)

```text
packages/contracts/src/
├── organization-roles.ts            # NEW: role kinds/refs/views, request schemas (.strict), port + guard
├── modules.ts                       # + organizationPermissions manifest field
├── actor.ts                         # + ActorCustomer.organizationRoleId?
├── customer-accounts.ts             # + organizationRoleId on records, countAdministrators, role-command port; − enum (WP-12)
├── organizations.ts, admin.ts, carts.ts, quote-requests.ts, common.ts   # legacy shapes deprecated (WP-01), removed (WP-12)
└── errors.ts                        # + ORGANIZATION_PERMISSION_REQUIRED, ORGANIZATION_ROLE_*, CART_APPROVAL_SELF_APPROVE

packages/platform/src/
├── commands/{command.ts,command-bus.ts,actor.ts}     # child Commands; customer actor
├── kernel/audit/audit-log-entry.entity.ts, kernel/ports/audit.ts
├── composition/compose-app.ts                        # resolvers pass organizationRoleId
└── migrations/<stamp>_core_audit_actor_customer_account.ts   # M1

packages/modules/organizations/
├── src/backend/entities/organization-role.entity.ts                                       # NEW
├── src/backend/services/organization-role-{catalogue,cache,permission-port,service}.ts   # NEW
├── src/backend/commands/organization-role-{create,update,delete}.command.ts              # NEW
├── src/backend/routes.roles.ts, routes.admin-roles.ts                                    # NEW
├── src/backend/{routes.members,routes.customer,routes.public,routes.admin}.ts            # role → roleId / organizationRole
├── src/backend/services/{invitation-service,registration-service,organization-moderation-service}.ts
├── src/backend/email-templates/invitation.ts                                             # #667
├── src/admin/components/OrganizationRolesTab.tsx (NEW), src/admin/pages/OrganizationDetail.tsx
├── src/migrations/<stamp>_organizations_organization_roles.ts            # M2
├── src/migrations/<stamp>_organizations_drop_legacy_role_columns.ts      # M4
├── src/manifest.ts, i18n/{en,pl}.json, docs/organizations.md
└── removed in WP-12: commands/set-cart-approval-policy.command.ts, the cart-approval write port, Organization.requiresCartApproval

packages/modules/customer_accounts/
├── src/backend/entities/customer-account.entity.ts            # + organizationRoleId; − role (WP-12)
├── src/backend/commands/customer-account-{change-role,remove-member,promote-admin}.command.ts   # NEW, replace role-service.ts
├── src/backend/services/customer-account-{ports,lifecycle-ports}.ts, index.ts
├── src/migrations/<stamp>_customer_accounts_organization_role_assignment.ts   # M3
└── src/migrations/<stamp>_customer_accounts_drop_legacy_role_column.ts        # M5

packages/modules/{carts,quote_requests,shopping_lists,quick_order,orders,addresses}/src/manifest.ts   # organizationPermissions
packages/modules/carts/src/backend/{routes.ts,routes.organization.ts,routes.admin.ts,services/cart-approval-*.ts,services/organization-cart-reach.ts}
packages/modules/carts/src/admin/                    # CartApprovalPolicy zone removed
packages/modules/{quote_requests,shopping_lists,quick_order,orders,mfa,customers}/src/backend/…   # gates; isOrgAdmin / role reads replaced

storefront/
├── lib/organization-permissions.ts                       # NEW (WP-01): can(session, code), isAdministrator(session)
├── app/(account)/organization/roles/{page,new/page,[id]/page}.tsx   # NEW
├── app/(account)/organization/{members,carts}/…, app/(account)/layout.tsx, the account page
├── app/(account)/organization/settings/cart-approval/    # removed
├── components/CartApprovalBanner.tsx, PDP / cart / quick-order / RFQ / list action components
└── lib/api/{account,organization,cart}.ts, lib/i18n/messages/{account,commerce}.ts

backend/test/
├── fixtures/organization-roles/pre-upgrade-outcomes.ts             # NEW (WP-00)
├── fixtures/organization-roles/expected-differences.ts             # NEW (WP-13a, PR-5, R-38): the §6.1 table
├── fixtures/organization-roles/landed-work-packages.ts             # NEW (WP-13a, R-38), deleted by WP-13
├── integration/organizations/roles-upgrade-oracle.test.ts          # NEW (WP-00); retired by WP-13a (R-38)
├── integration/organizations/roles-upgrade-replay.test.ts          # NEW (WP-13a), completed by WP-12, WP-13
├── helpers/seed-organization-roles.ts                              # NEW (WP-02b): custom-role seeding for Wave 2
└── contract/admin_users/permission-inventory.test.ts               # + organization-permission describe (WP-01)

docs/docs/architecture/permissions.md, docs/i18n/pl/…  # WP-11 (no upgrade page, A-3)
```

**Structure decision**: extend `organizations` and `customer_accounts`; no new module (research R-1:
a separate `organization_roles` module is rejected on domain ownership).

## Delivery model

1. **Integration branch.** `feat/170-organization-roles` is cut from `origin/master` **after WP-00
   merges**. Every work package below branches from it (`wp/170-<nn>-<slug>`) and merges back by
   merge request; the integration branch reaches `master` once, after WP-13 (research R-23).
   `master` is merged into it at least daily; generated artefacts that conflict
   (`backend/src/db/*-registry.generated.ts`, `admin/src/modules.generated.ts`, the manifest index)
   are **regenerated** with `pnpm --filter backend run composer:generate`, never hand-merged.
2. **Waves and file ownership.** Within a wave, work packages own **disjoint** file sets (the tables
   below); a file may be touched by several packages only in **different** waves, so concurrent
   branches cannot conflict. Shared test helpers belong to WP-02b; a Wave 2 package that needs a new
   fixture adds a new file under its own module's test directory.
3. **i18n bundles.** A module's `i18n/{en,pl}.json` is edited by the package that owns that module in
   the wave. `organizations`' bundle is WP-02a's in Wave 1 — it adds every key P1 needs, the Admin UI
   tab's and the e-mail role labels included, and lists them in its MR description; in Wave 2 only
   WP-03 edits it, and WP-08 consumes it.
4. **Deprecate, then delete.** Wave 1 adds; Wave 2 converts and stops reading legacy; WP-12 deletes.
   Between WP-02b and WP-12 the legacy enums are dual-written and the default trigger derives from
   them (R-23, R-28). The integration branch is green — typecheck, lint, `test:unit:fast`, and each
   package's targeted contract and integration files — at every merge. From WP-13a's merge the
   targeted files of **every** package include the upgrade replay, with the landing ledger of
   `contracts/migration-and-replay.md` §6.2 (R-38); the WP-00 oracle test no longer runs there.
5. **Changesets.** Every work package that changes what a package publishes adds its own changeset
   file (`specs/conventions/release-intent.md`); `@endora-commerce/contracts` takes `minor` (D-225)
   with the old → new field mapping in the body. WP-12 writes the consumer-facing summary changeset.
6. **Done for a work package** = its FRs' tests green locally (complete-suite files run by hand,
   D-198); the inventory command (R-14) reporting zero over its owned files; `typecheck`, `lint`,
   `test:unit:fast` and `pnpm --filter '!backend' run test` for the touched packages; the module's
   own documentation page (EN) updated.

## Work packages

Sizes: S ≤ 1 day, M 2–3 days, L 4–6 days of one agent.

### Wave 0 — on `master`, before the integration branch exists

| WP | Title | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| **WP-00** | Pre-upgrade oracle (R-27; `contracts/migration-and-replay.md` §5) | `backend/test/integration/organizations/roles-upgrade-oracle.test.ts` (new), `backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts` (new) | **#656 merged** (placement outcomes); #655 not required | M |

A characterization test of today's code: it merges to `master` on its own, test only (an empty
changeset if the gate asks for one).

### Wave 1 — foundation, serial on the integration branch

| WP | Title | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| **WP-01** | Contracts and platform, additive | `packages/contracts/src/{organization-roles.ts (new), modules.ts, actor.ts, errors.ts, index.ts}` and the `@deprecated` marks in `organizations.ts`, `customer-accounts.ts`, `common.ts`, `carts.ts`, `quote-requests.ts`, `admin.ts`; `packages/platform/src/commands/{command,command-bus,actor}.ts`, `kernel/audit/audit-log-entry.entity.ts`, `kernel/ports/audit.ts` and its writer, `composition/compose-app.ts`, core migration **M1**; `packages/modules/auth/src/backend/{plugin.ts,index.ts}`; `storefront/lib/organization-permissions.ts` (new); `backend/test/contract/admin_users/permission-inventory.test.ts` (organization-permission describe; an empty population passes) | WP-00 on `master` | M |
| **WP-02a** | Roles in `organizations` | `organizations`: `entities/organization-role.entity.ts`, `services/organization-role-*.ts`, `commands/organization-role-*.command.ts`, `routes.roles.ts`, `routes.admin-roles.ts`, `index.ts`, `plugin.ts` (wiring only), `manifest.ts` (operator codes, error codes), `i18n/{en,pl}.json`, migration **M2** (table, trigger, FR-071 marker, invitations column, plus the dual-write in `services/invitation-service.ts` and `entities/organization-invitation.entity.ts`), `docs/organizations.md` (Roles section) | WP-01 | L |
| **WP-02b** | Assignment in `customer_accounts` | `customer_accounts`: entity, migration **M3** (column, backfill, default trigger, composite FK), `commands/*` (change role, remove member, promote administrator — replacing `role-service.ts`), `services/customer-account-{ports,lifecycle-ports}.ts` (records carry `organizationRoleId`; `countAdministrators`; write port takes `organizationRoleId` and dual-writes `role`; `customerAccountRoleCommandPort`), `index.ts` (`customerOrgResolver` returns the role id), `docs/customer_accounts.md`; `organizations`: `services/registration-service.ts`, `services/personal-organization-service.ts`, `commands/create-organization.command.ts` (pass role ids), `src/ports/index.ts` and the two personal-organization port registrations in `src/backend/index.ts` (the provisioning answers carry `administratorRoleId`, PR-3), the reassignment children in `commands/organization-role-delete.command.ts`, `manifest.ts` (acknowledged edge); `customers`: only the role-id pass-through of `services/customer-org-assignment-service.ts` into the account write (its guards stay WP-03's, Wave 2); `packages/demo-composition/src/composition.ts`; `backend/scripts/acceptance/instance-actor-scope.ts`; shared helpers `backend/test/helpers/{seed-organizations,seed-commerce,seed-roles,seed-credit-limit,admin-search-fixtures,test-server}.ts` and `backend/test/helpers/seed-organization-roles.ts` (new); tests `backend/test/integration/customer_accounts/*` (3, plus `personal-organization-administrator.test.ts` new, PR-3), `backend/test/unit/customer_accounts/password-verification-port.unit.test.ts`, `backend/test/integration/demo/demo-reset-after-use.test.ts` | WP-02a | L |

WP-02a delivers the port reading `organizationRoleId` from the subject; WP-02b makes every subject
carry one (through the actor) and turns on the account-read fallback. Until WP-02b wires the
reassignment children, WP-02a's role delete refuses a held role — a gap that exists only inside the
integration branch.

### Wave 2 — conversion, in parallel after WP-02b

| WP | Title | Owns | Depends on (to merge) | Size |
| --- | --- | --- | --- | --- |
| **WP-03** | Members, invitations, session, addresses, reserved capabilities | `organizations`: `routes.members.ts`, `routes.customer.ts` (`/me`, the `addresses.manage` gates), `routes.public.ts` (login), `routes.admin.ts` (operator member endpoints), `services/invitation-service.ts` (roleId API, last-admin invite rule), `email-templates/invitation.ts` (#667), `services/organization-moderation-service.ts`, `services/organization-context-service.ts`, `i18n/{en,pl}.json`; `addresses`: `src/manifest.ts` and `i18n/*` (declares `addresses.manage`, R-8b, A-1); `customers`: `services/customer-{org-assignment,deletion,moderation}-service.ts`, `routes.admin.ts` (impersonation response, RFQ list call), `routes.self.ts`; `mfa`: `services/account-identity.ts`, `routes.org.ts`; tests: `backend/test/contract/organizations/*` (6, plus `personal-organization-administrator.contract.test.ts` and `login-cart-merge-skipped.contract.test.ts` new, PR-3, PR-12), `backend/test/integration/customers/personal-organization-depletion.test.ts` (new, PR-3), `backend/test/integration/organizations/{customer-subtree-rollup,invitation-email,invite-and-scope,membership-shapes,moderation-email-language,moderation-notification-scope,unreadable-path-fails-closed}.test.ts`, `backend/test/unit/organizations/moderation-email-language.test.ts`, `organizations/src/backend/email-templates/*.test.ts` (2), `backend/test/integration/customers/customer-moderation-service.test.ts`, `backend/test/unit/customers/customer-detail-channels-port.test.ts`, `backend/test/integration/mfa/*` (4), `mfa/src/backend/services/account-identity.test.ts` | WP-02b | L |
| **WP-04** | Carts (OR-3) | `carts`: `manifest.ts` (3 codes), `i18n/*`, `routes.ts` (gates, convert-to-quote included), `routes.organization.ts` (approvers; policy endpoint removed), `routes.admin.ts` (policy endpoints removed), `services/cart-approval-{service,policy,emails}.ts`, `services/organization-cart-reach.ts`, `entities/cart.entity.ts` (comment), `index.ts` (subscribers, port wiring), `src/admin/**` (zone removed), `docs/carts.md`, `services/cart-service.ts` (the sign-in merge gate, PR-12); tests: `backend/test/contract/carts/*` (4, plus `guest-basket-unchanged.contract.test.ts` new, PR-4), `backend/test/integration/carts/*` (4, plus `merge-on-login-permission.test.ts` new, PR-12, and other new), `backend/test/unit/carts/cross-module-ports.unit.test.ts`, `admin/test/modules/carts/cart-approval-policy-zone.test.tsx` (deleted), `admin/test/modules/organizations/organization-detail-after.two-contributors.test.tsx` | WP-02b; **#656 merged** (#655 merged, A-4) | L |
| **WP-05** | Quote requests, P2 part | `quote_requests`: `manifest.ts` (`quote_requests.create`), `i18n/*`, `index.ts` (customer context without `isOrgAdmin`), `services/rfq-service.ts` (visibility through `isAdministrator`, R-30), `routes.customer.ts` (gates), docs; tests: `backend/test/integration/quote_requests/*` (8), `backend/test/contract/quote_requests/pdf-export.test.ts`, `quote_requests/src/backend/**/*.test.ts` (4), `packages/contracts/src/quote-requests.test.ts` | WP-02b | M |
| **WP-06** | Shopping lists and quick order (OR-1, OR-6, #653) | `shopping_lists`: `manifest.ts`, `i18n/*`, routes, `services/shopping-list-service.ts`, docs; `quick_order`: `manifest.ts`, `i18n/*`, `services/{one-click-service,quick-order-build-service}.ts`, `routes.preferences.ts`, `routes.admin.ts`, customer routes, docs; tests: `quick_order/src/backend/services/{quick-order-build-service,one-click-service}.test.ts`, `backend/test/contract/shopping_lists/default-list-on-customer-create.test.ts`, new one-click and list-gate tests | WP-02b; **WP-04 merged** (`carts.order_without_approval` must be declared for the inventory) | M |
| **WP-07** | Orders (OR-5) | `orders`: `manifest.ts`, `i18n/*`, `services/order-access-service.ts`, `services/order-clone-to-quote-service.ts`, docs; tests: `backend/test/integration/orders/{order-access-service,buyer-order-actions-scope}.test.ts`, `orders/src/backend/services/order-buyer-action-scope.test.ts`, a new colleague-documents test | WP-02b (#680, the invoices leg, merged — A-4) | S |
| **WP-08** | Admin UI | `organizations/src/admin/**` (`pages/OrganizationDetail.tsx`, `components/OrganizationRolesTab.tsx` new, `api/*`); admin tests under `admin/test/modules/organizations/` except the zone-contributor file | WP-02a (role endpoints), WP-03 (member endpoints) | M |
| **WP-13a** | Upgrade replay, brought forward (R-38) | `backend/test/integration/organizations/roles-upgrade-replay.test.ts` (new, interim lists M3/M2); `backend/test/fixtures/organization-roles/expected-differences.ts` (new, §6.1 with `landedBy`) and its self-check `backend/test/unit/organizations/roles-expected-differences.test.ts` (new); `backend/test/fixtures/organization-roles/landed-work-packages.ts` (new, §6.2 — each entry later flipped by its own package); retires `backend/test/integration/organizations/roles-upgrade-oracle.test.ts` (`git rm`, never edited; the fixture stays) | WP-02b; **merges before WP-03, WP-04 and WP-06** | M |

### Wave 3 — storefront, in parallel; may start during Wave 2 against the contracts and merge after its APIs

| WP | Title | Owns | Depends on (to merge) | Size |
| --- | --- | --- | --- | --- |
| **WP-09** | Storefront: organization area | `storefront/app/(account)/layout.tsx`, `app/(account)/organization/{roles/**,members/**,carts/**}`, removal of `app/(account)/organization/settings/cart-approval/`, the account page, `lib/api/{account,organization}.ts`, `lib/i18n/messages/account.ts`; tests `storefront/test/account/{i18n/account-pages,module-presence-nav,org-cart-detail,org-carts-list}.test.tsx` plus new roles-page tests | WP-02a, WP-03, WP-04; the designer's layout (R-12) | L |
| **WP-10** | Storefront: commerce surfaces | `components/CartApprovalBanner.tsx`, the PDP / cart / quick-order / RFQ / shopping-list action components, `lib/api/cart.ts`, `lib/i18n/messages/commerce.ts`; tests `storefront/test/checkout/cart-approval-submit.test.tsx` plus new hidden/disabled-action tests | WP-04, WP-05, WP-06 | M |
| **WP-14** | Returns by permission, backend (OR-11) | `returns`: `src/manifest.ts` (two codes; `organizations` in `dependencies`), `i18n/{en,pl}.json`, `src/backend/{index.ts,plugin.ts,routes.customer.ts}`, `services/return-case-service.ts`, a module-local scope helper (new), the operator row mapper in `services/return-list-service.ts` (summary field), `docs/returns.md` and `plpage(returns)`; `contracts`: `returnCaseSummarySchema.customerAccountId` in `packages/contracts/src/returns.ts`; `orders`: the `orders.view_organization` description (manifest, `i18n/*`, `docs/orders.md`, `plpage(orders)`) (Q-R1 = A); `contracts`: the `findByIdForCustomer` doc comment in `packages/contracts/src/orders.ts` (T153); tests: `backend/test/integration/returns/{organization-permissions,organization-returns-visibility,colleague-order-returns}.test.ts` (new), `backend/test/integration/returns/off-state.test.ts`, `backend/test/integration/orders/colleague-orders-permission.test.ts` (the two *placer only* cases) | WP-02b, WP-07 (merged) | M |
| **WP-14b** | Returns by permission, storefront (OR-11) | `storefront/app/(account)/orders/[id]/page.tsx` (the return action), `app/(account)/returns/{page,new/page,[id]/page}.tsx`, `lib/returns/returnForm.ts`, `lib/api/returns.ts`, the returns keys of `lib/i18n/messages/account.ts`; tests `storefront/test/account/{order-detail-return-action,returns-new-returnable,i18n/orders-returns}.test.tsx`, `storefront/test/account/returns-organization-permissions.test.tsx` (new) | WP-14; **WP-09 merged** (it edits `account.ts`) | S |
| **WP-15** | Quick-order import by either target (OR-10) and the OR-9 Admin UI lock | `quick_order`: `src/backend/routes.ts` (the import's guard), `docs/quick_order.md`, `plpage(quick_order)`; tests `backend/test/contract/quick_order/quick-order-permissions.contract.test.ts`, `backend/test/integration/quick_order/off-state.test.ts`, `admin/test/modules/organizations/organization-roles-tab.test.tsx` (one create-form case) | WP-05, WP-06, WP-08 (merged) | S |

WP-14, WP-14b and WP-15 were added on 2026-11-04 by OR-9 to OR-11. Their file sets are disjoint from
WP-09's and WP-10's except `lib/i18n/messages/account.ts`, which is why WP-14b merges after WP-09; WP-15
is disjoint from WP-10 (WP-10 only renders the import by the rule WP-15 enforces, against mocked
APIs, so neither waits for the other).

### Wave 4 — close-out, serial

| WP | Title | Owns | Depends on | Size |
| --- | --- | --- | --- | --- |
| **WP-11** | Documentation EN + PL | `docs/docs/architecture/permissions.md` (organization permissions and the `organizationPermissions` field) and its PL page and pin; a final `check:docs-translations` sweep over every module page touched in Waves 1–3 (each WP already shipped its own PL page, A-2). No upgrade page (A-3) | Waves 1–3, **WP-14, WP-14b, WP-15** | S |
| **WP-12** | Legacy removal | contracts: delete `organizationRoleSchema`, `OrganizationRole`, `CustomerAccountRole`, `countByOrganizationRole`, `RfqCustomerContext.isOrgAdmin`, the cart-policy schemas, `requiresCartApproval` on the details record and the write port; `organizations`: delete `commands/set-cart-approval-policy.command.ts`, the `organizationCartApprovalWritePort` registration, `Organization.requiresCartApproval`, the field in `services/organization-details-port.ts`; the entities' `role` properties; migrations **M4** and **M5**, added to the replay's `down()`/`up()` lists in the same merge request (R-38); every remaining test file naming the enum (the incidental fixtures under *Test allocation*); the consumer changeset | WP-03 … WP-10, WP-14, WP-14b, WP-15 | M |
| **WP-13** | Upgrade replay close-out and performance | `roles-upgrade-replay.test.ts` (from WP-13a: the interim comparison removed, every §6.1 row asserted at `after`); `landed-work-packages.ts` (deleted) and the self-check's ledger clause (R-38); the SC-004 comparison on the cart, checkout and placement paths with the existing `backend/test/perf/carts/` harness | WP-12 | M |

Then the integration MR `feat/170-organization-roles` → `master`, with the complete suite run
locally (`pnpm --filter backend run test`) and `quickstart.md` walked through.

### Phase 3 — internal RFQ approval (OR-2), a separate release

| WP | Title | Owns | Depends on |
| --- | --- | --- | --- |
| **WP-P3a** | `quote_requests` backend | the `quote_requests.approve` and `quote_requests.send_without_approval` declarations; status `'Awaiting internal approval'` and its fields (data-model §8); submit, approve, reject and withdraw transitions with history kinds; seller-side invisibility in every admin list, count and read and in `organizations`' sales-rep counters; EN/PL e-mails to approvers and requester; visibility switched to `can(…, 'quote_requests.approve')` (FR-041); tests including FR-044's edit-withdraws rule | P1+P2 released |
| **WP-P3b** | Storefront approval queue | quote list filter for approvers, approve/reject UI, requester banners | WP-P3a |

P3 gets its own `/speckit.plan` refinement pass before `/speckit.tasks`; data-model §8 is its
starting point.

### Dependency graph and merge order

```text
#656 ──► WP-00 ──(master)──► cut feat/170-organization-roles
                                   │
                                   ▼
                                 WP-01 ──► WP-02a ──► WP-02b ──► WP-13a (replay; before 03, 04, 06)
                                                        │
        ┌───────────────┬────────────────┬──────────────┼──────────────┬───────────────┐
        ▼               ▼                ▼              ▼              ▼               ▼
      WP-03     WP-04 (#655, #656)     WP-05        WP-07 (#680)     WP-08         WP-09 / WP-10
        │               │                │                          (merges        (draft against
        │               └──► WP-06 ◄─────┘ (after WP-04, WP-05)      after WP-03)   the contracts)
        │                                                                              │
        └──────────────────────────────► WP-09 (after 02a, 03, 04) ◄───────────────────┤
                                         WP-10 (after 04, 05, 06)  ◄───────────────────┘
                                         WP-14 (after 07) ──► WP-14b (after 14 and 09)
                                         WP-15 (after 05, 06, 08)
                                                     │
                                                     ▼
                                    WP-11 ──► WP-12 ──► WP-13 ──► integration MR → master
```

**Merge order into the integration branch**: WP-01 → WP-02a → WP-02b → WP-13a (before WP-03, WP-04
and WP-06; WP-05 and WP-07 may precede it, R-38) → {WP-03, WP-04, WP-05, WP-07}, WP-05 after WP-04
(its convert-to-order is gated by `carts.create`) → WP-06 (after WP-04 and WP-05) → WP-08 (after WP-03) → WP-09 → WP-10, with
WP-14 and WP-15 in parallel to both and WP-14b after WP-09 and WP-14 → WP-11 → WP-12 → WP-13. **Maximum parallelism**: six agents in Wave 2 (WP-03, -04, -05, -06, -07, -08), with WP-09
and WP-10 drafting alongside.

## Test allocation (79 test files + 6 helpers, `d31bab44b`)

- **Subject tests** — their behaviour changes; each belongs to the package that changes the
  behaviour, as listed in the *Owns* columns (carts → WP-04; organizations members, invitations and
  session → WP-03; mfa → WP-03; orders → WP-07; quote requests → WP-05; quick order and lists →
  WP-06; storefront → WP-09/WP-10; customer_accounts → WP-02b; the cart-approval policy audit test
  → WP-12, deleted with the Command it tests).
- **Incidental fixtures** — they name the enum only to seed an account and keep passing through the
  transition thanks to the default trigger and the dual-write (R-23, R-28); **WP-12** converts them
  when the enum goes:
  `backend/test/contract/{api_keys/binding-validation,catalog/api-key-tenant-isolation,catalog/bulk-pricing-parity,inventory/cut-edges-fail-closed,orders/place-order-organization-method-allow-list}.test.ts`,
  `backend/test/integration/{comparisons/viewer-priced-share.integration,distributor_api/bound-key-tenant-isolation,inventory/availability-worker,kernel/production-boot,sales_channels/bidirectional-membership-every-bridge}.test.ts`,
  `backend/test/unit/{admin_users/cross-module-ports.unit,comparisons/cross-module-ports,comparisons/viewer-priced-columns}.test.ts`,
  `packages/modules/{pwa,search}/src/backend/**/cross-module-ports.test.ts`,
  `backend/test/integration/organizations/cart-approval-policy-audit.test.ts`, and every other file
  the inventory still finds then (54 test files name a literal enum value at `d31bab44b`).
- **Entity-created fixtures** — 84 files create an `Organization` and 50 a `CustomerAccount` through
  the entity manager, most without naming a role; the two triggers make them correct untouched
  (R-28), so they are nobody's work.
- **Shared helpers** (6) — WP-02b, once; Wave 2 adds fixtures in new files only.

## FR → work package → test

| FR | WP | Test (new unless noted) |
| --- | --- | --- |
| FR-001, FR-070 | 02a, 02b | M2/M3 integration: both rows per Organization, personal and suspended included; the insert trigger; every account and invitation mapped, deleted and blocked included; a personal Organization's account → *Administrator* (PR-3) |
| FR-070a | 02b, 03 | every path into a personal Organization assigns *Administrator*; personal-only surfaces gated by `isPersonal`; operator delete/block of a personal member not refused as depletion (PR-3) |
| FR-002, FR-003 | 02a | role-Command unit: administrator immutable; member not renamable or deletable; labels translated EN/PL |
| FR-004 | 02a | name rules (trim, case, predefined labels), 50-role limit, stale version |
| FR-004a | 02a, 08, 09, 15 | a custom role created with `[]` holds nothing (02a, existing); both create forms open unchecked with no copy control (09; 15 for the Admin UI, OR-9) |
| FR-005 | 02a, 02b | cross-tenant: another Organization's role id → 404 on every role and member route; the composite FK refuses |
| FR-006 | 02b | `not null` plus the default trigger; an invitation always names a role |
| FR-007, FR-025 | 02a | port unit: presence on both axes; absent grants kept across a save; unknown codes dropped |
| FR-008 | 03 | role label in the members list, account page, e-mail and operator screens |
| FR-010–FR-012 | 03 | reserved capabilities refuse a custom role holding every code |
| FR-010a | 03 (+02a count) | the invitations list and `pendingInvitationCount` exclude expired invitations (PR-7) |
| FR-014 | all | the WP-00 oracle replayed (FR-072) |
| FR-014a | 03 | address writes need `addresses.manage`; the list stays open |
| FR-020, FR-021 | 01 | permission-inventory organization describe: cross-vocabulary, foreign declarer, labels |
| FR-022 | 04–07, 02a, 14 | inventory: every P2 code declared and enforced (the two `returns` codes by 14, OR-11); the two P3 codes are declared by P3a (R-30) |
| FR-023 | 02a | *Member*'s implicit defaults; an un-ticked code never returns across off/on and uninstall/reinstall |
| FR-024, US 6 | 02b | delete with holders is atomic, one entry per child; a delete with no holders needs no replacement |
| FR-030a | 04, 03 (+01) | the sign-in merge is skipped for a member lacking `carts.create`; the login keeps the anonymous-cart cookie (PR-12) |
| FR-030–FR-035 | 04 | gates per route; a guest still adds to the guest basket (PR-4); approval judged by the permission; approvers; self-approval refused; cascade events; e-mail recipients |
| FR-030b | 15, 10 | import served to a holder of either code, refused naming `carts.create` to a holder of neither, before the parse; the build still judged by its target; an absent module's code admits nothing (OR-10) |
| FR-040 | 05 (+04, 06) | every creation path, from a cart (04) and from a list (06) included |
| FR-041 | 05, P3a | P2 form (05): only *Administrator* sees every quote request (R-30); permission form: P3a |
| FR-042–FR-046 | P3a | — |
| FR-047, FR-048 | 06 (+04) | list writes; composite conversions |
| FR-049 | 07, 14 | colleague order list, read, reorder, clone, returns and invoices only with the permission; otherwise 404 (the return start widened by 14, Q-R1 = A) |
| FR-052 | 14, 14b | submission refused without `returns.create` before the order is read; reads and follow-ups on one's own case open; the start action hidden |
| FR-053 | 14, 14b | the Organization's cases listed and read only with `returns.view_organization` (subtree for roll-up); a colleague's case read-only (Q-R2); its actions hidden |
| FR-054 | 14 | a return from a colleague's order with `returns.create` and `orders.view_organization`, filed in the starter's name (Q-R1) |
| FR-050, FR-051 | 06, 10 | eligibility reasons; placement refused before any basket write; button hidden |
| FR-055 | 01, 02a | envelope: 403 code and label, distinct from 401, 503 and 404 |
| FR-056–FR-058 | 03, 09, 10 | session views; storefront hides or disables; account page |
| FR-060–FR-062 | 02a, 03, 08 | operator codes in both inventory directions; `customers:manage` assigns |
| FR-065, FR-066 | 01, 02a, 02b, 03 | bus unit (child Commands, customer actor); one entry per Command against the Organization; a no-op records nothing |
| FR-071 | 02a, 13 | an approval-requiring Organization's *Member* lacks the two codes; carts' states unchanged |
| FR-072, FR-074 | 00, 13 | oracle and replay against the expected-differences table (PR-5, PR-6); a second run changes nothing |
| FR-073 | 01, 03 | every touched request refuses `role` (strict); no response carries it |
| FR-080–FR-082 | 02a, 13 | cache: no read on the hot path; immediate in the writing process; a lost announcement ≤ 30 s; perf p95 |

## Risks

| Risk | Likelihood / impact | Mitigation |
| --- | --- | --- |
| The integration branch drifts from `master` for two to three weeks; generated artefacts and the lockfile conflict | high / medium | a daily `master` merge; regenerate, never hand-merge; generated-artefact changes are concentrated in Waves 1 and 4 |
| A role check in a spelling the inventory regex misses (`quick_order`'s preference actor `kind: 'org_admin'`, a `role ===` comparison on a renamed variable) | medium / high | WP-12's final inventory plus the WP-00 oracle replayed end to end; reviewers also grep `org_admin` and `role ===` |
| Child Commands or the customer-actor column destabilise the bus for every module | low / high | WP-01 lands them first with unit tests on the bus itself; both are additive (`ctx.run` unused until WP-02b) |
| The default trigger hides a production path that forgets to pass a role id | low / medium | the write port's input requires the id; WP-02b asserts every production path passes it; the trigger is documented as the entity default's equivalent |
| The cache serves a revoked grant beyond 30 s | low / high | the LRU age bound is independent of pub/sub; tests with the subscriber disabled (R-16) |
| D-198: contract and integration suites do not run on merge requests into the integration branch either | high / medium | each WP pastes its local targeted run; the integration MR requires a full local `pnpm --filter backend run test` |
| #656 slips (#655 and #680 merged, A-4) | medium / medium | only WP-00 and WP-04 wait; everything else proceeds |
| Storefront work waits on design | medium / low | WP-09 and WP-10 implement against R-12's outline with the designer reviewing; the APIs do not wait |
| Recorded read sizes move because file counts change | high / low | left alone inside the band; re-record only an entry the band refuses, by re-measuring (`specs/conventions/check-estate.md`) |

## Constitution Check — post-design re-evaluation

Re-checked after research R-14–R-33 and the contracts. What the design added since the
pre-research check, and why each verdict stands:

- **I** — the one new acknowledged edge (`customerAccountRoleCommandPort`) sits inside the existing
  `organizations` ↔ `customer_accounts` mutual pair, which the manifest already records for five
  ports; each trigger fires on its owner's own table, and M3's trigger function reads
  `organization_roles`, an R1 read covered by the declared dependency. PASS.
- **XI** — the composite FKs and the triggers keep every role reference inside its Organization at
  the database level, independently of the filter. PASS.
- **XIII** — the two platform extensions (R-21, R-22) are what make the PASS real rather than
  nominal: without them a storefront administrator's change would be unattributed and a deletion
  would need a hand-written audit call. Both keep the bus thin — no CQRS, no queue, one entry per
  Command. PASS.
- **XVII** — no module joins the non-deactivatable set; presence is read per call; grants are
  retained across off/on. PASS.

- **OR-9 to OR-11 (2026-11-04)** — **I**: `returns` declares and enforces its own two codes (FR-020),
  reaches `organizations` through `lazyPort` after adding the declared dependency (onto a
  non-deactivatable module), and judges a colleague's order through `orders`' published
  `orderReadPort.findByIdForCustomer` rather than restating the order-scope rule; `quick_order`'s
  either-of guard is module-local. **II**: the one shape change (`ReturnCaseSummary.customerAccountId`,
  additive) is in `packages/contracts` first (T147); no new error code. **XI**: the returns widening
  rides the always-on tenant filter on the `@OrgScoped` `ReturnCase`, out of reach is `404`, roll-up
  never adds a permission (T144). **XIII**: no new write — the submission keeps its existing audit
  path, and no role or assignment write changes. **XVII**: `returns` is switchable and its codes leave
  the catalogue while it is off, grants retained (T146); `quick_order`'s import is judged against
  presence like every other code (T139). No new dependency, no migration, no Setting. PASS.

**Verdict: PASS — no violation, no unjustified complexity; Complexity Tracking is empty.**

## Complexity Tracking

> No entries. No Constitution violation needs justification and no new runtime dependency is
> added. The two platform extensions (R-21, R-22) and the two database triggers (R-28) are design
> decisions recorded with their rejected alternatives in `research.md`, not violations.

## Handoff to `endora-commerce-dev`

- Start **WP-00 on `master`** as soon as #656 merges; nothing else starts before it is on `master`,
  because the oracle must be recorded by today's code.
- Then cut `feat/170-organization-roles` and run Wave 1 **serially** (WP-01 → WP-02a → WP-02b).
- Wave 2 runs up to six agents in parallel on the file sets above; respect the two merge-after
  constraints (WP-13a before WP-03, WP-04 and WP-06; WP-06 after WP-04 and WP-05; WP-08 after
  WP-03) and the one open-PR gate (#656 for WP-00 and
  WP-04; #655 and #680 are merged).
- Every package: a red test first for its FRs; `lazyPort` with a literal name; guards as
  `preHandler`s after `requireCustomer`; no bare `catch` around the port; the legacy read removed in
  the same change; dual-write until WP-12; the inventory over the owned files; the local targeted
  contract and integration runs pasted in the MR.
- WP-13a puts the upgrade replay on the integration branch before the first behavioural merge and
  retires the live oracle test (R-38): from then on each landing package (WP-03, WP-04, WP-06) flips
  its own entry of the landing ledger and every package pastes the replay's local run in its MR.
- WP-12 and WP-13 close the branch; the integration MR carries the full local suite run and a
  walk-through of `quickstart.md`. The replay asserts the oracle **plus** the expected-differences
  table of `contracts/migration-and-replay.md` §6.1 (PR-5) — a row outside that table that differs is a
  defect to fix in its module, and a row inside it that does not match its `after` is a question for
  the owner, never an edit of either table.
- The oracle rulings land in named packages: PR-3 in WP-02b (T117, T118), WP-03 (T119, T120) and
  WP-09 (T097/T098, the `isPersonal` nav gate); PR-4 in WP-01 (the guard's `guests` option,
  T007/T013) and WP-04 (T121, T073); PR-12 in WP-01 (T015, the outcome value), WP-04 (T126, T127)
  and WP-03 (T128, T129); PR-7 in WP-03 (T122, T123); PR-5 and PR-6 in WP-13a (T124,
  T125, T130–T133) and WP-13 (T112).
- Never assign a migration number: scaffold with `migration:new` and commit the regenerated
  registries (`contracts/migration-and-replay.md` §1).
- **The 2026-11-04 rulings (OR-9 to OR-11)** land in: WP-09 (T097/T098 amended, the empty create
  form), WP-10 (T100/T101 amended, the import's visibility), **WP-15** (T139–T142, the import's guard
  and the Admin UI lock), **WP-14** (T143–T149, returns backend) and **WP-14b** (T150–T152, returns
  storefront). None adds a migration or an error code, and none moves an oracle row (§6.3). The owner
  answered Q-R1 = A, Q-R2 = A and accepted Q-R3, so every one of them may start now.
