# Feature Specification: CRM — Sales Opportunities

**Feature Branch**: `feat/143-crm` (spec directory `specs/143-crm-sales-opportunities/`)
**Created**: 2026-10-05
**Status**: Draft
**Input**: Owner's requirements for a CRM module (`crm`) on Endora Commerce: Sales
Opportunities with a configurable status workflow modelled on the Order status workflow,
assignment to Sales Reps, attachments, notes, internal messages, analytics, a board view,
links to Orders and Quote Requests, tags, change history, automatic creation from placed
Orders and Quote Requests, an Opportunity value that is entered by hand or computed from the
linked documents, a Sales Channel, an Order-status ↔ Opportunity-status mapping, and
references to Products and Orders inside the Opportunity body and its notes.

**Owner's success criterion (defines the MVP, User Story 1)**: an Opportunity can be built by
hand *and* by linking an Opportunity with an Order, and the whole Opportunity workflow can be
walked, which is also reflected in changes of the Order's statuses.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Opportunity** | A sales opportunity: a record about one Organization that a Sales Rep works from first contact to a won or lost outcome. Polish UI label: *Szansa sprzedażowa*. |
| **Opportunity Status** | A named, operator-configurable state of an Opportunity. Each Status is *open*, *won* or *lost*; exactly one is the *start* Status. |
| **Workflow** | The set of Opportunity Statuses plus the permitted transitions between them. |
| **Sales Rep** | An Admin UI user who works Opportunities. Not a new kind of user. |
| **Linked document** | An Order or a Quote Request attached to an Opportunity. |
| **Status mapping** | A configured rule connecting an Opportunity Status and an Order status, in a stated direction. |
| **Transition hook** | Business logic another module or a deployment registers to run on an Opportunity transition from Status X to Status Y. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Work an Opportunity through its workflow, with a linked Order following along (Priority: P1)

A Sales Rep creates an Opportunity for an Organization by hand — a title, a description, an
optional contact person, an optional Sales Channel and an expected value — and finds it in the
Opportunities list. They link an existing Order of that Organization to it. An operator has
configured the Workflow: which Status an Opportunity starts in, which Statuses close it as won
and which as lost, which transitions are allowed, and which Order status each Opportunity
Status maps to. As the Sales Rep moves the Opportunity from Status to Status, every linked
Order is moved to the mapped Order status, and the Sales Rep is told, per Order, whether that
happened. A deployment can register its own business logic on a transition from X to Y, on
the same principle as the Order status workflow.

**Why this priority**: it is the owner's success criterion verbatim. Everything else in this
feature decorates an Opportunity that can already be created, linked and walked.

**Independent Test**: with the module switched on, configure a Workflow with a start Status,
one intermediate Status, one won and one lost Status, and a mapping from two of them to Order
statuses; create an Opportunity by hand; link an existing Order; move the Opportunity along
every permitted transition to *won*; confirm the Order's status changed at each mapped step
and that the Opportunity is closed as won.

**Acceptance Scenarios**:

1. **Given** the module is switched on and a default Workflow exists, **When** an operator
   opens the Workflow configuration, **Then** they can add, rename, recolour, reorder and
   delete Statuses, mark exactly one as the start Status, mark any as closing-won or
   closing-lost, and add or remove permitted transitions.
2. **Given** a configured Workflow, **When** a Sales Rep creates an Opportunity with a title
   and an Organization, **Then** it is saved in the start Status, receives a human-readable
   number, and appears in the Opportunities list.
3. **Given** an Opportunity, **When** the Sales Rep links an existing Order that belongs to
   the same Organization, **Then** the Order is listed on the Opportunity with its number,
   status and total, and the same Order cannot be linked to a second Opportunity.
4. **Given** an Opportunity in Status X, a permitted transition X → Y and a mapping from Y to
   Order status O, **When** the Sales Rep moves the Opportunity to Y, **Then** the Opportunity
   is in Y and each linked Order with status following switched on is moved to O through the
   Order workflow's own rules.
5. **Given** the Order workflow refuses the mapped change for one linked Order (no such
   transition, a finished Order, or another module's veto), **When** the Opportunity is moved,
   **Then** the Opportunity still moves, the Sales Rep sees for that Order that the change was
   refused and why, and the refusal stays visible on the Opportunity until it is retried or
   dismissed.
6. **Given** a transition X → Y that the Workflow does not permit, **When** a Sales Rep
   attempts it, **Then** it is refused and nothing changes — neither the Opportunity nor any
   linked Order.
7. **Given** the Opportunity reaches a Status marked closing-won (or closing-lost), **When**
   the transition completes, **Then** the Opportunity is recorded as won (or lost) with the
   time it closed.
8. **Given** a deployment has registered business logic for the transition X → Y, **When** an
   Opportunity makes that transition, **Then** the logic runs; logic registered to run
   *before* the transition can refuse it with a stated reason, and logic registered to run
   *after* cannot undo it.
9. **Given** the module is switched off, **When** anyone uses the platform, **Then** no CRM
   screen, navigation entry, command-palette action or API answers, Orders behave exactly as
   they do without the module, and switching it back on restores every Opportunity unchanged.

---

### User Story 2 — An Order's status moves its Opportunity (Priority: P2)

An operator configures, in the same mapping screen, which Order statuses move an Opportunity
to which Opportunity Status. When a linked Order reaches such a status — because a payment
arrived, a shipment was sent, or somebody changed it by hand — the Opportunity follows.

**Why this priority**: the owner asked for "mapping Order statuses to Opportunity statuses";
without it a Sales Rep re-keys what the Order already knows. It is not needed to satisfy the
success criterion, which runs in the other direction.

**Independent Test**: configure "Order status *completed* → Opportunity Status *won*", link one
Order to an Opportunity, complete the Order from the Orders screen, and confirm the
Opportunity is won, with the Order named as the cause.

**Acceptance Scenarios**:

1. **Given** a mapping Order status O → Opportunity Status S and an Opportunity with one
   linked Order, **When** the Order reaches O, **Then** the Opportunity moves to S and its
   history names the Order as the cause.
2. **Given** an Opportunity with several linked Orders and a mapping marked "only when every
   linked Order is there", **When** one of the Orders reaches O, **Then** the Opportunity does
   not move until every linked Order with status following switched on has reached a status
   mapped to S.
3. **Given** the Opportunity Workflow does not permit the transition the mapping asks for,
   **When** the Order reaches O, **Then** the Opportunity stays where it is and the skipped
   change is recorded on the Opportunity with the reason.
4. **Given** mappings exist in both directions, **When** an Opportunity is moved and its
   Orders follow, **Then** the Orders' resulting status changes do not move the Opportunity
   again, and a change that came from an Order does not push other Orders.
5. **Given** an Opportunity already closed, **When** a linked Order changes status, **Then**
   the Opportunity is not reopened by the mapping.

---

### User Story 3 — Opportunities are assigned to Sales Reps (Priority: P2)

A new Opportunity is assigned to a Sales Rep by default — the Sales Rep assigned to the
Opportunity's Organization — and can be reassigned or unassigned. A Sales Rep can see "my
Opportunities"; a person is told when an Opportunity is assigned to them.

**Why this priority**: ownership is what makes a pipeline workable by a team.

**Independent Test**: assign a Sales Rep to an Organization, create an Opportunity for that
Organization while signed in as someone else, and confirm the Opportunity is assigned to the
Organization's Sales Rep, who is notified and finds it under "my Opportunities".

**Acceptance Scenarios**:

1. **Given** an Organization with exactly one assigned Sales Rep, **When** an Opportunity is
   created for it without choosing an assignee, **Then** that Sales Rep is the assignee.
2. **Given** an Organization with several assigned Sales Reps, **When** one of them creates
   the Opportunity, **Then** the creator is the assignee; when somebody else creates it, the
   longest-standing assigned Sales Rep is.
3. **Given** an Organization with no assigned Sales Rep, **When** an Opportunity is created,
   **Then** it is unassigned and visibly marked so.
4. **Given** an Opportunity, **When** it is reassigned, **Then** the new assignee is notified
   and the change is in the Opportunity's history.
5. **Given** a Sales Rep restricted to certain Organizations, **When** they open the list,
   **Then** they see only Opportunities of Organizations they may see, whoever the assignee is.

---

### User Story 4 — Notes and internal messages on an Opportunity (Priority: P2)

Sales Reps and platform administrators keep notes on an Opportunity and talk to each other
about it in a message thread that never reaches the customer.

**Why this priority**: an Opportunity is worked by several people over weeks; without a place
to write, the knowledge lives in e-mail.

**Independent Test**: add a note and a message to an Opportunity as one Admin UI user, sign in
as the assignee, and confirm the note is listed, the message is in the thread, and the
assignee was notified of the message with a link to the Opportunity.

**Acceptance Scenarios**:

1. **Given** an Opportunity, **When** a user adds a note, **Then** it is listed with its
   author and time; the author can edit or delete it, and both are recorded in history.
2. **Given** an Opportunity, **When** a user posts a message, **Then** it joins the thread in
   time order, cannot be edited afterwards, and the assignee and everybody who has already
   written in the thread — except the author — are notified with a link to the Opportunity.
3. **Given** a customer account of the Opportunity's Organization, **When** they use the
   storefront, **Then** no note or message is visible to them anywhere.

---

### User Story 5 — Attachments on an Opportunity (Priority: P2)

A Sales Rep attaches files — a brief, a drawing, a signed offer — to an Opportunity.

**Independent Test**: upload a file to an Opportunity, reopen the Opportunity, download the
file, remove it, and confirm it is gone from the Opportunity.

**Acceptance Scenarios**:

1. **Given** an Opportunity, **When** a file is attached, **Then** it is listed with its name,
   size, uploader and time, and can be downloaded by anyone who can see the Opportunity.
2. **Given** a file attached to an Opportunity, **When** an operator tries to delete that file
   from the platform's media library, **Then** they are told the Opportunity uses it.
3. **Given** an attachment, **When** it is removed from the Opportunity, **Then** it no longer
   appears there and the removal is in history.

---

### User Story 6 — Tags (Priority: P2)

An operator maintains a list of Tags; Sales Reps tag Opportunities and filter the list by Tag.

**Independent Test**: create two Tags, tag three Opportunities, filter the list by one Tag and
confirm exactly the Opportunities carrying it are shown; rename and delete a Tag.

**Acceptance Scenarios**:

1. **Given** the Tags screen, **When** an operator creates, renames, recolours or deletes a
   Tag, **Then** the change is visible on every Opportunity carrying it; deleting a Tag in use
   asks for confirmation and removes it from those Opportunities.
2. **Given** tagged Opportunities, **When** the list is filtered by one or more Tags, **Then**
   only Opportunities carrying every selected Tag are shown.

---

### User Story 7 — Board view (Priority: P2)

A Sales Rep sees Opportunities as cards in one column per Status and moves an Opportunity by
dragging its card to another column, or by a keyboard-reachable "move to" action on the card.

**Independent Test**: open the board, drag a card to a column the Workflow permits and confirm
the Opportunity changed Status; drag to a column it does not permit and confirm the card
returns with an explanation; filter the board by Tag.

**Acceptance Scenarios**:

1. **Given** the board, **When** it loads, **Then** there is one column per Status in the
   configured order, each showing its Opportunities with title, Organization, assignee, value
   and Tags, and a per-column count and value total.
2. **Given** a card, **When** it is dropped on a column the Workflow permits, **Then** the
   Opportunity makes that transition with exactly the effects of doing so from the detail
   screen, linked Orders included.
3. **Given** a card, **When** it is dropped on a column the Workflow does not permit, **Then**
   it returns to its column and the user is told why.
4. **Given** a user who cannot or does not drag, **When** they use the card's "move to"
   action, **Then** they can make every transition dragging allows.
5. **Given** the board, **When** it is filtered by Tag, assignee or Sales Channel, **Then**
   only matching Opportunities are shown.

---

### User Story 8 — Quote Requests and a computed Opportunity value (Priority: P2)

A Sales Rep links Quote Requests as well as Orders. The Opportunity's value is either typed in
or computed from its linked Orders and Quote Requests; the operator decides, in the Workflow
configuration, from which Order statuses and which Quote Request statuses a document's value
counts.

**Independent Test**: set an Opportunity to "computed value", link an Order and a Quote
Request, configure which statuses count, and confirm the value equals the sum of the documents
in counting statuses and changes when a document enters or leaves one.

**Acceptance Scenarios**:

1. **Given** an Opportunity, **When** a Quote Request of the same Organization is linked,
   **Then** it is listed with its number, status and value; several Quote Requests and several
   Orders can be linked.
2. **Given** an Opportunity set to "entered by hand", **When** documents are linked or change,
   **Then** its value stays what was typed.
3. **Given** an Opportunity set to "computed" and a configuration of counting statuses,
   **When** a linked Order or Quote Request enters a counting status, **Then** its value is
   added; when it leaves, it is subtracted.
4. **Given** an Order that was placed from a linked Quote Request, **When** both are linked
   and both in counting statuses, **Then** the value counts that business once, not twice.
5. **Given** a linked document in a currency different from the Opportunity's, **When** the
   value is computed, **Then** the document is left out and the Opportunity says so.
6. **Given** a Quote Request linked to an Opportunity, **When** an Order is placed from that
   Quote Request, **Then** the Order is linked to the same Opportunity automatically.

---

### User Story 9 — Opportunities created automatically from placed Orders and Quote Requests (Priority: P3)

An operator switches on, in Settings, that every placed Order and/or every placed Quote
Request creates an Opportunity.

**Independent Test**: switch on "create from Quote Requests", submit a Quote Request from the
storefront, and confirm an Opportunity exists for that Organization, linked to the Quote
Request, assigned by the default rule, in the start Status.

**Acceptance Scenarios**:

1. **Given** "create from Orders" is on, **When** an Order is placed that is not yet linked to
   an Opportunity, **Then** an Opportunity is created for the Order's Organization, linked to
   the Order, in the start Status, on the Order's Sales Channel.
2. **Given** "create from Quote Requests" is on, **When** a Quote Request is placed, **Then**
   an Opportunity is created and linked likewise.
3. **Given** an Order placed from a Quote Request that is already linked to an Opportunity,
   **When** the Order is placed, **Then** no second Opportunity is created; the Order joins
   the existing one.
4. **Given** both settings are off (the default), **When** documents are placed, **Then** no
   Opportunity is created.
5. **Given** the module is switched off, **When** documents are placed, **Then** nothing is
   created, and nothing is created retroactively when it is switched back on.

---

### User Story 10 — Create an Order or a Quote Request from within an Opportunity (Priority: P3)

From an Opportunity, a Sales Rep starts a new Order or a new Quote Request for the
Opportunity's Organization in the platform's existing creation screens; the created document
is linked to the Opportunity without further action.

**Independent Test**: open an Opportunity, choose "Create order", complete the existing Order
creation screen, and confirm the new Order is listed on the Opportunity.

**Acceptance Scenarios**:

1. **Given** an Opportunity, **When** the Sales Rep chooses "Create order" and completes the
   Order creation screen, **Then** the new Order is linked to that Opportunity, even when
   automatic creation from Orders is on (no second Opportunity appears).
2. **Given** an Opportunity, **When** the Sales Rep chooses "Create quote request" and
   completes that screen, **Then** the new Quote Request is linked to that Opportunity.
3. **Given** the CRM module is switched off, **When** Orders and Quote Requests are created
   from their own screens, **Then** they behave exactly as before this feature.

---

### User Story 11 — Change history (Priority: P3)

The Opportunity screen has a "Change history" tab showing who changed what and when.

**Independent Test**: edit an Opportunity's title, move it to another Status, add a note and
link an Order; open the tab and confirm four entries, newest first, each with its author, time
and the before/after values.

**Acceptance Scenarios**:

1. **Given** any change to an Opportunity or to what hangs on it (links, tags, notes,
   attachments, assignee, status), **When** the history tab is opened, **Then** the change is
   listed with its author — or "system" with its cause — its time and what changed.
2. **Given** a user who can see the Opportunity but not the platform's general audit log,
   **When** they open the tab, **Then** they still see this Opportunity's history, and nothing
   about any other record.

---

### User Story 12 — References to Products and Orders in the body and in notes (Priority: P3)

While writing an Opportunity's description, a note or a message, a user inserts a reference to
a Product or an Order; readers see it as a named link to that Product or Order.

**Independent Test**: insert a Product reference into a note, save, and confirm it renders as
the Product's current name linking to the Product; rename the Product and confirm the note
shows the new name.

**Acceptance Scenarios**:

1. **Given** a text field of an Opportunity, **When** the user picks a Product or an Order
   from a search, **Then** a reference is inserted and, after saving, rendered as a link
   labelled with the Product's name or the Order's number.
2. **Given** a reference to a record the reader may not see or that no longer exists, **When**
   the text is rendered, **Then** the reference shows as unavailable and leaks no detail.

---

### User Story 13 — CRM analytics (Priority: P3)

A sales manager opens CRM analytics for a chosen date range and sees: the average time to
handle an Opportunity, the average time Opportunities spend in chosen Statuses, the most
effective Sales Reps (most Opportunities closed as won per month), the most valuable
Opportunities, and the average Opportunity value.

**Independent Test**: with a known set of closed Opportunities, open analytics for the month
and confirm each figure equals the hand-computed one.

**Acceptance Scenarios**:

1. **Given** a date range, **When** analytics load, **Then** the five figures are shown for
   Opportunities in that range, with a chart per figure where a chart helps.
2. **Given** a selection of Statuses, **When** "time in Status" is shown, **Then** it reports
   the average time for each selected Status only.
3. **Given** a manager restricted to certain Organizations, **When** analytics load, **Then**
   every figure is computed over those Organizations only.

---

### User Story 14 — CRM where the rest of the platform already is (Priority: P3)

An Organization's screen lists that Organization's Opportunities; the dashboard's recent
activity names Opportunities by title; other modules can read an Opportunity and move it
through its Workflow; the demo shop has a pipeline to look at.

**Independent Test**: open an Organization with Opportunities and confirm they are listed
there with links; switch the CRM module off and confirm the panel is gone.

**Acceptance Scenarios**:

1. **Given** an Organization with Opportunities, **When** its screen is opened by a user who
   may see Opportunities, **Then** a panel lists them with Status and value and a "new
   Opportunity" shortcut.
2. **Given** another module or a deployment's own code, **When** it needs an Opportunity,
   **Then** it can read one and request a Status change through a documented interface and is
   told the outcome as a value, without reaching into CRM internals.
3. **Given** the demo data set is installed, **When** the board is opened, **Then** it shows
   Opportunities in several Statuses.

---

### Edge Cases

- **A Status still in use is deleted** — refused while any Opportunity is in it; the start
  Status cannot be deleted; a Workflow must always have exactly one start Status, at least one
  closing-won and at least one closing-lost Status.
- **A mapped Order status is deleted from the Order workflow** — the mapping stays, the next
  move reports "unknown Order status" for the affected Orders, and the mapping screen flags it.
- **An Order is linked while its status already differs from what the current Opportunity
  Status maps to** — nothing is changed at link time; following applies from the next
  transition on.
- **Status following is switched off for one linked Order** — that Order is never moved by
  the Opportunity and never moves it.
- **Two people move the same Opportunity at once** — one wins; the other is told the
  Opportunity changed and nothing is applied twice.
- **A closed Opportunity** — can be reopened only if the Workflow has a transition out of its
  closing Status; reopening clears its closed time and outcome.
- **The Organization's Sales Rep is deactivated** — the Opportunity keeps its assignee as
  recorded and shows them as inactive; the default rule skips inactive users.
- **A linked Order or Quote Request the reader may not see** — listed as unavailable, without
  its number, status or value.
- **The Quote Requests capability is switched off** — Opportunities keep working; linked Quote
  Requests show as unavailable, contribute nothing to a computed value, and Quote Requests
  cannot be linked, auto-created from or created.
- **Automatic creation is switched on while Orders already exist** — nothing is created for
  existing documents.
- **An Opportunity is deleted** — allowed only to users who may configure CRM; its links are
  removed and the linked Orders and Quote Requests are untouched.

## Requirements *(mandatory)*

### Functional Requirements

**Opportunities**

- **FR-001**: Users MUST be able to create an Opportunity without any Order or Quote Request,
  giving at least a title and an Organization.
- **FR-002**: An Opportunity MUST belong to exactly one Organization, which is an existing
  Organization of the platform; an optional contact person MUST be an existing customer
  account of that Organization. The feature MUST NOT introduce its own customer or company
  records.
- **FR-003**: The system MUST give every Opportunity a unique human-readable number.
- **FR-004**: Users MUST be able to list, search, sort and filter Opportunities (by Status,
  open/won/lost, assignee, Organization, Sales Channel, Tag and creation date), open one, edit
  it, and — with the configuration permission — delete it.
- **FR-005**: Users MUST be able to set and clear a Sales Channel on an Opportunity.
- **FR-006**: An Opportunity MUST be visible only to Admin UI users who may see its
  Organization; an Opportunity outside a user's Organizations MUST be indistinguishable from
  one that does not exist.

**Workflow**

- **FR-010**: Operators MUST be able to create, edit, order and delete Opportunity Statuses,
  each with a name per supported language and a colour.
- **FR-011**: Exactly one Status MUST be the start Status; every new Opportunity starts there.
- **FR-012**: Each Status MUST be markable as closing the Opportunity as won or as lost;
  reaching one records the outcome and the closing time.
- **FR-013**: Operators MUST be able to define which transitions between Statuses are
  permitted; a transition that is not permitted MUST be refused before anything changes.
- **FR-014**: The module MUST ship a usable default Workflow, so that Opportunities can be
  created before any configuration.
- **FR-015**: Other modules and deployment-specific code MUST be able to register logic that
  runs on a transition from Status X to Status Y: before it, with the ability to refuse it
  with a reason shown to the user, and after it, without the ability to undo it. Registration
  MUST be possible for a specific X → Y, for "any transition out of X" and for "any transition
  into Y".
- **FR-016**: Every Status change MUST record its time, its author or system cause, and the
  previous Status.

**Orders, Quote Requests and status mapping**

- **FR-020**: Users MUST be able to link existing Orders and existing Quote Requests of the
  Opportunity's Organization to an Opportunity, and unlink them; an Opportunity MAY have many
  of each; a document MUST belong to at most one Opportunity.
- **FR-021**: Operators MUST be able to map an Opportunity Status to an Order status ("when an
  Opportunity enters this Status, move its Orders to that status"), at most one Order status
  per Opportunity Status.
- **FR-022**: When an Opportunity enters a mapped Status, the system MUST request the mapped
  status for every linked Order with status following switched on, through the Order
  workflow's own rules, and MUST record and show the outcome per Order — applied, already
  there, or refused with the reason. A refusal MUST NOT be hidden and MUST NOT undo the
  Opportunity's transition.
- **FR-023**: Users MUST be able to retry a refused Order status change from the Opportunity,
  and to switch status following off for an individual linked Order.
- **FR-024**: Operators MUST be able to map an Order status to an Opportunity Status ("when a
  linked Order reaches this status, move the Opportunity"), at most one Opportunity Status per
  Order status, with a choice between "as soon as any linked Order is there" and "only when
  every linked Order is there".
- **FR-025**: A change caused by a mapping MUST NOT trigger a mapping in the opposite
  direction, and a mapping MUST NOT reopen a closed Opportunity.
- **FR-026**: Users MUST be able to start creating an Order or a Quote Request from an
  Opportunity using the platform's existing creation screens; the created document MUST be
  linked to that Opportunity automatically.
- **FR-027**: An Order placed from a Quote Request that is linked to an Opportunity MUST be
  linked to the same Opportunity automatically.

**Value**

- **FR-030**: An Opportunity's value MUST be either entered by hand or computed from its
  linked Orders and Quote Requests, chosen per Opportunity; the value carries one currency.
- **FR-031**: Operators MUST be able to state, in the Workflow configuration, which Order
  statuses and which Quote Request statuses make a linked document's value count.
- **FR-032**: A computed value MUST follow the linked documents: it changes when a document is
  linked or unlinked, enters or leaves a counting status, or changes its amount, and when the
  counting configuration changes.
- **FR-033**: A computed value MUST count an Order placed from a linked Quote Request once,
  and MUST leave out — and name — documents in another currency.

**People and collaboration**

- **FR-040**: Every Opportunity MUST have at most one assignee, an Admin UI user; the default
  assignee follows the Sales Reps assigned to the Opportunity's Organization (User Story 3).
- **FR-041**: Users MUST be able to reassign and unassign an Opportunity and to filter by
  assignee, including "assigned to me" and "unassigned".
- **FR-042**: Users MUST be able to add, edit and delete their own notes on an Opportunity.
- **FR-043**: Admin UI users MUST be able to exchange messages in the context of an
  Opportunity; messages are immutable, never visible to customers, and notify the other
  participants.
- **FR-044**: Users MUST be able to attach files to an Opportunity, download them and remove
  them; a file in use by an Opportunity MUST be protected from deletion elsewhere.
- **FR-045**: Users MUST be able to insert references to Products and Orders into an
  Opportunity's description, its notes and its messages, rendered as links carrying the
  record's current name or number.

**Tags, board, history, analytics**

- **FR-050**: Operators MUST be able to create, edit and delete Tags; users MUST be able to
  put Tags on Opportunities and filter the list and the board by Tag.
- **FR-051**: The system MUST offer a board view of Opportunities by Status in which a
  permitted transition can be made by dragging a card and, equivalently, without dragging.
- **FR-052**: The Opportunity screen MUST offer a "Change history" tab listing every change
  to the Opportunity and to what hangs on it, with author, time and before/after values.
- **FR-053**: The system MUST offer analytics over a chosen date range: average handling time
  (creation to closing), average time spent in selected Statuses, Sales Reps ranked by
  Opportunities closed as won per month, the most valuable Opportunities, and the average
  Opportunity value.

**Automation and settings**

- **FR-060**: Operators MUST be able to switch on and off, in the platform's Settings,
  automatic creation of an Opportunity for every placed Order and, separately, for every
  placed Quote Request; both are off by default.
- **FR-061**: Automatic creation MUST NOT create a second Opportunity for a document that is
  already linked, or whose originating Quote Request is.

**Platform behaviour**

- **FR-070**: The module MUST be switchable on and off by an operator. While off, none of its
  screens, navigation entries, command-palette actions, API, automation or contributions to
  other screens is present; Orders, Quote Requests, Organizations and customers behave exactly
  as without the module; no data is lost and switching it back on restores everything.
- **FR-071**: Every CRM screen MUST be reachable from the Admin UI's navigation — in a
  navigation group of its own named "CRM" — and from the command palette, and MUST be shown
  only to users holding the permission that guards it.
- **FR-072**: Every user-facing text MUST be available in English and Polish.
- **FR-073**: Every change made through the feature MUST be recorded in the platform's audit
  trail with its author.
- **FR-074**: Other modules MUST be able to read an Opportunity and request a Status change
  through a documented interface that reports the outcome as a value.
- **FR-075**: The module MUST be documented for operators and for developers, in English and
  Polish.

### Key Entities

- **Opportunity** — number, title, description, Organization, optional contact person,
  optional Sales Channel, current Status, assignee, value (mode, amount, currency), expected
  closing date, how it came to exist (by hand, from an Order, from a Quote Request), outcome
  and closing time.
- **Opportunity Status** — code, names, colour, order, whether it is the start Status, whether
  it closes as won or lost.
- **Status Transition** — a permitted move from one Status to another.
- **Status Mapping** — a direction, an Opportunity Status, an Order status and, for the
  Order-to-Opportunity direction, the any/all rule.
- **Value-counting rule** — which Order statuses and which Quote Request statuses count.
- **Linked document** — an Order or a Quote Request on an Opportunity, how it came to be
  linked, whether status following is on.
- **Status history entry** — from, to, when, by whom or by what cause.
- **Propagation outcome** — what became of one requested Order status change.
- **Tag** — name, colour; attached to many Opportunities.
- **Note / Message** — author, text, time, kind.
- **Attachment** — a file in the platform's media library attached to an Opportunity.
- **Reference** — a pointer from a text of an Opportunity to a Product or an Order.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Sales Rep can create an Opportunity by hand, link an existing Order and move
  the Opportunity from the start Status to a won Status in under 3 minutes, and after each
  mapped step the Order shows the mapped status.
- **SC-002**: 100% of Order status changes requested by an Opportunity transition are
  reported back to the user per Order as applied, already there, or refused with a reason;
  none is silently dropped.
- **SC-003**: With the module switched off, every Order and Quote Request behaviour covered by
  the existing test suites is unchanged, and none of the module's surfaces is reachable.
- **SC-004**: A user restricted to a set of Organizations can reach 0 Opportunities, notes,
  messages, attachments, history entries or analytics figures belonging to other
  Organizations.
- **SC-005**: An operator can reconfigure the Workflow — add a Status, mark it closing-won,
  permit a transition into it and map it to an Order status — in under 2 minutes without
  leaving one screen.
- **SC-006**: The board shows 500 open Opportunities and responds to a card move in under
  1 second as perceived by the user.
- **SC-007**: Each analytics figure for a month of 1,000 Opportunities appears in under
  2 seconds and equals the figure computed by hand from the same data.
- **SC-008**: Every CRM screen is reachable through the navigation and the command palette in
  both English and Polish, with no untranslated label.
- **SC-009**: With automatic creation on, 100% of newly placed Orders and Quote Requests end
  up linked to exactly one Opportunity.

## Clarifications

### Owner rulings, 2026-10-05

- **Navigation**: CRM gets its **own top-level navigation group named "CRM"** in the Admin UI
  sidebar, and every CRM link lives there — Opportunities, Board, Analytics, Tags, Workflow.
  They are **not** placed under the existing "Sales" group. If it later turns out the group
  holds only one or two links, they will be moved into "Sales"; that is a possible later
  follow-up and nothing to do now. The group label is "CRM" in both English and Polish.
- **Packaging**: CRM is a **free module in this repository** for now ("maybe paid someday").
  It must stay cleanly detachable; its destination does not change.

## Assumptions

Decisions taken where the requirements left room, each with the alternative that was not
taken; the reasoning is in `research.md`.

- **Statuses carry a kind (open / won / lost) and one start flag**, rather than separate
  "terminal" and "outcome" notions. Unlike Order statuses, a closing Status may have outgoing
  transitions if the operator adds them (reopening). *Rejected*: closed means final, as for
  Orders — a lost Opportunity that comes back is ordinary sales work.
- **An Opportunity always has an Organization.** A lead with no Organization is out of scope:
  the platform's single tenant concept is the Organization, and an individual buyer already
  has a personal one.
- **Linked documents must belong to the Opportunity's Organization**, and a document belongs
  to at most one Opportunity. *Rejected*: many-to-many — it makes "which Opportunity does this
  Order move?" unanswerable.
- **An Opportunity transition is never undone by an Order refusing to follow.** The Order
  workflow answers only after the Opportunity has moved, by its own published rule; the
  refusal is surfaced and can be retried. *Rejected*: all-or-nothing — it would let any module
  that vetoes Order transitions freeze the sales pipeline.
- **Following is one hop.** A change caused by a mapping does not trigger the opposite
  mapping. *Rejected*: letting mappings cascade until they settle — unbounded with an
  inconsistent configuration.
- **"From which status onward" is configured as a set of counting statuses**, with a shortcut
  to select a status and everything after it in display order — statuses form a graph, not a
  line, so "onward" has no single meaning. Quote Request statuses are the platform's fixed
  set.
- **A computed value sums Order totals and Quote Request values** (agreed prices where they
  exist, otherwise the requested ones), in the Opportunity's currency only; there is no
  currency conversion.
- **"Sales Rep" means an Admin UI user**; any active Admin UI user can be an assignee. The
  default follows the platform's existing Sales-Rep-to-Organization assignment.
- **Notes and messages are both internal.** A note is an annotation its author can edit; a
  message is an immutable entry in a thread that notifies the other participants. Customers
  see neither. Customer-facing conversation stays where it is, on Orders and Quote Requests.
- **Automatic creation applies to documents placed after it is switched on**, by customers and
  by staff alike, and never to documents already linked or created from an Opportunity.
- **Analytics are computed live** over the chosen range; "handling time" is creation to
  closing; a month is a calendar month in the platform's time zone.
- **Messages do not send e-mail**; they use the Admin UI's notification bell. If that
  capability is switched off, messages still work without notifications.
- **Runtime custom fields on Opportunities, import/export, outbound webhooks, e-mail
  notifications and inclusion in the admin global search are not part of this feature**; each
  is assessed in `research.md` with the reason and what it would take.
- **The Quote Requests capability is optional for CRM** (see `research.md` R-17, an open
  question for the owner): the owner listed Quote Requests among the dependencies; the design
  integrates with it fully while it is on and keeps CRM working when an operator has switched
  it off.

## Dependencies

Orders; Quote Requests; Organizations (including Sales-Rep assignment); customer accounts;
Products (catalog); Admin UI users and roles; Sales Channels; the media library; Settings; the
audit trail; Admin notifications.
