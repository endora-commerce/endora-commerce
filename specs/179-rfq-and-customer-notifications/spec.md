# Feature Specification: Quote request notification delivery and the storefront notification centre

**Feature Branch**: `spec/179-rfq-and-customer-notifications`
**Created**: 2026-11-12
**Status**: Draft
**Input**: Issue #238 — *Quote Request notification rows are recorded and never delivered* — and the
owner rulings of 2026-11-12 (Q1–Q8, below), which turn the repair into full delivery: e-mail,
the admin bell, a new customer notification centre on the storefront, and PWA push.

## Owner rulings *(binding, 2026-11-12)*

| # | Question | Ruling |
| --- | --- | --- |
| — | Repair or remove? | Deliver, once and properly. There are no production deployments, so the old `quote_request_notification_events` table is dropped and redesigned with no compatibility code. |
| Q1 | Which changes e-mail the customer side? | **(b)** Every status change of a quote request **except** *Completed*; the order confirmation covers that one. |
| Q2 | What does the approval e-mail carry? | **(b)** A link to the request, no PDF. *Send PDF to customer* stays a separate manual action. |
| Q3 | Who is the customer side? | **(b)** The account that raised the request, **plus** the members of its Organization who hold the quote permission (`specs/170-organization-roles/`). |
| Q4 | Which customer-side changes notify operators? | **(a)** All of them: submitted, re-submitted, offer accepted, offer rejected, expired. |
| Q5 | Through which channels are operators told? | **(c)** The admin bell always; e-mail only for *submitted* and *re-submitted*. |
| Q6 | Who is told when nobody is assigned? | **(b)** The administrators holding `rfqs:handle`, not every administrator. |
| Q7 | Is there an in-account notification for customers? | **(c)** Build a customer notification centre on the storefront in this feature, **including** PWA push when the customer has that notification type enabled. Whether the storefront header carries a bell is the architect's and designer's call (decided below, *Header bell decision*). |
| Q8 | How late may a notification still go out? | **(a)** 24 hours. |

Two terms in Q3 and Q1 needed a reading. The architect proposed both (research R-3 and R-4) and
the **owner confirmed both on 2026-11-12**; they are rulings:

- **"Members who hold the quote permission"** means the members who may **open** the request — today
  the holders of the Organization's *Administrator* role, after `specs/170-organization-roles/` P3
  the holders of `quote_requests.approve`. Telling a member about a request they get a `404` for
  would disclose it, so the recipient rule is the visibility rule, written once.
- **"Status change"** is the status as the **buyer** sees it, so an operator's new offer on a
  pending request (*Awaiting your response*) is one, while the buyer's own draft edits are not.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operators hear about new and answered quote requests (Priority: P1)

A buyer submits a quote request. The sales representative assigned to the buyer's Organization
receives an admin bell entry and an e-mail naming the request's number and Organization. When the
buyer later accepts or rejects the offer, or the request expires, the representative receives a bell
entry. If no representative is assigned to the Organization, every administrator who holds
`rfqs:handle` is told instead — and nobody without that permission is.

**Why this priority**: today a submitted request is silent. An unanswered RFQ is lost revenue, and
this is the half of #238 that costs money every day.

**Independent Test**: submit a request for an Organization with one assigned representative. Run the
delivery worker. Assert one bell entry and one e-mail for that representative, and nothing for any
other administrator. Repeat with no assignment and assert one bell entry and one e-mail per
administrator holding `rfqs:handle`.

**Acceptance Scenarios**:

1. **Given** an Organization with an assigned representative who holds `rfqs:handle`, **When** a
   buyer submits a quote request, **Then** that representative receives one bell entry and one
   e-mail, each naming the request's number; the bell entry links to the request.
2. **Given** the same request, **When** the buyer accepts the operator's offer, **Then** the
   representative receives one bell entry and **no** e-mail (Q5).
3. **Given** an Organization with no assignment, **When** a buyer re-submits a request, **Then**
   every active administrator holding `rfqs:handle` receives one bell entry and one e-mail, and an
   administrator without `rfqs:handle` receives neither (Q6).
4. **Given** the request has an assignee (the operator who last acted on it), **When** the buyer
   rejects the offer, **Then** the assignee is told as well as the Organization's representatives,
   once each.
5. **Given** the admin bell module is switched off, **When** a buyer submits a request, **Then**
   the e-mail still goes out and the bell delivery is recorded as skipped because the module is off.

---

### User Story 2 — Buyers are e-mailed when their request moves (Priority: P1)

A buyer's quote request is revised, approved, cancelled or expires. The buyer who raised it, and
every member of the Organization who may open it, receives an e-mail in the store's language that
says what happened and links to the request on the storefront. The approval e-mail carries the link
and no PDF. When the buyer's own order completes the request, no quote e-mail is sent.

**Why this priority**: the customer half of #238 — a buyer whose offer is ready and who is not told
waits, or buys elsewhere.

**Independent Test**: for an Organization with a requester and one other *Administrator* member,
walk a request through submit → operator revision → customer accept → order. Assert, per step, the
e-mails each person received, against the matrix in `contracts/notification-matrix.md`.

**Acceptance Scenarios**:

1. **Given** a pending request, **When** an operator saves a new offer, **Then** the requester and
   every member who may open the request each receive one e-mail linking to it.
2. **Given** an offer, **When** an operator approves the request, **Then** each customer-side
   recipient receives one e-mail with a link to the request and **no** attachment (Q2).
3. **Given** an approved request, **When** the buyer's order completes it, **Then** no quote e-mail
   is sent to anybody (Q1).
4. **Given** a member who holds only *Member* rights and did not raise the request, **When** the
   request is approved, **Then** that member receives nothing.
5. **Given** the requester accepts the offer themselves, **When** the change commits, **Then** the
   requester receives the e-mail confirming it, and the other customer-side recipients receive it
   as well.
6. **Given** an operator switched the *Quote request approved* e-mail off on the e-mail templates
   screen, **When** a request is approved, **Then** no approval e-mail is sent, the delivery is
   recorded as skipped because the e-mail is deactivated, and the other channels are unaffected.

---

### User Story 3 — Buyers see their notifications in their account (Priority: P2)

A buyer signs in to the storefront and sees, on the account entry in the header, that they have
unread notifications. The account area has a *Notifications* page listing them newest first, each
with a one-line sentence in the buyer's language, its date, and a link to the quote request it is
about. Opening an entry marks it read; *Mark all as read* clears the count.

**Why this priority**: an e-mail can be missed or filtered; the centre is the record a buyer can
come back to. It is also the foundation other modules (orders, returns) will write into later.

**Independent Test**: produce two notifications for a buyer, sign in as that buyer, assert the
header shows two unread, open one and assert the count drops to one and the browser lands on the
request; *Mark all as read* and assert zero.

**Acceptance Scenarios**:

1. **Given** two unread notifications, **When** the buyer loads any storefront page at **any
   viewport width**, **Then** the account entry shows an unread indicator with the count 2, and the
   entry's accessible name includes "Unread notifications: 2".
2. **Given** the notifications page, **When** the buyer opens an entry, **Then** it is marked read,
   the buyer lands on the linked request, and the account entry's count has dropped by one on that
   same page.
3. **Given** a buyer reading the page in Polish, **When** the list renders, **Then** every entry is
   in Polish, including entries recorded while the buyer was browsing in English.
4. **Given** no notifications, **When** the buyer opens the page, **Then** an empty state explains
   what will appear here and offers one action (go to quote requests).
5. **Given** an operator impersonating the buyer, **When** the operator opens the page or an entry,
   **Then** the list is shown and nothing is marked read.
6. **Given** a buyer whose Organization uses two sales channels, **When** the buyer browses
   channel A, **Then** only notifications about channel A, and those about no channel, are listed
   and counted.

---

### User Story 4 — Buyers who opted in receive a push on their device (Priority: P3)

A buyer has installed the storefront as an app and allowed notifications, and has *Quote updates*
switched on in their push preferences. When a notification about their quote request is recorded,
their device receives a push that opens the request. A colleague who may open the same request, and
who also opted in, receives it as well.

**Why this priority**: the push layer exists (`specs/149-pwa-order-status-push/`) and already pushes
quote changes to the requester; this story makes it follow the same recipients and the same
transitions as every other channel, so the three customer channels never disagree.

**Independent Test**: subscribe two devices — one for the requester, one for an *Administrator*
member — with quote updates on for the first and off for the second. Approve the request. Assert one
push message for the first account and a delivery recorded as skipped by preference for the second.

**Acceptance Scenarios**:

1. **Given** the requester with a subscribed device and quote updates on, **When** an operator
   approves the request, **Then** one push is sent to that device, and it opens the request.
2. **Given** a recipient with quote updates off, **When** the same happens, **Then** no push is sent
   to them and the delivery is recorded as skipped by preference.
3. **Given** the shop has push switched off, or the PWA module is off, **When** the same happens,
   **Then** no push is sent and the delivery is recorded as skipped, with the reason.
4. **Given** any quote change, **When** it is delivered, **Then** no recipient receives two pushes
   for it (the former event-driven quote push no longer runs).

---

### User Story 5 — Operators can see what was sent (Priority: P2)

An operator opens a quote request's *History* and, under each entry that notified anybody, sees who
was told, through which channel, and whether it was sent, skipped (and why) or failed (and the last
error).

**Why this priority**: "did the customer get the e-mail?" is the first support question delivery
creates; without an answer on the request, the only answer is the database.

**Independent Test**: produce one delivery of each outcome for a request and assert the History
response and screen show each, with its reason.

**Acceptance Scenarios**:

1. **Given** a submitted request with three deliveries, **When** an operator holding `rfqs:handle`
   opens *History*, **Then** the *submitted* entry lists the three, each with recipient, channel and
   outcome.
2. **Given** a delivery that failed after its retries, **When** the operator opens *History*,
   **Then** it shows *Failed* and the last error.
3. **Given** a buyer viewing the same request on the storefront, **When** the timeline renders,
   **Then** no delivery information is shown.

### Edge Cases

- **A recipient leaves or is blocked between the change and the delivery.** The recipient set is
  fixed when the change commits; at delivery the account is re-read, and a deleted, blocked or
  anonymised account is skipped with that reason. A role change after the commit does not add or
  remove anybody.
- **No address.** A recipient with no e-mail address is skipped for e-mail with that reason; their
  other channels go out.
- **Delivery later than 24 hours** after the change (a stopped worker, Redis down): the delivery is
  skipped as stale and never sent (Q8). This holds for every channel.
- **The receiving module is off** at delivery (admin bell, customer notification centre, PWA): that
  channel is skipped with the reason *module off*, immediately, and is not retried when the module
  comes back. The other channels go out.
- **`quote_requests` itself is off**: no change can happen, so nothing new is recorded; the worker
  stops (the module's worker gate) and resumes its pending deliveries when it is switched back on,
  subject to the 24-hour window.
- **Transport fails** (SMTP refuses, push provider errors): retried with backoff up to five attempts,
  then recorded as failed with the last error. A retry never produces a second e-mail for an attempt
  the transport already accepted.
- **No mail server configured** (console transport): recorded as skipped with that reason, not as
  sent.
- **Two worker processes**: each delivery is claimed by exactly one.
- **A personal (B2C) Organization**: the customer side is the requester alone.
- **The requester is also an *Administrator*** of the Organization: they are one recipient, told
  once per channel.
- **The actor**: the buyer whose action caused the change receives the e-mail (a confirmation) but
  no centre entry and no push about it — they are looking at the result.
- **Re-submission** creates a new request; deliveries are attached to the new request.
- **Expiry of an old-news request** (due more than 24 hours before the sweep reached it): as today,
  no delivery is recorded for it (the sweep's existing grace rule, which Q8 now matches).
- **Retention**: centre entries older than the retention period (default 90 days) are deleted;
  delivery records live as long as the request.
- **A third storefront locale** with no catalogue: entries render in English.

## Requirements *(mandatory)*

### Functional Requirements

**Recording (quote_requests)**

- **FR-001**: Every quote-request change listed in `contracts/notification-matrix.md` MUST record,
  in the **same transaction** as the change and its history entry, one delivery record per
  recipient and channel the matrix names. No change commits without its delivery records, and no
  delivery record exists for a change that did not commit.
- **FR-002**: A delivery record MUST be unique per (history entry, recipient, channel); recording
  twice for the same history entry MUST NOT create a second record.
- **FR-003**: The *Completed* change MUST record no delivery (Q1).
- **FR-004**: The customer-side recipients MUST be the requester plus every active, unblocked,
  non-anonymised member of the request's Organization who may open the request, decided by the
  same rule the storefront uses to show it (Q3; research R-3). Each person is one recipient.
- **FR-005**: The operator-side recipients MUST be the request's assignee and the Organization's
  assigned representatives, each kept only if active and holding `rfqs:handle`; when none remains,
  every active administrator holding `rfqs:handle` (Q6). Each person is one recipient.
- **FR-006**: Customer-side changes MUST notify operators through the admin bell for every one of
  submitted, re-submitted, offer accepted, offer rejected and expired, and through e-mail only for
  submitted and re-submitted (Q4, Q5).
- **FR-007**: The actor of a customer-side change MUST receive the e-mail and MUST NOT receive a
  centre entry or a push for it.
- **FR-008**: The table `quote_request_notification_events` MUST be dropped and replaced, with no
  data carried over and no compatibility read path.

**Delivery (quote_requests worker)**

- **FR-010**: A background worker MUST deliver pending records in bounded batches, each record
  claimed by exactly one worker process, and MUST be started promptly after a change commits as
  well as on a fixed schedule that catches anything the prompt start missed.
- **FR-011**: A record whose change is older than 24 hours when the worker reaches it MUST be
  closed as skipped-stale and not delivered (Q8).
- **FR-012**: A record whose receiving module is off MUST be closed as skipped-module-off without
  attempting delivery.
- **FR-013**: The admin bell and the customer centre deliveries MUST commit in the same transaction
  as the record's closing, so each is delivered exactly once.
- **FR-014**: E-mail and push deliveries MUST carry an idempotency key derived from the record, so a
  retried attempt the transport already accepted produces no second message.
- **FR-015**: A failed attempt MUST be retried with increasing delay, up to five attempts, after
  which the record is closed as failed with its last error.
- **FR-016**: Every closing state — sent, each skipped reason, failed — MUST be stored on the record
  with the time it was reached.

**E-mail**

- **FR-020**: Each change in the matrix that e-mails MUST use its own operator-editable e-mail
  template, declared by `quote_requests`, with default subject and content in English and Polish.
- **FR-021**: A customer-side e-mail MUST be written in the default language of the request's sales
  channel and MUST link to the request on that channel's storefront when the channel has a
  storefront address; without one it names the request's number and carries no link.
- **FR-022**: The approval e-mail MUST NOT attach the quote PDF (Q2).
- **FR-023**: An operator-side e-mail MUST be written in the administrator's preferred language,
  English when unset, and MUST name the request's number and Organization.
- **FR-024**: A template an operator switched off MUST close the record as skipped-deactivated; a
  composition with no mail server MUST close it as skipped (no transport, or console only).

**Admin bell**

- **FR-030**: A bell entry MUST target one administrator, carry a translatable title in
  `quote_requests`' own bundle with an English fallback sentence, name the request by number only,
  and link to the request's admin screen.

**Customer notification centre (new module)**

- **FR-040**: A new module MUST own customer notifications: entries addressed to one customer
  account of one Organization, recorded by other modules through a published port, in the caller's
  transaction or on its own.
- **FR-041**: An entry MUST carry a translatable title (and optional body) as a template address
  with parameters and an English fallback sentence, the producing module, a kind, an optional
  subject (type and id), an optional storefront-relative link, the sales channel it concerns (or
  none) and a producer idempotency key unique per entry.
- **FR-042**: A signed-in buyer MUST be able to list their own entries newest first, page through
  them, read their unread count, mark one read and mark all read. Nothing else is writable.
- **FR-043**: Entries MUST be rendered in the language of the request reading them, falling back to
  the English sentence.
- **FR-044**: The list and the count MUST include only entries of the request's resolved sales
  channel and entries with no channel (Principle XII), and only entries whose producing module is
  present.
- **FR-045**: Under impersonation, reads MUST be answered and marking read MUST change nothing.
- **FR-046**: Entries older than the retention period MUST be deleted by a scheduled sweep; the
  period is a setting of the module, default 90 days.
- **FR-047**: A link MUST be a storefront-relative path; the port MUST refuse an absolute URL or a
  protocol-relative one.
- **FR-048**: While the module is off, its storefront API MUST answer as absent, the storefront MUST
  show neither the page nor the unread indicator, and a producer's centre delivery MUST be skipped as
  module-off.

**Storefront**

- **FR-050**: The account area MUST offer a *Notifications* page with an empty state, an error
  state with a retry, an in-flight state on every submit (disabled, `aria-busy`, spinner), an
  unread/read distinction that does not rely on colour alone, and *Mark all as read*. Page loads use
  the storefront's existing navigation feedback; the page adds no `loading.tsx`. While the module is
  off the page answers the shop's 404 (FR-048), with no bespoke "unavailable" message.
- **FR-050a**: An entry with a link MUST be a real link (opens in a new tab, can be copied) to
  `/account/notifications/<id>/open`, which marks the entry read (not under impersonation) and
  redirects to the entry's target. A failed mark still redirects. An entry without a link MUST NOT
  be a link surface; it offers a *Mark as read* button instead.
- **FR-050b**: After *Mark all as read*, a status region that is always rendered beside the heading
  MUST announce the result, and focus MUST move to the heading; a failure MUST show a specific error
  with a retry. Under impersonation the button MUST be shown disabled with the reason.
- **FR-051**: The header MUST NOT gain a separate bell; the existing account entry MUST carry the
  unread indicator and count (*Header bell decision*). The indicator MUST be visible **at every
  viewport width**: the 768–876 px band, which today renders neither the desktop account pill nor
  the mobile tab bar and drawer, MUST gain an account entry by aligning the tab bar's and the
  drawer's breakpoint to the header's 877 px. No indicator appears in the minimal checkout header.
- **FR-051a**: Opening an entry, marking one read and marking all read MUST re-render the account
  entry's count in the same response. Otherwise the count updates on the next full render; there is
  no polling and no live refresh.
- **FR-051b**: The count MUST reach assistive technology as visually hidden text inside the account
  entry, after its visible name ("Unread notifications: {count}"), never as an `aria-label` that
  replaces the visible name. The indicator MUST have no live region. The badge shows at most `9+`;
  the hidden text carries the exact count.
- **FR-051c**: The account area's navigation MUST list *Notifications* second, after the profile,
  with the unread count in text when above zero, and the account overview MUST show a one-line
  summary ("You have 2 unread notifications") linking to the page when above zero. Both appear only
  while the module is present.
- **FR-052**: All new storefront copy MUST ship in English and Polish, and Polish labels MUST wrap
  rather than truncate.

**Push**

- **FR-060**: A customer-side delivery MUST be pushed through the PWA push layer to the recipient's
  subscribed devices when push is on for the channel, quote pushes are on for the channel, and the
  recipient's *quote updates* preference is on; otherwise it MUST be closed as skipped with the
  reason.
- **FR-061**: The PWA module's own quote-status push subscriptions MUST be removed in the same
  change that introduces FR-060, so no change is pushed twice.

**History**

- **FR-070**: The admin History of a request MUST show, per history entry, its delivery records with
  recipient, channel, state, attempts and last error, to operators holding `rfqs:handle`.
- **FR-071**: No customer-facing response MUST carry delivery records.

**Documentation**

- **FR-080**: The `quote_requests` module page MUST replace its *Notifications* section with what
  is delivered, to whom and when; the new module MUST have its own page; both in English and
  Polish.

### Key Entities

- **Quote request delivery** (`quote_requests`): one per (history entry, recipient, channel) — who,
  through which channel, its state, attempts, last error and when it closed.
- **Customer notification** (new module): one entry in a buyer's notification centre — the sentence
  to show, the link, the subject, the channel, read or not.
- **Push preference** (`pwa`, existing): the buyer's per-type choice; its *quote updates* switch
  gates FR-060.

## Header bell decision

**Decision: no separate bell in the storefront header. The unread indicator goes on the existing
account entry** (the avatar pill on desktop, the account entry of the mobile tab bar and drawer),
and the centre is a page of the account area. Rationale, against `.claude/skills/ux-laws/SKILL.md`:

- **Hick's Law / §7 item 3 (≤ 5 primary actions).** The desktop action cluster already holds five
  controls when every module is present — shopping list, quote draft, compare, cart, account. A
  sixth icon breaks the cap the skill sets for the most-used region of the page.
- **Signal-to-noise.** Quote changes are rare events per buyer (a few per request, over days).
  A permanent header control for a rare signal competes with the cart and search on every page,
  including for every guest, who can never have a notification.
- **Jakob's Law, read narrowly.** With one producer, notifications are about the buyer's own
  account, so the account entry is where buyers look for them. A bell is the convention once
  notifications become a general inbox, which is the revisit trigger below. (B2B supplier portals do
  often carry a bell; the claim is not that bells are unconventional.)
- **Occam's Razor / Picture superiority.** The account entry is already a labelled, recognisable
  target; an indicator on it adds information without adding a control. The proactive alert is the
  e-mail and the push (US2, US4); the centre is the record.
- **Accessibility floor.** The indicator is part of the entry's accessible name ("Account, 2 unread
  notifications"), shows a number and not a colour alone, and the page's unread state is marked by
  text and weight, not colour.

- **Flow.** No indicator appears in the minimal checkout header (`HeaderSwitch` `minimal`):
  checkout is not interrupted.

The account pill is a plain link to `/account` (the profile), so the badge leads to the account
overview, whose summary line and navigation lead on to *Notifications* (FR-051c, SC-006). Pointing
the pill at the notifications page while something is unread was rejected: one control with two
destinations.

**Revisit when any one of these holds**: (a) a second producer (orders or returns) writes to the
centre; (b) a notification kind is time-critical (for example offer expiry within 48 h); (c)
measured discovery is low (most unread entries are never opened from the storefront). The first
step is then an account dropdown on the existing pill, which already draws a chevron, with
*Notifications (n)* as its first item; a dedicated bell comes only after that. The indicator moves
to the new control; it is never shown in two places.

The designer review of 2026-11-12 agreed with this decision and its amendments are applied here
and in `contracts/customer-notifications-storefront-api.md`; the four decisions it left to the
architect are ruled in research R-24.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every change in the matrix, every recipient it names has exactly one closed
  delivery per channel within 2 minutes of the change under normal operation (worker running, all
  modules on).
- **SC-002**: Zero duplicate e-mails, bell entries, centre entries or pushes per (change, recipient,
  channel), including across a worker crash between attempt and closing.
- **SC-003**: Zero deliveries to a person who cannot open the request (customer side) or who lacks
  `rfqs:handle` (operator side).
- **SC-004**: Zero deliveries sent more than 24 hours after their change.
- **SC-005**: An operator can answer "was the customer told, and how?" from the request's History
  alone, for 100% of deliveries.
- **SC-006**: A signed-in buyer reaches the request from a notification in at most three
  interactions from any page (the account entry, *Notifications*, the entry), and in two from the
  account overview's summary line.
- **SC-007**: Switching any receiving module off leaves every other channel delivering, and no
  request transition fails because a notification channel is unavailable.

## Assumptions

- A customer account records no language of its own; the sales channel's default language is the
  buyer's language for e-mail, as in `orders`, `returns` and `carts`' approval e-mails. The centre
  is rendered per request and so follows the buyer's current language.
- The operator e-mail carries no clickable admin link: an absolute admin URL needs `ADMIN_BASE_URL`,
  an environment input `mfa` owns, whose promotion to the platform is outside this feature (the
  `crm` event-reminder precedent). The bell links. Owner answer OQ-1: the link follows in #185.
- Organizations with very many *Administrator* members (hundreds) are not expected; the recipient
  set is resolved in one pass per change.
- Orders and returns are **not** producers of the centre in this feature; they are follow-ups.

## Owner answers to the open questions *(2026-11-12)*

No owner question remains open.

- **OQ-1 — resolved: A.** Operator e-mails carry no clickable admin link in this feature; they name
  the request number and the bell carries the link. The owner requires the link in the very next
  step: issue **#185** (promote `ADMIN_BASE_URL`, today owned by `mfa`, so any module can link into
  the Admin UI from an e-mail) is the committed follow-up. Once #185 lands, the two RFQ operator
  e-mails gain the link to the request, and so do the `crm` and `tasks` e-mails (plan *Follow-ups*,
  tasks T104).
- **OQ-2 — confirmed.** The architect's readings of Q1 and Q3 at the top of this spec are binding
  rulings (see *Owner rulings*).
