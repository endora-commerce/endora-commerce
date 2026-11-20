# Feature Specification: Complaints from guests without a customer account

**Feature Branch**: not created by this step — the spec was written while
`feat/180-off-platform-complaints` was checked out; the branch is chosen at plan time
**Created**: 2026-11-16
**Status**: Draft
**Module**: `returns` (owner); reads from `catalog`, `transactional_emails`, `settings`,
`admin_notifications`, `admin_users`, `assets_library` (byte storage only), as
`specs/180-off-platform-complaints/` already does
**Predecessor**: `specs/180-off-platform-complaints/` — this feature extends its *complaint about a
product bought elsewhere* path (its US5–US8, FR-B01…FR-B43) to a person who has no customer
account
**Input**: A person without a customer account files a complaint about a product bought outside
the platform, on the existing no-order complaint form, after proving they control an e-mail
address; they follow the case through a private tracking link; their personal data is erased
automatically after the case closes; the operator enables it per sales channel, off by default.

## Owner decisions *(binding, 2026-11-16 — recorded, not reopened)*

| # | Question | Decision |
| --- | --- | --- |
| G1 | Which guest path is in scope? | **Only path B**: a person without an account files a **complaint** about a product **bought elsewhere** (no platform order), on the feature-180 no-order form. Guest returns or complaints against a platform order (path A — order number + e-mail lookup) and guest **returns** (withdrawal) of any kind are **out of scope**; path A is a possible follow-up. |
| G2 | Is any account created? | **No account of any kind.** A *lightweight account* was considered and rejected. The case has **no customer account and no organization**. Isolation follows the precedent of `specs/170-forms-module/` (anonymous entries, `NewsletterSubscriber`): the account and the organization are absent **together**, admins scoped to a set of organizations never see a guest case, and the plan MUST record the architect's Principle XI review. |
| G3 | How is the guest identified? | By **e-mail verification before the form**: the visitor enters an address, receives a one-time link, and the link opens the form in a verified guest session bound to that address. The page answers identically whether or not anything was sent. Rate limit and honeypot as in `forms`. The shop's *new case* e-mail and the admin bell entry fire only for a verified, submitted case. |
| G4 | How does the guest follow the case? | Through a **private tracking link** sent in the confirmation and in every later e-mail to the guest. It shows the status, customer-visible comments and attachments; the guest may add comments and files there. It stops working a fixed time after the case closes. |
| G5 | How long is guest personal data kept? | Erased **automatically** a set time after the case closes (default 90 days), plus an admin action *Erase personal data* for a data-subject request. Audit entries keep counts and field names, never values (as 180). |
| G6 | Is a guest case ever attached to an account? | **Never automatically**, even when the e-mail matches an existing account — that would let anyone plant a case in someone else's account. A manual *attach to customer* in the admin is a possible follow-up, out of scope. |
| G7 | How is it enabled? | A new setting **Complaints from guests**, **off by default**, per sales channel. It has effect only while 180's **Complaints without a platform order** is on for the same channel; when that one is off, guest complaints are off too (fails closed). |
| G8 | How does the admin handle a guest case? | Marked and filterable (180's origin filter extended); handled as any other off-platform complaint — repair, replacement, *settled outside the platform*; **never a refund through the platform** (180 ruling R4). |
| G9 | What does the module's off state hide? | With `returns` off (Principle XVII) the guest entry, the verification page, the form and the tracking page are **entirely absent**. |
| G10 | Are a guest's own comments erased with the rest of their personal data? | **No** — comments are kept, as 180 keeps a customer's comments on anonymisation (FR-071). The case history stays whole. |
| G11 | Where does a guest's file get its tenant column? | **Nowhere — the column is nullable.** Settled in 180 before it merges: `return_case_attachments.organization_id` stays nullable on every database (it already did where legacy rows had none), so this feature adds no migration to relax it. A row without an organization matches no organization-scoped read. |

## Clarifications

### Session 2026-11-16 (owner rulings on the plan)

- Q: May the tracking and verification links be derived with the platform's sealed-reference
  facility (session-key-derived, purpose-bound), so that nothing token-like is stored and every
  e-mail can carry the same link? → A: **Yes.** The platform's one-paragraph documentation of that
  facility is amended in the same delivery. Consequence accepted: rotating the platform's session
  key voids every guest link; *Send a new tracking link* is the remedy (plan ruling 1, research
  R-5).
- Q: When and where is it built? → A: **Now, in the same working tree, on top of the uncommitted
  feature 180** (`specs/180-off-platform-complaints/`). It is split into two merge requests at commit
  time: 180 first, 181 stacked on it (plan ruling 2).
- Q: What does "the case closes" mean? → A: **The case enters a terminal status.** The closing time
  is recorded from now on. A settled case left in a non-terminal status (*Resolved*) is not erased
  until it is closed; the operator documentation says so (plan ruling 3, research R-9).

### Session 2026-11-16 (plan departures, accepted with the rulings above)

1. **Origin filter** (FR-061): besides the four origins, *bought elsewhere* (customer and guest
   together) stays as an option, so saved views made under 180 keep their meaning.
2. **Retention range** (FR-070): a value outside 30–3 650 days is read as the nearest bound (the
   settings store validates no range). The setting's description states the range.
3. **"Closes"** (FR-043, FR-071, FR-074) means "enters a terminal status". FR-074 holds because a
   terminal status has no exit in the workflow; a test pins that invariant.
4. **Opening a verification link does not use it** (FR-020, FR-022). The link opens a page with one
   *Continue* button, so e-mail scanners and link previews cannot consume the one-time link.
5. **Throttling per client address answers "too many requests"** (FR-021, FR-024). It names no
   e-mail address, so it does not break FR-021's identical answer for every address. The
   per-address limit stays silent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A visitor without an account files a complaint (Priority: P1)

A person bought one of the shop's products from a distributor or in a physical store, and it is
defective. They have no account with the shop and do not want one. On the shop's returns area they
choose *Continue without an account*, type their e-mail address, and receive an e-mail with a
link. The link opens the feature-180 complaint form: they describe the product (picked from the
catalogue or typed as a model name), the defect with photos, the purchase date and proof of
purchase, their name, phone and the address the product should be sent back to, accept the
complaint terms, and submit. The page confirms the complaint with its reference and gives them
their tracking link; the same link arrives by e-mail.

**Why this priority**: it is the feature. Today such a complaint arrives by e-mail or phone and is
handled outside any workflow, or the person is forced to register for a one-off warranty claim.

**Independent Test**: with both settings on for a channel, request a link for an address with no
account, open it, file a complaint naming one catalogue product and one typed model with a photo
and a proof of purchase; assert one case exists with no account and no organization, on the
request's sales channel, carrying the lines, purchase data, contact data with the **verified**
address, ship-back address, clauses and files as submitted; assert one confirmation e-mail to that
address with the tracking link, one *new case* e-mail to the shop's recipients and bell entries
only for administrators allowed to see guest cases.

**Acceptance Scenarios**:

1. **Given** guest complaints are on for the channel, **When** a signed-out visitor opens the
   returns area, **Then** they are offered *Sign in* (for anything bought from this shop) and
   *Continue without an account* (for a product bought elsewhere), with wording that makes clear an
   order from this shop needs signing in.
2. **Given** guest complaints are on, **When** a signed-out visitor follows a link to the no-order
   complaint form (the address 180 uses for *bought elsewhere*), **Then** instead of being sent
   straight to the login page they are offered both *Sign in* — which returns them to that form
   after signing in — and *Continue without an account*.
3. **Given** guest complaints are off for the channel (or 180's no-order complaints are off),
   **When** a signed-out visitor opens the returns area or the no-order form, **Then** they are
   sent to sign in exactly as today and no guest option is shown anywhere.
4. **Given** a visitor entered an address on the verification page, **When** they submit it,
   **Then** the page says, in the same words and after the same kind of delay whatever the
   address, that if the address can receive e-mail a link is on its way, how long the link is
   valid, and how to request another.
5. **Given** a visitor opens a valid verification link, **When** the form appears, **Then** the
   e-mail address is shown as verified and cannot be edited, the name, phone and ship-back address
   are empty (nothing is prefilled), and every other part of the form is the one signed-in
   customers get for a product bought elsewhere.
6. **Given** a verified guest submits a complete complaint, **When** it is accepted, **Then** the
   page names the case reference, shows the tracking link with advice to keep it, and says a
   confirmation with the same link was sent to the verified address.
7. **Given** *proof of purchase required* is on for the channel, **When** a guest submits without
   an attachment typed *proof of purchase*, **Then** the submission is refused naming the missing
   proof, as for a signed-in customer.
8. **Given** a guest submits a case of kind *return*, or names a platform order, **When** it
   reaches the platform, **Then** it is refused: a guest may file only a complaint about a product
   bought elsewhere.

---

### User Story 2 — The guest follows the case through a private link (Priority: P1)

The guest has no account to sign into. Every e-mail the shop sends them about the case —
confirmation, operator messages, status changes, authorization with the return instructions,
rejection — carries the case's tracking link. The link opens a page showing the case's reference,
status, products, the purchase and contact data they gave, the customer-visible comments and the
files. While the case is open they can write a comment and add files there.

**Why this priority**: without it the guest files a complaint into a void; every operator question
would need a manual e-mail outside the platform, which is what this feature removes.

**Independent Test**: file a guest complaint, open the tracking link in a fresh browser without any
session, assert the case page shows status, products and customer-visible comments but no internal
comment; post a comment and a photo through it; assert both appear on the admin case; move the case
to a status marked *notify the customer on entry* and assert the e-mail carries the same link.

**Acceptance Scenarios**:

1. **Given** a guest case, **When** anyone opens its tracking link, **Then** the case page is shown
   without signing in; an operator's internal comments and staff-only notes (for example the
   *settled outside the platform* note) are never shown.
2. **Given** an open guest case, **When** the link holder posts a comment or adds a file, **Then**
   it appears on the admin case as coming from the guest, with the same file limits as 180
   (types, per-file size, per-case count).
3. **Given** a closed guest case, **When** the link holder opens the link before it expires,
   **Then** the page is read-only: no comment or file can be added.
4. **Given** a tracking link that expired, was replaced by a newer one, or whose case's personal
   data was erased, **When** anyone opens it, **Then** a neutral page says the link no longer works
   and how to contact the shop, revealing nothing about whether the case exists.
5. **Given** a guest case, **When** an operator posts a customer-visible comment with *notify
   customer*, authorizes, rejects, or moves the case into a notifying status, **Then** the guest
   receives the same e-mail a signed-in customer would, sent to the verified address and carrying
   the tracking link instead of a link into a customer account.
6. **Given** a link holder who mistyped or guessed a link, **When** they open it, **Then** they see
   the same neutral page as for an expired link.

---

### User Story 3 — The operator handles guest complaints (Priority: P2)

On the case list an operator sees which cases came from a guest, filters to them, and handles them
like any other complaint about a product bought elsewhere: authorize, comment, settle by repair,
replacement or *settled outside the platform*. The case shows the guest's contact data and
ship-back address as given and that the e-mail address was verified. When a guest loses their link,
or says it was forwarded to someone else, the operator sends a new one, which makes the old one
stop working.

**Why this priority**: the storefront half is useless if an operator cannot tell a guest case from a
customer's, or if the case can be settled in a way the platform cannot carry out for someone with
no account.

**Independent Test**: with one customer complaint against an order, one customer complaint without
an order and one guest complaint, filter the list by origin and assert each origin returns exactly
its case; open the guest case as an administrator scoped to a set of organizations and assert it is
indistinguishable from a missing case; settle it and assert only repair, replacement and *settled
outside the platform* are offered.

**Acceptance Scenarios**:

1. **Given** the case list, **When** an unrestricted operator filters by origin, **Then** the filter
   offers *with an order*, *bought elsewhere — customer*, *bought elsewhere — guest* and all, guest
   rows carry a *Guest* marking, the filter is kept in saved views, and the export says which
   cases are guest cases.
2. **Given** an administrator restricted to a set of organizations, **When** they open the list,
   search, export, open a guest case by its address, or act on it, **Then** guest cases are absent
   and a direct request answers exactly as for a case that does not exist.
3. **Given** a guest case at settlement, **When** an operator settles it, **Then** the offered
   resolutions are those of any off-platform case (repair, replacement, *settled outside the
   platform* with a note), and refund, credit and corrective invoice are refused.
4. **Given** a guest case, **When** an operator chooses *Send a new tracking link*, **Then** the
   guest receives a new link at the case's verified address, the previous link stops working at
   once, and the action is audited.
5. **Given** a guest case whose e-mail address belongs to an existing customer account, **When**
   the operator opens it, **Then** it is still a guest case with no account or organization; the
   platform never links it to that account.
6. **Given** a new guest case, **When** the bell entries are recorded, **Then** they go only to
   administrators who may view returns **and** may see guest cases; an administrator restricted to
   a set of organizations receives none.

---

### User Story 4 — Guest personal data does not outlive its purpose (Priority: P2)

A set time after a guest case closes (90 days by default), the platform erases the guest's contact
data, ship-back address and files from the case and the tracking link stops working; the case
itself — products, purchase data, statuses, resolution — stays for the shop's records. When a guest
exercises their right to erasure earlier, an operator erases the same data from the case at once.

**Why this priority**: a guest has no account to delete; without automatic erasure their data would
be kept indefinitely, which the shop could not justify. It is P2 because it acts only after a case
closes, so the P1 stories can ship and run before it first triggers — but it must ship in the same
release.

**Independent Test**: close a guest case, advance the clock past the retention period, run the
platform's maintenance, and assert the case keeps its lines and resolution, has no contact data,
address or files, shows the erasure date, and its tracking link shows the neutral page; separately,
erase an open guest case by the admin action and assert the same plus no further e-mail to the
guest.

**Acceptance Scenarios**:

1. **Given** a guest case closed longer ago than the retention period, **When** the daily
   maintenance runs, **Then** its contact data, ship-back address and files are erased, the case
   shows the erasure date, and the audit records the number of cases and files and the names of the
   fields erased — never their values.
2. **Given** an operator with the erasure permission, **When** they choose *Erase personal data* on a
   guest case in any status and confirm, **Then** the same data is erased at once, the tracking link
   stops working, and no further e-mail can be sent to the guest about that case.
3. **Given** a guest asks for erasure of everything the shop holds, **When** an unrestricted
   operator searches the case list by that e-mail address, **Then** every guest case carrying it is
   found, so each can be erased.
4. **Given** a closed guest case that an operator reopens before its erasure date, **When** it is
   reopened, **Then** the erasure is no longer due; it falls due again the retention period after
   the case next closes.
5. **Given** a customer account is anonymised, **When** its erasure runs, **Then** guest cases that
   merely carry the same e-mail address are not touched (they are not that account's), and the
   operator documentation says so.

---

### User Story 5 — The operator switches guest complaints on (Priority: P3)

The operator turns on *Complaints from guests* for one sales channel (or globally), and sets how
long guest data is kept after a case closes. The setting is visibly dependent on *Complaints without
a platform order*.

**Why this priority**: it is the switch, not the value; small, but nothing reaches a guest without
it.

**Independent Test**: with the dependency off, turn guest complaints on and assert no guest surface
appears; turn the dependency on and assert it appears on that channel only.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** an operator opens the returns settings, **Then** *Complaints
   from guests* is off for every channel, with a description saying it needs *Complaints without a
   platform order*.
2. **Given** guest complaints on and no-order complaints off for a channel, **When** a signed-out
   visitor uses that channel, **Then** no guest surface exists and a direct guest submission is
   refused.
3. **Given** an operator changes either setting or the retention period, **When** the change is
   saved, **Then** it is audited with the operator's identity.

---

### Edge Cases

- **Module off (Principle XVII).** With `returns` off, the guest choice, the verification page, the
  verification and tracking links and the form answer as pages that do not exist, and no e-mail is
  sent; links in e-mails sent earlier lead to the not-found page. Switching the module back on
  restores every tracking link still within its validity; no case or setting is lost. An erasure
  that fell due while the module was off runs at the first maintenance after it is back on (the
  180 precedent) — operator documentation discloses that the off state postpones erasure.
- **Setting switched off mid-flow.** A visitor on the verification page, holding a verification
  link, or with the form open, is refused at the next step with a sentence saying complaints from
  guests are not accepted here any more and how to contact the shop; nothing is created. Guest cases
  already filed stay fully workable for operators and their tracking links keep working (as 180
  keeps existing off-platform cases).
- **Verification link expired or already used.** It opens a page offering to send a new link, with
  the address filled in when the same browser requested the link (otherwise the visitor types it);
  the page never discloses the address a link was sent to. While the browser holds any live guest
  session, a refused link simply continues to the form, which shows the verified address (owner
  rulings O-2, O-3, 2026-11-16).
- **E-mail typo.** The link never arrives. The *link sent* page says how long to wait, lets the
  visitor go back and enter a different address, and offers *send again* after a short wait. No case
  can exist under an address nobody verified.
- **Address that belongs to an existing customer account.** The page answers exactly as for any
  other address. The verification **e-mail** (seen only by the address's owner) adds that the
  address has an account and that complaints filed after signing in appear in the account; a
  complaint filed through the guest link stays a guest case and never appears in that account (G6).
- **A signed-in customer opens a verification link.** The guest form opens as for anyone; the case
  is a guest case, not attributed to the signed-in account (attribution never follows a session the
  verification did not create). The page notes they are signed in and offers to file from the
  account instead.
- **Double submit** (double click, back button, retry after timeout). The 180 submission key, bound
  to the guest session, yields at most one case and one set of e-mails; the repeat lands on the
  same confirmation.
- **Guest session expired with the form open.** Submission is refused with an offer to send a new
  link to the same address; files uploaded in the expired session are discarded with the 180 rule
  for unclaimed uploads.
- **Several complaints by one guest.** One verified session may file more than one complaint while
  it lasts (180's *one purchase per case* rule makes this normal); each case has its own tracking
  link.
- **Catalogue product on a guest line.** Judged by what a signed-out visitor may see on the channel,
  not by any customer's visibility rules.
- **E-mail delivery failure.** As 180: never blocks or rolls back a submission, a comment or a
  transition; recorded for operators. A failed verification e-mail is recorded likewise, and the
  visitor still sees the uniform answer.
- **Bots.** A filled honeypot is answered like a success and discards the request; requests beyond
  the rate limits are answered with the same uniform page (verification) or a "try again later"
  sentence (form, tracking-page comments) that names no address.
- **Language.** Every guest-facing page follows the request's language; every e-mail to the guest,
  including the verification e-mail, is in the sales channel's language, as 180 sends its e-mails.
- **Tracking link forwarded.** Whoever holds it can read and comment until it expires or is
  replaced; the page says so ("anyone with this link can see this complaint"), and the operator can
  replace it (US3 scenario 4).
- **Operator reopens or moves a closed case.** The tracking link's expiry and the erasure are counted
  from the latest close; an already-erased case stays erased.

## Requirements *(mandatory)*

### Functional Requirements

**Enabling it (G7)**

- **FR-001**: The operator MUST be able to enable *Complaints from guests* globally and per sales
  channel; it is **off by default**. It MUST take effect on a channel only while *Complaints without
  a platform order* (180 FR-B01) is also on for that channel, and the module's off state MUST always
  win over both.
- **FR-002**: While guest complaints are not in effect for the request's channel, no guest surface
  MUST be offered and every guest request (verification, form, submission) MUST be refused with a
  sentence in the request's language; existing guest cases and their tracking links are unaffected.

**Entry point (G1)**

- **FR-010**: While guest complaints are in effect, a signed-out visitor reaching the returns area
  or the no-order complaint form MUST be offered both *Sign in* (returning them to where they were
  going, address and query included) and *Continue without an account*, worded so that a purchase
  from this shop is directed to signing in. While not in effect, today's redirect to sign-in MUST be
  unchanged.
- **FR-011**: The guest entry MUST have a stable public address an operator can link to from content
  pages (for example the contact page). Guest pages MUST NOT be indexed by search engines.

**E-mail verification (G3)**

- **FR-020**: Before the form, the visitor MUST give an e-mail address and MUST open a one-time
  link sent to it; only an opened, valid link starts a guest session, bound to that address.
- **FR-021**: The answer to a verification request MUST be identical in wording, status and timing
  characteristics whatever the address — whether it belongs to an account, was rate-limited,
  failed to send, or was sent. Nothing on any page may reveal whether an address has an account or
  has cases.
- **FR-022**: A verification link MUST be usable once and MUST expire 60 minutes after it was sent
  (default). Requesting a new link MUST invalidate the address's earlier unused links.
- **FR-023**: A guest session MUST last at most 24 hours from verification (default, matching the
  lifetime of 180's unclaimed uploads) and MUST end when the visitor leaves it or it expires.
- **FR-024**: Verification requests MUST be rate limited per client address and per e-mail address,
  and MUST carry a honeypot field, following the `forms` precedent (`specs/170-forms-module/`
  FR-040, FR-041). Guest submissions MUST be rate limited per guest session and per verified
  address.
- **FR-025**: The verification e-mail MUST be an operator-editable transactional template shipped in
  English and Polish that the operator cannot switch off (it is the only way in). When the address
  belongs to an existing account, the e-mail MUST add that complaints filed after signing in appear
  in the account.
- **FR-026**: Records of verification requests MUST NOT keep the e-mail address longer than 7 days
  after the request.

**The guest complaint (G1, G2, G6)**

- **FR-030**: A verified guest MUST be able to file a case of kind *complaint* without a platform
  order on the request's sales channel, using the 180 no-order form and its rules unchanged: lines
  (FR-B12, FR-B14), purchase data (FR-B13), attachments and *proof of purchase required* (FR-B20,
  FR-B21), clauses (FR-B30–FR-B32), submission key, and the same refusals.
- **FR-031**: The contact e-mail of a guest case MUST be the verified address and MUST NOT be
  editable on the form; name, phone and ship-back address MUST be typed by the guest (nothing to
  prefill from).
- **FR-032**: A guest case MUST have **no customer account and no organization**, both absent
  together; a case MUST never carry one without the other. The absence MUST be stamped by the
  platform from the guest session, never taken from the request.
- **FR-033**: A guest case MUST NOT be attached to any customer account automatically, whatever its
  e-mail address and whatever session the browser holds (G6).
- **FR-034**: Any other kind, a platform order, or an organization or account named in a guest
  request MUST be refused.
- **FR-035**: Attachments of a guest case MUST be uploaded within the verified guest session (before
  submission) or through the tracking link (after); MUST be private; and MUST be retrievable only
  through that case's valid tracking link and by administrators allowed to see the case. Files
  uploaded in one guest session MUST NOT be claimable by another session or by a customer.
- **FR-036**: After submission the page MUST show the case reference (180 FR-A44) and the tracking
  link with advice to keep it, and MUST make no promise of a processing time (180 FR-B37).

**Tracking link (G4)**

- **FR-040**: Every guest case MUST have one valid private tracking link at a time; possessing it
  MUST be the only storefront access to the case. It MUST NOT be derivable from the case reference,
  the case identifier or the e-mail address, MUST be infeasible to guess by trying links (attempts
  are rate limited, FR-042's limit applying to openings as well), and MUST NOT be passed on to other
  sites the page links to.
- **FR-041**: The tracking page MUST show the reference, the status, the rejection reason when there
  is one (owner ruling O-1, 2026-11-16), the products, the purchase data, the contact data and
  ship-back address as given, the customer-visible comments, and the files with their type; MUST NOT show internal comments or staff-only notes; and MUST state that
  anyone holding the link can see the case.
- **FR-042**: While the case is open, the link holder MUST be able to post a comment and add files
  (180 limits); once closed, the page MUST be read-only. Comments from the page MUST be rate
  limited.
- **FR-043**: The tracking link MUST stop working 90 days after the case closes (fixed default, not
  operator-configurable in this feature), or earlier when the guest data is erased or the link is
  replaced. A link that does not work for any reason MUST show one neutral page that does not reveal
  whether the case exists.
- **FR-044**: Every e-mail to the guest about the case — confirmation, comment with *notify
  customer*, entering a notifying status, authorization, rejection — MUST go to the verified address
  in the sales channel's language and carry the tracking link where a signed-in customer's e-mail
  carries the link into the account.
- **FR-045**: The guest confirmation MUST always be sent for a guest case, even when the operator
  has switched off the confirmation for account holders, because it carries the guest's only
  durable way back to the case. It MUST be operator-editable in English and Polish.
- **FR-046**: An operator allowed to see the case MUST be able to send a new tracking link to the
  case's verified address, which invalidates the previous link at once.

**Shop notifications (G3)**

- **FR-050**: A submitted guest case MUST trigger 180's *new case* e-mail (FR-A02), identifying the
  filer as a guest by their name only — not their e-mail address, phone or address — and no
  organization.
- **FR-051**: A submitted guest case MUST record bell entries (180 FR-A03) only for administrators
  who may view returns **and** may see cases with no organization; none for an administrator
  restricted to a set of organizations.
- **FR-052**: A verification request, an unopened link, or an abandoned form MUST NOT trigger any
  shop e-mail or bell entry.

**Admin handling (G2, G8)**

- **FR-060**: A case MUST be a guest case exactly when it has no customer account; this MUST be
  derived, never set by an operator. A guest case is always also off-platform (180 R5).
- **FR-061**: The case list MUST mark guest rows and MUST extend 180's origin filter to *with an
  order* / *bought elsewhere — customer* / *bought elsewhere — guest* / all, kept in saved views; the
  export MUST say which cases are guest cases. The admin search MUST find guest cases by the contact
  e-mail address.
- **FR-062**: Guest cases MUST be visible and actionable only to administrators with unrestricted
  organization scope; for an administrator restricted to a set of organizations they MUST be absent
  from every list, count, search, export and saved view, and a direct request MUST be
  indistinguishable from one for a case that does not exist.
- **FR-063**: The case detail MUST show the guest marking, that the contact address was verified
  and when, and the contact data and ship-back address as given.
- **FR-064**: A guest case MUST be settled only by the resolutions of an off-platform case (180
  FR-B33, FR-B33a); refund, credit and corrective invoice MUST be refused.

**Personal data (G5)**

- **FR-070**: The operator MUST be able to set, globally, how many days after a guest case closes its
  personal data is erased: default **90**, between 30 and 3 650 days. A change applies to cases not
  yet erased.
- **FR-071**: When the period has passed since a guest case closed, the platform's daily maintenance
  MUST erase the case's contact data, ship-back address and files, record the erasure date on the
  case (180 FR-B43, D-8), and make the tracking link stop working. Products, purchase data, statuses,
  clauses as shown, comments and the resolution MUST remain. Comments — the guest's included — are
  kept, as 180 keeps a customer's comments on anonymisation (owner ruling 2026-11-16, Q1 = A): the
  case history stays whole; personal data a guest typed into a comment is not erased.
- **FR-072**: An operator holding a dedicated erasure permission and allowed to see the case MUST
  be able to erase a guest case's personal data at once, in any status, after a confirmation that
  states it cannot be undone. After it, no e-mail MUST be sent to the guest about that case.
- **FR-073**: Every erasure, automatic or manual, MUST be audited with the number of cases and files
  and the names of the fields erased, never their values. Every other audit entry of a guest case
  MUST likewise carry no contact value.
- **FR-074**: A closed guest case reopened before its erasure MUST no longer be due; the period MUST
  restart from its next close. An erased case MUST stay erased.
- **FR-075**: Anonymising a customer account MUST NOT touch guest cases that merely share its e-mail
  address; the operator documentation MUST say so and point to the manual erasure.

**Off state (G9)**

- **FR-080**: While `returns` is off, every guest surface — the choice on the returns area, the
  verification page and links, the form, the submission, the tracking page and its downloads — MUST
  behave as if never installed, and no guest e-mail MUST be sent; switching it back on MUST restore
  them unchanged, without losing a case, a link or a setting.

**Common**

- **FR-090**: Every new storefront, e-mail and admin string MUST ship in English and Polish; every
  refusal MUST reach the guest as a sentence in the request's language.
- **FR-091**: Filing a guest case, a guest's comment or file, sending a new tracking link, erasure and
  every setting change MUST be recorded in the audit log through the same path as every other
  returns write; the actor of a guest's own action MUST be recorded as a guest, never as a customer.
- **FR-092**: The new operator capabilities (erasure, new tracking link) MUST be registered
  as admin permissions and, where they add an admin action, be reachable as the module's other case
  actions are; no new admin screen is introduced.
- **FR-093**: The operator documentation of `returns` MUST describe guest complaints, the tracking
  link, retention and erasure, and the scoped-admin behaviour, in English and Polish.

### Key Entities *(include if feature involves data)*

- **Guest verification** — a request to verify an e-mail address for a sales channel: the address
  (kept at most 7 days), when the link was sent, when it expires, whether it was used. Belongs to no
  customer or organization.
- **Guest session** — what an opened verification link starts: the verified address, the channel,
  when it expires; it owns the files uploaded in it until they are filed.
- **Return case** — gains: *guest* (derived: no customer account, hence no organization); when the
  contact address was verified; its current tracking link and when that link stops working; when
  its guest data falls due for erasure. Keeps every 180 field; a guest case is always off-platform.
- **Case comment** — gains a *guest* author, beside customer and operator.
- **Returns settings** — gain *Complaints from guests* (per channel, off) and the guest-data
  retention period (global, 90 days).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor who receives the link within a minute completes the verification and a
  complaint for one product with one photo and one proof of purchase in under 6 minutes, e-mail
  delivery excluded.
- **SC-002**: For any two addresses — one with an account, one without, one rate-limited — the
  verification page's answers are identical; no observer can tell from any guest page whether an
  address has an account or cases.
- **SC-003**: 0 guest cases are visible to, counted for, exportable by or notify an administrator
  restricted to a set of organizations; every direct request by such an administrator answers as for
  a missing case.
- **SC-004**: 0 guest cases are ever attributed to a customer account or an organization.
- **SC-005**: Every guest case receives exactly one confirmation carrying a working tracking link,
  and every later customer e-mail about it carries the same (current) link.
- **SC-006**: Every guest case closed longer than the retention period has no contact data, address
  or file after the next daily maintenance in which the module is on.
- **SC-007**: No expired, replaced, erased or guessed tracking link shows anything but the neutral
  page.
- **SC-008**: With the module off, 100% of guest addresses answer as not found and 0 guest e-mails
  are sent.
- **SC-009**: The share of complaints about products bought elsewhere arriving by e-mail or phone
  instead of through the platform falls after the setting is turned on (measured by the operator
  against the 90 days before).

## Assumptions

- **Supersedes one 180 assumption, for this path only.** `specs/180-off-platform-complaints/`
  assumed *signed-in customers only*, giving every case an organization. This feature introduces a
  case with no account and no organization, on the reasoning of the `forms` precedent: a guest who
  bought elsewhere is not a transacting customer of the platform, the request runs in the platform's
  explicit mode for anonymous traffic, and an organization-restricted read can never match a case
  with no organization. The plan MUST record the architect's Principle XI review (classification of
  every affected record, the together-absent rule, the scoped-admin answer, cross-tenant tests).
- **Clauses** are those 180 shows for a complaint on the channel; a guest-specific clause (for
  example a separate personal-data notice) is a follow-up. The verification page carries a short
  fixed sentence saying what the address is used for.
- **No cancellation by the guest.** The tracking page offers no *cancel*; the guest asks in a comment
  and the operator acts. Signed-in customers keep their cancel.
- **Retention is configurable, the link expiry fixed.** How long personal data may be kept is the
  shop's legal judgement (it varies with jurisdiction and with claim-limitation periods), so the
  retention period is a setting; the link expiry is a convenience bound with no such variance, so it
  is a fixed default. The tracking link never outlives the data.
- **Contact data in the shop's e-mail.** The *new case* e-mail names the guest only; the rest is read
  in the admin, so less personal data lands in mailboxes the platform cannot erase.
- **Replacement shipments** for a guest case go to the ship-back address the guest gave; whether
  the platform's shipment records can hold a recipient with no organization is for the plan.
- **No customer notification centre or push** for guests (they have no account); e-mail only.
- **Limits** (60-minute verification link, 24-hour guest session, 7-day verification record, 90-day
  link expiry and retention, 30–3 650-day range) are defaults chosen here; the plan records the rate
  limits' figures and rationale.

## Out of scope (possible follow-ups)

- **Path A**: a guest return or complaint against a platform order (order number + e-mail lookup).
- **Guest returns** (withdrawal) of any kind.
- **Manual *attach to customer*** by an operator, moving a guest case into an account.
- **Any account creation**, including a lightweight or passwordless account.
- **Guest-specific clauses** and a *resend my links* self-service for guests.
