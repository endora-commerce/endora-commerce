# Feature Specification: Merging duplicate Organizations and duplicate Projects

**Feature Branch**: `spec/1907-organization-merge`
**Created**: 2026-11-24
**Status**: Draft. The owner answered OQ-1 to OQ-4 on 2026-11-25, each as recommended (see
*Clarifications* below). These answers are recorded as ruling **D-299** in `plan.md`; the number
is the next free one above the floor (D-283) and the highest in the tree (D-298), and must be
re-checked against open pull requests before merge. OQ-5 to OQ-12 were not asked. They stand as
assumptions the owner may still overturn, and `plan.md` § *Open items* lists them. No
`[NEEDS CLARIFICATION]` remains. `plan.md`, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md` and `tasks.md` are written.
**Input**: GitHub issue #1907: merging duplicate Organizations and duplicate Projects.

**Built on (cite by slug)**:
- `specs/186-aggregate-ports/` (D-293). Every owner module re-parents its own records through its
  own audited Commands, exposed on its aggregate port.
- `specs/191-membership-join-requests/` (D-298). The membership move carries members to the
  survivor.
- `specs/176-command-hooks-outbox/` (D-289). The merge Commands are hookable, and `afterCommit` work
  goes through the outbox.
- `specs/188-policy-points/` (D-295). A deployment can object to a merge.
- `specs/177-tax-id-scope/` (D-290). Covers the tax-ID scope and the organization tree.
- `specs/182-related-payers/`. Covers payer links and the payer stored on the order.
- `specs/175-sales-rep-reach-rule/`. Decides who reaches what.
- `specs/187-side-table-extensions/` (D-294). Side tables keyed by a host id.

The relevant rungs are the customisation ladder
(`docs/docs/architecture/customisation-ladder.md`) rungs 1–3 and the contract surface
(`docs/docs/architecture/contract-surface.md`).

## Clarifications

### Session 2026-11-25

Answers given by the owner (through the coordinator) to the four blocking questions of the first
draft. Each took the recommendation.

- Q: OQ-1. May a personal (B2C) Organization take part in a merge? → A: No. Any merge involving
  a personal Organization is refused (FR-023).
- Q: OQ-2. What happens when a step fails partway, and can a merge be undone? → A: A
  forward-only, resumable background job. Steps are idempotent, failures are retried, then the
  merge shows *needs attention* with a resume action. A merge can be cancelled only before records
  start moving, and there is no unmerge (FR-008, FR-009, FR-011, FR-012).
- Q: OQ-3. Which pairs in the organization tree may be merged? → A: Two roots, or two members of
  the same tree, and the loser may never be an ancestor of the survivor. The loser's children move
  under the survivor (FR-021, FR-022, FR-042).
- Q: OQ-4. What happens to modules that are off at merge time? → A: They are skipped, and their
  part runs automatically when they are switched back on (FR-070, FR-071).

## Context

A store accumulates duplicates. The same company registers twice, an ERP import creates a second
record for a company that already self-registered, or a sales representative creates a customer
without finding the existing one. The same happens to Projects, when two representatives open the
same tender. Today the only remedy is manual:

1. move each person by hand (`specs/191-membership-join-requests/` FR-001);
2. accept that orders, quotes, invoices, returns, opportunities, credit and pricing stay split
   across two records (191 FR-009 keeps data with the Organization a person *left*, and that is
   correct for a move but wrong for a duplicate);
3. block or delete the duplicate, which loses its history or strands it.

A **merge** declares that two records were always one. Everything the duplicate (the **loser**)
holds follows the record that stays (the **survivor**). The loser stays as an archived record that
points at the survivor, so old references still resolve.

The hard part is not one module. On `master` (`67351db04`), **29 modules plus the platform kernel** hold an
Organization reference (inventory below). Under Principle I, `organizations` may not write any of their tables.
The merge is therefore an **orchestration across owners**. Each owner moves its own records with its
own Command, and the orchestration has to survive one owner failing halfway.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Survivor** | The record that remains and receives everything. |
| **Loser** | The duplicate. After the merge it is archived and carries a pointer to the survivor. |
| **Merge** | One recorded operation (survivor, loser, the operator's field choices, its steps and their states). It has an id that every step's audit entry carries. |
| **Merge preview** | The read-only answer to "what would happen": refusals, counts per owner, conflicts and field differences. Nothing is written. |
| **Step** | One owner module's part of a merge: its records re-parented by its own Command(s), idempotent and resumable. |
| **Merge participant** | A module that holds a reference to the merged host (Organization or Project) and declares how its records follow. It provides the preview counts and conflicts and performs its step. |
| **Disposition** | What happens to one kind of record: **re-point**, **union**, **survivor wins** (optionally **fill gaps**), **sum**, **stricter**, or **kept on the loser**. See the inventory. |
| **Tree / root** | As in `specs/177-tax-id-scope/`. An Organization and its descendants, and the ancestor with no parent. |
| **Personal Organization** | The single-member Organization of a B2C customer (D-178). It has no tax ID (177 FR-001). |

## Two scopes, and how they ship

- **Organization merge** (US1–US5) is the main need. It touches 29 modules and the kernel, and carries every
  cross-cutting rule below.
- **Project merge** (US6) is smaller. Almost everything stays inside `projects`, and only `tasks`
  and `crm` hold Project references. It reuses the same mechanism: a merge record, participants,
  steps, an archived loser with a pointer, and an audit trail.

**Recommendation (assumed; see OQ-5)**: one specification and one mechanism, delivered in **two
releases**. Organization merge comes first. Project merge follows on the mechanism the first
delivery proves. The mechanism stays generic, keyed by host type, so that a later merge of another
host (for example a customer account) is a new participant set and not a new design.

## User Scenarios & Testing *(mandatory)*

### User Story 1: An operator merges a duplicate Organization into the real one (Priority: P1)

An operator finds two Organizations for the same company. One holds two years of orders. The other
was created last week by an ERP import and already has a buyer, an open basket and one quote
request. From the survivor's screen, the operator chooses *Merge a duplicate into this
organization*, picks the duplicate, and reviews the preview. The preview shows what moves, per area
and with counts, and which values differ. The operator chooses the values to keep and confirms.
Within minutes the survivor shows both companies' people, addresses, orders, quotes, invoices,
returns, opportunities and projects. The duplicate is archived and says *Merged into …*.

**Why this priority**: this is the whole feature. Without it the store keeps split histories, split
credit and split pricing for one customer.

**Independent Test**: seed two Organizations with records in every participant module, merge one
into the other, and assert two things. Every record the inventory marks *re-point* or *union* now
belongs to the survivor. Every record marked *kept on the loser* is unchanged.

**Acceptance Scenarios**:

1. **Given** Organizations A (survivor) and B (loser) in the same tenant, both reachable by the
   operator, **When** the operator previews merging B into A, **Then** the preview lists, per
   participant, how many records will move, the conflicts that will be resolved and how, the field
   values that differ, and any refusal. Nothing is written.
2. **Given** the preview, **When** the operator confirms with a field choice (for example B's legal
   name and A's tax ID), **Then** the merge starts. B can no longer be written by anyone else, and
   the operator sees the merge's progress.
3. **Given** a merge that finished, **When** anyone opens A, **Then** A holds B's members (with
   mapped roles), addresses, orders, quote requests, invoices, returns, carts, shopping lists,
   opportunities, project participations, payer links, credit exposure, price-list audiences and
   sales channels, as the inventory's dispositions say.
4. **Given** the same merge, **When** anyone opens B, **Then** B is shown as archived and *merged
   into A* (with when and by whom), is read-only, appears in no list, picker or search, and its
   address in the Admin UI leads to A.
5. **Given** a member of B who was signed in during the merge, **When** they make their next
   request after their move, **Then** they act for A with their mapped role and are not signed out
   (191 FR-008).
6. **Given** custom-field values on both A and B, **When** the merge completes, **Then** for each
   field A keeps its value, a field A left empty takes B's, and a field the operator explicitly
   chose from B takes B's (FR-030).

---

### User Story 2: The merge refuses what it cannot do safely (Priority: P1)

The operator tries merges that must not happen, and each is refused with a reason before anything is
written: an Organization merged into itself, into its own descendant, or across two unrelated trees;
a personal Organization; a pair one of whose records is already in another merge; or a pair the
operator does not reach.

**Why this priority**: a wrong merge cannot be undone (FR-012). The refusals are the safety net.

**Independent Test**: each refusal row of FR-020 to FR-027 is exercised through the preview and
through the start command, and the answer is the same in both with nothing written.

**Acceptance Scenarios**:

1. **Given** B is an ancestor of A, **When** the operator previews B into A, **Then** the merge is
   refused and the reason names the tree.
2. **Given** A and B are non-root members of two different trees, **When** the operator previews,
   **Then** the merge is refused (OQ-3).
3. **Given** B is a personal Organization, **When** the operator previews, **Then** the merge is
   refused (OQ-1).
4. **Given** a sales representative who reaches A but not B, **When** they try to preview, **Then**
   it is refused as if B did not exist for them (175 FR-001).
5. **Given** an order placement for B is in flight, **When** the operator starts the merge, **Then**
   the start is refused as temporarily unavailable and can be retried. Nothing is written.

---

### User Story 3: History stays explainable after the merge (Priority: P1)

Months later an auditor asks why an invoice issued to the duplicate appears on the real company's
account, and an integration sends an order update naming the duplicate's id. The audit trail
answers the first question in one place: who merged what, when, and with which choices, with every
re-parenting Command carrying the merge id. The integration gets a clear answer naming the
survivor.

**Why this priority**: merges rewrite ownership across the whole platform. Without one trail and a
resolvable old id, the result cannot be explained or integrated.

**Independent Test**: after a merge, the survivor's history lists the merge as one entry with a
drill-down to its steps. Every audit entry written by the merge carries the merge id. Reading B by
id answers *merged into A*. A write naming B is refused with A's id.

**Acceptance Scenarios**:

1. **Given** a completed merge, **When** the operator opens A's history, **Then** one *merged B into
   A* entry shows the actor, time, the field choices (as names and codes, never the values
   themselves, per `specs/conventions/audit-state.md`) and per-participant counts.
2. **Given** a completed merge, **When** server code reads B through the Organization read port,
   **Then** it receives B as archived with its survivor's id.
3. **Given** a completed merge, **When** server code or an API client writes to B (for example
   creates an order for it), **Then** the write is refused with a code that names A (OQ-6).
4. **Given** a webhook subscribed to Organization events, **When** the merge completes, **Then** it
   receives exactly one *organization merged* event carrying both ids and the merge id, and no flood
   of per-record update events.

---

### User Story 4: An interrupted merge finishes, and a module that was off catches up (Priority: P2)

A merge is halfway through when one owner's step fails, for example on a database timeout or a
restarted worker. The merge does not leave the two Organizations half-merged and forgotten. It
retries, and if it still fails it stops in a visible *needs attention* state that the operator can
resume. Separately, the store had the CRM module switched off on the day of the merge. When the CRM
is switched back on, B's opportunities follow A without anyone doing anything.

**Why this priority**: thirty owners means partial failure is a certainty at scale. A module that is
off must behave as never installed (Principle XVII) without losing its records' path to the
survivor.

**Independent Test**: inject a failure into one participant's step. Assert that earlier steps stay
done, that the merge retries and then shows *needs attention*, and that *resume* completes it with no
duplicate effect. Then switch a participant off, merge, switch it on, and assert that its records
are re-parented by its own step on activation.

**Acceptance Scenarios**:

1. **Given** a merge whose orders step fails after the addresses step succeeded, **When** the
   automatic retries are exhausted, **Then** the merge shows *needs attention* naming the step and
   its error. B stays frozen, and finished steps are not repeated on resume.
2. **Given** the operator resumes, **When** the failing step now succeeds, **Then** the remaining
   steps run and the merge completes exactly as an uninterrupted one would.
3. **Given** the CRM module is off during the merge, **When** the merge runs, **Then** the CRM step
   is recorded as *deferred (module off)*, the merge completes for every other owner, and nothing
   about the CRM is shown or written (OQ-4).
4. **Given** that deferred step, **When** the CRM module is switched back on, **Then** its step runs
   once and is recorded on the original merge with the original merge id.

---

### User Story 5: An integration merges duplicates it created (Priority: P3)

An ERP connector learns from its own master data that two of its customer numbers were merged. It
asks the platform to merge the corresponding Organizations, with no administrator present, and it
names itself as the source.

**Why this priority**: duplicates created by integrations are usually discovered by integrations.
D-293 says every aggregate operation an operator has must be available to server code.

**Independent Test**: from a worker under a system scope, request a preview and a merge through the
Organization port. Assert the same refusals, steps, audit entries (system actor plus source code)
and events as the admin path.

**Acceptance Scenarios**:

1. **Given** a worker with no administrator, **When** it merges B into A through the port with a
   source code, **Then** the merge runs as the system actor, records the source, and behaves exactly
   as the admin merge.
2. **Given** a deployment rule that objects to merges between Organizations with different ERP
   customer numbers, **When** a merge is started, **Then** it is refused with that rule's reason and
   nothing is written (FR-061).

---

### User Story 6: An operator merges two duplicate Projects (Priority: P2)

Two representatives opened the same tender as two Projects. The operator merges one into the other.
The survivor gains the loser's comments, attachments, linked orders, quotes and opportunities,
Organizations, members, viewers and tasks. The loser is archived, points at the survivor, and keeps
its own stage history.

**Why this priority**: it was asked for in the same issue and reuses the mechanism. It is lower
because a duplicate Project is cheaper to live with than a duplicate customer.

**Independent Test**: seed two Projects with comments, attachments, links, Organizations, members,
viewers, tasks and mentions, merge them, and assert each disposition of the Project inventory.

**Acceptance Scenarios**:

1. **Given** Projects P (survivor) and Q (loser), **When** the operator merges Q into P, **Then**
   Q's comments and attachments appear in P in chronological order, Q's links move to P, and P's
   Organizations and members become the union of both (P's role kept on a conflict).
2. **Given** tasks in Q's context, **When** the merge completes, **Then** they are in P's context.
   Those that belonged to one of Q's stages are attached to P with no stage (FR-092).
3. **Given** a comment elsewhere that mentions Q, **When** it is displayed after the merge, **Then**
   the mention leads to P.
4. **Given** the Projects module is off, **When** anyone looks for project merge, **Then** it does
   not exist (Principle XVII).

---

### Edge Cases

- **Merge into itself**: refused before anything else.
- **Chains**: A already absorbed C, and B is now merged into A. Allowed, and a pointer to C resolves
  through A. An archived loser can never be a survivor or a loser again, and pointers are never
  longer than one hop, because a loser cannot be merged.
- **Two merges racing on one record**: the second start is refused. At most one running merge
  involves a given Organization (as survivor or loser).
- **Survivor not active**: a survivor that is *pending verification* or *blocked* may receive a
  merge, and its status is unchanged. A *rejected* or deleted survivor is refused. A loser may be in
  any status except deleted or already merged.
- **Loser has children**: they move under the survivor (one tree move each, as `setParent`). Under
  `per-tree-root` this never creates a tax-ID conflict, because both are in the survivor's tree
  afterwards (OQ-3 limits which pairs qualify).
- **Tax IDs**: under `global` the two cannot share a tax ID (177 FR-011, soft-deleted included). If
  the operator keeps the loser's tax ID for the survivor, the loser's must be released in the same
  write that sets the survivor's, or the database refuses it. Under `per-tree-root` an archived
  loser keeps its tax ID where that is legal, and releases it otherwise.
- **Last administrator**: moving B's last administrator would be refused by 191 FR-004. A merge move
  is exempt, because B is being archived and not depleted.
- **Same person in both**: two accounts for one person stay two accounts in A. Merging customer
  accounts is out of scope, and the preview flags accounts whose names match.
- **Role names clash**: B's predefined roles map onto A's predefined roles. A custom role of B maps
  to A's role with the same name, or is copied into A if A has none (FR-041).
- **Payer links between the two**: a payer link from B to A (or A to B) becomes a link from A to
  itself. It is revoked, and its pending requests are closed with a merge reason. Where A and B both
  have a link to the same payer, A's link is kept and B's is revoked.
- **Carts**: open carts move with their buyers and are repriced in the survivor's context on their
  next read. Lines that lose their price stay in the cart, marked as unpriced (182 FR-114
  precedent). A cart *Buying for* B becomes *Buying for* A, and is cleared if that is now the cart's
  own Organization.
- **Credit**: A's limit stays. B's open reservations become A's exposure, which may put A over its
  limit. The preview says so, and the merge is not refused for it (OQ-8).
- **Organization-specific prices**: where both have a specific price for the same product, A's
  wins. Where only B has one, A gains it.
- **Products visible only to selected Organizations**: B is replaced by A in every allow-list (union
  without duplicates), so A's members see what B's members saw.
- **Promotion usage limits per Organization**: B's usage counts are added to A's, so the merge
  cannot be used to reset a limit.
- **Concurrent writes during the merge**: any write that names B (by an operator, a buyer of B not
  moved yet, an integration or a timer) is refused as *merge in progress*. Writes to A continue.
- **A participant module removed from the platform (not only off)**: its step is recorded as
  *deferred* and runs if the module is installed and activated again. Hard uninstall drops its
  tables, and with them the step's work.
- **Huge loser**: a loser with hundreds of thousands of orders or events is processed in batches by
  each owner. A batch is one Command, the merge shows progress, and nothing locks A's or B's tables
  for the whole merge.
- **Mentions in free text**: tokens like a Project mention inside a comment are not rewritten. They
  resolve to the survivor when rendered (FR-093).
- **Search**: until the loser's step on a search index completes, the loser may still appear in an
  index for seconds. Opening it leads to the survivor.

## Requirements *(mandatory)*

### Functional Requirements

**The merge as an operation (Organizations and Projects alike)**

- **FR-001**: The platform MUST let an authorized actor merge one Organization (the loser) into
  another (the survivor), and one Project into another, as a single recorded **merge** with its own
  id.
- **FR-002**: Every merge MUST first be available as a **preview** that writes nothing. The preview
  returns every refusal, per participant the count of records that will follow, the conflicts and
  how they will be resolved, and the field values that differ.
- **FR-003**: Starting a merge MUST re-check everything the preview checked. A preview MUST NOT
  reserve anything, and a merge started from an outdated preview MUST use the current state. If a
  refusal now applies, the start MUST be refused.
- **FR-004**: Starting a merge MUST, in one Command owned by the host's module, record the merge
  (survivor, loser, field choices, actor, source) and **freeze** the loser. From then on every write
  naming the loser, other than the merge's own steps, MUST be refused as *merge in progress*.
- **FR-005**: Each module that holds references to the host MUST re-parent its own records in its own
  **step**, through its own audited Command(s), exposed on its aggregate port where the records
  are an aggregate (`specs/186-aggregate-ports/`). No module MAY write another module's records for
  a merge (Principle I).
- **FR-006**: Steps MUST run in a declared, deterministic order of phases. For an Organization
  merge the phases are **structure** (children, sales channels, sales representatives, roles), then
  **configuration** (per-Organization settings in other modules), then **addresses**, then
  **members**, then **records** (business records, independent of each other), then **finalize**
  (field values onto the survivor, archive the loser with its pointer, release a tax ID, emit the
  merged event). Within a phase, participants MAY run in any order or in parallel.
- **FR-007**: Every step MUST be **idempotent and resumable**. Running it again after partial
  success MUST move only what is still the loser's and MUST NOT duplicate a union or a sum. Each
  step's state (pending, running, done, failed, deferred) and counts MUST be stored on the merge.
- **FR-008**: The merge MUST be executed by a background job following the queue-consumer pattern
  (Principle X). A failed step MUST be retried automatically. When retries are exhausted, the merge
  MUST stop in *needs attention* with the step and error visible to the operator, the loser still
  frozen, and an operator action to **resume**.
- **FR-009**: A merge MUST be **forward-only** once its first re-parenting step has committed. There
  is no automatic rollback (D-299, OQ-2).
- **FR-010**: Large volumes MUST be processed in bounded batches, each one Command, so that no merge
  holds a lock on a whole table and progress is visible.
- **FR-011**: A merge that has started but whose first re-parenting step has not committed MAY be
  cancelled by the operator. Cancelling unfreezes the loser and records the cancellation.
- **FR-012**: There MUST be no *unmerge* operation, and the Command Bus undo MUST NOT be offered for
  any merge Command. The preview and the confirmation MUST say that the merge cannot be undone.

**Refusals (Organization merge)**

- **FR-020**: A merge MUST be refused when the survivor and loser are the same, when either is
  deleted or already merged, when the survivor is rejected, or when either is in another merge that
  has not finished.
- **FR-021**: A merge MUST be refused when the loser is an ancestor of the survivor.
- **FR-022**: A merge MUST be allowed only when both are roots or both are in the same tree, and
  refused for non-root Organizations of two different trees (D-299, OQ-3).
- **FR-023**: A merge MUST be refused when either Organization is personal (D-299, OQ-1).
- **FR-024**: A merge MUST be refused, as temporarily unavailable and retryable, while an order
  placement or a payment is in flight for the loser. Open carts, pending quote requests, open
  returns and pending payer requests MUST NOT refuse a merge. They follow the survivor (OQ-7).
- **FR-025**: A merge MUST be refused when the actor does not reach both Organizations (FR-050). The
  refusal MUST NOT reveal whether the unreachable one exists.
- **FR-026**: A merge MUST be refused when a participant's preview reports a conflict it cannot
  resolve by its declared disposition. The refusal MUST name the participant and the conflict.
- **FR-027**: A deployment MUST be able to object to a merge before it starts (FR-061), and the
  objection MUST refuse it with the deployment's reason, writing nothing.

**Survivor's values**

- **FR-030**: For each field of the host itself (Organization: name, legal name, tax ID, VAT status,
  registered address, customer group, order confirmation e-mails, credit inheritance mode,
  fulfilment strategy; Project: title, description, value, start date, visibility), the survivor's
  value MUST win, except that a survivor field that is empty MUST take the loser's value, and the
  operator MAY choose the loser's value per field in the preview. Order confirmation e-mails MUST be
  the union of both.
- **FR-031**: Custom-field values MUST follow the same rule per field: survivor wins, empty survivor
  fields take the loser's value, and per-field operator choice is allowed. Multi-valued fields MUST
  NOT be combined. The chosen values MUST pass the field definitions' validation, or the start MUST
  be refused naming the field. The write MUST go through the host's `setCustomFieldValues`
  (`specs/conventions/custom-field-writes.md`).
- **FR-032**: Moderation state (status, approval, block and reject stamps) and the tree position MUST
  remain the survivor's and MUST NOT be offered for choice.
- **FR-033**: When the tax ID chosen for the survivor is the loser's, the survivor MUST take it in
  the same Command that releases it from the loser, together with the loser's most recent VAT
  validation result. The rule of the tax-ID scope in force MUST hold at every commit (177 FR-013).
- **FR-034**: Per-Organization configuration held by other modules (inventory disposition *survivor
  wins*) MUST keep the survivor's rows. Where the survivor has no row and the participant declares
  *fill gaps*, it MUST adopt the loser's. A security policy MUST take the stricter of the two
  (disposition *stricter*).

**What follows the survivor (Organization merge)**

- **FR-040**: Every reference listed in *Organization references on master* below MUST be handled by
  its owner with the disposition listed there. A record is never left pointing at the loser unless
  its disposition is *kept on the loser*.
- **FR-041**: Members MUST move through the membership operation of
  `specs/191-membership-join-requests/` with a new **merge** mode. That mode MUST be exempt from the
  last-administrator refusal for the loser, MUST map predefined roles to the survivor's predefined
  roles and custom roles by name (copying a missing custom role into the survivor), and MUST publish
  191's *organization changed* notice with the merge as its origin. Pending invitations of the loser
  MUST be re-pointed with the mapped role.
- **FR-042**: The loser's child Organizations MUST be moved under the survivor as ordinary tree moves.
  The loser's sales channels and sales-representative assignments MUST be added to the survivor's
  (union).
- **FR-043**: Issued documents (invoices, credit notes, order and quote documents) MUST keep their
  printed buyer data unchanged. Only their owning Organization changes, so that the survivor's users
  and operators find them.
- **FR-044**: External-system mappings (an invoice-ledger client mapping, an order's external
  references) MUST keep the survivor's mapping where both exist. The loser's mapping MUST be kept
  with the archived loser, and the preview and the merge record MUST list it, so the operator can
  merge the counterpart in the external system (OQ-10).
- **FR-045**: Every module whose records hold a reference to an Organization or a Project MUST declare
  its merge participation (its dispositions) in its own module. A static check MUST fail when an
  entity holding such a reference belongs to a module that declares no participation covering it.
  The same rule MUST apply to deployment overlays and installed packages that key side tables on a
  host id (`specs/187-side-table-extensions/`).

**The archived loser, identity and events**

- **FR-050**: Only an actor holding the new merge permission (`organizations:merge`, `projects:merge`)
  MAY preview or merge. A sales representative or scoped administrator MUST also reach both
  Organizations under the one reach rule (`specs/175-sales-rep-reach-rule/`). For Projects, they
  MUST be able to see and edit both. The permissions MUST be registered in the admin permission
  manifest, and neither MUST be granted to a predefined sales-representative role by default.
- **FR-051**: After a merge, the loser MUST remain as an archived, read-only record carrying its
  survivor's id, the merge id and the time. It MUST be excluded from every list, picker, search
  result, count and storefront resolution.
- **FR-052**: Reads of the loser by id (admin route, read port) MUST answer the archived loser with
  its survivor's id. The Admin UI MUST lead from the loser to the survivor.
- **FR-053**: Writes naming the loser MUST be refused with a distinct code carrying the survivor's
  id (OQ-6).
- **FR-054**: On completion the host's module MUST publish exactly one versioned event
  (`organization.merged.v1` / `project.merged.v1`) carrying the survivor id, the loser id and the
  merge id. It MUST be available as a webhook event type, delivered to subscriptions bound to the
  survivor (subscriptions bound to the loser having been re-pointed first). Re-parenting steps MUST
  NOT publish per-record update events or webhooks.
- **FR-055**: Each owner's step MUST refresh what it owns (search index documents and caches keyed
  by either Organization or Project) through its own index refresh and the lifecycle pub/sub
  invalidation pattern. The loser MUST be removed from every index, and the survivor MUST be
  reindexed after finalize.

**Audit, hooks, server-side access**

- **FR-060**: The start, cancel, resume and finalize of a merge MUST each be one audited Command of
  the host's module. Every Command a step runs MUST carry the merge id in its audit entry. The
  survivor's and the loser's history MUST each show the merge as one entry, with its steps reachable
  from it. Audit states MUST record ids, names and codes, never values
  (`specs/conventions/audit-state.md`).
- **FR-061**: The start Command MUST be a hookable action (176 FR-010), so a deployment can veto it
  before commit or act after commit through the outbox. A deployment MUST also be able to take part
  as a merge participant for its own side tables.
- **FR-062**: Preview and merge MUST be available to server code on the host's aggregate port
  (`organizationCommandPort`, `projectCommandPort`) with the ambient actor and an optional source
  code (D-293.6), with the same refusals and effects as the admin path.
- **FR-063**: The audit log itself MUST NOT be rewritten. Entries recorded against the loser stay
  against the loser and are reachable from the survivor's history through the merge.

**Modules that are off, tenancy**

- **FR-070**: A participant module that is not effectively present when the merge runs MUST NOT run,
  MUST NOT be shown in the preview, and its step MUST be recorded as *deferred*. The merge MUST
  complete without it (D-299, OQ-4).
- **FR-071**: When a module with deferred steps becomes effectively present again, its deferred steps
  MUST run automatically, once, under the original merge id. Until then, nothing it owns MAY be
  observable, as Principle XVII requires.
- **FR-072**: Project merge MUST exist only while `projects` is effectively present. Its admin
  surfaces, palette action and port method MUST follow the module's off state.
- **FR-073**: No step MAY produce a tenant-scoped record without an Organization. Every re-pointed
  record MUST pass the tenant write guard as a record of the survivor (Principle XI). The merge
  MUST run inside the tenant context of the store, never across tenants.

**Admin surfaces and i18n**

- **FR-080**: The Admin UI MUST offer the merge from the survivor's record screen (Organization and
  Project), with a guided flow: pick the duplicate, preview, choose values, confirm with an explicit
  "cannot be undone" acknowledgment, and progress. The merge's state MUST also be visible from the
  loser.
- **FR-081**: The Admin UI MUST list merges that need attention, with a resume action, to holders of
  the merge permission.
- **FR-082**: The command palette MUST offer *Merge organizations* and *Merge projects* actions under
  the same permissions and module state (Principle XVI).
- **FR-083**: Every user-facing string, including refusal messages and the archived-record banner,
  MUST exist in English and Polish. Merge notices to buyers are not sent, except 191's existing
  membership notice behaviour (OQ-11).

**Project merge**

- **FR-090**: A Project merge MUST be refused when the two are the same, when either is already
  merged, or when the actor cannot see and edit both. Both MAY be in any state. The survivor keeps
  its state and current stage.
- **FR-091**: The survivor MUST gain the loser's comments and attachments, links to orders, quotes
  and opportunities, Organizations (union), members (union, survivor's role on conflict) and viewers
  (union). Organizations a linked record needs MUST be added before the link moves.
- **FR-092**: Tasks in the loser's context MUST move to the survivor's context through the task
  module's own Command. A task tied to one of the loser's stages MUST lose its stage tie.
- **FR-093**: The loser's stage history, stage moves, value changes, stage tasks configuration and
  alerts MUST stay with the archived loser. Reference rows naming the loser as a target (in tasks,
  opportunities and projects) MUST be re-pointed by their owners. Mention tokens inside free text
  MUST NOT be rewritten and MUST resolve to the survivor when rendered.
- **FR-094**: Comments moved from the loser MUST NOT appear as unread to members who had read them.

### Organization references on master *(verified inventory)*

Derived on `67351db04` from the entities in `packages/modules/*/src/backend/entities/` that hold an
Organization id, plus polymorphic scopes (`scope = 'organization'`) and id arrays. The plan MUST
re-derive this list rather than trust it (FR-045 makes the check the source of truth). Dispositions
are the proposed defaults. *R* = re-point, *U* = union without duplicates, *S* = survivor wins,
*S+f* = survivor wins with fill gaps, *Σ* = sum, *K* = kept on the loser.

| Owner module | Records (entity file under `packages/modules/<owner>/src/backend/entities/`) | Disposition | Phase |
| --- | --- | --- | --- |
| `organizations` | the Organization row (`organization.entity.ts`): loser archived with pointer; fields per FR-030–FR-033; children `parent_id`/`path` | field choice; children R | structure / finalize |
| `organizations` | `organization-role.entity.ts` | predefined mapped, custom by name, else copied | structure |
| `organizations` | `organization-invitation.entity.ts` (pending) | R with mapped role | structure |
| `organizations` | `organization-sales-rep-assignment.entity.ts` | U | structure |
| `organizations` | `organization-payment-method-link`, `-delivery-method-link`, `-warehouse-link` (allow-lists) | S | configuration |
| `organizations` | `organization-tax-id-validation.entity.ts` | K (latest result travels with a chosen tax ID, FR-033) | finalize |
| platform kernel | sales-channel memberships (`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`) | U | structure |
| `customer_accounts` | `customer-account.entity.ts` (`organizationId`, `organizationRoleId`) | R via membership move, merge mode | members |
| `addresses` | `address.entity.ts` | R (survivor's defaults kept) | addresses |
| `carts` | `cart.entity.ts` (`organizationId`, `buyingForOrganizationId`) | R, repriced on next read | records |
| `orders` | `order.entity.ts` (`organizationId`, `payerOrganizationId`), `order-external-reference`, `order-transition-effect` | R | records |
| `orders` | `order-placement-intent.entity.ts` | in flight → refuse start (FR-024); settled → R | records |
| `quote_requests` | `quote-request.entity.ts`, `quote-request-notification.entity.ts` | R | records |
| `quote_requests` | `quote-request-org-policy.entity.ts` | S+f | configuration |
| `invoices` | `invoice.entity.ts` | R (printed data unchanged, FR-043) | records |
| `invoice_ledger` | `invoice-ledger-client-map.entity.ts` | S+f; loser's kept and listed (FR-044) | configuration |
| `invoice_ledger` | `invoice-ledger-document-map.entity.ts` | R | records |
| `invoice_ledger` | `invoice-ledger-delivery.entity.ts` | K (delivery log) | — |
| `credit_limits` | `credit-limit.entity.ts` | S+f | configuration |
| `credit_limits` | `credit-limit-reservation.entity.ts`, `credit-limit-return-topup.entity.ts` | R | records |
| `related_payers` | `related-payer-link.entity.ts` (both sides) | R; self-links and duplicates revoked | records |
| `related_payers` | `related-payer-request.entity.ts` (both sides) | R; self-requests closed | records |
| `price_lists` | `price-list-audience-member.entity.ts` | U | configuration |
| `price_lists` | `price-list-matrix-entry.entity.ts` (Organization-specific prices) | S+f per product | configuration |
| `price_lists` | `price-display-mode-override.entity.ts` (scope `organization`) | S+f | configuration |
| `promotions` | `promotion.entity.ts` (Organization-specific), `promotion-usage.entity.ts` | R | records |
| `promotions` | `promotion-usage-counter.entity.ts` (scope `organization`) | Σ | records |
| `catalog` | `product.entity.ts`, `product-channel-scope.entity.ts` (`allowedOrganizationIds`) | loser replaced by survivor, U | configuration |
| `crm` | `crm-opportunity.entity.ts` | R (Opportunity port) | records |
| `projects` | `project-organization.entity.ts` | U | records |
| `projects` | `project-link.entity.ts` (`organizationId` of the linked record) | R | records |
| `returns` | `return-case.entity.ts`, `return-case-attachment.entity.ts`, `return-withdrawal-statement.entity.ts` | R | records |
| `shopping_lists` | `shopping-list.entity.ts` | R | records |
| `comparisons` | `comparison.entity.ts` | R | records |
| `inventory` | `availability-notification.entity.ts` | R | records |
| `forms` | `form-entry.entity.ts` (nullable Organization) | R | records |
| `newsletter` | `newsletter-subscriber.entity.ts` | R | records |
| `customer_notifications` | `customer-notification.entity.ts` | R | records |
| `pwa` | `push-subscription.entity.ts`, `push-notification-preference.entity.ts` | R (preference de-duplicated per account) | records |
| `quick_order` | `quick-order-default-preference.entity.ts` (scope `organization`) | S+f | configuration |
| `mfa` | `mfa-organization-policy.entity.ts` | stricter | configuration |
| `api_keys` | `api-key.entity.ts` (bound distributor key) | R (OQ-9) | records |
| `webhooks` | `webhook.entity.ts` (Organization-bound subscription) | R, before finalize (FR-054) | records |
| `analytics` | `analytics-event.entity.ts` | R, batched (OQ-12) | records |
| `admin_users` | `impersonation-reason.entity.ts` | K (security log) | — |
| platform kernel | audit log entries (`packages/platform/src/kernel/audit/audit-log-entry.entity.ts`) | K, never rewritten (FR-063) | — |
| `admin_search` and every module's search documents | index entries | loser removed, survivor reindexed (FR-055) | finalize |

Not an Organization reference, though it mentions one: saved admin list views that store an
Organization filter (`quote-request-list-saved-view`, `crm-opportunity-list-saved-view`,
`product-list-saved-view`). These are not rewritten. A filter on the loser shows its archived banner
leading to the survivor. Organizations have **no notes or comments of their own** on `master`.
Comments and attachments belong to records (orders, opportunities, projects, returns, tasks) and
follow their record. Tasks carry no Organization (`tasks/src/backend/entities/task.entity.ts`).

### Project references on master *(verified inventory)*

| Owner module | Records | Disposition |
| --- | --- | --- |
| `projects` | the Project row (`project.entity.ts`): loser archived with pointer (it has no archive or soft delete today, and its delete cascades, so the loser cannot be deleted) | field choice |
| `projects` | `project-comment`, `project-attachment`, `project-link` | R (links: a record stays in one Project) |
| `projects` | `project-organization`, `project-member`, `project-viewer` | U (survivor's role on conflict) |
| `projects` | `project-reference` (as source and as target) | R |
| `projects` | `project-message-read` / `-baseline` | carried so moved comments are read (FR-094) |
| `projects` | `project-stage`, `project-stage-entry`, `project-stage-move`, `project-stage-task`, `project-stage-alert-delivery`, `project-value-change` | K |
| `tasks` | tasks with context `project` (`PROJECT_TASK_CONTEXT_TYPE`, `projects/src/backend/services/project-tasks.ts`); `task-reference.entity.ts` targets | R (stage tie dropped) |
| `crm` | `crm-opportunity-reference.entity.ts` targets of type `project` | R |
| text tokens `[[project:<id>]]` (`packages/contracts/src/record-references.ts`) | — | not rewritten; resolved (FR-093) |

### Key Entities

- **Merge**: host type (Organization or Project), survivor, loser, field choices, actor, source,
  state (*running*, *needs attention*, *completed*, *cancelled*), timestamps, and its steps. It is
  owned by the host's module.
- **Merge step**: one participant's part. Participant module, phase, state (*pending*, *running*,
  *done*, *failed*, *deferred*), counts, last error, attempts.
- **Merge participation**: a module's declaration of which of its records reference a host type and
  with which disposition. It is the input of the preview, of the step order and of the completeness
  check of FR-045.
- **Archived loser**: the loser record with its survivor's id, merge id and merge time.

### Interfaces and ownership *(ownership only, not mechanics; the plan decides the shapes)*

- `organizations` owns the Organization merge: preview, the merge record and its start, cancel,
  resume and finalize Commands, the freeze, the archived loser, the tree, roles, sales
  representatives, allow-lists, the event and the permission. It publishes them on
  `organizationCommandPort` (`specs/186-aggregate-ports/contracts/organization-command-port.md`) and
  reads them on its read port.
- `projects` owns the Project merge on the same terms through `projectCommandPort`.
- Every holder module performs its step with its own Commands. For the aggregates of D-293 (Order,
  QuoteRequest, Opportunity, Project, CustomerAccount via `membershipPort`) these are re-parenting
  operations added to their aggregate ports. For the others they go on a merge-participant
  capability (convention item 9 in `specs/186-aggregate-ports/contracts/aggregate-port-convention.md`).
- The orchestration knows participants only through their declarations. `organizations` names no
  holder module (Principle I).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a merge, zero records outside the *kept on the loser* dispositions reference the
  loser, verified by a query over every column the completeness check derives.
- **SC-002**: A merge of an Organization with 10 000 orders, 50 members and records in every
  participant completes within 10 minutes at the reference volume. No single Command holds a lock
  longer than 5 seconds, and writes to the survivor continue throughout.
- **SC-003**: For every injected single-step failure, *resume* completes the merge with a final state
  identical to an uninterrupted merge (no duplicate union rows, no double-counted sums).
- **SC-004**: Every audit entry a merge writes carries its merge id, and the survivor's history shows
  exactly one merge entry per merge.
- **SC-005**: 100% of the preview's refusals are also refused by the start, and a refused start
  writes nothing.
- **SC-006**: An operator can find a duplicate, preview and start a merge from the survivor's screen
  in under 2 minutes, without leaving the flow.
- **SC-007**: A participant that was off during a merge has, within one minute of being switched on,
  zero records still referencing the loser.
- **SC-008**: A new module that adds an Organization or Project reference without declaring a
  participation fails the static check on its merge request.

## Assumptions

- `specs/186-aggregate-ports/` (Organization, Project, Order, QuoteRequest, Opportunity, CustomerAccount
  ports) and `specs/191-membership-join-requests/` (`membershipPort`) land before this feature's
  implementation. This feature adds re-parenting operations to them additively, and the merge mode
  to the membership move.
- A merge is within one store (one tenant root of the platform). There is no cross-installation
  merge.
- Merging customer accounts (one person with two accounts) is out of scope, and the preview only
  flags likely duplicates of people.
- Finding duplicates (a duplicate-detection report or suggestions) is out of scope. The operator
  picks the pair, and the picker searches by name and tax ID.
- Buyers receive no merge notice beyond what 191's membership move already sends (OQ-11).
- Addresses are not de-duplicated. Identical addresses may appear twice in the survivor's book, and
  the operator may delete one later.
- Historical analytics events are re-pointed (OQ-12) so that per-Organization reports show one
  history.
- A Project merge does not merge two workflows. The survivor's stages stay.
- No new runtime dependency. The job uses the existing BullMQ worker pattern.

## Open questions

OQ-1 to OQ-4 are **closed** (Clarifications, 2026-11-25; ruling D-299). OQ-5 to OQ-12 were not
asked. They stand as the stated assumptions below, and the owner may overturn any of them before
the merge request that implements them (`plan.md` § *Open items*).

### OQ-1: Personal (B2C) Organizations (closed 2026-11-25: A)

A personal Organization has exactly one member and no tax ID. Merging two of them would give a
personal Organization two members.

- **A (recommended)**: refuse any merge involving a personal Organization in this feature. A person
  who belongs in a company uses the membership move or join request (191), and the data stays
  behind by design (191 FR-009).
- **B**: allow *personal → company* only. The person moves as a member and their personal orders,
  addresses and history follow, so it is a "move with data". It is useful when a B2C buyer was
  really buying for their employer, but it moves privately bought orders into a company's view.
- **C**: also allow *personal → personal*, which requires an account merge (out of scope).

### OQ-2: Partial failure model, and no unmerge (closed 2026-11-25: A)

Each owner's Command is its own transaction (`specs/186-aggregate-ports/` edge case *Caller inside
its own transaction*), so thirty owners cannot commit together through ports.

- **A (recommended)**: a **forward-only, resumable job**. The loser is frozen, steps are idempotent,
  failures are retried, then *needs attention* plus *resume*. Cancel is possible before the first
  re-parenting step, and there is no unmerge.
- **B**: **one transaction** for the whole merge, using child Commands through `beforeCommit` hooks.
  It is atomic, but it holds locks across every owner's table for minutes, cannot batch, fails as a
  whole on huge losers, and couples every module into one transaction.
- **C**: a **saga with compensation** (each step has an inverse). Inverses of unions, sums and
  revocations cannot be computed once the survivor has moved on, so compensation would be
  approximate, and an approximate unmerge is worse than none.

The owner should also confirm that **no unmerge** is acceptable (FR-012).

### OQ-3: Which pairs in the organization tree may merge (closed 2026-11-25: A)

- **A (recommended)**: both roots, or both in the same tree, with the loser never an ancestor of the
  survivor. Children of the loser move under the survivor. Non-roots of different trees are refused:
  the operator first moves one (an ordinary tree move, which applies the tax-ID scope's rules) and
  then merges.
- **B**: allow any pair. The loser's subtree joins the survivor's tree implicitly, which under
  `per-tree-root` can change which tree a tax ID belongs to, inside a merge.
- **C**: roots only. This is simplest, but duplicate branches inside one tree are common.

### OQ-4: Modules that are off at merge time (closed 2026-11-25: A)

- **A (recommended)**: proceed. The off module's step is *deferred* and runs automatically when it
  is effectively present again (FR-070, FR-071). This honours "off behaves as never installed" (the
  merge neither reveals nor waits for the module) and "reactivating restores data with no manual
  repair".
- **B**: refuse a merge while any participant is off. This is simpler, but it reveals an off module
  and lets a disabled capability block an unrelated operation.
- **C**: let `organizations` re-point the off module's records directly. This breaks Principle I
  and is rejected.

### OQ-5: One delivery or two (assumed: two)

Organization merge first, Project merge in the next release on the same mechanism. The alternative
is to ship both together, which delays the Organization merge for a lower-value scope.

### OQ-6: Writes naming the loser after a merge (assumed: refuse with the survivor's id)

- **A (recommended)**: reads resolve (FR-052), and writes are refused with a distinct code carrying
  the survivor's id, so an integration fixes its mapping instead of writing silently to a record it
  did not name.
- **B**: redirect writes to the survivor transparently. This is friendlier to stale integrations but
  hides the stale mapping for ever.

### OQ-7: In-flight business (assumed: only placements and payments block)

Open carts, pending quotes, open returns and pending payer requests follow the survivor. Refusing on
them would make a merge impossible for any active customer. Only a placement or a payment in flight
refuses the start, retryably.

### OQ-8: Credit limits (assumed: survivor's limit, summed exposure)

The survivor keeps its limit (or takes the loser's if it has none). The loser's open reservations
become the survivor's exposure, even past the limit, and the preview warns. The alternative is to
add the two limits, which silently grants new credit and is rejected.

### OQ-9: API keys bound to the loser (assumed: re-point)

A bound distributor key is immutable by design (feature 062). Re-pointing it to the survivor keeps
an integration working, because its service account moves with the members. The alternative is to
revoke it and tell the operator, which is safer but silently breaks an integration. The preview
lists such keys either way.

### OQ-10: External-system identities (assumed: survivor's mapping wins, loser's listed)

Where an external system (an ERP, an invoicing service) knows both companies, the platform cannot
merge them there. The survivor's mapping stays, and the loser's is kept on the archived loser and
listed for the operator. A deployment connector can act on `organization.merged.v1`.

### OQ-11: Telling buyers (assumed: no new notice)

Members get only 191's existing behaviour for a move. A merge-specific e-mail to the loser's members
("your company account was combined with …") could be added later as a template.

### OQ-12: Historical analytics events (assumed: re-point)

Re-pointing keeps per-Organization reports whole. The alternative keeps them on the loser as
immutable facts and makes reports resolve merges, which is a cost every report pays for ever.

## Constitution alignment (draft; the plan carries the formal Constitution Check)

- **I (NN)**: every owner moves its own records. The orchestration knows participants only by
  declaration (FR-005, FR-045).
- **II**: preview, merge and the events are contract shapes in `packages/contracts/` first.
- **III (NN)**: every FR traces to a test, including the participant completeness check (SC-008).
- **IV**: no new dependency.
- **X**: the merge job follows the BullMQ worker pattern.
- **XI (NN)**: there is no "no-organization" path. Every re-pointed record is the survivor's
  (FR-073), and personal Organizations are handled explicitly (OQ-1).
- **XIII (NN)**: every write is a Command, with one merge id across the trail (FR-060).
- **XIV**: custom-field values merge through the host's custom-field write (FR-031).
- **XV**: deployments veto through a hook and take part as participants. Core is not edited.
- **XVI**: palette actions (FR-082).
- **XVII (NN)**: off participants are deferred, not shown (FR-070, FR-071), and Project merge is
  absent while `projects` is off (FR-072).
