# Feature Specification: Aggregate ports — one write port per core aggregate

**Feature Branch**: `spec/186-aggregate-ports`
**Created**: 2026-11-23
**Status**: Draft — ruling **D-293** recorded below; two owner questions open (Q-1, Q-2 in
*Open questions*). `plan.md`, `research.md`, `data-model.md`, `contracts/` and `tasks.md` written.
**Input**: Owner decisions OD-2, OD-3 and OD-4 of 2026-11-23, issues #1819 (umbrella), #1820,
#1821–#1829.

**Related, written in parallel (cite by slug)**: `specs/187-side-table-extensions/` (D-294 — extension
attributes on aggregate *read* ports land host by host beside these write ports),
`specs/188-policy-points/` (D-295 — `organizations.moderation` approves through this feature's
`approve`), `specs/189-command-middleware/` (D-296 — the `meta` / `outcome` shapes this feature lists
as published surface), `specs/190-overlay-full-modules/` (D-297 — overlays compiled against the
surface this feature classifies, and shown its deprecations), `specs/191-membership-join-requests/`
(D-298 — `membershipPort`, which takes the two CustomerAccount membership moves this feature leaves
out). Earlier: `specs/176-command-hooks-outbox/` (hookable actions, `extensions`, outbox),
`specs/178-extensible-columns/` (OD-15, the extensible-host list), `specs/182-related-payers/` (the
payer stored on the order), `specs/175-buyer-input-custom-fields/` (custom-field write rules).

## Ruling D-293 (owner, 2026-11-23)

Recorded here as this feature's ruling; the numbers OD-2, OD-3, OD-4 and OD-10 are the owner's
decision list of the same day and are cited, not re-decided.

1. **OD-2 — ports per aggregate, not per request.** A write port is published as the port of its
   aggregate. It exposes the aggregate's lifecycle operations over the Commands its owner runs: each
   operation is one audited Command, runnable from a worker under `withSystemScope(reason)`, firing
   the same command hooks as the admin path.
2. **OD-3 — which aggregates.** Every aggregate that hosts Custom Fields: Organization,
   CustomerAccount, Order, QuoteRequest, Product, Category, Opportunity, Project, Task — the
   extensible hosts of OD-15, so the one decision "this entity is extensible" covers custom fields,
   declared extension columns and the aggregate port. Membership (moving an account between
   Organizations, join requests) is a separate port (#1831, #1832; OD-8). **OD-10 is closed on
   variant (b)**: the payer is stored on the order (`specs/182-related-payers/`), so the Order port
   covers it.
3. **OD-4 — stability in 0.x.** A method of a published port is removed or changed incompatibly only
   after one release that deprecated it, enforced by `check:release-intent`. The narrow ports this
   feature supersedes are marked deprecated in **0.113.0** and removed in **0.114.0**. The rule
   covers the whole contract surface an overlay may depend on, published as one list whose entries
   are each **frozen**, **stable** or **additive-only** (#1820 item 4).
4. **Delivery.** Release 0.113.0 starts with the move to MikroORM 7 (#1073; 7.2.11, legacy
   decorators from `@mikro-orm/decorators/legacy`). Contracts and port types may be written before
   the switch; service implementations land after #1866 merges.
5. **Context.** Overlay modules become full modules with an instance build and a *deployment* trust
   tier (#1858, `specs/190-overlay-full-modules/`); the surface list is what they compile against.

## Context

Server-side code outside a module — an overlay, an installed package, an integration worker — can
drive a core aggregate only through the ports its owner publishes. Those ports were published one
request at a time, so the public API follows the order of requests rather than the domain:
Organization has three write ports (`organizationWritePort`, `organizationCommandPort`,
`organizationCustomFieldWritePort`) and still cannot be re-parented or moderated from server code;
CustomerAccount spreads its lifecycle over four ports; Order over four capability ports; QuoteRequest,
Opportunity and Project have read ports only, or one transition; Task can only be bulk-created and
bulk-deleted in a context. Every gap becomes a core issue raised by a blocked deployment.

Measured on `origin/master` `ff7efc3e8` (research R-2): a large share of the operations the issues
name are **not Commands today** — Organization moderation is audited *after* its commit, QuoteRequest
and most CustomerAccount and Order writes are hand-audited inside their transaction, order comments
are not audited at all. A port over such a write would not fire command hooks, so this feature turns
each of those writes into a Command first, on the admin path and the port alike.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — An integration moves an Organization through its whole lifecycle (Priority: P1)

An ERP connector running as a worker, with no administrator present, creates an Organization, places
it under its head office, approves it, later blocks and unblocks it, sets its sales channels,
restrictions, credit inheritance mode, sales representatives and custom-field values — each through
one port, each recorded in the audit trail exactly as the administrator's action would be.

**Why this priority**: it blocks `specs/188-policy-points/` (moderation approves through `approve`)
and `specs/191-membership-join-requests/` (join approval and moves depend on it). It is also the
template every other aggregate copies.

**Independent Test**: a worker test under a system scope performs each operation with no
administrator and asserts the audit entry, the command hooks and the result are those of the admin
route for the same operation.

**Acceptance Scenarios**:

1. **Given** an existing branch Organization with no parent, **When** a worker sets its parent to a
   head office through the Organization port, **Then** the tree shows the branch under the head
   office and the audit trail holds one entry with the same action the admin's *set parent* records.
2. **Given** an Organization pending verification, **When** server code approves it through the
   port, **Then** it becomes active, the customer receives the same notice the admin approval sends,
   and the audit entry is written in the same transaction as the status change.
3. **Given** a command hook registered on an Organization action, **When** the port runs that
   action, **Then** the hook runs exactly as it does for the admin route, and a veto leaves nothing
   written.
4. **Given** a consumer of the old `organizationWritePort`, **When** it calls `create` in 0.113.0,
   **Then** the call behaves exactly as before and its type carries a deprecation pointing at the
   Organization port.

---

### User Story 2 — A deployment author knows what they may depend on, and a break cannot ship unannounced (Priority: P1)

A deployment developer compiling an overlay against the platform reads one published list of the
contract surface — ports, manifest extension fields, hook data, policy and middleware shapes,
extensible host tables — each entry marked frozen, stable or additive-only. When core deprecates
something they use, they see it one release before it disappears. A platform maintainer who removes
or narrows a stable entry without that deprecation release gets a red check.

**Why this priority**: OD-4 is the promise that makes the aggregate ports safe to depend on; without
the instrument, the 0.114.0 removal is as unannounced as any other edit.

**Independent Test**: on a fixture pair of trees (a base release and a head), the check reports each
finding kind — removal without deprecation, incompatible change without deprecation, change to a
frozen entry, narrowing of an additive-only entry, an unparseable deprecation — and passes the same
removal when the base release carried the deprecation.

**Acceptance Scenarios**:

1. **Given** a port method present in the previous release without a deprecation, **When** a branch
   removes it, **Then** the release-intent check fails naming the port, the method and the base
   release.
2. **Given** the same method deprecated in the previous release, **When** a branch removes it,
   **Then** the check passes.
3. **Given** a hook-data shape (additive-only), **When** a branch adds a field, **Then** the check
   passes; **When** it removes or retypes one, **Then** the check fails even if the field was marked
   deprecated.
4. **Given** the previous release tag cannot be resolved, **When** the check runs, **Then** it exits
   with "nothing was read", never green.
5. **Given** a new extensible host is added to the custom-field host list, **When** its owner
   publishes no aggregate port, **Then** the port-shape check fails naming the host.

---

### User Story 3 — Customer accounts from server code, through one port (Priority: P2)

An integration creates a customer account, updates its profile, blocks and unblocks it, soft-deletes
and restores it, changes its role, customer group, preferred language and custom-field values,
promotes it to organization administrator, marks its e-mail verified or removes it from its
Organization — through one port, with no administrator id passed in.

**Why this priority**: four overlapping ports today, several requiring an administrator id a worker
does not have.

**Independent Test**: each operation from a worker under a system scope produces the same audit entry
and hooks as the admin route; the old ports delegate.

**Acceptance Scenarios**:

1. **Given** an active account, **When** a worker blocks it through the CustomerAccount port with no
   administrator, **Then** it is blocked, its sessions end as on the admin path, and the audit entry
   records a system actor.
2. **Given** a consumer that needs to move the account to another Organization, **When** it looks
   for that operation, **Then** it finds it on the membership port of
   `specs/191-membership-join-requests/`, not here, and the CustomerAccount port's contract says so.

---

### User Story 4 — Order lifecycle from server code (Priority: P2)

A fulfilment or ERP integration moves an order's status and payment status, sets its custom-field
values, adds a comment and records its external reference — each through the Order port, each one
audited Command shared with the admin.

**Why this priority**: four capability ports today, and custom fields and comments have none.

**Independent Test**: parity of each operation with the admin route; a refused status change is
reported as an outcome, not a thrown error, as payment callbacks need.

**Acceptance Scenarios**:

1. **Given** an order in a status with no edge to the requested one, **When** an integration applies
   that status through the port, **Then** the answer is a refusal outcome naming the reason, nothing
   is written and nothing is audited.
2. **Given** an order, **When** a worker adds a comment through the port, **Then** the comment is
   stored and audited, and the buyer notice the admin comment sends is sent.

---

### User Story 5 — Quote requests from server code (Priority: P2)

A CRM integration creates a quote request for a customer, updates it, sets its custom-field values,
assigns it to a sales representative, approves or cancels it and sends its document.

**Why this priority**: the module publishes no write port at all.

**Independent Test**: parity of each operation with the admin route; buyer-side transitions are absent
and the contract says why.

**Acceptance Scenarios**:

1. **Given** a pending quote request, **When** a worker approves it through the port, **Then** it is
   approved with the same audit entry and notices as the admin approval.
2. **Given** a server-side caller, **When** it looks for resubmit, accepting or rejecting a revision
   or converting to an order, **Then** those operations are absent and the contract states they are
   the buyer's own.

---

### User Story 6 — Products and attribute definitions from server code (Priority: P2)

A PIM integration creates, updates, archives, restores and deletes products and variants, writes a
product's attribute values (its custom fields) and its channel- and language-scoped values through
the Product port, and manages attribute definitions through a separate Attribute port.

**Why this priority**: the broadest write port today mixes two aggregates; paid PIM connectors depend
on it and must be able to migrate within one release.

**Independent Test**: parity per operation; the old product write port and the scoped write port
delegate and carry deprecations.

**Acceptance Scenarios**:

1. **Given** a PIM worker, **When** it applies scoped values through the Product port, **Then** the
   result, the audit entry and the search and cache refresh are those of the admin editor's save.

---

### User Story 7 — Projects from server code, and their custom fields readable (Priority: P2)

A deployment keeps a project's investor in its own side table and must react when a project changes.
It creates projects, sets their Organizations, members and custom-field values, moves them between
stages, closes and reopens them, links records and adds comments through the Project port, and reads
a project's custom-field values through the Project read port.

**Why this priority**: a concrete deployment case (#1828); no core change is needed for the investor
itself, only this port (and the hookable actions of #1845, outside this feature).

**Independent Test**: parity per operation; the project record read by another module carries the
custom-field values.

**Acceptance Scenarios**:

1. **Given** a project with an internal custom field set, **When** another module reads it through
   the Project read port, **Then** the record carries the field's value.

---

### User Story 8 — Categories from server code (Priority: P3)

An integration creates, updates, moves (parent and position), deletes categories and sets their
custom-field values and inventory thresholds through the Category port.

**Independent Test**: parity per operation; the old write port delegates, and its list read is found on
the Category read port.

**Acceptance Scenarios**:

1. **Given** a category, **When** a worker moves it under another parent through the port, **Then**
   the tree, the audit entry and the storefront navigation refresh match the admin move.

---

### User Story 9 — Opportunities from server code (Priority: P3)

A CRM connector creates and updates opportunities, sets custom-field values, assigns them, moves them
through statuses, sets tags, links and unlinks records, adds comments and deletes them through the
Opportunity port.

**Independent Test**: parity per operation; the old transition port delegates.

**Acceptance Scenarios**:

1. **Given** an open opportunity, **When** a connector transitions it to a won status, **Then** the
   guards, audit entry and notices are those of the admin transition.

---

### User Story 10 — Tasks from server code (Priority: P3)

Server code creates, updates and deletes tasks, changes their status, sets custom-field values,
publishes them, relates and links them, adds reminders and comments through the Task port, alongside
the existing create-many and delete-in-context operations.

**Independent Test**: parity per operation; the old write port delegates.

**Acceptance Scenarios**:

1. **Given** a draft task, **When** a worker publishes it through the port, **Then** assignees are
   notified as on the admin path.

---

### User Story 11 — Placing an order for a customer, with a payer (Priority: P3)

An integration places an order for a customer from the customer's basket, naming a related payer
where the buyer may use one; the payer is validated by the related-payer rules and the order record
returned carries the payer.

**Why this priority**: placement is not a Command today and is the deepest conversion in the feature;
it may land after the rest of the Order port, as an additive change, without blocking it.

**Independent Test**: a worker places an order with a payer the related-payer rules allow and one they
refuse; the first is placed and audited once, the second refused with nothing written.

**Acceptance Scenarios**:

1. **Given** a buyer Organization with an active related payer, **When** an integration places an
   order naming that payer, **Then** the order is billed to the payer and the returned record carries
   the payer.
2. **Given** a payer the related-payer rules refuse, **When** the integration places the order,
   **Then** it is refused with the related-payer refusal and nothing is written.

---

### User Story 12 — The superseded narrow ports are gone in 0.114.0 (Priority: P3)

In the release after the deprecations shipped, the narrow ports and methods marked deprecated in
0.113.0 are removed; the release-intent check accepts the removal because the base release carried
the deprecation.

**Independent Test**: on the 0.114.0 branch the removals pass the check; a removal attempted on the
0.113.0 branch fails it.

**Acceptance Scenarios**:

1. **Given** the 0.113.0 release published with the deprecations, **When** the 0.114.0 branch removes
   them, **Then** every check passes and the upgrade note names each old call and its replacement.

---

### Edge Cases

- **No tenant context**: a port call outside any tenant context is refused before anything is
  written; a detached caller (a timer, a script) opens a system scope first.
- **Owner switched off**: for the four owners that can be switched off (quote requests, CRM,
  projects, tasks) every method fails closed with the module-disabled refusal; a consumer that
  catches it silently is refused by the existing port-catch check.
- **Same value**: a write that changes nothing writes nothing and records nothing, as on the admin
  path, unless a command hook noted a write of its own.
- **Concurrent change**: a caller passing the version it read gets a version conflict when the record
  moved on.
- **Hook extension input**: an extension key no present hook module claims is refused before anything
  is written.
- **Caller inside its own transaction**: a port call opens its own Command transaction; code that
  needs to write atomically with another module's Command uses a command hook, not a port call.
- **Side effects outside the write**: what the admin route does after or beside its write today (cache
  invalidation, search reindex, notices) happens for the port call too, or the parity test fails.
- **Deprecated and replacement used together**: in 0.113.0 a deprecated method and its replacement
  produce identical audit entries and hooks, because one delegates to the other.
- **Removal in the same release as the deprecation**: refused, because the base release did not carry
  the deprecation.
- **Dependency type changes** (MikroORM 7): not reported as a surface break by the comparison, which
  compiles both trees against one dependency set; they are announced by changesets and the upgrade
  note, as #1861 plans.

## Requirements *(mandatory)*

### Functional Requirements

**The aggregate port (all nine aggregates)**

- **FR-001**: Each of the nine aggregates MUST have exactly one published write port, named after
  the aggregate (`<aggregate>CommandPort`), owned by the aggregate's module.
- **FR-002**: Each port operation MUST run as exactly one audited Command, and MUST be the same
  Command the admin route for that operation runs, so the audit trail and command hooks see one write
  path.
- **FR-003**: Where the admin path of an in-scope operation is not a Command today (hand-audited, or
  unaudited), the feature MUST convert it to a Command used by both the admin route and the port,
  removing the hand-written audit in the same change, and MUST keep the audit action name the admin
  path records today, so audit history reads continuously.
- **FR-004**: The actor of every port operation MUST be the ambient one — an administrator inside an
  admin request, the administrator a worker acts for, or the system in a system scope — and MUST
  never be a parameter.
- **FR-005**: Every port operation MUST be callable from a worker under a system scope with no
  administrator present, and MUST refuse with no tenant context at all.
- **FR-006**: Every port operation MUST accept extension input for the command hooks on its action and
  MUST accept the version the caller read, refusing a stale one, where the admin route offers that
  concurrency rule.
- **FR-007**: Every port operation MUST accept an optional caller source code (for example the
  integration's module id), recorded as a code in the audit entry.
- **FR-008**: Refusals MUST be the same typed refusals the admin route answers, except status changes
  of Orders and Opportunities, which MUST answer refusals as outcomes (the payment-callback precedent).
- **FR-009**: A port MUST check no permission; its contract MUST say that the caller is the gate and
  that it is never resolved for a customer-facing route.
- **FR-010**: A port MUST declare no optional method; reads MUST live on the aggregate's read port,
  not its write port.
- **FR-011**: Each port's contract MUST document its behaviour when its owner is off.
- **FR-012**: Each port MUST offer `setCustomFieldValues` with the merge-callback shape the two
  existing server-side custom-field writes use (`specs/conventions/custom-field-writes.md`); for
  Product the bag is its attribute values.
- **FR-013**: Every side effect the admin route performs for an in-scope operation (notices, cache
  invalidation, search reindex, events) MUST also follow the port call.
- **FR-014**: The custom-field host list MUST name each host's aggregate port, and a host whose
  named port is missing, unregistered by its owner, or lacking `setCustomFieldValues` MUST fail the
  port-shape check.
- **FR-015**: The published records of Opportunity, Project and Task MUST carry their custom-field
  values, as the other six already do; the Order record MUST carry its payer.

**Per aggregate** (operations and their Commands are in `contracts/`)

- **FR-020** Organization (#1821): create, update, set parent, move, approve, reject, block, unblock,
  delete, set custom-field values, convert to company, change tax ID, set sales channels, set
  restrictions, set credit inheritance mode, assign and unassign a sales representative. The existing
  `organizationCommandPort` is widened in place; `organizationWritePort` and
  `organizationCustomFieldWritePort` delegate and are deprecated.
- **FR-021** CustomerAccount (#1822): create, create standalone, update profile, block, unblock,
  soft-delete, restore, set customer group, set custom-field values, set subtree roll-up, promote to
  organization administrator, mark e-mail verified, change role, set preferred language, remove
  member, anonymise. Moving between Organizations is excluded (membership port, spec 191). The
  lifecycle and member write ports delegate and are deprecated, except their membership methods,
  which spec 191 deprecates.
- **FR-022** Order (#1823): apply status, apply payment status, set custom-field values, add comment,
  set external reference; place (US11). Status, payment-status and external-reference writes of the
  capability ports delegate and are deprecated; the placement port is deprecated only when `place`
  lands. Reorder and clone to quote are excluded (research R-9).
- **FR-023** QuoteRequest (#1824): create for a customer, update, set custom-field values, assign,
  approve, cancel, send document. Buyer-side transitions are excluded and the contract says so.
- **FR-024** Product (#1825): create, update, archive, restore, delete, create/update/delete a
  variant, set custom-field (attribute) values, apply scoped values. Attribute-definition management
  moves to a separate Attribute port. The product write port and the scoped write port delegate and
  are deprecated; bulk import stays a separate capability port.
- **FR-025** Category (#1826): create, update, move, delete, set custom-field values, set inventory
  thresholds. The category write port delegates and is deprecated; its list read is the read port's.
- **FR-026** Opportunity (#1827): create, update, set custom-field values, assign, transition, set
  tags, link, unlink, add comment, delete. The transition port delegates and is deprecated.
- **FR-027** Project (#1828): create, update, set custom-field values, set Organizations, set members,
  move to a stage, close, reopen, link, unlink, add comment, delete. Archive and restore are not
  offered: the module has no such operation today.
- **FR-028** Task (#1829): create, create many, update, set status, set custom-field values, publish,
  relate, unrelate, link, unlink, add reminder, add comment, delete, delete in context. The task write
  port delegates and is deprecated.

**Stability — deprecation, the published surface, and its check (#1820)**

- **FR-030**: The port-per-aggregate rule MUST be written in the composition convention and pointed
  at from the customisation ladder (rung 3) and the kernel guide.
- **FR-031**: A deprecated surface entry MUST carry `@deprecated` naming the release that deprecated
  it and its replacement, or the words "no replacement" and a reason.
- **FR-032**: The published contract surface MUST be listed in one convention document and one
  published guide (English and Polish), by kind, each kind classified frozen, stable or additive-only
  with its compatibility direction, and each kind's entries derived from the tree rather than listed.
- **FR-033**: The release-intent check MUST compare the surface at HEAD with the previous release tag
  and fail when a stable entry is removed or changed incompatibly without having been deprecated in
  that release, when a frozen entry changes, or when an additive-only entry narrows; it MUST fail on
  an unparseable deprecation.
- **FR-034**: The check MUST exit with "nothing was read" when the base release cannot be resolved or
  its surface population is empty, and MUST print what it read.
- **FR-035**: The superseded narrow ports and methods MUST be deprecated in 0.113.0 and MUST NOT be
  removed before 0.114.0; the 0.114.0 removal MUST ship with an upgrade note (English and Polish)
  naming each old call and its replacement.
- **FR-036**: Each published change MUST carry a changeset written for the consumer (old call, new
  call).

### Key Entities

- **Aggregate port**: the one write port of an extensible aggregate; operations are the owner's
  Commands.
- **Narrow port (superseded)**: an earlier request-shaped write port, kept for one release, delegating
  to the aggregate port.
- **Published surface entry**: a thing an overlay or package may depend on, of a kind (port, container
  name, hookable action, hook data, manifest extension field, policy shape, middleware shape,
  extensible host table), with a stability tier and a compatibility direction.
- **Deprecation**: a marker on a surface entry naming the release that deprecated it and its
  replacement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the in-scope operations listed in `contracts/` for the nine aggregates can be
  performed from a worker with no administrator, each verified by a parity test against its admin
  route.
- **SC-002**: For every in-scope operation, the audit entry written by the port and by the admin route
  has the same action, object type and state shape; zero operations audit twice or not at all.
- **SC-003**: An instance built against 0.112.0 compiles and runs unchanged against 0.113.0 as far as
  this feature is concerned: zero removed or narrowed surface entries in 0.113.0.
- **SC-004**: Each finding kind of the surface comparison is demonstrated red on a fixture and green on
  its corrected twin; the check never reports green without having read the base release.
- **SC-005**: After the feature, the nine owner modules publish no write port other than their
  aggregate port and the capability ports the contracts list with a reason.
- **SC-006**: A deployment can implement the "investor on a project" case of #1828 with no core change
  beyond this feature and #1845.

## Open questions

- **Q-1** [NEEDS CLARIFICATION: the issues' "actor kind `automation` when no administrator is
  present" — does the owner want a new actor kind on the Command Bus, or the existing `system` kind
  with the caller's source code recorded beside it?] Recommendation: **the existing `system` kind
  plus the source code (FR-007)** — research R-4.
- **Q-2** [NEEDS CLARIFICATION: OD-4 admits no exception. May the owner sanction a deliberate break
  without a deprecation release (a security fix, a forced dependency change), recorded as a ledger
  entry citing a D-number and an upgrade-note anchor?] Recommendation: **yes, ledgered, two-way,
  emptied by each release** — research R-13.

## Assumptions

- 0.112.0 ships before this feature's first merge; 0.113.0 carries the deprecations, 0.114.0 the
  removals. "The previous release" is the highest `v*` tag reachable from the branch.
- No schema change and no migration: every operation writes columns its owner already has.
- No HTTP API change and no admin UI change; no new permission, palette action or setting.
- The paid modules in the separate repository use eight of the superseded ports; they migrate during
  0.113.x, after 0.113.0 publishes (precedent: the owner's 2026-11-23 ruling on adapting paid modules
  after a release publishes).
- Out of scope: hookable actions in newsletter, promotions and projects (#1843, #1844, #1845 — small,
  tracked under #1819); the membership port and join requests (#1831, #1832 →
  `specs/191-membership-join-requests/`); order configuration (statuses, transitions, list views);
  declaring new hookable actions on the nine owners.
