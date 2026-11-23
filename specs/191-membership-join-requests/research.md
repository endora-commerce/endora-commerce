# Research: Membership moves and join requests on an existing tax ID

Decisions for `specs/191-membership-join-requests/`. Each is **decision → rationale → alternatives
rejected**. Numbers are stable; cite them as `191 R-n`. Code paths are as of `origin/master`
`657917d35` (2026-11-23).

## What the code does today (grounding)

| Fact | Where |
| --- | --- |
| The move is `#writeOrganization`: load, assign `organizationId` + `organizationRoleId` in one statement (composite FK), `em.flush()`, then a hand-written audit row — no Command, no hooks, no outbox, no event | `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts` (`setOrganization`, `detachToPersonalOrganization`, `#writeOrganization`) |
| `actorAdminUserId` is a required **input** of the move (`CustomerAccountOrganizationMoveInput`) | `packages/contracts/src/customer-accounts.ts` |
| The only callers are the operator's *assign* / *unassign*, with their authority check, the administrator-travels role rule and the last-administrator guard | `packages/modules/customers/src/backend/services/customer-org-assignment-service.ts` |
| Sessions hold no Organization | `packages/modules/auth/src/backend/entities/session.entity.ts` |
| The role cache is keyed by Organization and never holds an assignment; the member's role id is read fresh per request | `packages/modules/organizations/src/backend/services/organization-role-cache.ts` (header, R-15 of spec 170) |
| The last-administrator rule, under a `for update` lock on the holders | `packages/modules/customer_accounts/src/backend/commands/customer-account-role-rules.ts` (`refuseLosingLastAdministrator`) |
| Registration refuses an existing tax ID twice: the pre-check outside the transaction and again inside `organization.register` | `packages/modules/organizations/src/backend/services/registration-service.ts`, `commands/register-organization.command.ts` |
| One tax-ID lookup answers `none` / `one` (the root first) / `ambiguous` | `packages/modules/organizations/src/backend/services/tax-id-lookup-service.ts` |
| Personal Organization provisioning on the caller's transaction | `PersonalOrganizationService.provisionFor(em, …)` in `packages/modules/organizations/src/backend/services/personal-organization-service.ts` |
| The account-creation child Command | `customerAccountMemberCommandPort.prepareCreate` → `command({ organizationId, organizationRoleId })` (`packages/contracts/src/customer-accounts.ts`) |
| E-mail confirmation tokens are `organizations`' entity; `verify` stamps the account then sets the Organization `active` unconditionally | `packages/modules/organizations/src/backend/services/email-verification-service.ts` |
| A non-active Organization cannot add to a basket | `assertOrganizationCanTransact` in `packages/modules/carts/src/backend/routes.ts` |
| Member management on the storefront is the reserved *Administrator* capability | `packages/modules/organizations/src/backend/routes.members.ts` (header) |
| The request/approve/expire precedent: routing captured on the request, store-day limit, expiry sweep worker, notices from the module's own `afterCommit` hooks | `packages/modules/related_payers/src/backend/services/{request-routing,daily-limit,request-expiry,request-notifications}.ts`, `workers/request-expiry-sweep-worker.ts`, `index.ts` (`ctx.commandHooks`) |
| The storefront reads `GET /api/v1/organizations/registration-options`, revalidated on `settings.value_changed` | `storefront/lib/api/registry-lookup.ts`, `packages/modules/organizations/src/backend/index.ts` (`registrationOptionsRevalidation`) |

## R-1 — Two published interfaces, one owner each

**Decision.** `membershipPort` is owned by `customer_accounts` and carries the move
(`changeOrganization`, `detachToPersonal`, and the same move as a child-Command factory
`changeCommand`). `organizationJoinRequestPort` is owned by `organizations` and carries the join
requests (`requestToJoin`, `approve`, `reject`, `withdraw`, `findOpenForAccount`).

**Rationale.** The membership column is `customer_accounts`' (#1831 names it the owner); the
registration policy, the tax-ID lookup, the target's roles and the request table are
`organizations'`. `ctx.di.providePort` claims a container name for one module
(`DuplicateRegistrationError`), so a single `membershipPort` carrying both halves would have to
be served by one of them proxying the other — an invisible second owner.

**Rejected.** *One `membershipPort` with the join methods (#1832's wording)* — two owners for one
name, or a proxy that hides a cross-module write behind the wrong owner's gate. *Join requests in
`customer_accounts`* — that module would have to own the tax-ID conflict policy and the
registration flow, both `organizations'` today. *A new `organization_join_requests` module* — R-8.

## R-2 — One hookable action for both moves: `customer_account.organization.change`

**Decision.** Move and detach are one Command action, `customer_account.organization.change`,
object type `customer_account`, declared hookable with `beforeCommit` and `afterCommit`. Its
hook data and outbox data carry `mode: 'move' | 'detach_to_personal'`. The audit action of new
rows is therefore `customer_account.organization.change`; rows written before keep
`customer_account.organization_assigned` / `_unassigned` (audit-state O-4: history is not
rewritten).

**Rationale.** A deployment veto such as "only within one tree" or "never out of company X" must
hold for every way the account leaves an Organization. Two actions are two registrations a hook
author must remember; forgetting one is a bypass. `mode` keeps the distinction for readers.

**Rejected.** *Keep the two legacy verbs as two actions* — the bypass above. *A third verb for
join approval* — approval is a move; its origin is `source: 'join_request'` (R-7), and the
approval itself is `organization.join_request.approve`, whose child the move is.

## R-3 — The actor is the ambient one; automation when no operator

**Decision.** The new port's inputs carry **no actor**. The bus derives it from the TenantContext
(Principle XIII): an administrator in an admin request, the customer for a storefront company
administrator (`actorCustomerAccountId`), and the `automation` kind
`specs/186-aggregate-ports/` (D-293) adds for work entered with `enterSystemScope` /
`withSystemScope(reason)` with no administrator. The deprecated lifecycle methods keep their
signature for one release (OD-4) and **ignore** `actorAdminUserId` beyond asserting, in
development builds, that it equals the ambient actor.

**Rationale.** An actor taken from an input is what XIII forbids; it is also why a worker could
not call the move at all (#1831).

**Rejected.** *Keep `actorAdminUserId` optional* — still an input-supplied actor. *Record the
system kind* — indistinguishable from platform maintenance; D-293 exists to tell them apart (if
186 slips, `system` is the interim value, plan § Risks).

## R-4 — Role: the target's *Member* by default, any role of the target when named

**Decision.** `organizationRoleId` is optional on `changeOrganization`; absent, the Command reads
`organizationRoleReadPort.predefinedRoleId(target, 'member')`. A named role is looked up with
`findRole(target, id)`; a miss is `404 NOT_FOUND` (another Organization's role is not
distinguishable from a missing one — spec 170 FR-005). `detachToPersonal` always writes the
personal Organization's *Administrator* (owner ruling PR-3 of spec 170). The operator's *assign*
keeps its own rule (*Administrator* travels from a company, else *Member* — spec 170 PR-11) by
passing the role explicitly; that rule stays `customers'` policy.

**Rejected.** *Move the administrator-travels rule into the Command* — it is one screen's policy,
and an ERP import must be able to say exactly which role it wants.

## R-5 — The last-administrator guard moves into the Command

**Decision.** The Command refuses moving the last active *Administrator* out of a **company**
(`409 ORG_OWNER_DEPLETION`, the code the operator path already answers), counted with
`refuseLosingLastAdministrator` under its holder lock. Leaving a **personal** Organization is never
refused: it stays, dormant, as D-178 intends. `CustomerOrgAssignmentService.unassign` drops its own
pre-check in the same change, so the rule has one statement.

**Rationale.** Today only *unassign* checks it; *assign* can strand a company (it moves a company
administrator elsewhere unchecked), and a port open to workers must not depend on the caller
remembering. The lock is what makes it hold under concurrent moves (spec 170 R-29).

**Rejected.** *Keep the guard in `customers`* — an ERP import does not pass through `customers`.

## R-6 — What a move does not touch

**Decision.** Nothing scoped to the Organization the account leaves is moved: baskets, shopping
lists, quote requests, orders, returns, addresses, approvals in flight stay with that
Organization, as its records. Customer-scoped records (preferences, notifications) follow the
account. No session is revoked and no cache is dropped: sessions hold no Organization, the role
cache never holds an assignment, and the account's Organization and role are read per request.
The reference storefront re-reads the account context per request; WP-5 adds a test proving no
page caches the account context (`/me` and what the account menu renders from it) across requests. No client-side
refresh is needed: the moved person never performs the move themselves, so their next navigation
is the first request after it.

**Rejected.** *Carry the open basket over* — owner precedent #169 ("never touch the active
basket"); the basket is priced and approved under the old Organization's rules. *Revoke sessions*
— nothing in a session is stale (OR-5).

## R-7 — The announcement: an event for listeners, an outbox for hooks

**Decision.** The Command declares `event: customer_account.organization_changed.v1` with
`{ customerAccountId, fromOrganizationId, toOrganizationId, organizationRoleId, mode, source }`,
dispatched once after commit by the bus. The `afterCommit` outbox data is the same ids plus `mode`
and `source` (list-1 values: ids and codes). `source` is a code, `^[a-z][a-z0-9_.]{0,63}$`; core
writes `operator`, `join_request`, `integration`; a deployment may write its own code.

**Rationale.** Ids and codes only (#1831), so the event can reach webhooks without becoming a
disclosure. One move, one event, whether it came from a person, a worker or an approval.

**Rejected.** *Names in the payload* — personal and tenant values on a bus every module reads.

## R-8 — Join requests belong to `organizations`; no new module

**Decision.** The request table, its Commands, routes, worker, settings, permissions and screens
are `organizations'`.

**Rationale.** The decision point sits inside `organizations'` registration; the target, its
roles, its administrators and the tax-ID scope are `organizations'`; the e-mail confirmation tokens
are `organizations'`. `organizations` is non-deactivatable, so the capability's off switch is the
policy `refuse`, which is also its default — the operator-facing equivalent of Principle XVII's
activation, without a module whose every edge would be mutual with its only host.

**Rejected.** *A toggleable `organization_join_requests` module* — it would resolve
`organizations'` registration internals through a port that exists for it alone, `organizations`
would have to ask it whether to refuse (a second mutual edge), and switching it off would mean
exactly what `refuse` means. Principle I prefers extending the owner.

## R-9 — The conflict policy is a declared policy point with a `chain` combiner

**Decision.** `organizations` declares the policy point `organizations.registrationConflict`
(`specs/188-policy-points/`, D-295) in its manifest:

- **input** (Zod, `RegistrationConflictInputSchema`): `{ salesChannelId: uuid | null,
  taxIdScope: 'global' | 'per-tree-root', match: 'one' | 'ambiguous', target: { organizationId,
  isRoot, status } | null }` — no tax ID value, no name;
- **verdict** (`RegistrationConflictVerdictSchema`): `{ decision: 'refuse' | 'join_request' }`;
- **default participant** (innermost): reads `organizations.registration.conflict_policy`
  (`refuse` | `join_request`, default `refuse`) through `settingsReadPort`;
- **combiner** `chain`; a deployment participant is ordered by module `dependencies` and receives
  `(input, previous)`;
- **failure** `fail-closed` = `refuse`; the owner then validates: `match: 'ambiguous'` or
  `target: null` forces `refuse` whatever the chain answered.

**Rationale.** OR-3 and #1839 name exactly this point and combiner. The input carries what a rule
can reasonably branch on and nothing a rule should not see.

**Interim if 188 is late.** `RegistrationService` calls a module-local
`decideRegistrationConflict(input)` that is the default participant plus the owner's validation,
behind the same schemas, so adopting the point is a registration change, not a rewrite. The
setting and the behaviour ship either way.

**Rejected.** *A setting with more values* — covers only what core foresaw (#1839). *A command
hook veto on `organization.register`* — a hook can refuse a write; it cannot turn a refusal into a
different write.

## R-10 — The join path is one Command with the account and the personal Organization as children

**Decision.** Registration on the join path runs `organization.join_request.create` (origin
`registration`). Its `run`, on one transaction:

1. re-resolves the tax ID on its transaction and checks it still names the same target (the race
   is answered below);
2. counts the target's requests for the store day under a `for update` lock on the target's
   Organization row (R-15) and refuses at the limit;
3. provisions the personal Organization with `PersonalOrganizationService.provisionFor(em, …)`
   for the **pre-assigned** account id;
4. runs the `customer_account.create` child (`ctx.run`) into that Organization with its
   *Administrator* role;
5. writes the request (`awaiting_email_confirmation`) and the e-mail confirmation token.

The pre-assigned id is an **additive** member of the account-creation preparation:
`PreparedCustomerAccountCreate.customerAccountId` — the id the Command will write — on whichever
port carries `prepareCreate` after `specs/186-aggregate-ports/`.

*The race in step 1*: the pre-check found a live match outside the transaction and the Command
finds none, or another target (the company was deleted or re-parented between the two reads).
Neither existing answer is true — the tax ID no longer "exists", and no request was made — so the
Command answers `409 REGISTRATION_CONFLICT_CHANGED` ("Something changed while you were
registering. Please submit the form again."), and the retry follows whichever branch is now right.
The mirror race (no match in the pre-check, a match inside `organization.register`) keeps today's
`409 ORGANIZATION_TAX_ID_EXISTS`; the storefront's retry then follows the policy.

**Rationale.** FR-030's all-or-nothing, with each child keeping its own audit entry, exactly as
`organization.register` builds its first account (`specs/176-command-hooks-outbox/` FR-002). The
personal Organization records `personalAccountId`, so it needs the account id before the account
exists — hence the pre-assigned id rather than a second write.

**Rejected.** *`customerAccountLifecycleWritePort.createStandalone`* — its own transaction, not a
Command, cannot hold the request row. *Running `organization.register` with a flag* — its hook
data promises a created Organization; hooks on it would see a join path they never declared for.
*Update the personal Organization's `personalAccountId` after the child* — a second write of a
row the same step just created, to avoid one additive field.

Hooks on `organization.register` do **not** fire for the join path; a deployment that wants every
registration hooks both actions. Documented in the organizations page.

## R-11 — E-mail confirmation before anyone is asked

**Decision.** A request is created `awaiting_email_confirmation` and becomes `pending` only after
the registrant confirms their address. `EmailVerificationService.verify` is changed in two ways:
it no longer sets a **personal** Organization's status (it only moves a company out of
`pending_verification`, as its comment always meant), and after stamping the account it runs
`organization.join_request.submit` for that account's open request, if any. `submit` captures the
routing (R-12) and is hookable `afterCommit`, from which the deciders are told.

**Rationale.** Deciders identify the person by e-mail address. Without confirmation, anyone could
register an unregistered colleague's address with the company's tax ID and be approved as them —
into the company's credit, prices and order history. Sign-in still works before confirmation, as
it does for every account today (FR-051).

**Rejected.** *Show "unconfirmed" and let deciders judge* — moves a security decision onto people
who cannot verify it. *Confirm before creating the account* — keeps a pending registration (and
therefore a password) outside `customer_accounts`, which OD-8 (a) rejected.

## R-12 — Routing, captured once

**Decision.** At `submit`, the routing is computed from the setting
`organizations.join_requests.decided_by` (`organization_administrators` default | `operator`) and
the target's facts, and stored with a reason code: `routing ∈ {organization_administrators,
operator}`, `operatorReason ∈ {setting, no_active_administrator, target_not_active, null}`. It is
never recomputed. The operator may decide any pending request (FR-073); company administrators see
only requests routed to them.

**Rationale.** The related-payers precedent (`request-routing.ts`: captured on the request, never
re-read): a decider list that shifts under a request is a request nobody owns.

## R-13 — Tenancy: the request is the target's record

**Decision.** `OrganizationJoinRequest` is `@OrgScoped()` on `organization_id` = the **target**.
Company administrators read it under their ambient `org` filter; in-reach operators through the
admin tenant scope (`organization-reach.ts`). The registrant's own reads and their withdraw run
under `withSystemScope('organizations: a registrant reads their own join request')`, constrained by
`customer_account_id = <session account>`. Every out-of-scope address answers `404`.

**Rationale.** The request is addressed to, decided by and finally about the target. The
registrant's access is one narrow, greppable hatch over one row by their own id (the related-payers
counterparty precedent, its R-5).

**Rejected.** *`@CustomerScoped` on the registrant* — then every decider read is the hatch, and
the operator queue a cross-tenant scan.

## R-14 — Concurrency and the one-open-request rule

**Decision.** Every deciding Command (`approve`, `reject`, `withdraw`, `expire`, `submit`) loads
the row `for update`, checks `state` and the caller's `expectedVersion` (where the caller has
one), and bumps `version`. A lost race is `409 ORGANIZATION_JOIN_REQUEST_DECIDED`. A partial unique
index on `(customer_account_id) where state in ('awaiting_email_confirmation','pending')` holds
FR-080; its violation is `409 ORGANIZATION_JOIN_REQUEST_OPEN`.

## R-15 — Limits

**Decision.** The daily limit counts the target's requests **created** since the latest local
midnight in the store's time zone, whatever their state (an attempt is an attempt), and is checked
twice: in the pre-check and inside the create Command under a `for update` lock on the target's
Organization row, so concurrent registrations cannot overshoot. At the limit:
`429 ORGANIZATION_JOIN_REQUEST_LIMIT` ("Too many requests to join this company today. Please try
again tomorrow."), before anything is written. The store-day computation is a module-local copy
of `related_payers`' `dailyWindowStart` (a cross-module import is forbidden; promoting it to the
platform for two callers is a separate decision). Defaults: 20 per day (1–1000), expiry 14 days
(1–90).

**Rejected.** *Silently drop the request at the limit and still answer "sent"* — a lie to the
registrant and an account created for nothing.

## R-16 — The registration reply

**Decision.** `POST /api/v1/organizations/register` answers:

- **company created** — `201`, unchanged body plus `outcome: 'organization_registered'` (additive);
- **join request created** — `202 { data: { outcome: 'join_request_sent', customerAccount,
  emailConfirmationSent } }`, with no `organization`.

`registerOrganizationResponseSchema` becomes a discriminated union on `outcome`. With the policy at
`refuse` (default) no client ever receives the second shape.

**Rationale.** FR-050. `202` says the asked-for thing (a company) was not created while something
was accepted; a client unaware of the union reads a non-201 and does not mistake it for a company.

**Rejected.** *Return the target's id* — a disclosure, and useless to the registrant.

## R-17 — Notifications

**Decision.** Following `related_payers` (`index.ts`, `ctx.commandHooks`), `organizations`
registers `afterCommit` hooks on its own actions: `submit` → company administrators (e-mail,
`organization_join_request_received`, each in their own language) or operators (in-app
notification through `adminNotificationRecordPort`, a non-binding edge as for new registrations);
`approve` / `reject` / `expire` → the registrant (`organization_join_request_approved` /
`_rejected` / `_expired`, and the storefront notification centre when `customer_notifications`
is present). The **confirmation** e-mail (`organization_join_request_email_confirmation`) is sent by
the route after commit, like today's registration verification mail, because it carries the raw
token, which outbox data may not.

**Rejected.** *Send from the Command* — a mail sent for a rolled-back write. *Put the token in the
outbox* — outbox data is list-1 only (`specs/176-command-hooks-outbox/`).

## R-18 — Expiry is a BullMQ sweep

**Decision.** `organizations` gains `workers/join-request-expiry-sweep-worker.ts`, registered with
`ctx.worker`, modelled on `related_payers`' `request-expiry-sweep-worker.ts` (and
`quote_requests/rfq-expiry-worker.ts`, Principle X): an `exists` probe with no scope, then batches
of 200 under `enterSystemScope`, one `organization.join_request.expire` Command per row, a lost
race skipped.

## R-19 — Anonymisation and moves by other paths

**Decision.** `organizations` subscribes (`ctx.subscribe`) to `customer_account.anonymized.v1` and
erases `note`, `requestedName` and `rejectionReason` on that account's requests (one
`organization.join_request.erase_texts` Command, not hookable), and to
`customer_account.organization_changed.v1` with `source !== 'join_request'`, withdrawing that
account's open request as the system actor (FR-047).

**Rationale.** Free text typed by a person is erased with the person (#843 precedent). A request
for an account that already moved would otherwise be approvable into a second move.

## R-20 — Admin surfaces

**Decision.** Two operator permissions in `organizations' manifest.ts`:
`organizations:read-join-requests` (requires `customers:read`) and
`organizations:decide-join-requests` (requires `organizations:read-join-requests`). One page
`/organizations/join-requests` (queue + detail drawer), a sidebar entry under the Organizations
group, one palette action `open-organization-join-requests`, enum labels via `defineEnumLabels` in
`src/admin/lib/labels.ts`, a *Join requests* count link on the Organization detail. Labels in
`packages/modules/organizations/i18n/{en,pl}.json` (flat).

## R-21 — Storefront

**Decision.** `GET /api/v1/organizations/registration-options` gains `joinRequestsOffered`
(the setting's value — the default participant's answer; a deployment rule that turns it on
elsewhere does not render the note field, which is acceptable). Customer routes in
`routes.customer.ts` (registrant) and `routes.members.ts` (administrators). The reference
storefront gains: the registration outcome state, the *waiting to join* notice on the account
home, and *Join requests* under the company's members screen. `registrationOptionsRevalidation`
includes the new setting codes.

## R-22 — Audit state

**Decision.** `ORGANIZATION_JOIN_REQUEST_AUDIT_KEYS` = `state`, `routing`, `operatorReason`,
`origin`, `customerAccountId`, `organizationRoleId`, `decidedByKind`, `expiresAt`, `version`,
`changedFields`, `noteLength`. Never: `note`, `requestedName`, `rejectionReason`, the target id
(the tenant anchor; recorded as `changedFields: ['organizationId']` where it matters). The move
records `{ mode, source, changedFields: ['organizationId','organizationRoleId'] }` and the role
ids (ids of other records, list 1) — not the Organization ids, which are the account's tenant
anchor (`organizationMoveAuditState`, unchanged).

## R-23 — Persistence under MikroORM 7

**Decision.** The entity is written for MikroORM 7.2.11 as the tree is after #1866: legacy
decorators from `@mikro-orm/decorators/legacy`, `em.persist(x); await em.flush()` (no
`persistAndFlush`), raw reads through the kysely-backed `em.execute` / query builder — not knex.
One migration in `packages/modules/organizations/src/migrations/`, scaffolded with
`pnpm --filter backend run migration:new` (timestamped). The FK to `customer_accounts(id)` is an
acknowledged edge in `backend/test/unit/db/acknowledged-fk-edges.ts`, as
`email_verification_tokens → customer_accounts` is. `customer_accounts` needs no migration.

## R-24 — No new dependency

Everything is Fastify, MikroORM, Zod, BullMQ, the Command Bus, the outbox and the existing mail
path. Complexity Tracking stays empty.

## R-25 — Names

**Decision.** Events `organization.join_request.created.v1` / `.decided.v1` and Commands
`organization.join_request.*`, following `organizations'` own family (`organization.registered.v1`,
`organization.status_changed.v1`) rather than #1832's `organizations.join_request.*`. Settings:
`organizations.registration.conflict_policy` (beside the three `organizations.registration.*`
keys, rather than #1832's `organizations.registration_conflict_policy`),
`organizations.join_requests.decided_by`, `.expiry_days`, `.daily_limit_per_organization`.
Table `organization_join_requests`; columns per Principle VI (`organization_id`,
`customer_account_id`).

## R-26 — Q1, if the owner picks B

**Decision (conditional).** `provisionFor` gains an optional `status` (`active` default,
`pending_verification` allowed). The join-path Command passes `pending_verification` when
`customers.allow_registration_without_organization` is false on the request's channel (read in
the pre-check through `customers`' published setting reader — a new edge, or the setting read
through `settingsReadPort` by code, decided in WP-3). `verify` no longer activates a personal
Organization (R-11), so it stays inactive until approval moves the person out, or an operator
activates it through the existing moderation action. A personal Organization awaiting
verification is listed by the existing moderation filter.
