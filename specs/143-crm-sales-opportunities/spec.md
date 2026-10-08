# Feature Specification: CRM — Sales Opportunities

**Feature Branch**: `feat/143-crm` (spec directory `specs/143-crm-sales-opportunities/`)
**Created**: 2026-10-05
**Status**: Accepted — the owner's rulings of 2026-10-05 are in *Clarifications*; implemented on
`feat/143-crm` and amended on 2026-10-06 to what was built (see *Clarifications* §
*Amendments after implementation*). Tasks still open are listed in `tasks.md`.
**User Stories 21 and 22 (Events, reminders, the Calendar) were added on 2026-10-08 and are
designed, not built**: branch `feat/143-crm-calendar`, `tasks.md` Phases 24 – 27. Their open
questions, each with the default applied, are in *Clarifications*.
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
   *(Reachable in the product since 2026-10-08 — FR-100; Clarifications § Amendments, A-1.)*
5. **Given** a linked document in a currency different from the Opportunity's, **When** the
   value is computed, **Then** the document is left out and the Opportunity says so.
6. **Given** a Quote Request linked to an Opportunity, **When** an Order is placed from that
   Quote Request, **Then** the Order is linked to the same Opportunity automatically.
   *(Reachable in the product since 2026-10-08 — FR-100; A-1.)*

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
   the existing one. *(Reachable in the product since 2026-10-08 — FR-100; A-1.)*
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
   **Built on 2026-10-08 (Clarifications § Amendments, A-4; `research.md` N-DD1).** The demo
   data set gains twelve Opportunities for the demo Organization, two in each Status of the
   default Workflow, assigned across the two demo Sales Reps with one left unassigned, with
   three months of status history, tags, notes and an internal message. **None is linked to an
   Order or a Quote Request**: the demo data set contains neither, and placing one was not
   made part of this feature (`research.md` N-DD2).

---

### User Story 15 — Operator-defined fields on an Opportunity (Priority: P3)

An operator adds fields of their own to Opportunities — "Lead source", "Competitor",
"Decision date" — on the platform's existing custom-fields screen, without a deployment. Sales
Reps fill them in when creating an Opportunity and on its screen; the values are validated
against the field's definition.

**Why this priority**: every sales team tracks a few facts no product ships with. The
platform already has the mechanism for Orders, Organizations, customers and Quote Requests.

**Independent Test**: define a required select field for Opportunities on the custom-fields
screen, create an Opportunity without it and see the field named in the refusal, fill it in,
reopen the Opportunity and see the value.

**Acceptance Scenarios**:

1. **Given** the CRM module is on, **When** an operator opens the custom-fields screen,
   **Then** "Opportunity" is among the record types they can define fields for.
2. **Given** fields defined for Opportunities, **When** a Sales Rep creates or edits an
   Opportunity, **Then** the fields are offered with their labels in the user's language, and
   a value that breaks a field's definition is refused naming that field.
3. **Given** an Opportunity with custom values, **When** it is read by anyone who may see it,
   **Then** the values are shown; nobody who may not see the Opportunity can read them.
4. **Given** the CRM module is switched off, **When** an operator opens the custom-fields
   screen, **Then** "Opportunity" is not offered and its field definitions cannot be changed;
   switching CRM back on restores definitions and values unchanged.

---

### User Story 16 — Other systems are told when an Opportunity changes status (Priority: P3)

An operator subscribes an external system — a reporting tool, a chat channel, an ERP — to
Opportunity events on the platform's existing webhooks screen. When an Opportunity is created,
changes Status or closes, the subscribed address receives a signed notification.

**Why this priority**: a pipeline that other systems cannot follow gets re-keyed by hand.

**Independent Test**: create a webhook subscription for "Opportunity status changed", move an
Opportunity, and confirm one delivery was queued for that address carrying the Opportunity,
the previous and the new Status.

**Acceptance Scenarios**:

1. **Given** the CRM module is on, **When** an operator creates or edits a webhook
   subscription, **Then** the Opportunity events — created, status changed, closed — are among
   the events offered.
2. **Given** a subscription to "status changed", **When** an Opportunity changes Status for
   any reason, **Then** exactly one notification is queued for that subscription, with a
   documented, versioned content.
3. **Given** a subscription bound to one Organization, **When** an Opportunity of another
   Organization changes Status, **Then** nothing is sent to it.
4. **Given** the webhooks capability is switched off, **When** an Opportunity changes Status,
   **Then** the change succeeds and nothing is sent.
5. **Given** the CRM module is switched off, **When** the webhooks screen is opened, **Then**
   the Opportunity events are not offered.

---

### User Story 17 — The Order and the Quote Request show their Opportunity (Priority: P3)

Somebody looking at an Order sees, on that Order's screen, the Opportunity it belongs to —
number, title, Status, assignee and value — with a link to it. If the Order belongs to none,
they can link it to an existing Opportunity of the same Organization or start a new one from
it. The Quote Request screen shows the same panel.

**Why this priority**: people arrive at an Order from many places; the sales context should
be one click away, in both directions.

**Independent Test**: open a linked Order and confirm the panel shows its Opportunity and
links to it; open an unlinked Order, choose "Create opportunity", complete the form and
confirm the Order is linked; switch CRM off and confirm the Order screen is exactly as it was
before this feature.

**Acceptance Scenarios**:

1. **Given** an Order linked to an Opportunity, **When** its screen is opened by a user who
   may see Opportunities, **Then** a panel shows the Opportunity's number, title, Status,
   assignee and value, and links to it.
2. **Given** an Order linked to none, **When** the user chooses "Link to an opportunity",
   **Then** they can pick an open Opportunity of the Order's Organization and the Order is
   linked; **When** they choose "Create opportunity", **Then** the creation form opens for
   that Organization and the Opportunity it creates is linked to the Order.
3. **Given** a Quote Request, **When** its screen is opened, **Then** the same panel and the
   same two actions are available for it.
4. **Given** a user without permission to see Opportunities, or the CRM module switched off,
   **When** an Order or Quote Request screen is opened, **Then** no panel, heading or empty
   space appears, and the screen is identical to the one without the module.

---

### User Story 18 — Mention a person, an Order or a Product by typing `@` (Priority: P3)

*Added 2026-10-07 at the owner's request: "W CRM dodać możliwość odnoszenia się do osób przez
"@", odnoszenia do Zamówienia przez "@@" i Produktu przez "@@@"", after an earlier message on
an Opportunity: "Dodać wywoływanie Handlowca przez @, np. @Tomasz Nowak - przejmij temat".*

While writing an Opportunity's description, a note or a message, a user types `@` and picks a
person, `@@` and picks an Order, or `@@@` and picks a Product, without leaving the keyboard.
A mentioned person is told, in the Admin UI, that they were mentioned and on which
Opportunity.

**Independent Test**: in a message type `@`, a few letters of a colleague's name, Enter, and
the rest of the sentence; send it; confirm the message shows `@` and the colleague's name,
and that the colleague — and nobody else — has a notification naming the Opportunity by its
number and leading to it.

**Acceptance Scenarios**:

1. **Given** a text field of an Opportunity, **When** the user types `@` at the start of the
   text or after a space, **Then** a list of people opens and narrows as they type; arrow keys
   move through it, Enter chooses, Escape closes it and leaves what was typed.
2. **Given** the same field, **When** the user types `@@`, **Then** the list is of the
   Organization's Orders; **When** they type `@@@`, **Then** it is of Products. Each is
   offered only to a user who may read Orders, or Products, and otherwise the characters stay
   as typed.
3. **Given** an e-mail address typed in the text, **When** its `@` is typed, **Then** no list
   opens.
4. **Given** a saved text that mentions a person, **When** it is read, **Then** the mention
   shows as `@` and the person's current name; a person who was removed or deactivated shows
   as unavailable.
5. **Given** a description, a note or a message saved with a person mentioned who was not
   mentioned in the previous version of that text, **When** it is saved, **Then** that person
   gets exactly one notification naming the Opportunity by its number and who mentioned
   them — never the text — and leading to the Opportunity.
6. **Given** a mention of the author themself, of somebody who may not read Opportunities, or
   of somebody who may not see the Opportunity's Organization, **When** the text is saved,
   **Then** that person is not notified.
7. **Given** a description that carries references, **When** its change is read in the Change
   history tab, **Then** each reference shows as the name it stands for, not as its stored
   code.
8. **Given** a text field of an Opportunity — empty, or opened on a text that already carries
   references — **When** the user writes in it, **Then** every reference is shown as the
   name it stands for and never as its stored code; it is removed as a whole, and what is
   saved is unchanged for any reference the user did not touch, one they may not see
   included. *(Owner ruling, 2026-10-07: "w takiej postaci to jest niezrozumiałe dla
   użytkownika".)*
9. **Given** a list opened by `@`, **When** it appears, **Then** it is at the place being
   typed, not elsewhere on the field, and inside the window on a phone. *(Owner ruling,
   2026-10-07: "powinna wyświetlać się tam gdzie wpisujemy".)*

---

### User Story 19 — Choose what a board card shows, and filter the board by it (Priority: P3)

*Added 2026-10-08 at the owner's request: "Chciałbym dodać jeszcze jedną funkcję do CRM: w
konfiguracji można ustawić, jakie pola niestandardowe i pola Szansy Sprzedażowej ogólnie
mogą się wyświetlać na karcie w boardzie dla Szans Sprzedażowych. Czyli mogę zdecydować, że
np. nazwa organizacji, do której jest przypisana szansa ma się wyświetlać na Boardzie. Albo
robię sobie pole "źródło pozyskania" i zaznaczam, że to pole może się wyświetlać na Boardzie.
Powinna być też możliwość filtrowania boarda po polach, które wyświetlają się na kartach w
boardzie".*

An operator decides which fields of an Opportunity a board card shows, and in what order —
fields every Opportunity has (its Organization, contact person, Sales Rep, value, Sales
Channel, Tags, number, dates, where it came from, how many documents are linked) and the
fields the operator defined themself. A Sales Rep then narrows the board by any field its
cards show.

**Why this priority**: a board is read at a glance, and what a team needs to see at a glance
differs from team to team. The board already works without it.

**Independent Test**: define a select field "Lead source" for Opportunities, put it on the
card in the CRM configuration, open the board and see the value on the cards that carry one;
filter the board by one of its options and confirm the cards, the counts and the totals of
every column narrow to the Opportunities carrying it; take the field off the card and confirm
it is gone from the cards and from the filters.

**Acceptance Scenarios**:

1. **Given** nobody has configured the card, **When** the board is opened, **Then** a card
   shows what it showed before this story: title, number and Organization, value, assignee
   and Tags.
2. **Given** the CRM configuration, **When** an operator who may configure CRM opens the
   *Board card* section, **Then** they are offered every built-in field and every field
   defined for Opportunities, choose up to six of them and put them in order; the title is
   always shown and is not among the choices.
3. **Given** a saved choice, **When** the board is opened by anyone who may read
   Opportunities, **Then** each card shows the chosen fields in the chosen order — a field
   the Opportunity has no value for is left out of that card — and a long text is cut short.
4. **Given** a field shown on the cards, **When** the board's filters are opened, **Then**
   there is a filter for it that suits its type — one or more options of a choice field,
   yes / no, a text it contains, a lowest and a highest number or amount, a range of dates,
   or the picker the board already had — and filters combine: only Opportunities matching
   all of them are shown, counted and totalled.
5. **Given** a filtered board, **When** its address is copied and opened again, **Then** the
   same filters are applied; one action clears them all.
6. **Given** a custom field on the card, **When** its definition is deleted, **Then** the
   board keeps working: the field is gone from the cards, from the filters and from the
   configuration, and a filter on it left in an address is ignored.
7. **Given** a user who may read Opportunities but not configure CRM, **When** they try to
   change the card, **Then** they are refused; **Given** a user restricted to a set of
   Organizations, **Then** no filter reaches an Opportunity outside it.

---

### User Story 20 — An Opportunity screen that reads in order (Priority: P3)

*Added 2026-10-08 at the owner's request, made with a screenshot of the Sales Opportunity
view of another CRM (translated from Polish): "I have this view of a Sales Opportunity in one
of the CRMs. Can you adapt our Opportunity view, based on this screenshot, so that the
information in our view is more readable and ordered? You can move the links out into a
separate tab 'Powiązania'." The screenshot is a model for the screen's structure, not for
its branding, and not for the features behind it — research N-DL1 says what was taken from
it and what was not.*

*Amended the same day, after the owner saw the first build (translated from Polish): "I
forgot our workflow need not be linear… so let's change the display so it shows only the
possible transitions forward and backward in the process. Also, I would wrap the right-hand
bar in a Card component so it is more readable, and it should rather be entirely on the
right, i.e. we narrow the Card with the stages." The scenarios and FR-110, FR-112 – FR-115
and FR-119 below are as amended; research N-DL9 and N-DL10.*

A Sales Rep opening an Opportunity reads, from the top: what it is called and who it is for;
then, on the left, which status it is in and where the workflow lets it go — back or
forward — and under that the working area: description, linked documents, notes, messages,
files, history, each on a tab. On the right, beside all of it, one card of the Opportunity's
facts stays in place whichever tab is open.

**Why this priority**: every capability of the screen existed before this story; it changes
where each one is found. The screen had grown one section at a time, as stories landed, into
a single long tab.

**Independent Test**: open an Opportunity in a workflow that has a backward transition and
two closing statuses. Read its status and the moves offered back and forward, press one —
with a reason — and see it move; confirm a status the workflow does not allow from here is
not on the screen.
Open the *Links* tab, link an Order, reload the page and find the same tab open. Sign in
with a read-only role and confirm nothing on the screen can be pressed to change anything.
Repeat at a 390 px wide window.

**Acceptance Scenarios**:

1. **Given** an Opportunity, **When** its screen is opened, **Then** the header shows its
   title and status and, in one line under them, its number, its Organization, who holds it
   (or that nobody does) and its Sales Channel when it has one.
2. **Given** an Opportunity whose status the workflow lets move both to an earlier status
   and to later ones, **When** the screen is opened, **Then** the stage bar names the
   current status and offers the earlier one under *Back* and the later ones under
   *Forward* — a status that closes the Opportunity among them, marked as won or lost — and
   shows no other status of the workflow.
3. **Given** a status the workflow lets move in one direction only, **When** the bar is
   read, **Then** only that side is shown; **Given** a closed Opportunity the workflow lets
   reopen, **Then** reopening is offered under *Back*.
4. **Given** a user who may change Opportunities, **When** they press a status the workflow
   allows from the current one, having written a reason, **Then** the Opportunity moves
   exactly as it did before this story — the reason recorded, a veto shown in its own words,
   the linked Orders following — and what became of those Orders is listed under the bar.
5. **Given** a user who may only read, **When** they open the screen, **Then** the bar shows
   the same moves as text and none of them can be pressed.
6. **Given** a closed Opportunity the workflow lets go nowhere, **When** the bar is read,
   **Then** it shows the status, how and when the Opportunity was closed, that no further
   change is possible, and no move.
7. **Given** an Opportunity with linked documents, **When** the screen is opened, **Then**
   it opens on *Overview*, the *Links* tab's label carries the number of linked documents,
   and the linked Orders and Quote Requests — with linking, unlinking, status following and
   creating a document — are on that tab and on no other.
8. **Given** any tab is open, **When** the page is reloaded or its address is opened by
   somebody else, **Then** the same tab is open; an address naming no tab opens *Overview*.
9. **Given** a user returning from creating an Order or a Quote Request from the
   Opportunity, **When** the screen opens, **Then** it is on *Links*, where the new document
   is reported.
10. **Given** any tab is open, **When** the facts card is read, **Then** it shows four
    groups — value and deadline, customer and assignee, classification, record — each fact
    as a label above its value, and a fact with no value shown as empty. It is on the right,
    from the header down, beside the stage bar and the tabs.
11. **Given** a 390 px wide window, **When** the screen is opened, **Then** nothing scrolls
    sideways except the tab strip, every move of the bar is visible without scrolling
    sideways, and the facts card comes after the stage bar and before the tabs.

---

### User Story 21 — Events on an Opportunity, with a reminder (Priority: P3)

*Added 2026-10-08 at the owner's request. The owner's words, verbatim, with an English
rendering — the five of the ten sentences that this story answers (the others are User
Story 22's):*

> - „W ramach Szansy Sprzedażowej można definiować różne Wydarzenia, które mają swoją nazwę,
>   opis i datę." — *Within a Sales Opportunity one can define Events, each with a name, a
>   description and a date.*
> - „W widoku Szansy Sprzedażowej powinna pojawić się zakładka "Wydarzenia", która zawiera
>   listę Wydarzeń powiązanych z Szansą, ma widok Kalendarza z Wydarzeniami wybranej Szansy
>   oraz daje możliwość dodania nowego Wydarzenia dla Szansy Sprzedażowej." — *The Sales
>   Opportunity screen should gain an "Events" tab holding the list of the Opportunity's
>   Events, a Calendar view of that Opportunity's Events, and a way to add a new Event to the
>   Opportunity.*
> - „Przy tworzeniu Wydarzenia można zaznaczyć, czy mamy być powiadamiani o Wydarzeniu. Jeśli
>   tak, ustawiamy datę i godzinę powiadomienia, która domyślnie ustawia się na datę
>   Wydarzenia." — *When creating an Event one can tick whether we are to be notified about
>   it. If so, we set the date and time of the notification, which defaults to the Event's
>   date.*
> - „Przypomnienie wysyła się jako Powiadomienie w dzwoneczku lub jeśli jestem offline, jako
>   wiadomość e-mail do osoby przypisanej do Szansy Sprzedażowej" — *The reminder is sent as
>   a notification in the bell or, if I am offline, as an e-mail message to the person
>   assigned to the Sales Opportunity.*
> - „Zmiana Handlowca przypisanego do Szansy przenosi jej wpisy do kalendarza nowej osoby." —
>   *Changing the Sales Rep assigned to an Opportunity moves its entries to the new person's
>   calendar.* (Its reminder half is here; its calendar half is User Story 22.)

*The owner also sent three screenshots of another CRM — its calendar, its "new event" dialog
and an Opportunity screen with a week strip. They are a model for structure, not for
branding and not for that product's domain; research N-CAL1 says what was taken and what
was not.*

A Sales Rep plans the next step of a deal where the deal is: on the Opportunity's *Events*
tab they add "Call back about the offer", tomorrow from 10:00 to 10:30, and tick *Remind
me*. Tomorrow at 10:00 whoever holds the Opportunity then is told — in the bell, and by
e-mail as well when they do not have the Admin UI open.

**Why this priority**: an Opportunity is workable without it; the story adds the "what
happens next, and when" that notes cannot answer. It is the last capability before the
module's first release (owner, 2026-10-08: "After this feature the CRM module is ready to
merge and release").

**Independent Test**: on an Opportunity assigned to a colleague, open *Events*, add a timed
Event with a reminder two minutes ahead and an all-day Event without one. See both in the
list and in the tab's calendar, and the tab's label counting them. Wait: the colleague's
bell shows one entry naming the Event, and it opens this Opportunity on *Events*. Reassign
the Opportunity before a second reminder is due and see the new assignee reminded, not the
old one. Close the Opportunity and confirm no reminder is sent while it is closed.

**Acceptance Scenarios**:

1. **Given** an Opportunity and a user who may change Opportunities, **When** they add an
   Event with a name, a start and an end on one day, **Then** it is listed on the
   Opportunity's *Events* tab under *Upcoming*, drawn in the tab's calendar, the tab's label
   counts it, and the Opportunity's change history records that an Event was added.
2. **Given** the dialog, **When** *All day* is switched on, **Then** the two times are not
   asked for, and the Event is shown on its date to every reader, whatever time zone their
   browser is in.
3. **Given** the dialog, **When** *Remind me* is ticked, **Then** a date and time appear,
   already set to the Event's start (09:00 on its date for an all-day Event), and follow the
   start while the user has not changed them; a reminder time that is not in the future is
   refused with a sentence that says so.
4. **Given** an Event whose reminder is due on an open Opportunity with an assignee,
   **When** the reminder is processed, **Then** the assignee gets exactly one bell entry that
   names the Event, when it starts and the Opportunity's number, and opens the Opportunity
   on *Events* with that Event marked.
5. **Given** the same, and an assignee who has not used the Admin UI in the last five
   minutes, **Then** they also receive one e-mail, in the language of their Admin UI, with
   the same facts and a link to the Opportunity.
6. **Given** an Opportunity reassigned after the Event was created, **When** the reminder is
   due, **Then** the person assigned at that moment is reminded and the earlier one is not.
7. **Given** an Opportunity with no assignee, **When** a reminder is due, **Then** the
   person who created the Event is reminded if they may still open the Opportunity;
   otherwise nobody is, and the Event says that nobody could be reminded.
8. **Given** a closed Opportunity, **When** a reminder falls due, **Then** nothing is sent,
   the tab says reminders are paused, and the Events stay listed and editable; reopened
   within a day of the reminder's time, it is sent late; later than that, it is shown as
   missed.
9. **Given** the platform was not running when a reminder fell due, **When** it runs again
   within 24 hours, **Then** the reminder is sent once, late; after 24 hours it is not sent
   and is shown as missed.
10. **Given** an Event, **When** somebody who may change the Opportunity edits or deletes
    it, **Then** the change is recorded in the history; a deleted Event sends no reminder,
    and a reminder moved to a new future time is sent at the new time, once.
11. **Given** a user who may only read, **When** they open *Events*, **Then** they see the
    list and the calendar and nothing that adds, changes or deletes.
12. **Given** an Opportunity the user may not see, **When** they ask for its Events or name
    one of them, **Then** the answer is the one given for an Opportunity that does not
    exist.
13. **Given** the instance has no working e-mail, or the operator has switched the reminder
    e-mail off, **When** a reminder is due for somebody who is away, **Then** the bell entry
    is still written and is there when they return.

---

### User Story 22 — A calendar of Events across Opportunities (Priority: P3)

*Added 2026-10-08 with User Story 21. The owner's words, verbatim, with an English
rendering:*

> - „Moduł CRM powinien zawierać widok Kalendarza, w stylu kalendarza Google." — *The CRM
>   module should contain a Calendar view, in the style of Google Calendar.*
> - „Pokazuje on wszystkie Wydarzenia z CRM, które mają określoną datę." — *It shows all CRM
>   Events that have a date.*
> - „Administrator Platformy widzi wszystkie Wydarzenia wszystkich Szans Sprzedażowych na
>   Kalendarzu. Handlowiec widzi Wydarzenia tylko ze swoich Szans Sprzedażowych." — *A
>   Platform Administrator sees all Events of all Sales Opportunities on the Calendar. A
>   Sales Rep sees Events only of their own Sales Opportunities.*
> - „Kliknięcie na Wydarzenie przenosi do powiązanej z nią Szansy Sprzedażowej." — *Clicking
>   an Event leads to the Sales Opportunity it belongs to.*
> - „Wydarzenia na Kalendarzu pojawiają się tylko dla aktywnych Szans Sprzedażowych" —
>   *Events appear on the Calendar only for active Sales Opportunities.*
> - „Zmiana Handlowca przypisanego do Szansy przenosi jej wpisy do kalendarza nowej osoby." —
>   *Changing the Sales Rep assigned to an Opportunity moves its entries to the new person's
>   calendar.*

A Sales Rep opens *CRM → Calendar* on Monday morning and sees the week: every Event of the
Opportunities they hold, on its day and at its hour. A manager opens the same screen and
sees everybody's, and can narrow it to their own.

**Why this priority**: the Events of User Story 21 are already usable from each
Opportunity; this story is the view across them.

**Independent Test**: with Events on three open Opportunities — one held by the Sales Rep,
one by a colleague in an Organization both may see, one in an Organization the Sales Rep
may not see — and one on a closed Opportunity: as the Sales Rep, open the Calendar and find
only the first; press it and land on that Opportunity's *Events* tab. As a manager, find the
first three and not the fourth; switch to *Mine*. Reassign the first Opportunity to the
colleague and see it leave the Sales Rep's calendar. Repeat at a 390 px wide window and
with a keyboard alone.

**Acceptance Scenarios**:

1. **Given** a user who may view Opportunities, **When** they open the Calendar from the
   CRM group of the sidebar or from the command palette, **Then** it opens on the current
   month, today marked, with *Today*, *Previous*, *Next*, a *Go to date* field and a switch
   between *Month*, *Week* and *Agenda*.
2. **Given** a user who may see every Organization, **When** the Calendar opens, **Then**
   it shows the Events of every open Opportunity, and a *Mine / All* switch narrows it to
   the Opportunities assigned to them.
3. **Given** a Sales Rep — a user confined to their Organizations — **When** the Calendar
   opens, **Then** it shows only the Events of Opportunities assigned to them, and offers no
   switch.
4. **Given** an Opportunity that is closed as won or lost, **When** the Calendar is read,
   **Then** none of its Events is on it; reopened, they are back.
5. **Given** an Opportunity reassigned from one Sales Rep to another, **When** each opens
   the Calendar, **Then** its Events are on the new assignee's and no longer on the former
   one's, with nothing to carry over.
6. **Given** the *Week* view, **When** it is read, **Then** it shows seven days from Monday,
   an all-day row, the hours of the day, each Event at its time and length, Events that
   overlap side by side, and a line at the current time on today.
7. **Given** the *Month* view and a day with more Events than fit, **When** it is read,
   **Then** the day shows the first three and "+N more", which opens that day's week.
8. **Given** any view, **When** an Event is pressed, **Then** the user is on the Opportunity
   it belongs to, on *Events*, with that Event marked.
9. **Given** any view and a keyboard alone, **When** the user tabs through the calendar,
   **Then** every Event is reached in the order of its time, each announced with its name,
   its time and its Opportunity, and each day is a heading.
10. **Given** a 390 px wide window, **When** the Calendar is opened, **Then** it is the
    *Agenda* — a list of days with their Events — and nothing scrolls sideways.
11. **Given** the view, the date and the *Mine / All* choice, **When** the page is reloaded
    or its address opened again, **Then** the same view of the same date is shown.
12. **Given** no Event in the shown range, a slow answer, or a failed one, **Then** the
    calendar says so — an empty range with a way to today, a skeleton, an error with *Try
    again* — and never an empty grid with no words.

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
  removed and the linked Orders and Quote Requests are untouched. Its Events go with it, and
  no reminder of theirs is sent.
- **An Event that would span two days** — refused: an Event starts and ends on one day, or
  is all-day for one date (User Story 21). A meeting over midnight is two Events.
- **An Event read in another time zone** — a timed Event is one instant and is drawn at the
  reader's local time, on the day it starts for them, clipped at midnight; an all-day Event
  is a date and is drawn on that date for everybody.
- **A reminder falls due while the assignee cannot open the Opportunity** (deactivated, or
  no longer reaching its Organization) — they are not reminded; the Event's creator is
  tried under the same test; failing both, nobody is, and the Event says so.
- **A reminder falls due while the bell capability is switched off** — the e-mail is sent
  whether or not the person is online; with neither available the Event says the reminder
  could not be delivered.
- **The reminder's time is changed after it was sent** — a new future time arms it again;
  it is sent once at the new time.
- **Two people edit one Event at once** — the later save wins; an Event carries no version.
- **A month holding more Events than the calendar draws** — the first 500 by start time are
  shown and the screen says the range is incomplete and to narrow it (*Mine*, or *Week*).

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
  linked to the same Opportunity automatically. *(Reachable in the product since 2026-10-08:
  the Order records its Quote Request — FR-100 … FR-104; Clarifications § Amendments, A-1.)*

**Value**

- **FR-030**: An Opportunity's value MUST be either entered by hand or computed from its
  linked Orders and Quote Requests, chosen per Opportunity; the value carries one currency.
- **FR-031**: Operators MUST be able to state, in the Workflow configuration, which Order
  statuses and which Quote Request statuses make a linked document's value count.
- **FR-032**: A computed value MUST follow the linked documents: it changes when a document is
  linked or unlinked, when a linked document changes status, when a linked Quote Request's
  prices are modified, when the Opportunity is switched to "computed", and when the counting
  configuration changes. *(Amended 2026-10-06 — A-6. The original wording was "enters or
  leaves a counting status, or changes its amount". As built, an Order's amount on its own is
  not a trigger: the value is recalculated on the Order's status changes, at the amount the
  Order has at that moment. A Quote Request that is completed is picked up at the next
  recalculation rather than at once.)*
- **FR-033**: A computed value MUST count an Order placed from a linked Quote Request once,
  and MUST leave out — and name — documents in another currency. *("Counted once" is
  reachable in the product since 2026-10-08 — FR-100; A-1.)*

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
  already linked, or whose originating Quote Request is. *(The second half — "or whose
  originating Quote Request is" — is reachable in the product since 2026-10-08 — FR-100;
  A-1.)*

**Platform behaviour**

- **FR-070**: The module MUST be switchable on and off by an operator. While off, none of its
  screens, navigation entries, command-palette actions, API, automation or contributions to
  other screens is present; Orders, Quote Requests, Organizations and customers behave exactly
  as without the module; no data is lost and switching it back on restores everything.
- **FR-071**: Every CRM screen MUST be reachable from the Admin UI's navigation, in a
  navigation group of its own named "CRM". The module MUST be reachable from the command
  palette through its landing screen and its few everyday actions — a curated set, not one
  entry per screen. Every navigation entry and palette action MUST be shown only to users
  holding the permission that guards the screen it opens. *(Amended 2026-10-06 — A-2. The
  original wording was "Every CRM screen MUST be reachable … from the command palette". As
  built there are four palette actions — open Opportunities, new Opportunity, open the board,
  open analytics; Tags and Workflow configuration are reached from the navigation only.)*
- **FR-072**: Every user-facing text MUST be available in English and Polish. *(One exception
  as built, caused by the platform rather than by this feature — A-5: the names and
  descriptions of the module's three Settings on the Settings screen are in English only.
  Until 2026-10-07 the titles of the notification-bell entries were a second; FR-085 closed
  it.)*
- **FR-073**: Every change made through the feature MUST be recorded in the platform's audit
  trail with its author.
- **FR-074**: Other modules MUST be able to read an Opportunity and request a Status change
  through a documented interface that reports the outcome as a value.
- **FR-075**: The module MUST be documented for operators and for developers, in English and
  Polish.

**Cooperation added by the owner's second ruling (2026-10-05)**

- **FR-076**: Operators MUST be able to define custom fields for Opportunities through the
  platform's existing custom-fields capability, and users MUST be able to fill them in when
  creating and editing an Opportunity. Values MUST be validated against their definition on
  every write, refused per field, and visible only to those who may see the Opportunity.
  While the CRM module is off, the Opportunity record type MUST NOT be offered for field
  definition.
- **FR-077**: Operators MUST be able to subscribe external systems, through the platform's
  existing webhooks capability, to Opportunity events — at least "status changed", and also
  "created" and "closed" (carrying won or lost). Each notification's content MUST be
  documented and versioned, and MUST respect a subscription's Organization binding. With the
  webhooks capability off, Opportunities MUST keep working; with CRM off, its events MUST NOT
  be offered.
- **FR-078**: The Order screen and the Quote Request screen MUST show the Opportunity the
  document is linked to (number, title, Status, assignee, value, a link), and for an unlinked
  document MUST offer linking it to an existing Opportunity of the same Organization and
  starting a new Opportunity from it. With CRM off, or for a user who may not see
  Opportunities, both screens MUST be identical to the ones without the module.

**Added after implementation (2026-10-06) — behaviour that was built and had no requirement**

- **FR-079**: What another capability owns MUST be shown inside CRM only to a user who may
  read it where it lives. A linked Order's number, status and total, a linked Quote Request's
  number, status and value, the name of a document a computed value leaves out, and the label
  of a referenced Product or Order MUST be shown as unavailable to a user who lacks that
  capability's own read permission; linking a document, switching its status following, and
  attaching a file already in the media library by its identifier MUST require it as well.
  The Opportunity's own figures — its value included — are not narrowed.
- **FR-080**: A file a browser would run as a page or a script (HTML, SVG, XML, JavaScript)
  MUST be refused as an attachment, by name or by declared type, before anything is stored;
  every attachment MUST be handed out as a download, never displayed inside the Admin UI's
  own session; and a single attachment MUST NOT exceed the stated size limit (25 MB as
  built).

- **FR-081**: Users MUST be able to mention a person — a user of the Admin UI who may read
  Opportunities — in an Opportunity's description, its notes and its messages; the mention
  MUST be shown as `@` and the person's current name, and as unavailable for a person who was
  removed or deactivated. *(Added 2026-10-07, User Story 18.)*
- **FR-082**: In those text fields, typing `@`, `@@` or `@@@` at the start of the text or
  after white space MUST open a search of people, of the Organization's Orders, or of
  Products respectively, operable by keyboard alone; an `@` inside a word (an e-mail address)
  MUST NOT. The Order and Product searches are offered under the rule of FR-079.
- **FR-083**: A person newly mentioned in a saved description, note or message MUST receive
  one Admin UI notification per save, naming the Opportunity by its number and the author by
  name, never carrying the text, and leading to the Opportunity. The author, a person who may
  not read Opportunities and a person who may not see the Opportunity's Organization MUST NOT
  be notified; saving the same text again MUST NOT notify again.
- **FR-084**: The Change history tab MUST show references inside a changed description as
  the names they stand for, under the rule of FR-079, and MUST say when an Opportunity has
  more history than the tab can reach.
- **FR-085**: A notification-bell entry this feature writes — an assignment, a message, a
  mention — MUST be shown to each reader in that reader's Admin UI language, English or
  Polish, and MUST remain readable, in English, when the translation cannot be found: while
  the CRM capability is switched off, or in an Admin UI older than this requirement. What a
  translated entry says MUST NOT exceed what FR-083 and the assignment and message rules allow
  its English sentence to say — the Opportunity's number and, for a mention, the author's
  name. The platform's notification bell gains the ability additively: a capability that
  writes entries the old way is unaffected. *(Added 2026-10-07 at the owner's request;
  `research.md` N-BT1 … N-BT4.)*

- **FR-086**: While a description, a note or a message is written or edited, every reference
  in it MUST be shown as the name it stands for, never as its stored code; the list opened
  by `@` MUST appear at the place being typed; and saving MUST NOT alter a reference the
  user did not change. *(Added 2026-10-07, owner rulings on User Story 18.)*

- **FR-090**: An operator holding `crm:configure` MUST be able to choose which fields a
  board card shows and in what order, from the built-in fields of an Opportunity and every
  custom field defined for Opportunities; at most six, the title always shown besides. The
  choice is one for the whole instance. Until it is made, a card shows what it showed before.
  *(Added 2026-10-08, User Story 19.)*
- **FR-091**: The board MUST show, on every card, the chosen fields in the chosen order,
  leaving out a field the Opportunity has no value for, and MUST answer no field value that
  was not chosen. Reading the values MUST cost a number of statements that does not grow with
  the number of cards.
- **FR-092**: The board MUST offer a filter for every field its cards show, of a kind that
  suits the field, applied by the server to the cards, the counts and the totals alike;
  filters combine with AND, are carried in the board's address, and are cleared by one
  action. A filter naming a field that is not on the card MUST be ignored, not refused.
- **FR-093**: A custom field that no longer exists MUST drop out of the cards, the filters
  and the configuration without an error. Field filters MUST NOT reach an Opportunity the
  user cannot otherwise read (FR-040).

**An Order records the Quote Request it was placed from** *(added 2026-10-08 — the owner's
answer to A-1: "Ad 2) tak, jak możesz to dorób". A change to the Orders, cart and Quote
Requests capabilities made inside this feature; numbering starts at FR-100, FR-087 … FR-099
being left free for work on parallel branches. Research N-QS1 … N-QS6.)*

- **FR-100**: An Order placed from the basket that an accepted Quote Request filled MUST
  record that Quote Request, on every path by which a Quote Request becomes an Order. The
  record MUST be in place when the Order first becomes readable, so that everything that
  reacts to a placed Order sees it.
- **FR-101**: The basket MUST keep the Quote Request it was filled from for as long as it
  keeps the agreed prices: adding a product, removing one or changing a quantity keeps it. A
  basket emptied of its last line, or filled again from another source (a reorder, an Order
  an administrator creates), MUST forget it.
- **FR-102**: The Quote Request an Order records MUST be checked when the Order is placed,
  never taken on trust: it MUST belong to the same Organization as the Order, MUST still be
  approved, and the basket MUST still hold at least one of its lines at the agreed price.
  When any of the three fails the Order MUST be placed all the same and record nothing, and
  MUST disclose nothing of the Quote Request. No request from the storefront, the Admin UI or
  the external API may name the Quote Request.
- **FR-103**: With the Quote Requests capability switched off, or absent, an Order MUST be
  placed exactly as before and record no Quote Request; nothing of that capability moves.
- **FR-104**: A Quote Request whose Order has been placed MUST be completed and point at
  that Order, reliably — including when the Order is not yet readable at the moment its
  placement is announced — and MUST NOT be completed by an Order of another Organization. A
  completed Quote Request cannot be ordered a second time. **At most one Order records a
  given Quote Request**: when two baskets carry the same one, the first Order placed is the
  request's and the second is placed as an ordinary Order — whether or not the request has
  been completed yet. *(Last sentence added 2026-10-08 by the independent review — research
  N-QSR1.)*

**The Opportunity screen's layout** *(added 2026-10-08, User Story 20. Admin UI only: no
endpoint, schema, permission or rule of an earlier requirement changes. FR-105 … FR-109 are
left free. Research N-DL1 … N-DL8.)*

- **FR-110**: The Opportunity screen MUST present a header (title, status, and one line
  naming the number, the Organization, the assignee or that there is none, and the Sales
  Channel when there is one) and, under it, two columns: on the left the stage bar, then the
  outcome of the last status change for the linked Orders, then the tabs; on the right, from
  the header down and beside all three, the Opportunity's facts in one bounded card. On a
  screen too narrow for two columns the order MUST be stage bar, Order outcomes, facts, tabs
  — the facts never under the content of a tab — and the page MUST NOT scroll sideways at a
  width of 390 px. *(Amended 2026-10-08: the facts beside the stage bar and in a card, and
  before the tabs on a narrow screen — research N-DL10.)*
- **FR-111**: Every action the screen offered before MUST remain reachable by the same
  users: editing and deleting the Opportunity; changing its status, with a reason; retrying
  and dismissing a refused Order change; assigning; tagging; switching the value's mode;
  linking, unlinking and status following of documents; creating a document from the
  Opportunity; notes, messages, attachments, change history and custom fields. The layout
  MUST add no way of changing an Opportunity and MUST NOT change the rule of an existing one.
- **FR-112**: The stage bar MUST name the status the Opportunity is in and MUST show, of all
  the other statuses of the workflow, exactly those the workflow allows a move to from it
  (FR-013) — no status that cannot be reached in one move, and no line of the whole
  workflow: the workflow is a graph. It MUST NOT present any status as passed, completed or
  skipped, and MUST NOT state a position such as "n of N". *(Amended 2026-10-08: the first
  build listed every status and counted a stage — research N-DL9.)*
- **FR-113**: The moves MUST be presented on two sides of the current status: **back** — to
  a status earlier in the operator's order, and reopening a closed Opportunity — and
  **forward** — to a later status, and every move that closes the Opportunity, each of those
  identified as won or lost. A side with no move MUST NOT be shown; with no move at all the
  bar MUST say that the workflow allows none. A closed Opportunity MUST also show how (won or
  lost) and when it was closed. *(Amended 2026-10-08.)*
- **FR-114**: A move MUST be actionable for a user who may change Opportunities, and acting
  on it MUST be the existing status change in every respect (FR-015, FR-016, FR-022), the
  optional reason included. A user who may only read MUST be shown the same moves with
  nothing actionable among them. When the order of the workflow cannot be read, the bar MUST
  still offer every allowed move, MUST NOT guess a side for a move whose side depends on that
  order, and MUST say so.
- **FR-115**: The bar MUST be operable with a keyboard alone; each action MUST be named by
  what it does, direction included; no status and no side MUST be distinguished by colour
  alone; and every move MUST be visible without sideways scrolling at 390 px, however many
  the workflow allows.
- **FR-116**: The tabs MUST be, in this order: Overview, Links, Notes, Messages,
  Attachments, Change history; the screen MUST open on Overview. *(Since User Story 21
  an Events tab stands third, between Links and Notes — FR-133.)*
- **FR-117**: The linked Orders and Quote Requests MUST be on the Links tab, with everything
  FR-020, FR-023 and FR-026 give them, and on no other tab. The tab's label MUST carry the
  number of linked documents when there is at least one. The Quote Requests section MUST be
  present, degraded or absent under exactly the conditions it was before.
- **FR-118**: The open tab MUST be part of the screen's address, so that a reload and a
  shared link open the same tab. An address naming no tab, or an unknown one, MUST open
  Overview; the address a user returns to after creating a document from the Opportunity
  MUST open Links. Every address of an Opportunity that worked before MUST keep working.
- **FR-119**: The facts card MUST show, on every tab, four groups in this order — value
  and deadline; customer and assignee; classification; record — each fact as a label above
  its value. A fact with no value MUST be shown as empty, and said to be so to assistive
  technology, never left out — the closing date excepted, which an open Opportunity
  does not have; nothing MUST be revealed only on hover. A fact MUST be
  changeable in the column only where it already was in one gesture: the value's mode, the
  assignee, the tags.
- **FR-120**: What became of the linked Orders after a status change, and every refused
  change still open (FR-022, FR-023), MUST be shown directly under the stage bar on every tab.
- **FR-121**: The screen MUST have exactly one first-level heading and MUST NOT skip a
  heading level on any tab, Change history included; the tab strip MUST be a single keyboard
  stop walked with the arrow keys; every control MUST offer a 44 px target on a touch
  screen; and every colour MUST come from the theme, so that the dark theme needs nothing of
  its own.

**Events and their reminders** *(added 2026-10-08, User Story 21. FR-122 … FR-129 are left
free. Research N-CAL1 … N-CAL14. FR-116's tab order gains *Events* in third place — FR-133 —
and is otherwise unchanged.)*

- **FR-130**: A user who may change Opportunities MUST be able to add an Event to an
  Opportunity they may see: a name (1 … 200 characters), an optional description (plain
  text, up to 5 000 characters), and either a start and an end, or *all day* for one date.
  An Event belongs to exactly one Opportunity and cannot be moved to another.
- **FR-131**: An Event MUST start and end on one calendar day, its end after its start. A
  timed Event is a moment in time, the same moment for every reader; an all-day Event is a
  date, the same date for every reader.
- **FR-132**: Every user who may change the Opportunity MUST be able to edit and delete any
  of its Events — the Events are the Opportunity's plan, not their author's property.
- **FR-133**: The Opportunity screen MUST have an *Events* tab, third after *Overview* and
  *Links*, whose label carries the number of Events that have not ended yet when there is at
  least one. The tab MUST hold: the Opportunity's Events as a list, those not yet ended
  first and soonest first, the ended ones after them; a calendar of this Opportunity's
  Events alone; and, for a user who may change the Opportunity, adding, editing and deleting
  an Event. A user who may only read MUST get the list and the calendar and no control that
  changes anything. A closed Opportunity MUST keep the tab, its Events and their editing.
- **FR-134**: An Event MUST be visible exactly to the users who may see its Opportunity; an
  Event of an Opportunity outside a user's reach MUST be indistinguishable from one that
  does not exist, on every path that reads or names it.
- **FR-135**: Adding, changing and deleting an Event MUST be recorded in the Opportunity's
  change history with who and when, and with the Event's name and times; the description's
  text MUST NOT be part of the record.
- **FR-136**: Deleting an Opportunity MUST delete its Events. Closing an Opportunity MUST
  NOT.
- **FR-137**: An Event MAY carry one reminder: a date and time, offered as the Event's start
  (09:00 on its date for an all-day Event) and changeable. A reminder time that is not in
  the future when it is saved MUST be refused. Removing the reminder, or deleting the Event,
  MUST mean nothing is sent.
- **FR-138**: When a reminder is due it MUST go to the person assigned to the Opportunity
  **at that moment**; when nobody is assigned, to the person who created the Event. A
  person who is deactivated or may no longer see the Opportunity MUST NOT be reminded. When
  nobody qualifies, nothing is sent and the Event MUST say that nobody could be reminded.
- **FR-139**: A reminder MUST be written to the recipient's notification bell, naming the
  Event, when it starts and the Opportunity's number, and opening the Opportunity on
  *Events*. When the recipient has made no request to the Admin UI in the five minutes
  before, an e-mail MUST be sent to them as well — in the language of their Admin UI, with
  the same facts and a link to the Opportunity. An e-mail that cannot be sent — no working
  e-mail on the instance, or the reminder e-mail switched off by the operator — MUST NOT
  cost the bell entry. With the bell capability switched off the e-mail MUST be sent
  whether or not the recipient is online.
- **FR-140**: A reminder MUST be delivered at most once. It MUST NOT be sent while its
  Opportunity is closed or while CRM is switched off. A reminder found due up to 24 hours
  late — after downtime, after CRM was switched back on, after the Opportunity was
  reopened — MUST be sent then; one found later than that MUST NOT be sent and MUST be shown
  as missed. Saving a new future reminder time on an Event whose reminder was already
  handled MUST arm it again.
- **FR-141**: The *Events* tab MUST say, for every Event with a reminder, what became of
  it: scheduled for a time; paused because the Opportunity is closed; sent, when and by
  which of the two ways; missed; nobody to remind; could not be delivered.

**The Calendar** *(added 2026-10-08, User Story 22. Research N-CAL3, N-CAL4,
N-CAL9 … N-CAL12.)*

- **FR-142**: CRM MUST have a Calendar screen, in the CRM group of the sidebar and among
  the command-palette actions, open to every user who may view Opportunities.
- **FR-143**: The Calendar MUST show Events of **active** Opportunities only — those in a
  status that does not close the Opportunity as won or lost. Closing an Opportunity MUST
  take its Events off the Calendar and reopening MUST bring them back; neither changes the
  Events.
- **FR-144**: A user who may see every Organization MUST be shown the Events of every active
  Opportunity, and MUST be able to narrow the Calendar to the Opportunities assigned to
  them. A user confined to a set of Organizations — a Sales Rep — MUST be shown only the
  Events of Opportunities assigned to them, among those Organizations. On no path may the
  Calendar show an Event of an Opportunity its reader may not see.
- **FR-145**: Whose Calendar an Event is on MUST follow from who the Opportunity is assigned
  to when the Calendar is read. Reassigning an Opportunity MUST therefore move all its
  Events at once, with nothing copied and nothing left behind.
- **FR-146**: The Calendar MUST offer a *Month*, a *Week* and an *Agenda* view; *Today*,
  *Previous* and *Next*; going to a chosen date; and a title naming the range shown. The
  view, the date and the *Mine / All* choice MUST be part of the screen's address.
- **FR-147**: The *Week* view MUST show seven days starting on Monday, a row for all-day
  Events, the hours of the day, each timed Event at its time and for its length, Events
  that overlap side by side, and the current time on today. The *Month* view MUST show
  whole weeks, up to three Events per day and, beyond three, how many more — which opens
  that day's week. The *Agenda* MUST list the days that have Events, each with its Events
  in order of time.
- **FR-148**: Every Event on the Calendar MUST be a link to its Opportunity, opening on
  *Events* with that Event marked, and MUST be named — to sight and to assistive
  technology — by its name, its time, and its Opportunity's number and title.
- **FR-149**: Times MUST be shown in the time zone of the reader's browser, and the screen
  MUST name that zone.
- **FR-150**: The Calendar MUST be fully usable with a keyboard alone and with a screen
  reader: every Event reachable in the order of its time, every day a heading, nothing
  distinguished by colour alone, focus always visible, every control a 44 px target on a
  touch screen. At a width under 640 px the Calendar MUST be the *Agenda*, and nothing MUST
  scroll sideways at 390 px. It MUST have a loading, an empty and an error state, each in
  words.
- **FR-151**: One read of the Calendar MUST cover at most 45 days and return at most 500
  Events, saying so when there were more; its cost MUST NOT grow with the number of
  Opportunities or of Events returned.
- **FR-152**: The demonstration data MUST include Events on demonstration Opportunities,
  dated relative to the day the data is installed, so that the Calendar of a fresh demo is
  not empty.

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
- **Custom field values** — the operator-defined fields of one Opportunity and their values;
  the definitions belong to the platform's custom-fields capability.
- **Event** — something planned on one Opportunity: name, description, one day's start and
  end or an all-day date, the time zone it was planned in, who created it; optionally one
  reminder — its time and what became of it.

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
- **SC-008**: Every CRM screen is reachable through the navigation, and the module through
  its curated command-palette actions, in both English and Polish, with no untranslated
  label. *(Amended 2026-10-06 with FR-071 — A-2.)*
- **SC-009**: With automatic creation on, 100% of newly placed Orders and Quote Requests end
  up linked to exactly one Opportunity. *(True of an Order placed from a Quote Request that
  is already linked since 2026-10-08: it joins that Opportunity — FR-100; Clarifications
  § Amendments, A-1.)*

- **SC-010**: An operator can add a custom field to Opportunities and see it on the
  Opportunity form in under 1 minute, with no deployment; 100% of values that break a
  definition are refused naming the field.
- **SC-011**: 100% of Opportunity status changes produce exactly one queued notification per
  matching webhook subscription, and 0 notifications reach a subscription bound to another
  Organization.
- **SC-012**: From an Order's screen a user reaches its Opportunity in one click; with the
  CRM module off, the Order and Quote Request screens show no trace of it.
- **SC-013**: A Sales Rep can add an Event with a reminder to an Opportunity in under 30
  seconds; 100% of due reminders on open Opportunities reach the bell of the person assigned
  at that moment within 2 minutes of their time, and 0 are delivered twice.
- **SC-014**: A month holding 500 Events appears on the Calendar in under 1 second as
  perceived by the user, and switching between Month, Week and Agenda within the loaded
  range is immediate.
- **SC-015**: A Sales Rep's Calendar shows 0 Events of Opportunities that are not assigned
  to them, and no user's Calendar shows an Event of an Opportunity they may not open.

## Clarifications

### Owner rulings, 2026-10-05

- **Navigation**: CRM gets its **own top-level navigation group named "CRM"** in the Admin UI
  sidebar, and every CRM link lives there — Opportunities, Board, Analytics, Tags, Workflow.
  They are **not** placed under the existing "Sales" group. If it later turns out the group
  holds only one or two links, they will be moved into "Sales"; that is a possible later
  follow-up and nothing to do now. The group label is "CRM" in both English and Polish.
- **Packaging**: CRM is a **free module in this repository** for now ("maybe paid someday").
  It must stay cleanly detachable; its destination does not change.

### Owner rulings, 2026-10-05 (second round)

The three questions this design had left open are **decided by the owner**, each as the
default already applied:

- **Quote Requests is not a hard dependency of CRM.** An operator may switch the Quote
  Requests capability off while CRM is on; CRM keeps working and degrades as the Edge Cases
  say (linked Quote Requests unavailable, not counted, not linkable).
- **An Opportunity's transition stands when an Order refuses to follow.** The refusal is shown
  per Order and can be retried or dismissed; it never undoes the Opportunity's move.
- ~~The board uses the browser's native drag-and-drop.~~ **Reversed the same day — see the
  third round below.**

### Owner ruling, 2026-10-05 (third round) — the board uses a drag-and-drop library

**The Opportunity board is built on the `@dnd-kit` drag-and-drop library**, replacing the
native drag-and-drop default accepted in the second round. The owner's reason: *"I feel it may
be useful not only in this module but in the future too."* Consequently the board's lanes and
cards are a reusable, domain-free building block of the Admin UI's design system, which CRM is
the first to use. The **"Move to…" menu stays**: dragging — by pointer, touch or keyboard — is
never the only way to move a card.

Three integrations this design had deferred are **in scope by the owner's request**: custom
fields on Opportunities (User Story 15, FR-076), outbound webhooks for Opportunity events
(User Story 16, FR-077), and the "linked Opportunity" panel on the Order screen — extended by
this design to the Quote Request screen, at the cost of one more mount (User Story 17,
FR-078). **Import/export stays deferred**: it is not a one-declaration integration — the
platform's import/export capability holds each record type's adapter itself, so adding
Opportunities means changing that capability and making it depend on CRM (`research.md` R-22).

### Owner ruling, 2026-10-05 — the module's identifier is `crm`

The owner's requirements document names the module "CRM (`crm`)", and the owner confirmed it
on 2026-10-05. The identifier is an acronym, not the plural noun the naming convention
otherwise asks of a module, so it is admitted by name on the naming check's list of proper
nouns — the way every earlier module with a non-plural identifier was (`research.md` N-1).

### Decisions taken during implementation — coordinator decisions, owner informed, reversible

None of these was put to the owner as a question before it was built. Each was decided by the
session's coordinator while implementing, the owner was told, and **the owner may reverse any
of them**; each is the default now in force. Permission names are the ones an operator sees
in the role editor. The reasoning and the alternatives not taken are in the `research.md`
note named.

- **D-1 — Uploading an attachment needs the CRM write permission and nothing of the media
  library's** (`crm:write`). The file is stored in the media library as a private file by
  CRM, on the user's behalf. *Not taken*: asking for the media library's own upload
  permission, which a Sales Rep does not hold and which left the Attachments tab without an
  "Add a file" button for them (N-D8, N-F1).
- **D-2 — Attaching a file that is already in the media library, by its identifier,
  additionally needs the media library's read permission** (`assets.read`). Otherwise
  anybody who knew the identifier of a private file could attach it and download it. The
  Admin UI does not use this path; it uploads (N-I5).
- **D-3 — Another capability's records are shown to those who may read them there.** Linking
  an Order, switching its status following, and seeing a linked Order's number, status and
  total need `orders:read`; the same for a Quote Request needs `rfqs:handle` (the one
  permission the Quote Requests capability has); a Product's name inside a reference needs
  `catalog:read`. Without the permission the record is shown as unavailable. An
  Opportunity's computed value is its own figure and is shown to everybody who may see the
  Opportunity, so one linked document's amount can be inferred from it (N-R3, N-R13). This is
  FR-079.
- **D-4 — Moving a followed Order is a consequence of the configured mapping, not an act of
  the person who moved the Opportunity.** It is applied whether or not that person holds
  `orders:write`: the mapping was configured by somebody with the configuration permission,
  and the Order's own history records who triggered it. *Not taken*: requiring
  `orders:write`, which would make "the Order follows the Opportunity" true only for people
  who could have moved the Order by hand (N-R3).
- **D-5 — Logic registered to run *after* a transition receives its notifications one after
  another, in the documented order, and the transition's answer waits for them.** A failure
  in such logic is still isolated and cannot undo or fail the transition (N-E19).
- **D-6 — A computed value adds Orders at their gross total and Quote Requests at their net
  line sum**, in the Opportunity's currency only, with no conversion between the two bases
  (N-E1, N-E2).
- **D-7 — A Quote Request an administrator creates on a customer's behalf is a "placed"
  Quote Request for automatic creation**: with "create from Quote Requests" on it gets an
  Opportunity, unless it was created from within one (N-J6).
- **D-8 — The Opportunity an Order was created from is part of the Order-created
  notification, and therefore reaches external systems subscribed to "Order created"**
  through outbound webhooks, as an opaque reference (a type and an identifier). It is absent
  for every other Order (N-J7).
- **D-9 — A document created from within an Opportunity is linked without checking that its
  creator holds the CRM write permission.** The buttons on the Opportunity ask for it; the
  link itself is made when the Order-created notification arrives, and that notification
  does not say who created the Order. So somebody who may create Orders, holds no CRM
  permission and knows an Opportunity's identifier can attach a new Order of the same
  Organization to it. The Organization match is always checked, and for a Quote Request so
  is the creator's reach to the Organization. Closing the gap needs the creator's identity
  on the Order-created notification, which belongs to the Orders capability (N-J2).

### Amendments after implementation, 2026-10-06

A product-owner audit compared this specification with what was built. Where they differed
the specification was corrected in place, with the original wording kept in the amendment
note, or the requirement was left standing and marked. Nothing was removed.

- **A-1 — "An Order placed from a linked Quote Request joins its Opportunity and is counted
  once" could not happen in the product; since 2026-10-08 it does.** Affected FR-027, the
  "counted once" half of FR-033, the second half of FR-061, User Story 8 scenarios 4 and 6,
  User Story 9 scenario 3 and SC-009 for such Orders. The platform did not record which Quote
  Request an Order was placed from — a defect that predated this feature and lay in the
  Orders and cart capabilities (`research.md` N-E3) — so CRM's behaviour was proven only with
  an Order whose source was written by hand. **Decided by the owner on 2026-10-08** ("Ad 2)
  tak, jak możesz to dorób"): repaired inside this feature. FR-100 … FR-104 state what the
  Orders, cart and Quote Requests capabilities now do; CRM itself did not change, and the
  seven places above are proven by Orders placed through the storefront's own routes
  (`research.md` N-QS1 … N-QS6).
- **A-2 — Command palette (FR-071, SC-008).** Reworded from "every CRM screen" to a curated
  set. The platform's binding rule for the palette (constitution, Principle XVI) asks that a
  *module* be discoverable there through its landing screen and its few highest-value
  actions, and forbids listing every screen ("curated, not exhaustive"). The original
  wording of FR-071 asked for more than that rule allows; what was built — four actions —
  follows the rule. If the owner wants Tags or Workflow in the palette, that is two more
  actions and a judgement under the same rule, not a missing requirement.
- **A-3 — Analytics time zone.** UTC as built; see *Assumptions*. A platform time-zone
  setting is a possible follow-up.
- **A-4 — Demo pipeline (User Story 14, scenario 3).** ~~Not built; deferred.~~ **Decided by
  the owner on 2026-10-08** ("Tak, dodajmy dane demo dla CRM do naszych danych demo w seed"):
  the change to the demo data set is admitted (`contracts/foreign-module-changes.md` §N) and
  the pipeline is built (`research.md` N-DD1). The second half of the question — whether the
  demo gains an Order — was not part of that answer and stays open: the pipeline links
  nothing, and one Opportunity's calculated value is honestly zero (`research.md` N-DD2).
- **A-5 — English-only texts (FR-072).** One exception, platform-level: a Setting's name and
  description are shown as declared, with no per-language variant, for every capability's
  Settings (`research.md` N-H5). Every other CRM text is in both languages. *(Until
  2026-10-07 there was a second: a notification bell entry took its title as finished text
  rather than as a translatable key, for every capability that uses the bell — `research.md`
  N-B7. FR-085 gave the bell a translatable form and CRM uses it; the other capabilities that
  write to the bell still write English only, which is theirs to change.)*
- **A-6 — What moves a computed value (FR-032).** Reworded to the triggers that exist. The
  Orders capability sets an Order's total when the Order is placed and nowhere else was it
  found to change it, so nothing is known to be missed; if such a path exists elsewhere or
  is added, the value catches up at the Order's next status change rather than at once.
- **A-7 — Two requirements added**, FR-079 and FR-080, for behaviour that was built during
  implementation and review and had no requirement: showing another capability's records
  only to those who may read them (D-3), and refusing files a browser would run as
  attachments.
- **Not amended, and worth the owner's attention**: a message cannot be addressed to
  anybody — it notifies the assignee and everybody who already wrote in the thread, so the
  first message on an unassigned Opportunity notifies nobody (FR-043 says "the other
  participants", which this satisfies as written); and "the most valuable Opportunities"
  (FR-053) ranks by value — the module holds no cost or margin, so if the owner's "most
  profitable" meant margin it is not built.

### Open questions on Events and the Calendar, 2026-10-08 — each with the default applied

User Stories 21 and 22 were designed from ten sentences. Where a sentence left room, a
default was applied so the stories can be built; **every one of these is the owner's to
confirm or reverse**, and none blocks implementation. The reasoning and the code read for
each are in `research.md`, the note named.

- **OQ-1 `[NEEDS CLARIFICATION — owner]` — What "offline" means.** *Default applied*: a
  person is online when the Admin UI made a request for them in the last five minutes —
  which, because the bell itself asks every 30 seconds, means "has the Admin UI open in a
  browser". The bell entry is always written; the e-mail is added when they are not online
  (FR-139). So a person away from a desk whose browser stayed open gets the bell only.
  *Alternative*: send the e-mail when the bell entry is still unread N minutes after it was
  written — closer to "did they actually see it", later by N minutes, and a larger change
  to the notification capability (N-CAL6).
- **OQ-2 `[NEEDS CLARIFICATION — owner]` — "Bell *or* e-mail" was built as "bell, *and*
  e-mail when offline".** *Default applied*: an offline person gets both, so that an
  instance with no working e-mail never loses a reminder silently. *Alternative*: strictly
  one or the other (N-CAL6).
- **OQ-3 `[NEEDS CLARIFICATION — owner]` — Who is reminded when the Opportunity has no
  assignee.** *Default applied*: the person who created the Event; if they cannot be, nobody
  (FR-138). *Alternative*: nobody at all — "to the person assigned" read strictly (N-CAL4).
- **OQ-4 `[NEEDS CLARIFICATION — owner]` — "A Sales Rep sees only their own
  Opportunities' Events."** *Default applied*: "their own" is *assigned to them*; a Sales
  Rep's Calendar has no way to show a colleague's Opportunities, although the Sales Rep can
  open those Opportunities — and read their Events tab — when they share an Organization.
  Everybody else gets *Mine / All* (FR-144). *Alternative*: a *Team* choice for Sales Reps
  showing every Opportunity they may open (N-CAL2).
- **OQ-5 `[NEEDS CLARIFICATION — owner]` — A reminder names the Event.** Every other CRM
  bell entry names an Opportunity by its number alone, never by a title or a text, because
  a bell entry outlives a person's access to the Organization. *Default applied*: the
  reminder — bell and e-mail — carries the Event's **name** (not its description, and not
  the Opportunity's title), because a reminder that does not say of what is not one; the
  recipient's access is checked when it is sent. *Alternative*: "An event on opportunity
  OPP-000123 is due", and the name only after the click (N-CAL7).
- **OQ-6 `[NEEDS CLARIFICATION — owner]` — An Event is one day, with a start and an end.**
  The owner's sentence says "date"; the reference CRM has from/to, an end date and
  recurrence-free multi-day entries. *Default applied*: one day, start and end (60 minutes
  offered), or all day for one date. *Not built*: Events over several days, repeating
  Events (N-CAL1).
- **OQ-7 `[NEEDS CLARIFICATION — owner]` — Events are created on the Opportunity, not on
  the Calendar.** *Default applied*: the Calendar is a view; "New event" is on the
  Opportunity's *Events* tab, where the owner's sentence puts it. *Alternative*: a "New
  event" button on the Calendar that first asks which Opportunity (N-CAL9).
- **OQ-8 `[NEEDS CLARIFICATION — owner]` — Time zones.** The platform has no time-zone
  setting (A-3). *Default applied*: the Calendar is drawn in the reader's browser's zone;
  an Event remembers the zone it was planned in, and the e-mail and the bell state its
  time in that zone, named. *Alternative*: a per-user or platform zone — a platform
  capability, not CRM's (N-CAL1).
- **OQ-9 — the week starts on Monday** in both languages (N-CAL10); **a reminder more than
  24 hours late is dropped** (N-CAL5). Stated here so they are decisions and not surprises.

## Assumptions

Decisions taken where the requirements left room, each with the alternative that was not
taken; the reasoning is in `research.md`.

- **An Event belongs to an Opportunity and to nothing else** (User Stories 21, 22). There
  is one kind of Event; it has no participants, no location field, no colour of its own and
  no category. The reference CRM's "entry kinds" belong to that product's domain.
  *Rejected*: Events not tied to an Opportunity (a personal calendar) — the owner's
  sentences define an Event "within a Sales Opportunity", and an Event with no Opportunity
  would have no Organization, which the platform does not allow.
- **The Calendar is read-only**: nothing is dragged, resized or created on it. *Rejected*
  for this release: drag to move — it needs a non-drag alternative of equal power (WCAG 2.2
  SC 2.5.7) and a time-zone-correct drop, for a view whose every Event is one click from
  its edit form.
- **No new permission.** The Calendar and reading Events need "View sales opportunities";
  adding, changing and deleting an Event need "Create and work sales opportunities". What a
  Sales Rep's Calendar shows follows from the platform's existing notion of a Sales Rep —
  a user confined to their Organizations — not from a code.
- **An Event's description is plain text**; the `@` shortcuts of User Story 18 are not
  offered in it. *Rejected*: references in Event descriptions — they would make an Event a
  third kind of source for the reference index and for mention notifications, for a text
  that is a line or two.
- **A reminder is not retried for ever and not sent twice.** If the platform stops in the
  instant between deciding to send and recording that it sent, that one reminder is shown
  as "could not be confirmed" and is not repeated.
- **Events are not offered to outbound webhooks, to import/export or as a board-card
  field**, and the Opportunity's facts column does not gain a "next event" fact. Each is
  additive later; none was asked for.

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
  currency conversion. As built, an Order counts at its **gross** total (what the customer
  pays, delivery included) and a Quote Request at its **net** line sum — each is the figure
  its own screen shows, and the two are not brought to one basis (Clarifications § Decisions
  taken during implementation, D-6).
- **"Sales Rep" means an Admin UI user**; any active Admin UI user can be an assignee. The
  default follows the platform's existing Sales-Rep-to-Organization assignment.
- **Notes and messages are both internal.** A note is an annotation its author can edit; a
  message is an immutable entry in a thread that notifies the other participants. Customers
  see neither. Customer-facing conversation stays where it is, on Orders and Quote Requests.
- **Automatic creation applies to documents placed after it is switched on**, by customers and
  by staff alike, and never to documents already linked or created from an Opportunity. A
  Quote Request an administrator prepares on a customer's behalf counts as placed (D-7).
- **Analytics are computed live** over the chosen range; "handling time" is creation to
  closing; a day is a whole day and a month a calendar month in **UTC**. *(Amended 2026-10-06
  — A-3. The original wording was "in the platform's time zone"; the platform has no
  time-zone setting, so there is none to follow. An Opportunity closed in Warsaw at 00:30 on
  the 1st is counted in the month before. A platform time-zone setting, which analytics
  would then follow, is a possible follow-up and the owner's call.)*
- **Messages do not send e-mail**; they use the Admin UI's notification bell. If that
  capability is switched off, messages still work without notifications. *(Unchanged by User
  Story 21: an Event's reminder is the one CRM notification that can also be an e-mail.)*
- **Import/export of Opportunities, e-mail notifications (the reminder of User Story 21
  excepted, since 2026-10-08) and inclusion in the admin global search are not part of this
  feature**; each is assessed in `research.md` R-22 with the
  reason and what it would take. (Custom fields, outbound webhooks and the Order-screen panel
  were on this list until the owner's second ruling of 2026-10-05 brought them into scope.)
- **Webhook notifications carry what the event carries** — identifiers, statuses, the cause
  and, for "closed", the value — and no free text (description, notes, messages).
- **A custom field definition belongs to the record type, not to an Organization**, as for
  every other record type on the platform; its values live on the Opportunity and are as
  visible as the Opportunity is.
- **The Quote Requests capability is optional for CRM** (owner decision, 2026-10-05 second
  round — see Clarifications): the owner listed Quote Requests among the dependencies; the
  design integrates with it fully while it is on and keeps CRM working when an operator has
  switched it off.

## Dependencies

Orders; Quote Requests; Organizations (including Sales-Rep assignment); customer accounts;
Products (catalog); Admin UI users and roles; Sales Channels; the media library; Settings; the
audit trail; Admin notifications; custom fields; webhooks; transactional e-mail and admin
sessions (User Story 21's reminder).
