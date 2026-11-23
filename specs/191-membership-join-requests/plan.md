# Implementation Plan: Membership moves and join requests on an existing tax ID

**Branch**: `spec/191-membership-join-requests` (design); implementation on `feat/191-membership-join-requests`
| **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md) | **Ruling**: **D-298**
**Input**: `specs/191-membership-join-requests/spec.md` (issues #1831, #1832; owner decisions of
2026-11-23).
**Companions**: [research.md](./research.md) (R-1 – R-26), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md), [tasks.md](./tasks.md).
**Siblings (parallel, cited by slug)**: `specs/186-aggregate-ports/` (D-293),
`specs/187-side-table-extensions/` (D-294), `specs/188-policy-points/` (D-295),
`specs/189-command-middleware/` (D-296), `specs/190-overlay-full-modules/` (D-297).

## Summary

**Part 1 (#1831).** `customer_accounts` publishes `membershipPort`, whose operations run one
Command, `customer_account.organization.change` — hookable (`beforeCommit` veto, `afterCommit`
outbox), audited by name, announcing `customer_account.organization_changed.v1` (ids only) after
commit, with the ambient actor (`automation` when no operator, D-293). It defaults the role to the
target's *Member*, refuses stranding a company without an administrator, revokes no session and
moves no tenant data. The operator's assign/unassign and the deprecated lifecycle methods run
through it.

**Part 2 (#1832, OD-8).** On an existing tax ID, `organizations`' registration asks the policy
point `organizations.registrationConflict` (`chain`, default participant = the setting, default
`refuse`). Under `join_request` one Command creates the registrant's personal Organization, their
ordinary account and an `organization_join_requests` row; once the e-mail address is confirmed the
request is routed (company administrators by default, else the operator) and decided — approval is
a child run of the membership Command. Withdraw, expiry (BullMQ sweep), a daily limit per target,
one open request per account, notices from the outbox, a storefront account notice and company
tab, an Admin UI queue with permissions and a palette action, pl + en throughout.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: Fastify, MikroORM **7.2.11** (after #1866: legacy decorators from
`@mikro-orm/decorators/legacy`, no `persistAndFlush`, kysely instead of knex), Zod, BullMQ,
ioredis — all existing; **no new dependency** (R-24)
**Storage**: PostgreSQL — one table `organization_join_requests` (organizations); no column added
elsewhere
**Testing**: Vitest — co-located module tests, `backend/test/{contract,integration}`, admin and
storefront suites; `@endora-commerce/test-kit` (`audit`, `command-hooks`) and 188's policy
conformance helper
**Target Platform**: the backend API and worker processes, the admin SPA, the reference storefront
**Project Type**: monorepo web platform (modules in `packages/modules/`)
**Performance Goals**: registration adds at most one settings read and one indexed count on the
join path; the refuse path costs what it does today
**Constraints**: no change of behaviour with default settings (SC-001); no disclosure of the target
in any registrant reply (SC-006)
**Scale/Scope**: requests are low-volume (bounded by the daily limit per target)

## Constitution Check

*Gate before Phase 0, re-checked after Phase 1 — both pass.*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | ✅ | Two ports, one owner each (R-1); `organizations` reaches `membershipPort` and `customerAccountReadPort` through acknowledged mutual edges beside the existing `customer_accounts` ones; no cross-module import; a module-local copy of the store-day helper rather than an import of `related_payers` (R-15) |
| II API-first | ✅ | Every shape in `packages/contracts/` first (WP-0); the registration reply change is additive for every store on the default policy (R-16) |
| III TDD (NN) | ✅ | `tasks.md` puts a failing test before every implementation task; every FR maps to a test (tasks § Traceability) |
| IV YAGNI / deps | ✅ | No new dependency; no new module (R-8); no branch placement on approval (A-6); no account-area "ask to join" screen (A-7) |
| V TypeScript | ✅ | — |
| VI Naming (NN) | ✅ | `organization_join_requests`, `organization_id`, `customer_account_id`; kebab-case paths; camelCase JSON (R-25) |
| VII SEO/perf | ✅ | Storefront pages stay Server Components; no new public crawlable surface |
| VIII English (NN) | ✅ | Artefacts in English; pl only in bundles |
| IX UI reuse | ✅ | admin-kit primitives; storefront follows `Payers.tsx` / `RejectPayerRequestButton.tsx` |
| X Queues | ✅ | Expiry as a BullMQ repeatable sweep via `ctx.worker` (R-18) |
| XI Tenancy (NN) | ✅ | `@OrgScoped` on the target; registrant reads through one greppable `withSystemScope` constrained by their own account id; operator reach; out-of-scope = 404; no-organization path impossible (the registrant always has their personal Organization, D-178) (R-13) |
| XII Channels (NN) | ✅ | The channel is recorded for notices and is an input of the policy point; no channel-scoped content read; Q1-B, if chosen, reads the channel's B2C setting through its owner |
| XIII Command Bus (NN) | ✅ | Every write is a Command: the move, seven join-request actions, the anonymisation erase; `#writeOrganization`'s hand-written audit deleted in the same change; actor from context only (R-3); notices from the outbox (R-17) |
| XIV Extensibility | ✅ | The registrant's custom-field values are stored on the account as on every registration; extension input reaches hooks via `extensions` |
| XV Untouched core | ✅ | A deployment customises through a policy participant and command hooks, not edits (SC-007) |
| XVI Palette | ✅ | `open-organization-join-requests`, sidebar destination covered |
| XVII Toggleable (NN) | ✅ | `organizations` and `customer_accounts` are non-deactivatable; the capability's off switch is the policy `refuse` (also the default); optional neighbours (`admin_notifications`, `customer_notifications`) are non-binding and degrade to no notice; a contributed policy participant of a switched-off module is skipped |

**Verdict: PASS.** No violation to justify; Complexity Tracking is empty.

## Ruling D-298

**D-298 (owner, 2026-11-23)** — recorded here by the architect, numbered above the floor of
`specs/pre-migration-history/README.md` (D-283) and the highest ruling the sibling specs claim
(D-297).

1. **OD-8 variant.** Registration on an existing tax ID under the `join-request` policy creates the
   account in the registrant's personal Organization (D-178) with ordinary sign-in, plus an
   `organization_join_requests` row. No password on the request; no new account state.
2. **Approval** moves the account into the company with a role through the membership Command
   (#1831); **rejection** leaves it in the personal Organization.
3. **The conflict policy** (`refuse` default | `join-request`) is a setting that is the default
   participant of the declared policy point `organizations.registrationConflict`, combiner `chain`
   (`specs/188-policy-points/`, #1839).
4. **Case 5** (moving an account to a branch) is covered by #1831 and delivered with OD-8.
5. **Sessions** are not invalidated by a move; the actor is `automation` when no administrator
   acts.
6. **Aggregate ports** `organizationCommandPort` (#1821) and `customerAccountCommandPort` (#1822)
   come from `specs/186-aggregate-ports/` (D-293); this feature depends on them and redefines
   neither. Tax-ID scope modes (D-290) are used as they are.
7. **Delivery** in release 0.113.0, after the MikroORM 7 switch (#1073 → #1866) for any entity
   work.

**Architect decisions under D-298** (owner may overturn; research numbers): two ports, two owners
(R-1); one hookable action for move and detach (R-2); last-administrator guard in the Command
(R-5); join requests in `organizations`, no new module (R-8); e-mail confirmation before routing
(R-11); routing captured once, operator may always decide (R-12); `202` discriminated reply (R-16);
event and setting names in the module's existing families (R-25).

## Owner questions

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| **OQ-1** (= spec Q1) | On a channel with private registration closed, may a pending or rejected registrant buy privately from the personal Organization the join path created? | **B** — create that personal Organization not yet active (existing status), activated only by an operator; R-26 | WP-3 (one parameter); everything else proceeds |
| OQ-2 | Confirm: a request reaches deciders only after e-mail confirmation (A-4, R-11) | Yes — impersonation risk otherwise | nothing (built as recommended) |
| OQ-3 | Confirm: no account-area "ask to join" for existing private customers in this feature (A-7) | Yes — the port supports it; a follow-up issue | nothing |
| OQ-4 | Confirm defaults: expiry 14 days, 20 requests per target per day, deciders = company administrators | Yes | nothing |
| OQ-5 | Should approval be able to place the person directly in a branch of the target? (A-6) | Not now — a move afterwards does it | nothing |

## Project Structure

### Documentation (this feature)

```text
specs/191-membership-join-requests/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── checklists/requirements.md
└── contracts/
    ├── membership-port.md               # #1831
    ├── join-requests.md                 # Commands, port, hooks, events, errors, notices, worker
    ├── registration-conflict-policy.md  # the policy point
    ├── storefront-api.md                # registration reply, registrant, company administrators, pages
    └── admin-api.md                     # permissions, routes, queue, palette
```

### Source code (affected)

```text
packages/contracts/src/
├── customer-accounts.ts            # Membership* types, MembershipPort; PreparedCustomerAccountCreate.customerAccountId; deprecations
├── customer-account-hooks.ts       # NEW — CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS, organization_changed.v1
├── organization-hooks.ts           # + six join-request refs
├── organization-join-requests.ts   # NEW — views, request bodies, policy schemas, port
├── organizations.ts                # register request/response union; registration options flag
└── errors.ts                       # five codes

packages/modules/customer_accounts/
├── src/manifest.ts                 # hookableActions
├── src/backend/commands/customer-account-change-organization.command.ts   # NEW
├── src/backend/services/membership-port.ts                                # NEW
├── src/backend/services/customer-account-lifecycle-ports.ts               # delegate, delete #writeOrganization
├── src/backend/services/customer-account-audit-state.ts                   # mode, source in keys
└── src/backend/index.ts            # providePort('membershipPort')

packages/modules/customers/src/backend/services/customer-org-assignment-service.ts   # via membershipPort

packages/modules/organizations/
├── src/manifest.ts                 # settings, permissions, action, policy point, hookable actions, errors, templates, acknowledged edge
├── src/migrations/<timestamp>_organizations_join_requests.ts                    # NEW (migration:new)
├── src/backend/entities/organization-join-request.entity.ts                     # NEW
├── src/backend/commands/join-request-*.command.ts                               # NEW (7)
├── src/backend/services/{join-request-service,join-request-routing,join-request-daily-limit,
│                         join-request-notifications,join-request-port,registration-conflict-policy}.ts   # NEW
├── src/backend/services/registration-service.ts         # policy + join branch
├── src/backend/services/email-verification-service.ts   # personal status untouched; submit
├── src/backend/services/personal-organization-service.ts  # optional status (only if OQ-1 = B)
├── src/backend/workers/join-request-expiry-sweep-worker.ts                      # NEW
├── src/backend/routes.public.ts · routes.customer.ts · routes.members.ts · routes.admin-join-requests.ts (NEW)
├── src/backend/email-templates/join-request-defaults.ts                         # NEW
├── src/backend/index.ts            # wiring, ctx.commandHooks, ctx.subscribe, ctx.worker, providePort
├── src/admin/{pages/OrganizationJoinRequestsPage.tsx, lib/labels.ts, api/join-requests.ts, index.ts}
├── i18n/{en,pl}.json
└── docs/organizations.md (+ section) · docs/organization-join-requests.md (NEW)

storefront/
├── app/(auth)/register/{page.tsx,actions.ts}
├── app/(account)/account/ (JoinRequestNotice) · app/(account)/organization/members/ (tab)
├── components/account/{JoinRequestNotice.tsx, JoinRequestsTab.tsx, DecideJoinRequestDialog.tsx}
├── lib/api/join-requests.ts
└── messages (en, pl)

backend/test/
├── unit/db/acknowledged-fk-edges.ts             # organization_join_requests → customer_accounts
├── contract/organizations/join-requests*.contract.test.ts
└── integration/{customer_accounts/membership-worker-move,organizations/join-request-flow}.test.ts
```

**Structure decision**: extend `customer_accounts` (the move) and `organizations` (the requests);
no new package or module (R-1, R-8).

## Delivery and implementation order

Release **0.113.0**. Preconditions: #1866 (MikroORM 7) merged for any entity task; 186 merged for
the actor kind and the aggregate ports; 188 merged for WP-3's point (else its interim, R-9).

| WP | Content | Depends on | Merge request |
| --- | --- | --- | --- |
| WP-0 | Contracts: types, schemas, refs, error codes, deprecations (types only) | — | 1 (can land before #1866) |
| WP-1 | #1831: Command, `membershipPort`, lifecycle delegation, `customers` adoption, last-admin guard | WP-0, 186 (actor kind) | 2 |
| WP-2 | Entity, migration, seven Commands, port, routing, limits, subscribers, worker | WP-1, #1866 | 3 |
| WP-3 | Registration: policy point (or interim), join branch, `202` reply, verification → submit, registration options flag | WP-2, 188 | 4 |
| WP-4 | Notifications: templates, outbox hooks, admin bell, notification centre | WP-3 | 4 (same MR) |
| WP-5 | Storefront API (registrant, company administrators) + reference storefront pages | WP-3 | 5 |
| WP-6 | Admin API, queue page, permissions, palette, sidebar, labels | WP-2 | 5 or 6 |
| WP-7 | Docs (en + pl), changesets, `composer:generate` / `manifests:generate`, full suite | all | each MR carries its own; WP-7 closes |

WP-1 ships value alone (case 5, the ERP move). WP-2 + WP-3 + WP-4 is the smallest join-request
slice that is safe to switch on; WP-5 and WP-6 can be parallel after it.

## Test strategy (failing test first in every step)

- **Audit**: a sentinel test per Command (`expectNoAuditValues`) seeding the note, typed name,
  reason, e-mail and a fresh Organization id; `<MODULE>_AUDIT_KEYS` subset assertions.
- **Hooks**: `expectHookableCommand` for every declared ref; a `beforeCommit` veto writes nothing,
  emits nothing; outbox rows carry list-1 values only.
- **Tenancy**: cross-tenant tests for every read and decide route (404 indistinguishable); the
  registrant hatch constrained to their own id.
- **Concurrency**: two approvals racing (one 409); two registrations racing past the daily limit
  (never limit + 1); unique open request.
- **Policy**: 188's conformance helper; default `refuse` on a fresh store; fail-closed cases.
- **Integration**: the worker move (SC-004); the full join flow registration → confirm → approve →
  next request scoped to the company (SC-002).
- **Off-state / presence**: `admin_notifications` and `customer_notifications` absent → no notice,
  no failure; a contributed participant of a switched-off module is skipped.
- **Frontends**: register page states, account notice, company tab, admin queue (pl labels).

## Checks the merge requests must pass

`pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter backend run test:unit:fast`, targeted
contract/integration files, `pnpm --filter '!backend' run test`, `check:port-dependencies`,
`check:port-catches`, `check:port-shape`, `check:module-boundary`, `check:subscribe-seam`,
`check:entry-presence`, `check:action-route-permissions`, `check:custom-field-writes` (the register
body changed), `check:error-translations`, `i18n:hardcoded`, `registered-bundles-shape.test.ts`,
`permission-inventory.test.ts`, `palette-coverage.test.ts`, `harness-parity.test.ts`,
`composer:check`, `check:naming`, `check:language`, the tenancy classification check, and
`pnpm install --lockfile-only` after `manifests:generate`. The complete backend suite is dispatched
before the release (D-198: it does not run on a pull request).

## Risks

| Risk | Mitigation |
| --- | --- |
| 186 slips (no `automation` actor kind) | Background moves record `system` with the scope reason; switch when 186 lands (one line in the actor resolution, tested) |
| 188 slips | Interim `decideRegistrationConflict` (R-9) behind the same schemas; the setting ships either way |
| #1866 changes entity or raw-SQL idioms after this plan | WP-2 starts from the post-#1866 tree; data-model is idiom-neutral |
| The registration reply change surprises an instance storefront | Only under a non-default policy; changeset body names the union and the `202`; docs upgrade note |
| A deployment hooked `organization.register` expecting every registration | Documented: the join path is `organization.join_request.create` (R-10) |
| Spam to company administrators | E-mail confirmation first, daily limit per target, one open request per account, expiry |
| `verify` behaviour change for personal Organizations | Only personal Organizations change (they were `active` already); a test pins company behaviour unchanged |
| The ledger/derived-artefact trap (AGENTS.md) | WP-7 re-runs `composer:generate`, `manifests:generate`, the FK ledger and the module-removal ledger in the same MR |

## Complexity Tracking

Empty — no constitution violation, no new runtime, dev or workspace dependency (R-24).

## Agent context

`.specify/scripts/bash/update-agent-context.sh` was **not** run for this design-only change, on the
orchestrator's instruction: the plan declares no new dependency, so it would only add the slug to
*Recent Changes*. Run it in the implementation merge request if wanted.

## Handoff to `endora-commerce-dev`

1. Start after #1866 and 186 are on `master`; check 188 — if absent, take R-9's interim.
2. Work strictly in `tasks.md` order; each task's failing test first.
3. Read before writing: `specs/conventions/module-composition.md` (ports, `lazyPort` literals,
   acknowledged edges), `audit-state.md` (the sentinel obligation), `module-admin-surfaces.md`
   (permissions, palette), `module-i18n.md` (flat bundles, en + pl), `module-migrations.md`
   (`migration:new`), `custom-field-writes.md` (the register body changed).
4. Precedents to copy, not import: `related_payers`' routing, daily limit, expiry worker and
   `ctx.commandHooks` notices; `organization.register`'s child-Command construction.
5. OQ-1 is the only open decision; build `provisionFor`'s `status` parameter only when it is answered B.
6. Do not run `update-agent-context.sh` unless asked; regenerate and commit generated artefacts in
   the same MR; never `git stash` in a shared worktree.
