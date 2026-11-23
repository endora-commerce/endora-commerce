# Feature Specification: Membership moves and join requests on an existing tax ID

**Feature Branch**: `spec/191-membership-join-requests`
**Created**: 2026-11-23
**Status**: Draft — owner rulings of 2026-11-23 recorded as **D-298** (`plan.md` § *Ruling D-298*);
one question open (Q1, below)
**Input**: Issues #1831 (move an account to another Organization as an audited, hookable operation)
and #1832 (OD-8: registering with a tax ID the store already knows asks to join that company),
with the owner decisions of 2026-11-23.
**Companions**: [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md), [tasks.md](./tasks.md).

## Context

Two things a store cannot do today, one built on the other.

1. **Moving a person between Organizations.** A person sometimes changes Organization — from a
   head office to one of its branches, or because an ERP says they now work for a different
   company. An operator can do it from the customer screen, but an automated integration cannot,
   nothing else on the platform is told that it happened, and a deployment has no way to object
   (for example "only within the same Organization tree").
2. **Registering with a tax ID the store already has.** Such a registration is refused today, with
   no way forward: the person usually works for that company and wants to join it, and the only
   remedy is an operator creating the account by hand.

The owner's decision OD-8 (2026-11-23) settles where such a person lives until they are accepted:
in **their own personal Organization**, which every individual already has (D-178), with an
ordinary account that can sign in. Their wish to join is a **join request** addressed to the
company. Approving it is the move of part 1; rejecting it leaves them where they are.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Personal Organization** | The single-member Organization every individual has (D-178, Principle XI). |
| **Company** | An Organization that is not personal. |
| **Target** | The company a join request asks to join. Under the `per-tree-root` tax-ID scope it is the tree's head office (the root), as the registration lookup already resolves it. |
| **Registrant** | The person who registered and asked to join. |
| **Company administrators** | The target's members holding its *Administrator* role (`specs/170-organization-roles/`). |
| **Operator** | Store staff in the Admin UI. |
| **Deciders** | Whoever is asked to decide a request: the company administrators or the operator (FR-064). |
| **Conflict policy** | What registration does when the tax ID already exists: `refuse` (today's behaviour, the default) or `join-request`. |

## Owner rulings *(binding; D-298, 2026-11-23 — not reopened by this feature)*

- **OR-1 (OD-8).** Registration on an existing tax ID, when the conflict policy says
  `join-request`, creates the account in the registrant's personal Organization with ordinary
  sign-in, plus a join request. No password is kept on the request, and no new account state is
  introduced.
- **OR-2.** Approval moves the account into the company with a role the approver chooses;
  rejection leaves it in the personal Organization.
- **OR-3.** The conflict policy is a store setting (`refuse` by default, so nothing changes for an
  existing store) and is the default participant of a declared decision point a deployment may
  extend (`specs/188-policy-points/`, #1839).
- **OR-4.** Moving an account to another Organization (including a branch — "case 5") is built now,
  as the operation join requests use.
- **OR-5.** Sessions are not revoked on a move: the tenant is resolved from the account on every
  request. When no operator acts, the actor is recorded as automation.
- **OR-6.** The Organization and CustomerAccount aggregate operations come from
  `specs/186-aggregate-ports/` (D-293); this feature uses them and does not redefine them.
- **OR-7.** Delivered in release 0.113.0, after the persistence-layer upgrade (#1073 → #1866).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A person is moved to another Organization (Priority: P1)

An operator, or an automated integration with no operator behind it (an ERP import), moves a
person from one Organization to another — typically from the head office to a branch. The person
keeps their sign-in; from their next page view they work in the new Organization with the role
they were given. The move is recorded once in the audit trail, the rest of the platform is told
about it, and a deployment can refuse it before it happens.

**Why this priority**: Join requests (US2–US4) are built on it, and the branch move is an owner
requirement on its own (OR-4).

**Independent Test**: Run the move once from the operator's customer screen and once from a
background job with no operator; in both, the person's next request sees the new Organization, one
audit entry records the move by name with the right actor, one "organization changed" notice is
published after commit, and a deployment-supplied objection blocks it with nothing written.

**Acceptance Scenarios**:

1. **Given** a member of company A, **When** an operator moves them to branch B without choosing a
   role, **Then** they hold B's *Member* role, their next request is scoped to B, one audit entry
   names the operator, and one "organization changed" notice names the person, A, B and the role.
2. **Given** the same member, **When** a background import moves them with no operator, **Then**
   the move succeeds and its audit entry and notice record the actor as automation.
3. **Given** a member of company A, **When** the move names a role that belongs to another
   Organization, **Then** it is refused as "not found" and nothing changes.
4. **Given** the last active administrator of company A, **When** anyone moves them out of A,
   **Then** the move is refused and A keeps its administrator.
5. **Given** a deployment that allows moves only within one Organization tree, **When** a move to
   an unrelated company is attempted, **Then** it is refused with the deployment's reason, nothing
   is written and no notice is published.
6. **Given** a member with an open basket, saved lists and pending quote requests in A, **When**
   they are moved to B, **Then** all of those stay with A, and the member sees B's data from the
   next request.
7. **Given** a member of company A, **When** they are detached to their personal Organization,
   **Then** they land there as its administrator, through the same recorded operation.

---

### User Story 2 — A registrant asks to join their company (Priority: P1)

The store has chosen the `join-request` policy. Someone fills in the business registration form
with a tax ID the store already has. Instead of a refusal they are told their request has been
sent and asked to confirm their e-mail address. They can sign in straight away; their account
area shows that they are waiting to join the company whose tax ID they entered, and lets them
withdraw the request.

**Why this priority**: It is the problem #1832 exists to solve.

**Independent Test**: With the policy at `join-request`, register with an existing tax ID; the
reply says only "request sent", an account exists in a new personal Organization, a confirmation
e-mail arrives, signing in works, the account area shows the waiting notice, and withdrawing it
closes the request.

**Acceptance Scenarios**:

1. **Given** the policy `refuse` (the default), **When** someone registers with an existing tax ID,
   **Then** the registration is refused exactly as today and nothing is written.
2. **Given** the policy `join-request`, **When** someone registers with an existing tax ID, **Then**
   an account is created in their own personal Organization, a join request addressed to the
   company is recorded, and the reply says only that the request was sent — it names neither the
   company as the store records it, nor its administrators, nor its status.
3. **Given** that registration, **When** the registrant has not yet confirmed their e-mail
   address, **Then** nobody is asked to decide the request; **When** they confirm it, **Then** the
   deciders are told.
4. **Given** a pending request, **When** the registrant signs in, **Then** the account area shows
   "waiting to join" with the tax ID and the company name **they entered**, and a withdraw action.
5. **Given** a pending request, **When** the registrant withdraws it, **Then** it is closed as
   withdrawn, the deciders no longer see it as open, and the registrant stays in their personal
   Organization.
6. **Given** the registered tax ID belongs to a branch's tree under the `per-tree-root` scope,
   **When** the request is created, **Then** its target is the tree's head office.
7. **Given** a registrant whose e-mail is already registered, **When** they register again,
   **Then** the existing duplicate-address refusal applies and no request is created.
8. **Given** the registration form's company fields (name, address, company custom fields),
   **When** a join request is created instead of a company, **Then** those company values are not
   stored as an Organization; only the name the registrant typed is kept on the request so they
   and the deciders can recognise it.

---

### User Story 3 — A company administrator decides (Priority: P1)

A company administrator signs in to the storefront and finds the requests to join their company,
each with the person's name, e-mail address and the time they asked. They approve one, choosing
the role the person gets (*Member* is preselected), or reject it with an optional reason. The
approved person is a member of the company from their next page view; the rejected one is told
and remains a private customer where the store allows it.

**Why this priority**: The company knows its people; asking it is what makes the flow safe without
operator labour.

**Independent Test**: As an administrator of the target, approve one request with a custom role
and reject another with a reason; the first person's next request is scoped to the company with
that role, the second stays in their personal Organization, and both are told by e-mail in their
language.

**Acceptance Scenarios**:

1. **Given** a pending request routed to company administrators, **When** an administrator of the
   target opens the requests list, **Then** they see it; a member without the *Administrator* role
   is refused as for every other member-management screen.
2. **Given** that request, **When** the administrator approves it with role R of their company,
   **Then** the person is moved into the company with R through the operation of US1, the request
   is closed as approved, and the person is told.
3. **Given** that request, **When** the administrator rejects it with a reason, **Then** it is
   closed as rejected, the person stays in their personal Organization, and the person is told,
   with the reason when one was given.
4. **Given** two administrators deciding the same request at once, **When** the second decision
   arrives, **Then** it is refused as already decided and the first stands.
5. **Given** an administrator of another company, **When** they address the request, **Then** it
   reads as not found.
6. **Given** the registrant has meanwhile been moved elsewhere, blocked or deleted, **When** an
   approval is attempted, **Then** it is refused and nothing moves.

---

### User Story 4 — The operator's queue (Priority: P2)

The operator has one Admin UI queue of join requests, filterable by state, by who is asked to
decide and by company, reachable from the sidebar and the command palette. Requests routed to the
operator (by the store's setting, or because the company has no active administrator, or because
the company is not active) are decided there; the operator may also decide a request routed to a
company. An operator sees only the companies within their reach.

**Why this priority**: The fallback when a company cannot decide, and the store's oversight.

**Independent Test**: With routing set to the operator, register a join request; it appears in the
queue (and in the operator's notifications), the operator approves it with a role, and an operator
whose reach excludes that company cannot see it.

**Acceptance Scenarios**:

1. **Given** a request routed to the operator, **When** an operator with the read permission opens
   the queue, **Then** it is listed with its state, its target, the registrant, its age and why it
   is routed there.
2. **Given** an operator with the decide permission, **When** they approve with a role of the target
   or reject with a reason, **Then** the outcome is the same as in US3.
3. **Given** an operator whose reach excludes the target, **When** they open the request, **Then** it
   reads as not found.
4. **Given** the palette, **When** an operator with the read permission searches "join requests"
   (or the Polish equivalent), **Then** the queue is offered; without the permission it is not.

---

### User Story 5 — The store keeps control of the policy (Priority: P2)

An operator chooses the conflict policy, who decides, how long a request lives and how many
requests one company may receive per day, in the store's settings. A deployment may add its own
rule on top (for example "join requests only on the wholesale channel") without changing core.

**Why this priority**: Nothing changes for a store that does nothing (OR-3); a store that opts in
decides how.

**Independent Test**: Flip the policy to `join-request` and back and observe registration on an
existing tax ID follow it; with a deployment rule contributed, observe the rule's verdict win while
the setting still applies where the rule defers.

**Acceptance Scenarios**:

1. **Given** a fresh or upgraded store, **When** nobody changes anything, **Then** the policy is
   `refuse`.
2. **Given** the policy `join-request`, **When** a deployment rule answers `refuse` for one sales
   channel, **Then** registration on that channel refuses and on others creates join requests.
3. **Given** a rule that fails or answers something outside the allowed answers, **When**
   registration consults the policy, **Then** it refuses, as today.

---

### User Story 6 — Requests do not pile up or become a nuisance (Priority: P3)

A request not decided in time expires and the registrant is told. One account can have only one
open request. One company receives at most a configurable number of new requests per day; beyond
it, registrations naming that company are refused for the day without revealing anything else.

**Why this priority**: Anyone who knows a tax ID can ask; these limits keep that from becoming
spam to a company's administrators.

**Independent Test**: Lower the expiry and the daily limit; an old request expires with a notice,
the registration over the daily limit is refused with the generic limit message, and a second
request by the same account is refused.

**Acceptance Scenarios**:

1. **Given** a request older than the expiry period and undecided, **When** the periodic sweep
   runs, **Then** it is closed as expired and the registrant is told.
2. **Given** a company that has received the daily limit of requests today, **When** another
   registration names its tax ID, **Then** it is refused with a "try again tomorrow" message and
   nothing is written.
3. **Given** an account with an open request, **When** another request for it is attempted,
   **Then** it is refused.
4. **Given** a request never confirmed by e-mail, **When** the expiry period passes, **Then** it
   expires like any other.

### Edge Cases

- **Race on the tax ID.** Two registrations with a new tax ID at once: the second finds it existing
  only inside its own write and is refused as today; on retry it follows the policy.
- **Ambiguous tax ID** (matches under more than one tree, which neither scope allows): treated as
  `refuse`.
- **Target not active** (awaiting verification, blocked or rejected): the request is accepted
  identically, so the reply reveals nothing, and is routed to the operator; it cannot be approved
  while the target is not active.
- **Target deleted while a request is open**: the request can no longer be approved; it expires.
- **Registrant anonymised** (deletion retention elapsed): the free texts on their requests (their
  note, the typed company name, a rejection reason) are erased with the account's other personal
  data.
- **Role deleted between listing and approval**: the approval is refused as not found; the decider
  picks another.
- **Company administrator is the registrant's only route but leaves the company**: requests already
  routed to the company stay there; the operator can still decide them (FR-073), and expiry closes
  them otherwise.
- **The registrant has been invited by the company meanwhile**: accepting an invitation is a
  different path that creates a new account and is unaffected; the open request is closed when
  the account it names is moved by any path (FR-047).
- **Store on which private (standalone) registration is closed**: see Q1.
- **Move to the Organization the account already belongs to**: no change, nothing recorded, no
  notice.
- **Move of a deleted account**: refused as not found, exactly as the existing operator action
  answers; a blocked account may still be moved by an operator or an integration (it may not be
  approved into a company — FR-035).

## Requirements *(mandatory)*

### Functional Requirements

#### Moving an account between Organizations (#1831, case 5)

- **FR-001**: The platform MUST offer one operation that moves a customer account to another
  Organization together with its role, usable by operator screens, by other modules and by
  background jobs with no operator.
- **FR-002**: The operation MUST also detach an account to its own personal Organization, as its
  administrator, provisioning that Organization if it never existed (D-178).
- **FR-003**: When no role is named, the target's predefined *Member* role MUST be used; a named
  role MUST belong to the target, else the move MUST be refused as not found.
- **FR-004**: Moving the last active administrator out of a company MUST be refused.
- **FR-005**: Each move MUST be recorded as exactly one audit entry, naming what changed and never
  the Organization values themselves (`specs/conventions/audit-state.md`), with the operator as
  actor when there is one and automation otherwise.
- **FR-006**: A deployment MUST be able to object to a move before it is written (the objection
  refuses it with the deployment's reason, nothing written) and to act on it after it committed,
  reliably and at least once.
- **FR-007**: After commit, exactly one "organization changed" notice MUST be published to the
  platform, carrying only identifiers: the account, the Organization it left, the one it joined,
  the role, the kind of move and its origin. A rolled-back move publishes nothing.
- **FR-008**: Sign-in sessions MUST NOT be revoked by a move; the person's next request MUST be
  scoped to the new Organization with the new role.
- **FR-009**: Data scoped to the Organization the person left — open baskets, saved lists, quote
  requests, orders, returns, addresses — MUST stay with that Organization.
- **FR-010**: A move to the Organization the account already belongs to MUST change nothing and
  record nothing.
- **FR-011**: The existing operator actions "assign to an Organization" and "detach to personal
  Organization" MUST run through this operation, keeping their current authority checks and role
  choice; the older ways of writing the move MUST keep working for one release, through this
  operation, and be marked for removal.

#### Conflict policy (OR-3)

- **FR-020**: When registration finds the tax ID already held by a live Organization, it MUST ask
  the conflict policy for a verdict: `refuse` or `join-request`.
- **FR-021**: The store's setting MUST be the policy's default answer, `refuse` unless an operator
  changes it; a store that changes nothing MUST behave exactly as before this feature.
- **FR-022**: A deployment MUST be able to contribute its own rule to the policy, ordered after the
  store's setting, seeing the setting's answer and the facts registration has (sales channel, tax
  ID scope, whether the target is active).
- **FR-023**: An answer outside the two allowed, a failing rule, or an ambiguous tax ID MUST result
  in `refuse`.

#### Join request lifecycle (OD-8)

- **FR-030**: Under `join-request`, registration MUST create, in one all-or-nothing step: the
  registrant's personal Organization, their account in it with ordinary sign-in, the join request
  addressed to the target, and an e-mail confirmation for the account. A failure at any point MUST
  leave none of them.
- **FR-031**: The request MUST NOT hold a password or any credential, and the account MUST NOT gain
  a new state; the account is an ordinary account of a personal Organization.
- **FR-032**: A request MUST be in one of: *awaiting e-mail confirmation*, *pending*, *approved*,
  *rejected*, *withdrawn*, *expired*. Only the first two are open; the others are final.
- **FR-033**: A request MUST become *pending* — and its deciders be told — only once the
  registrant has confirmed their e-mail address.
- **FR-034**: Approval MUST move the account into the target through the operation of FR-001, with
  the role the decider chose (the target's *Member* preselected), and close the request as
  approved in the same all-or-nothing step.
- **FR-035**: Approval MUST be refused when the request is not pending, the target is not active,
  the role does not belong to the target, or the account is no longer a live, unblocked account in
  its own personal Organization.
- **FR-036**: Rejection MUST close the request with an optional reason (at most 500 characters) and
  leave the account where it is.
- **FR-037**: The registrant MUST be able to withdraw their open request.
- **FR-038**: An open request older than the expiry period (setting, default 14 days, 1–90) MUST be
  closed as expired by a periodic background sweep.
- **FR-039**: Each create, confirmation, approval, rejection, withdrawal and expiry MUST be one
  recorded operation with one audit entry (names and codes only), that a deployment can object to
  beforehand and act on afterwards; a "join request created" and a "join request decided" notice
  (identifiers and outcome codes only) MUST be published after commit.
- **FR-040**: Two decisions on one request MUST NOT both succeed; the loser MUST be told it was
  already decided.
- **FR-041**: Server-side callers (another module, a deployment, an integration) MUST be able to
  create, approve, reject and withdraw join requests through a published interface, under the same
  rules.
- **FR-042**: Under the `per-tree-root` tax ID scope the target MUST be the tree's root; under
  `global` it MUST be the Organization holding the tax ID.
- **FR-043**: Registration on the join path MUST NOT create an Organization from the submitted
  company data; the typed company name MUST be kept on the request (at most 255 characters), and
  the registrant's own custom-field values MUST be kept on their account as on any registration.
- **FR-044**: The registrant MAY add an optional note for the deciders (at most 500 characters).
- **FR-045**: A request whose target is not active MUST be accepted identically and routed to the
  operator (FR-065).
- **FR-046**: When the registrant's account is anonymised, the free texts on their requests MUST be
  erased.
- **FR-047**: When the registrant's account is moved by any other path while a request is open,
  the request MUST be closed as withdrawn.

#### What the registrant sees

- **FR-050**: The registration reply on the join path MUST say only that a request was sent and an
  e-mail confirmation is needed; it MUST NOT reveal the stored company name, its administrators, its
  status or the routing.
- **FR-051**: The registrant MUST be able to sign in before and after any decision.
- **FR-052**: While a request is open, the account area MUST show a "waiting to join" notice with
  the tax ID and the company name the registrant entered, the request's state and a withdraw
  action.
- **FR-053**: The registrant MUST be told by e-mail, in their account's language, when the request
  is approved (with the company's name as stored, now that they are a member), rejected (with the
  reason, if any) or expired; withdrawal sends nothing.

#### Company administrators

- **FR-060**: The target's administrators MUST be able to list the target's pending requests routed
  to them in the storefront account area, with the registrant's name, e-mail address, note, typed
  company name and request date.
- **FR-061**: Only holders of the target's *Administrator* role MAY list or decide; member
  management is a reserved capability (`specs/170-organization-roles/`) and the same refusal MUST
  apply.
- **FR-062**: An administrator MUST be able to approve with any role of their company, or reject
  with an optional reason.
- **FR-063**: When a request becomes pending and is routed to the company, every active
  administrator of the target MUST be told by e-mail in their language.
- **FR-064**: Who decides MUST be a store setting: `organization_administrators` (default) or
  `operator`. The routing MUST be captured on the request when it becomes pending and not re-read.
- **FR-065**: A request MUST be routed to the operator, whatever the setting, when the target has no
  active administrator or the target is not active; the reason MUST be recorded as a code.

#### Operator

- **FR-070**: The Admin UI MUST offer a queue of join requests filterable by state, routing and
  target, sorted oldest first by default, with the registrant, target, age, routing and the
  operator-routing reason.
- **FR-071**: Reading the queue and deciding MUST each require their own admin permission, both
  registered for the role editor, and MUST be limited to targets within the operator's reach; an
  out-of-reach request MUST read as not found.
- **FR-072**: The queue MUST be reachable from the sidebar and the command palette (⌘K / CTRL+K),
  in English and Polish.
- **FR-073**: The operator MUST be able to decide any pending request, including one routed to a
  company.
- **FR-074**: When a request routed to the operator becomes pending, operators MUST receive an
  in-app notification.

#### Limits

- **FR-080**: An account MUST have at most one open request.
- **FR-081**: A target MUST receive at most a configured number of new requests per store day
  (setting, default 20, 1–1000); beyond it, registration naming that target MUST be refused with a
  generic "too many requests today" message before anything is written.
- **FR-082**: The existing registration throttling and duplicate-address refusal MUST continue to
  apply unchanged.

#### Cross-cutting

- **FR-090**: Every user-facing string — storefront, Admin UI, e-mails, refusals, settings and
  permission labels, palette entries — MUST ship in English and Polish.
- **FR-091**: Every new setting MUST appear on the Settings screen with its allowed values; changing
  the conflict policy MUST be reflected by the storefront registration page without a deploy.
- **FR-092**: Requests MUST be isolated by tenant: the target's administrators and in-reach
  operators see a request; the registrant sees only their own; any other reader sees "not found".
- **FR-093**: The user and developer documentation MUST describe both flows, in English and Polish.

### Key Entities

- **Join request**: a registrant's wish to join a target company. Holds the account, the target, the
  state, the routing and its reason, the optional note, the typed company name, the decider and
  decision time, an optional rejection reason, the role granted on approval, the expiry time and a
  version for concurrent decisions.
- **Membership move**: not stored as its own record — it is the account's Organization and role
  changing, recorded in the audit trail and announced by the "organization changed" notice.
- **Conflict policy**: the decision registration asks on an existing tax ID; its default answer is
  the store setting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A store that changes no setting sees no difference in registration outcomes: every
  existing registration test passes unchanged.
- **SC-002**: A registrant on an existing tax ID goes from the registration form to "waiting to
  join" in one submission plus one e-mail confirmation, with no operator involvement.
- **SC-003**: A company administrator decides a request in at most three interactions from the
  account area.
- **SC-004**: A move performed by a background job with no operator succeeds and is attributable
  (actor automation) in 100% of runs of the integration test.
- **SC-005**: For every move and every join-request operation, the audit trail holds exactly one
  entry and the platform exactly one notice per commit, and none per rollback (verified by tests).
- **SC-006**: No join-request reply or registrant screen discloses the stored company name, status or
  administrators before approval (verified by tests asserting the reply shape and sentinels).
- **SC-007**: A deployment rule contributed to the conflict policy changes registration outcomes
  without any edit to core (verified by the policy conformance test).
- **SC-008**: Every new string resolves in English and Polish (bundle checks green).

## Assumptions

- **A-1** `specs/186-aggregate-ports/` (D-293) delivers the automation actor kind and the
  CustomerAccount / Organization aggregate ports before this feature's implementation starts; if
  the actor kind slips, background moves record the system actor (plan § Risks).
- **A-2** `specs/188-policy-points/` (D-295) delivers declared decision points with the `chain`
  combiner before WP-3; if it slips, the setting is read directly behind a function shaped like the
  default participant (plan § Risks).
- **A-3** The e-mail confirmation reuses the store's existing confirmation-link mechanism; sign-in
  does not require confirmation, as today.
- **A-4** Decided (D-298, architect): a request reaches its deciders only after the registrant
  confirmed their e-mail address, because the deciders identify the person by that address (an
  unconfirmed address could impersonate a colleague). Owner may overturn (`plan.md` OQ-2).
- **A-5** Decided: a company administrator's approval alone suffices — they can already invite
  members directly (`specs/170-organization-roles/`), and approving a request grants nothing an
  invitation could not.
- **A-6** Decided: approval places the person in the target; placing them in one of the target's
  branches is a later move (US1). Owner may extend (`plan.md` OQ-5).
- **A-7** Out of scope: a signed-in private customer asking to join a company from their account
  area (the published interface of FR-041 supports it; the screen is a follow-up — `plan.md` OQ-3).
- **A-8** The storefront in this repository is the reference storefront; an instance's own
  storefront adopts the flow from the published API.
- **A-9** The conflict policy setting is store-wide (not per sales channel); a deployment rule can
  vary it by channel (FR-022).

## Open questions

- **Q1** — [NEEDS CLARIFICATION: on a sales channel where private (standalone) registration is
  closed, may a registrant whose request is pending or rejected buy as a private customer from the
  personal Organization the join path created for them?]

  | Option | Answer | Implications |
  | --- | --- | --- |
  | A | Yes, as any personal Organization can today | Simplest; but on a business-only store the join path becomes a way round the closed private registration (register with any known tax ID, get rejected, keep a private account that can order). |
  | B *(recommended)* | No: on such a channel the personal Organization is created not yet active, so the person can sign in, see the notice and withdraw, but cannot add to a basket until approved (they then leave it) or an operator activates it | Honours the owner's "if the channel allows it" (OD-8) with an existing Organization status, no new account state; the operator sees such personal Organizations awaiting verification. |
  | C | The join path is not offered on such channels (policy treated as `refuse`) | Defeats the feature on business-only stores, its main audience. |

## Notes for `plan.md`

The plan resolves: who owns which interface (two owners, two ports), the operation's names, the
table and its tenancy classification, the routing capture, the policy point's input and verdict
schemas, the registration reply shape, the confirmation hand-off from the existing verification
flow, the expiry worker, notifications through the outbox, the admin permission codes, the
storefront routes and pages, and the migration plan under MikroORM 7.
