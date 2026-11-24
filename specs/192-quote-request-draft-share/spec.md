# Feature Specification: Operator-created quote requests stay drafts until shared with the customer

**Feature Branch**: `feat/192-quote-request-draft-share`
**Created**: 2026-11-24
**Status**: Draft — owner decisions of 2026-11-24 recorded under *Owner decisions*; no question open; ready for plan
**Input**: Issue #1901. A sales representative prepares a quote for a customer in the Admin UI over
several sittings. Today the quote reaches the customer's account, with an e-mail, the moment it is
created. The operator needs to build it as a draft the customer cannot see, and to share it with
one action when it is ready. A store also needs a default validity for such quotes, counted from
the moment the customer receives them.

## Context

Measured at `08dcf12c7` (release 0.111.0) and unchanged on `origin/master` `230f04c30` (0.112.0)
in the paths below. Module paths are relative to `packages/modules/quote_requests/`.

- **Statuses.** Six: `Created from admin`, `Pending`, `Approved`, `Completed`, `Canceled`,
  `Expired` (`packages/contracts/src/quote-requests.ts:30-37`; state machine
  `src/backend/entities/quote-request.entity.ts:5-12`). None means "not yet visible to the
  customer".
- **An operator-created quote is live at once.** `createOnBehalf` stores `Created from admin` with
  `awaitingCustomerRevisionAcceptance: true` (`src/backend/services/rfq-admin-service.ts:1198`,
  `:1206`) and records the `prepared` notification in the same transaction (`:1298`). The
  notification matrix sends `prepared` to the customer's e-mail, notification centre and push
  (`src/backend/services/notifications/notification-matrix.ts:86`); template
  `quote_request_customer_prepared` (`src/backend/email-templates/quote-notification-defaults.ts:196`).
  The only caller of `createOnBehalf` is `POST /api/v1/admin/quote-requests`
  (`src/backend/routes.admin.ts:155`); the CRM opportunity's button opens the same create screen.
- **Customer reads have no status filter.** The storefront list returns the account's own
  requests, or the whole Organization's for the *Administrator* role, widened to the subtree for a
  roll-up login (`src/backend/services/rfq-service.ts:451-490`); `listForCustomer` serves the
  `customers` module (`:445-453`); the detail goes through `findVisibleForCustomer` (`:1444`);
  accept and reject cover `Created from admin` (`:1110-1137`).
- **Inactivity expiry** (`quote_requests.expiry_days`, 0 = never, per channel) sweeps `Pending` and
  `Created from admin` (`src/manifest.ts:48-54`; `src/backend/services/rfq-expiry-worker.ts:120`).
- **Validity.** An operator may type *Valid for N days* on create and on revise (`expiresInDays`
  → `expiresAt`, counted from that write); blank means no deadline
  (`src/admin/pages/RfqCreatePage.tsx:399`, `:608-614`; `src/admin/validity.ts`). After the date the
  customer's acceptance, conversion and order placement are refused (module doc § *Validity
  date*). There is no default.
- **One product on several lines** is supported: module doc § *Line groups* ("One product on
  several lines", `docs/quote_requests.md:391-398`); the create screen offers no "already added"
  exclusion (`src/admin/pages/RfqCreatePage.tsx:260`, `:740`); a revision pairs each stored line
  with at most one incoming line (`src/backend/services/line-carry-over.ts:70-96`); conversion
  seeds the basket one line per quote line, never merged
  (`packages/modules/carts/src/backend/services/cart-read-port.ts:129`).

## Owner decisions *(2026-11-24)*

- Drafts are built in the platform's quote-requests module: a draft state, a share action, and a
  point where another module can refuse a share.
- Drafts are **always on**; there is no setting now. Whether a new operator quote starts as a draft
  is decided in one place, so that a setting can be added later without reworking the feature.
- The validity of a shared quote counts from the moment of sharing.
- A draft never expires automatically, by inactivity or by validity.
- The customer is told with the existing "quote prepared" notification, sent at share time
  instead of at creation; its text stays editable in the e-mail templates.
- A draft's PDF may be previewed and downloaded by the operator; it cannot be sent to the customer.
- No un-share: a shared quote does not return to draft; later changes are revisions, as today.
- Anyone holding the quote-handling permission may share; a "Create and share" shortcut is
  allowed; an order's *Clone to quote* is unchanged.
- Sharing is refused while any line has no price.
- One global default-validity setting; out of the box 0, meaning no deadline, as today.
- Sharing is refused when the customer account is inactive or no longer a member of the quote's
  Organization; the quote stays a draft.
- Operator quotes that exist when the feature is installed stay visible to their customers; only
  quotes created afterwards start as drafts.
- One product may sit on several lines of a quote with different prices; draft and share never
  merge them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The operator builds a quote the customer cannot see (Priority: P1)

**Why this priority**: A quote built in stages must not reach the customer half-done.

**Independent Test**: Create a quote for a customer in the Admin UI, edit it, then sign in as that
customer, as the Administrator of its Organization and as a roll-up user of its tree, and check
every customer surface.

**Acceptance Scenarios**:

1. **Given** an operator creates a quote for a customer, **When** it is saved, **Then** it is a
   draft, the Admin UI shows it as a draft on its screen and in the list, and the customer receives
   no e-mail, notification-centre entry or push.
2. **Given** a draft, **When** the customer signs in, **Then** their list does not contain it and
   its direct address answers as for a quote that does not exist.
3. **Given** a draft for a member of an Organization, **When** the Organization's Administrator or
   a roll-up user of the tree signs in, **Then** they do not see it either.
4. **Given** a draft, **When** the customer tries to accept, reject, edit, resubmit, convert or
   download it by its identifier, **Then** the call is refused as for a quote that does not exist
   and nothing changes.
5. **Given** a draft, **When** the operator edits its lines, prices, groups, notes, validity days
   or custom fields, or cancels it, **Then** the change is saved and recorded in the history, and
   the customer is told nothing.
6. **Given** a draft untouched for longer than `expiry_days`, **When** the expiry sweep runs,
   **Then** the draft is not expired.
7. **Given** a draft, **When** the operator opens the PDF dialog, **Then** they can preview and
   download the PDF but cannot send it to the customer.
8. **Given** a customer submits a quote request, or an operator uses an order's *Clone to quote*,
   **When** it is saved, **Then** it is visible to the customer at once, as today.

---

### User Story 2 — The operator shares the quote in one action (Priority: P1)

**Why this priority**: The other half of the flow: the quote reaches the customer's account
without a PDF sent by hand.

**Independent Test**: Share a draft for a customer with an account and check the customer's
account, mailbox and the quote's history.

**Acceptance Scenarios**:

1. **Given** a draft whose lines all have a price, for an active customer account, **When** the
   operator presses **Share with customer**, **Then** the quote appears on the customer's account
   with its lines, prices and validity date, the customer can accept or reject it, and the
   customer receives the "quote prepared" notification once on each channel the matrix names.
2. **Given** a shared quote, **When** anyone reads its history, **Then** it shows who shared it and
   when, and the deliveries of the notification.
3. **Given** a shared quote, **When** the operator opens it, **Then** it is shown as shared,
   **Share with customer** is not offered and it cannot return to draft; a later change of its
   lines or prices is a revision the customer is told about, as today.
4. **Given** a draft with a line that has no price, **When** the operator shares it, **Then** the
   share is refused with a message naming the unpriced lines, the quote stays a draft and nobody
   is told.
5. **Given** a draft whose customer account is inactive or no longer a member of the quote's
   Organization, **When** the operator shares it, **Then** the share is refused with a message and
   the quote stays a draft.
6. **Given** a rule registered by another module forbids sharing a draft, **When** the operator
   shares it, **Then** the share is refused with that rule's reason, the quote stays a draft and
   nobody is told.
7. **Given** the create screen, **When** the operator chooses **Create and share**, **Then** the
   quote is created and shared in one step; when the share part is refused, the quote is saved as
   a draft and the refusal is shown.
8. **Given** two operators share the same draft at the same moment, **When** both calls arrive,
   **Then** the quote is shared once and the customer is told once.
9. **Given** a draft with the same product on two lines at different prices, **When** it is saved
   and shared, **Then** the customer sees two lines with their own prices, and a later revision
   keeps them separate.

---

### User Story 3 — A default validity counted from sharing (Priority: P2)

**Why this priority**: A store that dates its quotes wants every quote dated without the operator
remembering to type it, and wants the customer to get the full period.

**Independent Test**: Set the default to a number of days, create a quote without touching the
validity, wait, share it, and read its date; override the days on another quote.

**Acceptance Scenarios**:

1. **Given** the default validity is 30 days (an example value), **When** an operator creates a
   quote without touching the validity and shares it, **Then** its validity date is the moment of
   sharing plus 30 days, however long it was a draft.
2. **Given** the default is 0 (out of the box), **When** an operator creates and shares a quote
   without typing days, **Then** it has no validity date, as today.
3. **Given** an operator types a number of days on a quote, **When** it is shared, **Then** that
   quote uses its own number and no other quote changes.
4. **Given** the default is changed, **When** later quotes are created, **Then** they get the new
   value and earlier quotes keep theirs.
5. **Given** the create screen or a draft, **When** the operator reads the validity, **Then** it
   shows the number of days and that they count from sharing; after sharing, both sides see the
   date.

---

### Edge Cases

- The customer account has no e-mail address, has opted out, or the e-mail template is switched
  off: the share succeeds; the history shows the delivery outcome.
- Quotes created by operators before the feature is installed stay visible as shared quotes.
- A quote created from a CRM opportunity (or any screen that opens the create screen) is a draft
  like any other.
- A revision of a shared quote with *Valid for N days* counts from the revision, as today.
- The quote-requests module is switched off: there is no customer surface (Principle XVII).

## Requirements *(mandatory)*

### Functional Requirements

**Draft**

- **FR-001**: A quote an operator creates on a customer's behalf MUST start as a draft, whatever
  screen opens the create screen. The decision MUST be taken in one place so a setting can later
  make it optional. An order's *Clone to quote* is not such a quote and is unchanged.
- **FR-002**: Quotes an operator created before this feature is installed MUST stay visible to
  their customers as shared quotes.
- **FR-003**: A draft MUST NOT be visible to any customer account through any read: the list, the
  detail, counts, the `customers` module's lists, an Organization Administrator's view, a roll-up
  view.
- **FR-004**: Every customer action on a draft (accept, reject, edit, resubmit, convert, download)
  MUST be refused as for a quote that does not exist and MUST change nothing.
- **FR-005**: No customer notification on any channel MUST be sent about a draft: not on
  creation, edit or cancellation.
- **FR-006**: A draft MUST NOT be expired automatically, by inactivity or by validity.
- **FR-007**: An operator MUST be able to preview and download a draft's PDF; sending it to the
  customer MUST NOT be possible while the quote is a draft.
- **FR-008**: An operator MUST be able to make every edit the Admin UI allows today on a draft,
  each recorded in the history.
- **FR-009**: The Admin UI MUST show whether a quote is a draft or shared, on its screen and in
  the list, and the list MUST be filterable by it.
- **FR-010**: Quote requests a customer submits MUST stay visible to the customer at once.
- **FR-011**: The same product and variant MAY appear on several lines of a quote, each with its
  own quantity and price; saving a draft, sharing it, the customer's acceptance and a later
  revision MUST keep those lines separate.

**Share with customer**

- **FR-020**: An operator holding the quote-handling permission MUST be able to share a draft with
  one action on the quote's screen, and to create and share in one step on the create screen;
  when the share part of the latter is refused, the quote is saved as a draft and the refusal shown.
- **FR-021**: From the moment of sharing the quote MUST be visible to the customer as an
  operator-prepared quote is today, and the customer MUST be able to accept or reject it.
- **FR-022**: On sharing, and not on creation, the customer MUST receive the existing "quote
  prepared" notification on the channels the matrix names; its e-mail text stays editable in
  *E-mail templates*.
- **FR-023**: The history MUST record the share with the actor and the moment, and the
  notification deliveries.
- **FR-024**: A share MUST take effect once; a repeated or concurrent share of the same draft MUST
  NOT notify the customer twice.
- **FR-025**: A shared quote MUST NOT return to draft; later changes are revisions, as today.
- **FR-026**: Sharing MUST be refused, with a message naming the lines, while any line has no
  price.
- **FR-027**: Sharing MUST be refused, with a message, when the quote's customer account is
  inactive or no longer a member of the quote's Organization.
- **FR-028**: Another module MUST be able to register a rule that refuses a share with a readable
  reason (for example an approval still pending). A refused share leaves the quote a draft and
  tells the customer nothing.

**Default validity**

- **FR-030**: An administrator MUST be able to set one global default validity for new operator
  quotes, in days; out of the box it is 0, meaning no deadline.
- **FR-031**: A new operator quote MUST carry the default number of days unless the operator
  changes it for that quote; the create screen and a draft MUST show the days and that they count
  from sharing.
- **FR-032**: The validity date MUST be set at the moment of sharing: that moment plus the quote's
  number of days; no days means no date.
- **FR-033**: Changing the default MUST NOT change quotes already created.
- **FR-034**: The existing refusals after the validity date (acceptance, conversion, order
  placement) MUST stay as they are.

### Key Entities

- **Quote request**: gains whether it is shared with the customer, with the moment and the
  operator who shared it, and — while a draft — the number of validity days to apply at sharing.
- **Default validity** (module setting): one global number of days, 0 out of the box.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No customer surface (list, detail, actions, e-mail, notification centre, push; own
  account, Organization Administrator, roll-up) reveals a draft in the acceptance suite.
- **SC-002**: Each shared quote produces exactly one "quote prepared" notification per channel.
- **SC-003**: Every quote created without typing days and shared carries the default validity
  counted from the share.
- **SC-004**: Quotes that existed before installation remain visible to their customers.

## Assumptions

- "Operator" is any admin user holding the quote-handling permission (`rfqs:handle`).
- A finer permission for sharing, an approval workflow and per-quote control of what the customer
  sees are separate features; this one supplies only the refusal hook (FR-028).

## Out of Scope

- A setting that turns drafts off (kept easy by FR-001, not built).
- Merging lines of one product when a quote becomes a basket or an order.
- Offering products in the operator's product search that the storefront hides.
- Sharing a quote with someone who has no customer account (a link with a token).

## Open questions

None.
