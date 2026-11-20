# Feature Specification: Return-case notifications and complaints without a platform order

**Feature Branch**: `feat/180-off-platform-complaints`
**Created**: 2026-11-13
**Status**: Draft
**Module**: `returns` (owner); reads from `customer_accounts`, `admin_users`, `catalog`,
`assets_library` (byte storage only), `admin_notifications`, `transactional_emails`, `settings`;
the storefront prefills from `addresses` through the endpoints it already calls
**Input**: Ten additions to the returns and complaints flow, ruled generic and core by the owner
on 2026-11-13: (1) a complaint without a platform order — product (catalog product or free-text
model), quantity, defect description, serial number, proof-of-purchase number and date;
(2) customer attachments (photos, proof of purchase) and a *proof of purchase required* setting;
(3) contact data and a ship-back address for that complaint, prefilled from the customer's
account; (4) clause acceptance at submission, keeping the accepted text and the time;
(5) an e-mail to the shop on a new case, to addresses configured in the admin, and an admin-panel
notification; (6) a confirmation e-mail to the customer after submission; (7) a marking and a
list filter for off-platform cases; (8) recording who accepted the case; (9) a setting enabling
no-order complaints; (10) a working *notify customer* on an admin comment, and an e-mail to the
customer when a case enters an operator-chosen status.

## Owner rulings *(binding, 2026-11-13 — recorded, not reopened)*

| # | Question | Ruling |
| --- | --- | --- |
| R1 | Core or deployment-specific? | **Core.** Every requirement here is generic to a returns flow; a deployment cannot change a core module's data model, so the capability is delivered by the module that owns it. |
| R2 | What does "who accepted the case" (item 8) mean? | The **administrator who authorized** the case, recorded beside the authorization time that already exists, shown on the case detail and on the case list. |
| R3 | Which kinds may be filed without a platform order? | **Complaints only.** A return (withdrawal) always requires a platform order. |
| R4 | How is a no-order case settled? | **Never by a refund through the platform.** It is settled the way the purchase was made (for example offline). Refund to the payment method, the corrective invoice and the credit-limit top-up are unavailable on it; repair and replacement remain, and so does *settled outside the platform* (Clarifications, FR-B33). |
| R5 | What makes a case "off-platform"? | **The case has no platform order.** It is derived from the missing order and is never a separate flag an operator sets; an order imported from an external system (ERP) is a platform order, so a case against it is **not** off-platform. |
| R6 | How is it delivered? | **As one merge request** (superseding the two-MR split proposed earlier the same day — Clarifications). Inside it, two ordered slices (*Delivery slicing*, below): **A** — notifications and the authorizer (items 5, 6, 8, 10), built first; **B** — the no-order complaint (items 1, 2, 3, 4, 7, 9), built on A. |

## Clarifications

### Session 2026-11-13 (owner ruling)

The owner accepted the architect's recommended answer to each of the three open questions.

- Q: Does a *settled outside the platform* resolution exist? → A: **Yes.** It is offered on
  off-platform cases only, requires an operator note (at most 2 000 characters), moves no money
  through the platform, completes the settlement like any other resolution, and is audited
  (FR-B33).
- Q: What does *proof of purchase required* demand? → A: It applies to **no-order complaints
  only** (a platform order is its own proof) and requires **at least one attachment typed *proof
  of purchase***. The purchase date is always required and the purchase number always optional,
  whatever the setting (FR-B13, FR-B21).
- Q: Which submissions carry the clauses? → A: **Every case submission on the channel** — return
  or complaint, with or without an order — once at least one clause is configured for it; with
  none configured the form is unchanged (FR-B30).

Three corrections the plan made, recorded here so the spec and the plan agree (`plan.md` § *What
the plan changed in the spec*):

- The *Authorized by* list column is shown but **not sortable** (US4): the name belongs to
  `admin_users` and cannot be ordered on in the returns query.
- Attachments sent **with a submission** are limited to **30 MB in total** (FR-B20), beside the
  per-file and per-case limits; further files are added from the case page.
- The new-case recipient list is **not validated when it is saved** (FR-A01): the settings
  store validates no list item, as the existing order-confirmation recipient list shows. An
  invalid entry is skipped and reported at send time instead.

### Session 2026-11-13 (owner ruling — delivery)

- Q: Two merge requests (A, then B) or one? → A: **One merge request containing everything.**
  Slices A and B remain only as the internal build order — A's work first, then B's — so the
  branch is green at the boundary between them. Nothing else in the spec changes.

### Session 2026-11-13 (owner ruling — design review)

The designer's review (`design-review.md`, findings D-1 … D-18) was ruled on by the owner. The
answers below are binding and **supersede** earlier answers where they conflict (D-1 supersedes the
clause answer of the first session).

- D-1 → Each clause has **`appliesTo`** (`return` | `complaint` | `both`) and **`mode`**
  (`must_accept` | `inform_only`). An `inform_only` clause is shown and stored with the case, with
  no checkbox. **A clause never gates a consumer withdrawal**: on a submission that is a
  consumer's withdrawal, no `must_accept` clause is shown or required (FR-B30, FR-B31).
- D-2 → **Filing a case is not an entry into the initial status**: it sends no status e-mail; the
  confirmation covers it (FR-A31).
- D-3 → The customer's case list shows a **product label** and the **purchase date** (FR-B36).
- D-4 → Until an RMA number is assigned, a case has a **readable reference derived from its id**,
  shown wherever the RMA number would be: lists, page titles, e-mails (FR-A44).
- D-5 → *Settled outside the platform* is available **from authorization until the case is closed**,
  not only once the goods are received (FR-B33a).
- D-6 → The list filters are **not** kept in the URL (FR-B35).
- D-7 → The "no recipient configured" warning is an **alert on the returns workflow (statuses)
  page**, not on the generic settings screen (US1 scenario 2).
- D-8 → The case exposes the **date** its personal data was erased (FR-B43).
- D-9 → The no-JavaScript outcome of a submission over 30 MB, and its copy, are stated in the plan
  (research R-13).
- D-10 → The clauses page's primitives are named in the plan.
- D-11 → The storefront promises a confirmation e-mail **only when that e-mail is enabled** (US2
  scenario 1, FR-B37).
- D-12 → "Today" for the purchase date is the shop's day, given to the storefront by the server
  (FR-B13).
- D-13 → **No status e-mail about a transition the customer made themselves** (FR-A31).
- D-14 … D-18 → Implementation fixes, no spec change. They cover:
  - the login redirect keeps the query string;
  - a form submitted with no line gives an error;
  - **admin comments default to internal** (D-16, accepted);
  - the comment box gets a label, and the card titles are translated;
  - the ship-back address uses an extracted, labelled address-fields component.
- A clause **may carry a link to a full terms page**. The case stores the link as shown, not the
  linked page's content (FR-B31).
- The page after submission makes **no promise of a processing time** (FR-B37).

## Delivery slicing

| Slice | Items | User stories | Built |
| --- | --- | --- | --- |
| **A — notifications and the authorizer** | 5, 6, 8, 10 | US1, US2, US3, US4 | first; depends on nothing in this feature |
| **B — the complaint without a platform order** | 1, 2, 3, 4, 7, 9 | US5, US6, US7, US8 | after A, reusing A's notifications for the e-mails a no-order case triggers (FR-B40) |

The feature ships as **one merge request**; the slices are an ordering inside it, with the branch
green at the A/B boundary. Requirements are numbered `FR-A…` and `FR-B…` so every requirement
has exactly one slice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The shop hears about every new case (Priority: P1, slice A)

A customer files a return or a complaint. The shop's team learns about it without opening the
admin panel: an e-mail goes to the addresses the operator configured for new cases, and every
administrator who can work on returns sees an entry in the admin notification bell linking to
the case.

**Why this priority**: today a new case is silent. Nobody is told until somebody happens to open
the case list, and a complaint answered late costs the customer relationship and, for consumer
withdrawals, legal deadlines.

**Independent Test**: configure two recipient addresses for the channel, file a case as a
customer, and assert one e-mail to each address naming the case's kind, customer, organization
and products with a link to the case in the admin panel, and one bell entry for each
administrator who may view returns — and none for an administrator who may not.

**Acceptance Scenarios**:

1. **Given** recipients `a@shop.example` and `b@shop.example` configured for the case's sales
   channel, **When** a customer files a complaint, **Then** each address receives one *new case*
   e-mail and the case's submission completes regardless of the e-mail's outcome.
2. **Given** no recipient configured for the channel or globally, **When** a case is filed,
   **Then** no shop e-mail is sent, the bell entries are still recorded, and the returns workflow
   (statuses) page shows an alert that new-case e-mails go to nobody, linking to the setting.
3. **Given** the admin notification module is switched off, **When** a case is filed, **Then**
   the case is created, the shop e-mail is sent, and no bell entry is recorded.
4. **Given** the operator deactivated the *new case* e-mail template, **When** a case is filed,
   **Then** no shop e-mail is sent and the reason is recorded where operators read e-mail
   delivery problems.

---

### User Story 2 — The customer gets a confirmation (Priority: P1, slice A)

After submitting a return or a complaint, the customer receives an e-mail confirming that the
case was received, what it covers, and where to follow it in their account.

**Why this priority**: a submission with no acknowledgement produces duplicate submissions and
support contacts; it is the cheapest trust signal in the flow.

**Independent Test**: file a case and assert one confirmation e-mail to the filing account's
address, in the sales channel's language, naming the case's kind, products, submission date and
a link to the case in the customer's account.

**Acceptance Scenarios**:

1. **Given** a customer filing a complaint on a Polish-language channel, **When** the case is
   submitted, **Then** the customer receives one confirmation in Polish, and the page they land
   on names the case reference and says a confirmation was sent — that sentence appears only while
   the confirmation e-mail is enabled.
2. **Given** the confirmation template is deactivated, **When** a case is submitted, **Then** the
   case is created and no confirmation is sent.
3. **Given** a member files a case for an organization order placed by a colleague, **When** the
   case is submitted, **Then** the confirmation goes to the member who filed it, not to the
   colleague who placed the order.

---

### User Story 3 — The operator can tell the customer something (Priority: P2, slice A)

An operator writes a customer-visible comment on a case and ticks *notify customer*: the customer
receives an e-mail carrying the comment. Separately, the operator marks chosen statuses of the
returns workflow as *notify the customer on entry*; whenever a case enters such a status, the
customer receives an e-mail naming the new status.

**Why this priority**: the *notify customer* checkbox exists today and does nothing, which is
worse than not having it — operators believe the customer was told. Status e-mails remove the
manual follow-up an operator otherwise writes for every step.

**Independent Test**: post a customer-visible comment with *notify customer* and assert one
e-mail with the comment text; mark the status *Received* as notifying, move a case into it, and
assert one e-mail naming *Received* in the customer's channel language.

**Acceptance Scenarios**:

1. **Given** an open case, **When** an operator posts a customer-visible comment with *notify
   customer* ticked, **Then** the filing customer receives one e-mail containing the comment
   text and a link to the case.
2. **Given** an operator writes an internal comment, **When** they look at the comment form,
   **Then** *notify customer* is unavailable, and a request that asks for it on an internal
   comment is refused.
3. **Given** the status *Received* is marked *notify the customer on entry*, **When** a case
   enters *Received* by an operator's or the platform's action, **Then** the customer receives one
   e-mail naming the status in the channel's language.
7. **Given** *Cancelled* is marked as notifying, **When** the customer cancels their own case,
   **Then** no status e-mail is sent: the customer is not told what they just did (D-13).
8. **Given** the initial status is marked as notifying, **When** a case is filed, **Then** only the
   confirmation e-mail is sent: filing is not an entry into the initial status (D-2).
4. **Given** a transition that already sends its own dedicated e-mail (authorization,
   rejection), **When** its target status is also marked as notifying, **Then** the customer
   receives exactly one e-mail for that transition.
5. **Given** a status newly marked as notifying, **When** the marking is saved, **Then** no
   e-mail is sent for cases already in that status.
6. **Given** comments posted with *notify customer* before this feature, **When** it ships,
   **Then** nothing is sent for them retroactively.

---

### User Story 4 — Who authorized the case (Priority: P2, slice A)

When an operator authorizes a case, the platform records who did it. The case detail shows the
authorizing administrator beside the authorization time, and the case list can show it as a
column (not sortable — Clarifications).

**Why this priority**: accountability for an authorization — which commits the shop to accept
goods back — is a standing operator question, and today it can only be answered from the audit
log.

**Independent Test**: authorize a case as administrator X and assert that the case detail and the
case list show X's name beside the authorization time, and that the export carries it.

**Acceptance Scenarios**:

1. **Given** an unauthorized case, **When** administrator X authorizes it, **Then** the detail
   shows *Authorized by X* with the time, and the list's *Authorized by* column shows X.
2. **Given** a case authorized by an administrator whose account was later removed, **When**
   the detail is opened, **Then** it shows a neutral *former administrator* label rather than an
   empty value or an error.
3. **Given** a case authorized before this feature, **When** it is displayed, **Then** it shows
   the authorizer where the platform's audit record of that authorization names one, and
   *unknown* otherwise.

---

### User Story 5 — A complaint without a platform order (Priority: P3, slice B)

A signed-in customer bought a product outside the platform — in a shop, from a distributor, by
phone — and it is defective. Where the operator enabled it, the customer opens *File a
complaint*, chooses *I did not buy this here*, and describes the product: picked from the catalog
or typed as a model name, with quantity, a defect description and, when they have it, a serial
number. They give the proof-of-purchase number and date, confirm contact data and the address to
which the product should be sent back — both prefilled from their account — and submit.

**Why this priority**: it is the core of slice B and the reason for it — warranty complaints for
products sold through other channels have no way in today, so they arrive by e-mail and phone,
outside any workflow.

**Independent Test**: with the setting on for the channel, file a no-order complaint naming one
catalog product and one free-text model; assert the case exists without an order, in the
customer's organization and the request's sales channel, with both lines, the purchase data, the
contact data and the ship-back address as submitted.

**Acceptance Scenarios**:

1. **Given** no-order complaints are enabled for the channel, **When** a customer opens the
   complaint form, **Then** they can choose between an order from their history and *not bought
   on this platform*.
2. **Given** no-order complaints are disabled for the channel, **When** a customer opens the form
   or submits a no-order complaint directly, **Then** the option is not offered and the
   submission is refused with a message saying such complaints are not accepted here.
3. **Given** a customer with a name, e-mail, phone and default address on their account, **When**
   they reach the contact step, **Then** those values are prefilled and editable, and an edit
   changes the case only, never the account.
4. **Given** a line with neither a catalog product nor a model name, or a quantity below 1,
   **When** the customer submits, **Then** the submission is refused naming the line.
5. **Given** a no-order submission of kind *return*, **When** it reaches the platform, **Then**
   it is refused: a return requires a platform order (R3).
6. **Given** a catalog product named on a no-order line is later deleted or renamed, **When**
   the case is opened, **Then** it shows the product name as it was at submission.

---

### User Story 6 — Attachments and proof of purchase (Priority: P3, slice B)

On any complaint or return form, the customer attaches photos of the defect and documents, each
marked as a *photo*, a *proof of purchase* or *other*. Where the operator turned on *proof of
purchase required*, a no-order complaint cannot be submitted without at least one attachment
marked *proof of purchase*. Operators see the attachments on the case; the customer sees their
own on their case.

**Why this priority**: a defect described without a photo, or a warranty claim without a receipt,
costs a round of questions on every case; without the proof the operator cannot accept a
no-order complaint at all.

**Independent Test**: file a complaint with two photos and a PDF receipt; assert all three are on
the case with their types, visible to the filing customer and to an administrator with returns
access, and not retrievable by another customer or anonymously.

**Acceptance Scenarios**:

1. **Given** *proof of purchase required* is on, **When** a customer submits a no-order
   complaint without a *proof of purchase* attachment, **Then** the submission is refused naming
   the missing proof.
2. **Given** a file of a type or size outside the accepted limits, **When** the customer adds it,
   **Then** it is refused before submission with the limit stated.
3. **Given** a case with attachments, **When** another customer, or anyone not signed in, asks
   for one of its files, **Then** the file is not served.
4. **Given** an open case, **When** its customer adds a further attachment from the case page,
   **Then** it appears on the case for the operator.

---

### User Story 7 — Clauses accepted at submission (Priority: P3, slice B)

The operator configures the clauses shown to a customer filing a case, in each shipped language.
Each clause says which kinds it applies to (returns, complaints or both). It also says whether the
customer must tick it (for example the complaint terms) or only read it (for example the
personal-data notice). A clause may link to a full terms page. The customer cannot submit without
ticking every *must accept* clause shown. A consumer withdrawing from a purchase is never asked to
accept anything. The case keeps the exact text shown and when it was submitted; an operator sees it
on the case even after the clause text is changed.

**Why this priority**: an accepted clause the shop cannot later reproduce verbatim is no evidence;
keeping the text as shown is the only form that survives an edit of the terms.

**Independent Test**: configure one clause, submit a case accepting it, change the clause text,
and assert the case still shows the original text and the acceptance time.

**Acceptance Scenarios**:

1. **Given** one configured clause, **When** a customer submits without accepting it, **Then** the
   submission is refused naming the clause.
2. **Given** a clause accepted in Polish, **When** an operator opens the case in an English admin
   panel, **Then** the case shows the Polish text as accepted and the acceptance time.
3. **Given** no clause configured, **When** a customer opens the form, **Then** it shows no clause
   step and submits as today.
4. **Given** a *must accept* clause applying to returns, **When** a consumer files a withdrawal
   (a return by a personal organization within the withdrawal period), **Then** the clause is not
   shown and not required (D-1).
5. **Given** an *inform only* clause, **When** a customer files a case, **Then** the clause is shown
   with no checkbox and stored with the case as shown.
6. **Given** a clause applying to complaints only, **When** a customer files a return, **Then** the
   clause is not shown.

---

### User Story 8 — Off-platform cases in the admin panel (Priority: P3, slice B)

On the case list an operator sees which cases have no platform order — a marking on the row —
and filters the list to *off-platform*, *with an order*, or all. On such a case the detail shows
the purchase data, contact data and ship-back address the customer gave instead of an order
link, and settlement offers only the resolutions that do not move money through the platform:
repair, replacement, and *settled outside the platform* with a note.

**Why this priority**: without the marking an operator cannot tell, before opening a case, that
it carries no order to check the claim against; without the restricted settlement an operator
could try to refund money the platform never received.

**Independent Test**: with one case against an order, one against an ERP-imported order and one
without an order, filter by *off-platform* and assert only the third is listed; open it and assert
that refund, corrective invoice and credit are not offered while repair, replacement and
*settled outside the platform* are.

**Acceptance Scenarios**:

1. **Given** a case against an order imported from an ERP, **When** the list is filtered to
   *off-platform*, **Then** that case is not listed (R5).
2. **Given** a saved view with the *off-platform* filter, **When** it is reopened, **Then** the
   filter is restored.
3. **Given** an off-platform case at settlement, **When** an operator settles it, **Then** only
   repair, replacement and *settled outside the platform* are offered, and a direct request for
   a refund, a corrective invoice or a credit is refused.
4. **Given** an off-platform case at settlement, **When** an operator chooses *settled outside
   the platform* without a note, **Then** the settlement is refused naming the missing note; with
   a note, the case is settled, no money moves, and the note is shown on the case.
5. **Given** a case against a platform order, **When** an operator opens its settlement, **Then**
   *settled outside the platform* is not offered, and a direct request for it is refused.
6. **Given** the export of the case list, **When** an operator exports it, **Then** each row says
   whether the case is off-platform and who authorized it.

---

### Edge Cases

- **Module off (Principle XVII).** With `returns` switched off nothing in this feature runs: no
  form, no e-mail, no bell entry, no setting takes effect. The no-order setting is an additional
  condition *inside* an active module and never overrides the module's off state.
- **No-order complaints switched off after cases exist.** Existing off-platform cases stay fully
  visible and workable for operators and for the filing customer; only new submissions are
  refused.
- **Setting scoped per channel.** The no-order toggle and *proof of purchase required* may differ
  between sales channels; a submission is judged by the channel resolved from the request, never
  one named in the request body.
- **No organization.** There is none: every customer acts in an organization (a personal one for
  B2C). A no-order complaint is filed in the customer's current organization and is refused if the
  member lacks the right to file cases there, exactly as a complaint against an order is.
- **No default address on the account.** The ship-back address step starts empty and must be
  filled; a customer with several addresses picks one or types a new one.
- **Free-text model that matches a catalog product.** Accepted as typed; the platform does not
  guess a catalog link.
- **Purchase date in the future.** Refused. A purchase date long past is accepted — whether a
  warranty still applies is the operator's judgement, not a rule here.
- **Duplicate submission (double click, retry after a timeout).** Produces at most one case and
  one set of e-mails.
- **E-mail failures.** A failing, deactivated or unconfigured e-mail never blocks a submission, a
  comment or a transition, and never rolls one back; the reason is recorded for operators.
- **Customer anonymisation.** Erasing a customer also erases the contact data, ship-back address
  and attachments their cases hold. Today `returns` stores no such data and does not take part in
  the customer anonymisation; this feature is what makes it hold personal data, so it is what must
  make it take part (FR-B43).
- **A status renamed or deleted** after being marked notifying: a renamed status e-mails under its
  new name; a deleted one sends nothing.
- **Clause configuration changed mid-submission.** The customer's acceptance is judged against
  the clause set shown to them; a submission accepting a clause set that no longer exists is
  refused with a prompt to review the current terms.

## Requirements *(mandatory)*

### Functional Requirements — slice A (notifications and the authorizer)

**New-case notification to the shop (item 5)**

- **FR-A01**: The operator MUST be able to configure a list of e-mail addresses that receive the
  *new case* e-mail, globally and per sales channel, a channel's list replacing the global one.
  At most the first 10 addresses are used; an entry that is not a valid e-mail address is skipped
  and recorded with its reason where operators read e-mail delivery problems, and the other
  addresses are still sent to (Clarifications).
- **FR-A02**: When any case is filed — return or complaint, with or without a platform order —
  the platform MUST send the *new case* e-mail to every configured address of the case's sales
  channel, naming the case's kind, filing customer, organization, products, whether it is
  off-platform, and a link to the case in the admin panel.
- **FR-A03**: When any case is filed, the platform MUST record an admin notification bell entry,
  linking to the case, for every active administrator who may view returns and for no other
  administrator.
- **FR-A04**: When the admin notification module is off, filing MUST proceed with no bell entry
  and no error; the returns module MUST NOT require that module to be on.
- **FR-A05**: The *new case* e-mail MUST be an operator-editable transactional template shipped
  in English and Polish.

**Customer confirmation (item 6)**

- **FR-A10**: When a case is filed, the platform MUST send a confirmation e-mail to the account
  that filed it, in the sales channel's language, naming the kind, products, submission date and
  a link to the case in the customer's account.
- **FR-A11**: The confirmation MUST be an operator-editable transactional template shipped in
  English and Polish, which the operator may deactivate.

**Notify customer on comment (item 10)**

- **FR-A20**: When an operator posts a customer-visible comment with *notify customer*, the
  platform MUST send the filing customer an e-mail containing the comment text and a link to the
  case. Its template is operator-editable and shipped in English and Polish.
- **FR-A21**: *Notify customer* MUST be refused on an internal comment, and the admin form MUST
  make it unavailable there.
- **FR-A22**: The platform MUST NOT send anything for comments recorded before this feature.

**E-mail on entering a status (item 10)**

- **FR-A30**: The operator MUST be able to mark any status of the returns workflow as *notify the
  customer on entry*, on the existing status configuration screen.
- **FR-A31**: When a case enters a status so marked through an operator's or the platform's action,
  the platform MUST send the filing customer one e-mail naming the new status in the channel's
  language, with a link to the case. Its template is operator-editable and shipped in English and
  Polish. A transition the customer made themselves MUST NOT send it (D-13). Filing a case MUST NOT
  count as entering the initial status (D-2).
- **FR-A32**: A transition that already sends a dedicated customer e-mail (authorization,
  rejection) MUST NOT also send the status e-mail: the customer receives exactly one e-mail per
  transition.
- **FR-A33**: Marking a status as notifying MUST NOT send anything for cases already in it.

**The authorizer (item 8)**

- **FR-A40**: When a case is authorized, the platform MUST record the authorizing administrator
  beside the authorization time, whichever admin path performed the authorization.
- **FR-A41**: The case detail MUST show the authorizer's name and the authorization time; the
  case list MUST offer an *Authorized by* column, which is not sortable; the case export MUST
  include it.
- **FR-A42**: A removed administrator MUST be shown as a neutral *former administrator* label.
- **FR-A43**: For cases authorized before this feature, the authorizer MUST be taken from the
  platform's audit record of the authorization where one names it, and shown as *unknown*
  otherwise.

**The case reference (D-4)**

- **FR-A44**: Every case MUST have a readable reference: its RMA number once assigned, and until
  then a reference derived from its id (the first eight characters, upper-cased, prefixed `#`). The
  reference MUST be shown wherever the RMA number is shown: the admin and customer lists (as the
  case's link text), the case page titles, and every e-mail of this feature. The derived reference
  is a display aid, not a unique key; the admin search MUST also find a case by it.
**Common to slice A**

- **FR-A50**: No e-mail or bell outcome MUST block, fail or roll back the action that triggered
  it; every e-mail not sent MUST be recorded with its reason, as the existing authorization and
  rejection e-mails are.
- **FR-A51**: Every e-mail in this feature MUST be sent at most once per triggering event, also
  when the event is retried.
- **FR-A52**: The new settings and the status marking MUST be changes an operator makes through
  the admin panel, recorded in the audit log with the operator's identity.

### Functional Requirements — slice B (the complaint without a platform order)

**Enabling it (item 9)**

- **FR-B01**: The operator MUST be able to enable or disable no-order complaints, globally and
  per sales channel. It is off by default. It is a setting distinct from the module's own
  activation, and the module's off state always wins over it.
- **FR-B02**: While disabled for the request's channel, the storefront MUST NOT offer the
  no-order path and the platform MUST refuse a no-order submission with a dedicated error
  translated into the request's language.

**The complaint (item 1)**

- **FR-B10**: A signed-in customer MUST be able to file a case of kind *complaint* without a
  platform order, in their current organization and the sales channel resolved from the
  request, subject to the same organization permission that governs filing any case.
- **FR-B11**: A case without a platform order MUST be of kind *complaint*; any other kind MUST be
  refused (R3).
- **FR-B12**: A no-order complaint MUST carry one or more lines, each naming either a catalog
  product visible to the customer on that channel or a free-text model name (at most 255
  characters), plus a quantity of at least 1, a complaint reason from those offered for
  complaints, a defect description (required, at most 2 000 characters) and an optional serial
  number (at most 100 characters).
- **FR-B13**: A no-order complaint MUST carry the proof-of-purchase date (required, not in the
  future) and may carry a proof-of-purchase number (optional, at most 100 characters), whatever
  the *proof of purchase required* setting (Clarifications). "The future" is judged by the shop's
  day in its returns time zone. The storefront receives that day from the server, so the form and
  the check agree (D-12).
- **FR-B14**: A line naming a catalog product MUST keep the product's name as it was at
  submission.
- **FR-B15**: A no-order case MUST NOT affect any order, stock level, invoice or credit limit,
  and MUST carry no amount to refund.

**Contact data and ship-back address (item 3)**

- **FR-B16**: The no-order form MUST collect contact data (name, e-mail, phone) and a ship-back
  address, prefilled from the filing account and its address book, editable on the form. The
  values MUST be stored with the case as submitted; editing them on the form MUST NOT change the
  account or the address book.
- **FR-B17**: The case detail, for operators and for the filing customer, MUST show the contact
  data and the ship-back address the case holds.

**Attachments (item 2)**

- **FR-B20**: On every case form, and on an open case afterwards, the filing customer MUST be
  able to upload attachments, each typed as *photo*, *proof of purchase* or *other*: images and
  PDF only, at most 10 MB per file, 30 MB in total per submission and 10 files per case.
- **FR-B21**: The operator MUST be able to turn on *proof of purchase required*, globally and per
  sales channel, off by default. While it is on for the request's channel, a no-order complaint
  MUST be refused unless at least one of its attachments is typed *proof of purchase*. It has no
  effect on a case against a platform order, and it does not change whether the purchase date or
  number is required (Clarifications).
- **FR-B22**: Attachments MUST be retrievable only by the filing customer (and members who may
  view the organization's cases) and by administrators who may view returns; never anonymously
  or by another customer.
- **FR-B23**: The case detail MUST list the attachments with their type for operators and for
  the customer.
- **FR-B24**: An attachment MUST be one the customer uploaded for that case; linking an existing
  file the customer did not upload MUST be refused.

**Clause acceptance (item 4)**

- **FR-B30**: The operator MUST be able to configure zero or more clauses, each with:
  - its label and text in every shipped language, and an optional link to a full terms page;
  - the kinds it applies to (`return`, `complaint` or both);
  - a mode (`must_accept` or `inform_only`);
  - its scope, global or per sales channel.

  A submission on the request's channel MUST show the active clauses of that channel that apply to
  its kind, with or without a platform order. On a submission that is a consumer's withdrawal, no
  `must_accept` clause MUST be shown or required; a clause never gates a consumer withdrawal (D-1).
  With none applying, the form is unchanged. This supersedes the first session's clause answer
  where they conflict.
- **FR-B31**: A submission MUST be refused unless every `must_accept` clause shown was accepted.
  The case MUST store every clause shown — accepted and `inform_only` alike — with its mode, its
  text and link exactly as shown, in the submission language, and the submission time. The linked
  page's content is not stored (owner ruling).
- **FR-B32**: Editing or removing a clause MUST NOT change what earlier cases stored.

**Settlement of an off-platform case (R4)**

- **FR-B33**: Settling a case without a platform order MUST offer repair and replacement and MUST
  refuse a refund to the payment method, a corrective invoice and a credit-limit top-up.
- **FR-B33a**: Settling a case without a platform order MUST also offer *settled outside the
  platform*, which requires an operator note (1 to 2 000 characters), moves no money through the
  platform, completes the settlement as any other resolution does, and is shown with its note on
  the case for operators. It MUST be available **from the case's authorization until it is closed**
  — that is, on an authorized case not yet settled and not in a terminal status, whether or not
  goods were received (D-5). Repair and replacement keep their existing precondition. It MUST be
  refused on a case against a platform order (Clarifications).

**Off-platform marking and filter (item 7)**

- **FR-B34**: A case MUST be off-platform exactly when it has no platform order (R5); a case
  against an imported order MUST NOT be off-platform. The status is derived and cannot be set.
- **FR-B35**: The case list MUST mark off-platform rows and MUST offer a filter *off-platform* /
  *with an order* / all, kept in saved views; the export MUST carry the marking. List filters are
  not kept in the URL (D-6).
- **FR-B36**: The customer's own case list MUST show, for every case, its reference (FR-A44), a
  product label (the first line's product name and how many more lines there are) and, for an
  off-platform case, the purchase date (D-3). The customer's case page MUST show an off-platform
  case's products and purchase data instead of an order reference.
- **FR-B37**: After a submission, the customer's case page MUST confirm it with the case reference.
  It MUST say a confirmation e-mail is on its way only while that e-mail is enabled (D-11), and
  MUST make no promise of a processing time.

**Common to slice B**

- **FR-B40**: A no-order complaint MUST trigger the slice-A notifications (FR-A02, FR-A03,
  FR-A10) like any other case.
- **FR-B41**: Every new storefront and admin string MUST ship in English and Polish; every
  refusal MUST reach the customer as a sentence in the request's language.
- **FR-B42**: Filing a no-order complaint MUST be recorded in the audit log as filing any case
  is; settling it MUST be audited as any settlement is, with the operator's note for an outside
  settlement.
- **FR-B43**: Erasing a customer's personal data MUST also erase the contact data, ship-back
  address and attachments of their cases. The case MUST show operators the date of that erasure,
  so an empty attachments list is not mistaken for "none sent" (D-8).

### Key Entities *(include if feature involves data)*

- **Return case** — gains: an optional platform order (absent = off-platform, R5); the
  authorizing administrator (R2); the operator's note of an outside settlement; for a no-order
  complaint, the proof-of-purchase number and
  date, the contact data and the ship-back address as submitted; the clauses accepted with their
  text, language and time. Always belongs to an organization and a sales channel.
- **Case line** — gains: for a no-order complaint, either a catalog product or a free-text model
  name instead of an order line; a serial number. A no-order line carries no refund amount.
- **Case attachment** — gains a type (*photo*, *proof of purchase*, *other*) and is a file the
  customer uploaded for that case, private to the case's audience.
- **Return status** — gains the operator's *notify the customer on entry* marking.
- **Case clause** — an operator-configured text shown to a customer filing a case, in each shipped
  language, with an optional link to a full terms page, the kinds it applies to, a mode (*must
  accept* or *inform only*), scopable per channel.
- **Returns settings** — gain the shop's new-case recipients, the no-order toggle and *proof of
  purchase required*, each scopable per channel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of cases filed while recipients are configured, every recipient receives a
  *new case* e-mail and every administrator who may view returns has a bell entry; no
  administrator who may not view returns has one.
- **SC-002**: 100% of submitted cases produce exactly one confirmation e-mail to the filing
  account when the template is active, and a submission is never refused or delayed by an e-mail
  failure.
- **SC-003**: Every customer-visible comment posted with *notify customer*, and every entry into
  a notifying status made by an operator or the platform, produces exactly one customer e-mail; a
  transition never produces two, and a customer's own transition and the filing produce no status
  e-mail.
- **SC-004**: For every case authorized after the release, the authorizer is shown on the detail,
  the list and the export.
- **SC-005**: A customer with an account address on file completes a no-order complaint for one
  product, with one photo and one proof of purchase, in under 4 minutes.
- **SC-006**: Filtering by *off-platform* returns exactly the cases without a platform order,
  including none against imported orders.
- **SC-007**: No off-platform case can be settled by a refund, a corrective invoice or a credit
  through any surface.
- **SC-008**: For every case filed with clauses configured, an operator can read the exact
  accepted text and time, unchanged by any later clause edit.
- **SC-009**: No case attachment is retrievable without being its customer (or an organization
  member who may view its cases) or an administrator who may view returns.

## Assumptions

- **Signed-in customers only.** A no-order complaint is filed from a customer account; anonymous
  (guest) complaints are out of scope. This is what gives every case an organization (Principle
  XI).
- **One purchase per case.** A no-order complaint carries one proof of purchase; products bought
  in separate purchases are filed as separate complaints.
- **Case reference before authorization.** The authorization number is assigned at
  authorization, as today, and is not moved to submission. Until then the case carries the
  derived reference of FR-A44 (D-4), which every e-mail, list and title shows.
- **The admin bell audience** is the active administrators holding the returns view permission —
  the precedent of `specs/179-rfq-and-customer-notifications/` (Q6), never every administrator.
- **E-mail only to the customer.** The customer notification centre and push introduced by
  `specs/179-rfq-and-customer-notifications/` are not fed by returns in this feature; that is a
  follow-up.
- **Core fields, not custom fields.** The no-order data (purchase data, serial number, contact
  data, ship-back address, attachment type) is core case data rather than runtime custom fields
  (Principle XIV): the platform's behaviour depends on it — the required-proof rule, the
  settlement restriction, the e-mails and the filter. A deployment that needs a further field on
  a case is outside this feature.
- **Clauses and consents.** The stored-as-shown clause follows the precedent of the `forms`
  module, which keeps each consent's text as shown with an entry; operator-configurable new-case
  recipients follow its configurable notification recipients.
- **Admin creation on a customer's behalf** (an operator filing a case for a customer) is out of
  scope; a case is filed by the customer.
- **No warranty-period rule.** The platform does not judge whether a purchase date is within a
  warranty; the operator does.
- **Existing behaviour unchanged.** Returns and complaints against a platform order keep their
  current rules, amounts and settlement options; the authorization and rejection e-mails keep
  their current templates.
- **Limits** (10 recipients, 10 attachments per case of at most 10 MB each and 30 MB per
  submission, images and PDF, the text lengths above) are defaults chosen here; the plan records
  their rationale.
