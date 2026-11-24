# Feature Specification: Membership moves and join requests on an existing tax ID

**Feature Branch**: `spec/191-membership-join-requests`
**Created**: 2026-11-23
**Status**: Draft — owner rulings of 2026-11-23 recorded as **D-298** (`plan.md` § *Ruling D-298*),
including the owner's answers to this spec's questions (OR-8 – OR-12); no question open
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
| **Branch** | An Organization below the target in its Organization tree (a descendant: a child, a child's child, …). Never an Organization above the target or beside it. |
| **Placement** | The Organization an approved registrant becomes a member of: the target itself, or one of its branches (OR-12). |
| **Roll-up** | The existing customer capability (feature 056) by which a person's sign-in sees and acts across their Organization's branches as well as the Organization itself. An operator grants it per person. |

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
  request. When no operator acts, the actor is recorded as automation — which, by the owner's
  answer of 2026-11-23 to `specs/186-aggregate-ports/` (its Q-1), is the existing *system* actor
  with the calling integration's source code recorded beside it, not a new kind of actor.
- **OR-6.** The Organization and CustomerAccount aggregate operations come from
  `specs/186-aggregate-ports/` (D-293); this feature uses them and does not redefine them.
- **OR-7.** Delivered in release 0.113.0, after the persistence-layer upgrade (#1073 → #1866).

**The owner's answers to this spec's questions (D-298, 2026-11-23, second round):**

- **OR-8 (was Q1 / OQ-1 — variant B).** On a sales channel where private (standalone) registration
  is closed, the personal Organization the join path creates is **awaiting verification**: the
  registrant can sign in, follow and withdraw their request, but cannot buy until they are approved
  into a company or an operator activates that Organization. Where the channel allows private
  registration, it is created active, as every personal Organization is today.
- **OR-9 (was OQ-2 — confirmed).** A request reaches its deciders only after the registrant has
  confirmed their e-mail address.
- **OR-10 (was OQ-3 — confirmed).** No "ask to join" screen in the customer account area in this
  feature; the published interface supports it for a later one.
- **OR-11 (was OQ-4 — confirmed).** Defaults: a request expires after 14 days, a company receives at
  most 20 new requests per day, and company administrators decide.
- **OR-12 (was OQ-5 — CHANGED, built now).** The decider may approve a join request **directly into
  a branch** of the company — an Organization in the tax-ID owner's tree below the target — with a
  role of that branch. Who may choose which branch is FR-100 – FR-102.

## Interfaces and ownership *(stated here because issue #1832 is written against it)*

The two halves are two published interfaces with **one owner each** (`research.md` R-1):

| Interface | Owner module | Carries |
| --- | --- | --- |
| `membershipPort` | `customer_accounts` | the move of an account to another Organization with its role, and the detach to the personal Organization (US1, #1831) — one recorded operation, `customer_account.organization.change` |
| `organizationJoinRequestPort` | `organizations` | join requests: ask to join, approve (into the target or a branch), reject, withdraw, find the open one (US2 – US4, #1832) |

Approving a join request **uses** `membershipPort` — it is the US1 move run as part of the approval —
and never writes the account's Organization any other way. There is no single "membership" interface
carrying both halves: the account's Organization column belongs to `customer_accounts`, while the
tax ID, the tree, the roles and the request belong to `organizations`.

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
   the move succeeds and its audit entry and notice record the actor as automation (the system
   actor with the integration's source code, OR-5).
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
9. **Given** a sales channel on which private registration is closed, **When** a join request is
   created there, **Then** the registrant's personal Organization is awaiting verification: they can
   sign in, see the notice and withdraw, but adding to a basket is refused as for any Organization
   awaiting verification (OR-8).
10. **Given** a sales channel on which private registration is open, **When** a join request is
   created there, **Then** the personal Organization is active, exactly as a private registration's.
11. **Given** a personal Organization created awaiting verification, **When** the registrant
   confirms their e-mail address, **Then** it stays awaiting verification (confirming an address
   never activates a personal Organization).

---

### User Story 3 — A company administrator decides (Priority: P1)

A company administrator signs in to the storefront and finds the requests to join their company,
each with the person's name, e-mail address and the time they asked. They approve one, choosing
where the person goes — the company itself (preselected) or, when their own sign-in reaches the
company's branches, one of those branches — and the role the person gets there (*Member* is
preselected), or reject it with an optional reason. The approved person is a member of the chosen
Organization from their next page view; the rejected one is told and remains a private customer
where the store allows it.

**Why this priority**: The company knows its people; asking it is what makes the flow safe without
operator labour.

**Independent Test**: As an administrator of the target, approve one request with a custom role
and reject another with a reason; the first person's next request is scoped to the company with
that role, the second stays in their personal Organization, and both are told by e-mail in their
language. Grant that administrator roll-up and approve a third request into a branch with one of
the branch's roles; that person's next request is scoped to the branch.

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
7. **Given** an administrator of the target whose sign-in has roll-up, and an active branch C of the
   target, **When** they approve choosing C and a role R of C, **Then** the person is moved into C
   with R through the operation of US1, the request is closed as approved and records C as the
   placement, and the person's e-mail names C and the company.
8. **Given** an administrator of the target **without** roll-up, **When** they open the approval,
   **Then** only their own company is offered; **When** they nevertheless name a branch, **Then** it
   reads as not found and nothing moves.
9. **Given** an approval choosing branch C, **When** the role named belongs to the company or to
   another branch rather than to C, **Then** it is refused as not found and nothing moves.
10. **Given** an approval dialog listing branch C, **When** C is blocked, deleted or moved out of the
   company's tree before the approval is sent, **Then** the approval is refused with "the selected
   branch is no longer available", the request stays pending, and the decider may choose again.
11. **Given** an Organization in another tree, or above or beside the target in its own tree, **When**
   any decider names it as the placement, **Then** it reads as not found.

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
5. **Given** an operator with the decide permission, **When** they approve into a branch of the
   target that is within their reach, **Then** the outcome is that of US3 scenario 7; **When** the
   branch is outside their reach, **Then** it is not offered and naming it reads as not found.

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
- **Store on which private (standalone) registration is closed**: the personal Organization is
  created awaiting verification (OR-8, FR-048); after a rejection, withdrawal or expiry it stays so
  until an operator activates it.
- **Branch removed or deactivated while a request is pending**: nothing happens to the request — a
  pending request names only the target, and the placement is chosen at the moment of approval. An
  approval naming a branch that is by then blocked, awaiting verification, rejected, deleted or no
  longer below the target is refused and the request stays pending (FR-104).
- **Target moved into another tree while a request is pending**: the branches offered and accepted
  are those below the target at the moment of approval; the request follows the target, not the tree
  it was in when the person asked.
- **Branch administrators**: a person placed into a branch is not decided by, and does not notify,
  the branch's own administrators; they see the new member in their members list as any other.
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
- **FR-034**: Approval MUST move the account into the placement — the target, or the branch the
  decider chose (FR-100) — through the operation of FR-001, with the role the decider chose (the
  placement's *Member* preselected), and close the request as approved, recording the placement and
  the role, in the same all-or-nothing step.
- **FR-035**: Approval MUST be refused when the request is not pending, the target or the placement
  is not active, the role does not belong to the placement, or the account is no longer a live,
  unblocked account in its own personal Organization.
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
- **FR-048** (OR-8): On a sales channel where private registration is closed, the personal
  Organization the join path creates MUST be awaiting verification; where it is open, active.
  Confirming the e-mail address MUST NOT change a personal Organization's status. Such an
  Organization MUST appear where operators already find Organizations awaiting verification, and
  MUST become active only through the existing operator action.

#### What the registrant sees

- **FR-050**: The registration reply on the join path MUST say only that a request was sent and an
  e-mail confirmation is needed; it MUST NOT reveal the stored company name, its administrators, its
  status or the routing.
- **FR-051**: The registrant MUST be able to sign in before and after any decision.
- **FR-052**: While a request is open, the account area MUST show a "waiting to join" notice with
  the tax ID and the company name the registrant entered, the request's state and a withdraw
  action.
- **FR-053**: The registrant MUST be told by e-mail, in their account's language, when the request
  is approved (with the name, as stored, of the Organization they now belong to — and of the
  company, when that Organization is one of its branches), rejected (with the reason, if any) or
  expired; withdrawal sends nothing.

#### Company administrators

- **FR-060**: The target's administrators MUST be able to list the target's pending requests routed
  to them in the storefront account area, with the registrant's name, e-mail address, note, typed
  company name and request date.
- **FR-061**: Only holders of the target's *Administrator* role MAY list or decide; member
  management is a reserved capability (`specs/170-organization-roles/`) and the same refusal MUST
  apply.
- **FR-062**: An administrator MUST be able to approve into their company with any role of their
  company, or into a branch they may choose (FR-101) with any role of that branch, or reject with an
  optional reason.
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
  company, and to approve it into any branch FR-101 allows them.
- **FR-074**: When a request routed to the operator becomes pending, operators MUST receive an
  in-app notification.

#### Limits

- **FR-080**: An account MUST have at most one open request.
- **FR-081**: A target MUST receive at most a configured number of new requests per store day
  (setting, default 20, 1–1000); beyond it, registration naming that target MUST be refused with a
  generic "too many requests today" message before anything is written.
- **FR-082**: The existing registration throttling and duplicate-address refusal MUST continue to
  apply unchanged.

#### Placement — approval into a branch (OR-12)

- **FR-100**: An approval MUST carry its placement: the target, or one Organization below the target
  in the target's tree as the tree is at the moment of approval. Absent a choice, the placement MUST
  be the target. An Organization above the target, beside it, or in another tree MUST NOT be a
  placement.
- **FR-101**: Who may choose a branch MUST follow the authority each decider already has over that
  branch, and nothing wider:
  - a **company administrator** of the target MAY choose the target always, and a branch **only when
    their own sign-in has roll-up** — that is, when the branch is already within what their sign-in
    sees and acts on; without roll-up they MAY choose only the target;
  - an **operator** with the decide permission MAY choose any branch of the target that is within
    their reach, under the same reach rule that decides whether they see the request at all;
  - a **server-side caller** of the published interface (FR-041) MAY choose any branch of the
    target; the caller is the gate, as for every other operation on that interface.

  Roll-up widens only where a person may be placed; it MUST NOT widen which requests a company
  administrator lists or decides — those remain the requests addressed to their own Organization.
- **FR-102**: A placement the decider may not choose MUST read as not found, indistinguishable from
  an Organization that does not exist; it MUST NOT be offered in any choice the decider is shown.
- **FR-103**: The role MUST belong to the placement; a role of the target used with a branch, or of
  another branch, MUST be refused as not found.
- **FR-104**: The placement MUST be live, active and below the target **when the approval is
  written**; a placement that is blocked, awaiting verification, rejected, deleted or moved out of
  the target's tree MUST refuse the approval with a message that the selected branch is no longer
  available, leave the request pending, and change nothing. A change to the placement made
  concurrently with the approval MUST either be seen by it or wait for it — never both pass.
- **FR-105**: A pending request MUST NOT record a placement; nothing MUST happen to pending requests
  when a branch is created, blocked, deleted or moved.
- **FR-106**: The registrant MUST NOT be offered, or told, the target's branches before approval
  (SC-006); only the approval e-mail names the Organization they were placed in.
- **FR-107**: The decider's choice of placement MUST be shown, in English and Polish, as the
  target ("this company") followed by its branches in tree order with their names, only the
  Organizations FR-101 allows them, only active ones, searchable by name when there are many.

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
  decision time, an optional rejection reason, the placement and the role granted on approval
  (both recorded only once approved), the expiry time and a version for concurrent decisions.
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
  (system actor with the integration's source code, OR-5) in 100% of runs of the integration test.
- **SC-005**: For every move and every join-request operation, the audit trail holds exactly one
  entry and the platform exactly one notice per commit, and none per rollback (verified by tests).
- **SC-006**: No join-request reply or registrant screen discloses the stored company name, status or
  administrators before approval (verified by tests asserting the reply shape and sentinels).
- **SC-007**: A deployment rule contributed to the conflict policy changes registration outcomes
  without any edit to core (verified by the policy conformance test).
- **SC-008**: Every new string resolves in English and Polish (bundle checks green).
- **SC-009**: An approval into a branch takes no more interactions than an approval into the company
  plus one choice, and no decider is ever offered, or able to name successfully, an Organization
  outside FR-101 (verified by tests for each kind of decider, with and without roll-up).

## Assumptions

- **A-1** `specs/186-aggregate-ports/` (D-293) delivers the CustomerAccount / Organization aggregate
  ports and the caller source code (its FR-007) before this feature's implementation starts.
  Automation is recorded as the *system* actor plus that source code (owner answer to 186 Q-1,
  2026-11-23); no new actor kind is needed, so nothing here waits on one.
- **A-2** `specs/188-policy-points/` (D-295) delivers declared decision points with the `chain`
  combiner before WP-3; if it slips, the setting is read directly behind a function shaped like the
  default participant (plan § Risks).
- **A-3** The e-mail confirmation reuses the store's existing confirmation-link mechanism; sign-in
  does not require confirmation, as today.
- **A-4** Owner-confirmed (OR-9): a request reaches its deciders only after the registrant
  confirmed their e-mail address, because the deciders identify the person by that address (an
  unconfirmed address could impersonate a colleague).
- **A-5** Decided: a company administrator's approval alone suffices — they can already invite
  members directly (`specs/170-organization-roles/`), and approving a request grants nothing an
  invitation could not.
- **A-6** Superseded by OR-12: approval may place the person directly in a branch (FR-100 – FR-107).
  Who may choose a branch is derived from existing authority (roll-up for company administrators,
  reach for operators) rather than from a new permission (`research.md` R-27).
- **A-7** Out of scope, owner-confirmed (OR-10): a signed-in private customer asking to join a
  company from their account area (the published interface of FR-041 supports it; the screen is a
  follow-up).
- **A-8** The storefront in this repository is the reference storefront; an instance's own
  storefront adopts the flow from the published API.
- **A-9** The conflict policy setting is store-wide (not per sales channel); a deployment rule can
  vary it by channel (FR-022).

## Open questions

None. Q1 was answered by the owner on 2026-11-23 (variant B, recorded as OR-8); the confirmations
asked in `plan.md` (OQ-2 – OQ-4) are OR-9 – OR-11, and OQ-5 was answered *yes, now* (OR-12).

## Notes for `plan.md`

The plan resolves: who owns which interface (two owners, two ports), the operation's names, the
table and its tenancy classification, the routing capture, the policy point's input and verdict
schemas, the registration reply shape, the confirmation hand-off from the existing verification
flow, the expiry worker, notifications through the outbox, the admin permission codes, the
storefront routes and pages, the migration plan under MikroORM 7, and — for OR-12 — the placement
eligibility rule, its validation and locking at approval, and the placement choice on both
decider surfaces.
