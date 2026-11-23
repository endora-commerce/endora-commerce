# Research: Membership moves and join requests on an existing tax ID

Decisions for `specs/191-membership-join-requests/`. Each is **decision → rationale → alternatives
rejected**. Numbers are stable; cite them as `191 R-n`. Code paths are as of `origin/master`
`657917d35` (2026-11-23), re-checked against `babfae111` (0.112.0) for R-26 – R-30.

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

## R-3 — The actor is the ambient one; automation is `system` plus the source code

**Decision.** The new port's inputs carry **no actor**. The bus derives it from the TenantContext
(Principle XIII): an administrator in an admin request, the customer for a storefront company
administrator (`actorCustomerAccountId`), and the existing **`system`** kind for work entered with
`enterSystemScope` / `withSystemScope(reason)` with no administrator. What tells automation apart
from platform maintenance is the move's **`source`** code (R-7), recorded in the audit entry and
carried by the event and the outbox — the pair `specs/186-aggregate-ports/` R-4 defines and the
owner chose on 2026-11-23 (186 Q-1: "`system` + source code"). The deprecated lifecycle methods
keep their signature for one release (OD-4) and **ignore** `actorAdminUserId` beyond asserting, in
development builds, that it equals the ambient actor.

**Rationale.** An actor taken from an input is what XIII forbids; it is also why a worker could
not call the move at all (#1831). A new actor kind would widen the published
`CommandActor['kind']` union every consumer switches on (186 R-4).

**Rejected.** *Keep `actorAdminUserId` optional* — still an input-supplied actor. *A new
`automation` actor kind* — rejected by the owner's answer to 186 Q-1.

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
and `source` (list-1 values: ids and codes). `source` is a code with the shape `specs/186-aggregate-ports/` R-4 gives every caller source
(`^[a-z][a-z0-9_.-]{0,63}$` — one spelling, so an integration's module id fits both); core writes
`operator`, `join_request`, `integration`; a deployment or an integration may write its own code
(its module id, as 186 recommends). It is **required** on the move — unlike 186's optional
`AggregateCommandOptions.source` — because every move has an origin a reader must be able to tell.

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
  `(input, previous)`. Who may contribute is 188's rule, not this point's: a core or overlay module,
  and — by the owner's answer of 2026-11-23 to 188 (its question on third-party packages) — an
  installed package **only** when the deployment's committed divergence declaration grants it
  explicitly; an ungranted package still refuses composition, and the grant is listed in the
  divergence report;
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
is present). The approved notice names the placement (`organizationName`) and, when the placement is
a branch, the target (`companyName`) — the Organization the registrant now belongs to and the
company it is part of, so naming them discloses nothing to a non-member (R-27 – R-29). Branch administrators are not notified (R-31). The **confirmation** e-mail (`organization_join_request_email_confirmation`) is sent by
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
`changedFields`, `noteLength`, `hasRejectionReason`, `placement` (`'target' | 'branch'`, R-29).
Never: `note`, `requestedName`, `rejectionReason`, the target id (the tenant anchor; recorded as
`changedFields: ['organizationId']` where it matters), the placement's Organization id (R-29). The move
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

## R-26 — Q1 answered B: the personal Organization awaits verification on a closed channel

**Owner answer (OR-8, 2026-11-23): variant B.** This decision is now unconditional.

**Decision.** `PersonalOrganizationService.provisionFor(em, …)` gains an optional
`status: 'active' | 'pending_verification'` (default `active`, so every existing caller is
unchanged). The join path's Command passes `pending_verification` when the request's channel does
**not** allow private registration. The gate is read in the registration pre-check by code,
`settingsReadPort.get('customers.allow_registration_without_organization', salesChannelId,
z.boolean())`, defaulting to `false` — the same reader, and the same by-code reading of another
module's setting, `organizations` already uses for `sales_channels.storefront_url`
(`packages/modules/organizations/src/backend/index.ts`), and the same channel resolution `customers`
uses for its own gate (`resolveAllowRegistrationWithoutOrganization`, `customers/src/backend/index.ts`).
The value read is passed into the Command as an input, so the Command does not read settings.
`verify` no longer activates a personal Organization (R-11), so it stays awaiting verification until
approval moves the person out, or an operator activates it through the existing moderation action.
A personal Organization awaiting verification is listed by the existing moderation filter.

**Rationale.** Honours the owner's "if the channel allows it" with an existing Organization status
and no new account state (OR-1). The basket refusal is already in place
(`assertOrganizationCanTransact`, `packages/modules/carts/src/backend/routes.ts`). Reading by code
fails **closed**: if `customers` is somehow absent, the default `false` yields the restrictive answer.

**Rejected.** *A published `customers` setting reader* — a new port and edge for one boolean the
settings reader already answers. *A (simplest) and C (no join path on such channels)* — rejected by
the owner (`spec.md` OR-8).

## R-27 — Approval into a branch: who may choose which branch

**Owner answer (OR-12, 2026-11-23): approval may place the person directly in a branch, with a
role, built in this feature.** The owner left the authority rule to the design.

**Decision.** The eligible placements of an approval are the **target and its descendants** — the
Organizations whose materialized `path` begins with the target's `path`
(`packages/modules/organizations/src/backend/services/organization-tree-service.ts`, feature 056) —
narrowed by the decider:

| Decider | Eligible placements |
| --- | --- |
| Company administrator of the target (storefront; the reserved *Administrator* capability, `organizationPermissionPort.isAdministrator`) | the target; **plus** every descendant **iff** the administrator's own account has roll-up (`CustomerAccount.subtreeRollupEnabled`), i.e. iff the descendant is in the request's tenant reach — `orgConstraintFor()` answers `allowed` with the target's subtree, which `actorTenantContext` builds from `customerRollupScopePort` (`packages/platform/src/kernel/actor-tenant-context.ts`) |
| Operator holding `organizations:decide-join-requests` | the descendants that pass the same visibility rule the queue applies to the target — `organizationInReach`'s `SalesRepAssignmentPort.canSeeOrganization` (`packages/modules/organizations/src/backend/organization-reach.ts`), or every one under a platform-wide scope |
| Server-side caller of `organizationJoinRequestPort.approve` | the target and every descendant; the caller is the gate (R-1, FR-041) |

Every eligible placement must also be live and `active` (R-28). Under `per-tree-root` the target is
the root (FR-042), so its subtree is the whole tree — exactly the owner's "an Organization in the
tax-ID owner's tree". Under `global` the target is the Organization holding the tax ID, and the
placements are it and what is below it.

**Rationale.**

1. **One account, one Organization.** `customer_accounts.organization_id` is a single `NOT NULL`
   column, and the *Administrator* role is a role **of one Organization** (spec 170). A company
   administrator therefore administers no branch by role; the only existing authority a head-office
   person has over a branch is roll-up, which feature 056 defines as "sees and acts across its
   Organization's subtree" and which an operator grants per person. Placing someone into a branch is
   acting on that branch — it gives the person the branch's prices, credit and order history — so it
   is exactly what roll-up already allows and nothing a plain administrator could do today.
2. **The rule reads what the platform already computed.** The request route runs under the
   administrator's tenant context, whose allowed set already *is* the target's subtree when roll-up
   is on and the target alone when it is off. "The placement is in your reach" is then one check
   against a value nobody re-derives, and it cannot drift from what roll-up means elsewhere.
3. **Operators reuse their reach rule.** An operator who may not see a branch must not be able to
   put people into it; the visibility rule that hides the request (FR-071) is the one that decides
   the branch.
4. **No new permission.** Member management on the storefront is a reserved capability, "never a
   permission code" (`routes.members.ts` header, spec 170 data-model §6); an operator's decide
   permission already grants membership in an Organization in reach, and a branch in reach is no
   wider.

**Rejected.**

- *Any administrator of the target may choose any branch.* Widens the Administrator role from one
  Organization to a whole tree, so a person who cannot see a branch's orders could still staff it.
- *The decider must be an Administrator of the branch too.* Impossible by construction — one
  account belongs to one Organization — so the feature would never work on the storefront.
- *A new organization-role permission ("place members in branches").* Contradicts the reserved
  capability rule, and duplicates roll-up with a second switch that can disagree with it.
- *Any Organization in the target's tree, including above or beside it.* Under `global` that is an
  Organization with another tax ID than the one the registrant entered, and above the target is
  outside what the target's administrators reach. Under `per-tree-root` the subtree is already the
  whole tree, so nothing is lost there.
- *Let the registrant suggest a branch.* Discloses the tree before approval (SC-006).

## R-28 — Placement validation and locking at approval

**Decision.** `organization.join_request.approve` takes `placementOrganizationId?` (absent = the
target) and, on the bus transaction, in this order:

1. locks the request `for update`; checks `state = 'pending'` and `expectedVersion` (R-14);
2. re-checks **eligibility** (R-27) with the one function both the read route and the Command call,
   `JoinRequestPlacementService.assertEligible(request, decider, placementId)`; ineligible, unknown,
   malformed or deleted → `404 NOT_FOUND` (FR-102: not distinguishable);
3. locks the target's and the placement's Organization rows **`for share`**, in id order (one row
   when they are the same), and re-reads both: the placement's `path` must still begin with the
   target's `path` and be readable (`isReadableTreePath`), else `404`; the target not `active` →
   `409 ORGANIZATION_JOIN_REQUEST_NOT_APPROVABLE` `target_not_active`; the placement not `active` →
   the same code with `placement_not_active`;
4. runs the account checks (data-model §1 *Validation*);
5. runs the child `membershipPort.changeCommand({ customerAccountId, organizationId: placementId,
   organizationRoleId, source: 'join_request' })` — **the US1 Command, the only writer of the
   account's Organization**. It resolves the role against the placement (R-4): absent → the
   placement's *Member*; a role of another Organization → `404` (FR-103). Its `beforeCommit` hooks
   (for example a deployment's "only within one tree") apply as to every move;
6. writes `state = 'approved'`, `placement_organization_id`, `granted_organization_role_id`,
   `decided_*`, bumps `version`.

**Rationale.** The moderation Commands (`organization.approved`, `.rejected`, `.blocked`,
`.unblocked` in `services/organization-moderation-service.ts`), `organization.set_parent` /
`organization.move` and `organization.delete` all update the Organization row, so a `for share` lock makes each of them
either commit before the approval re-reads (and the approval sees it) or wait until the approval
commits (FR-104: "never both pass"). A share lock does not block other approvals or reads. Id order
avoids a deadlock between two approvals naming the same pair in opposite roles. The tree check on
`path` is one row read on a column the re-parenting Command rewrites in one statement
(`applyReparentPaths`). The role check stays in the move Command so it has one statement.

**Rejected.** *Validate only in the route* — a branch blocked between the route and the commit would
still receive the member. *`for update` on the Organization rows* — serialises concurrent approvals
into the same branch for no reason. *Put the tree rule in the move Command* — US1 moves anywhere by
design (an ERP may move across trees); "within the target's tree" is a join-request rule and lives
with the join request.

## R-29 — The placement in audit, hooks, outbox and events

**Decision.**

- **Audit** (`organization.join_request.approve`, a tenant-scoped record anchored on the target):
  `placement: 'target' | 'branch'` (a code) and `organizationRoleId` (an id of another record) are
  recorded; the placement's Organization id is **not**. The child move's entry, against the account,
  records `changedFields: ['organizationId', 'organizationRoleId']`, the role ids, `mode` and
  `source` (R-22) — never the Organization ids, which are the account's tenant anchor.
- **Hook data** of `approve` gains `placementOrganizationId` and `placementIsTarget`, so a
  `beforeCommit` hook can refuse ("never into branch X", "only into the root") before anything is
  written.
- **Outbox** of `approve` gains `placementOrganizationId` (an id, list 1); its `organizationId`
  stays the target, which pins the drain to the request's tenant.
- **Event** `organization.join_request.decided.v1` gains `placementOrganizationId: string | null`
  (set only for `approved`). The child's `customer_account.organization_changed.v1` already carries
  `toOrganizationId` = the placement.

**Rationale.** When the placement is the target, its id *is* the request's tenant anchor, which
`specs/conventions/audit-state.md` §2 forbids; recording the id only when it differs would be a
conditional rule every future editor must remember, while the code says what a reader of the audit
screen needs ("approved into a branch") and the id is on the row, in the hook data, the outbox and
both events for anyone with reach.

**Rejected.** *Record `placementOrganizationId` when it is a branch* — the conditional above.
*Record the branch name* — free text, list 2.

## R-30 — Choosing the placement: routes and screens

**Decision.** One read per decider surface, served by the same `JoinRequestPlacementService.list`
that R-28's `assertEligible` uses, so what is offered and what is accepted cannot disagree:

- storefront `GET /api/v1/organizations/mine/join-requests/:id/placements?q=&limit=` (company
  administrator, `routes.members.ts`) and admin
  `GET /api/v1/admin/organization-join-requests/:id/placements?q=&limit=`
  (`organizations:decide-join-requests`, under reach);
- each answers the eligible, live, `active` placements in tree (`path`) order — the target first,
  marked `isTarget` — with `name`, `depth` relative to the target, `parentOrganizationId`, and the
  placement's roles (`OrganizationRoleRef[]`) and its `defaultOrganizationRoleId` (the predefined
*Member*), `limit` 50 (max 100)
  with a `q` name filter and `total`, so a large tree stays one bounded read;
- the approve bodies gain `placementOrganizationId?`;
- the reference storefront's `DecideJoinRequestDialog` and the admin approve dialog show a
  *Place in* choice **only when more than one placement is eligible** — so an administrator without
  roll-up, or a company with no branch, sees the dialog exactly as before — and re-fill the role
  choice from the chosen placement's roles, *Member* preselected.

The admin approve dialog does **not** reuse `GET /api/v1/admin/organizations/:id/subtree` and
`…/:id/roles`: those are gated by `customers:read` and `organizations:read-roles`, which a holder of
`organizations:decide-join-requests` need not have, and they would apply none of R-27's narrowing.

**Rejected.** *Roles fetched per chosen placement in a second route* — one more round trip and route
for a list that is a handful of rows per Organization (two predefined roles plus the custom ones).
*Inline the placement list in every request view* — a tree read per row of the queue.

## R-31 — Nothing is pending on a branch

**Decision.** A pending request stores no placement (data-model check: `placement_organization_id`
is set iff `state = 'approved'`). Creating, blocking, deleting or re-parenting a branch therefore
needs no subscriber, sweep or migration of requests (FR-105); an approval that names a branch no
longer eligible is refused by R-28 and leaves the request pending for another choice. The branch's
own administrators are not asked and not notified; the new member appears in their members list,
and a deployment that wants more can hook `approve`'s `afterCommit` or subscribe to
`customer_account.organization_changed.v1`.

**Rejected.** *Let the decider pre-select a branch on a pending request* — a second, pending piece of
state that a branch change would have to repair. *E-mail the branch's administrators* — not asked
for; the person was placed by someone with authority over the branch (R-27), and the existing
member list already shows them.
