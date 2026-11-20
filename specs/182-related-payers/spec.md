# Feature Specification: Related payers

**Feature Branch**: `feat/182-related-payers`
**Created**: 2026-11-18
**Status**: Draft — owner rulings RP-1 to RP-5 recorded 2026-11-18; second batch RP-6 to RP-10
(one merge request; Q-1 to Q-3 answered; per-link commercial terms) and RP-11 (A-16 confirmed)
the same day; plan accepted with RP-12 and RP-13 the same day; RP-14 (VAT rate and display mode
in a payer's-terms context) after the Phase 0 pricing spike, RP-15 (the validity window as
instants) after Phase 1, RP-16 (checkout details) after Phase 2, the same day, and RP-17 (payer visibility details) after
Phase 3, RP-18 (Buying for details) after Phase 4, RP-19 (Phase 4 follow-ups) and RP-20 (Phase 5 follow-ups), 2026-11-19, and
RP-21 (Phase 6 follow-ups) the same day, and RP-22 (the cart's *Paid by* wording) on 2026-11-20. Remaining assumptions stand as
written. No clarification markers remain. `plan.md` and `tasks.md` written.
**Input**: Owner request (translated from Polish): *"Organization X places
an order, but a different Organization Y in the store pays for it — for example X delivers on a
tender run by investor Y, and Y pays. X picks Y's billing data at checkout. A generic Core feature;
a deployment overlay will later add a project's investor as a payer automatically, so it needs a
port."*

**Related**: `specs/170-organization-roles/` (the customer-side permission vocabulary this feature
declares into, FR-020 to FR-025 there), `specs/177-tax-id-scope/` (a tax ID may match more than one
Organization), `specs/154-sales-channel-access/` (Organization ↔ sales-channel access), issue #759
(the free-text billing company override at checkout), feature 056 organization hierarchy and
roll-up (pre-migration; `packages/modules/organizations/docs/organization-hierarchy.md`), the
company-registry lookup in `packages/modules/organizations/src/backend/registry-lookup/`.

## Context

Today an order is bought **and** paid by one Organization. The buyer's Organization is the order's
tenant (`organizationId`), and every money decision follows it: placement refuses a billing address
that is not the buyer's own (`addressRead.findById(ctx.organizationId, req.billingAddressId, …)` in
`packages/modules/orders/src/backend/services/order-service.ts`, both in `placeOrder` and in the
checkout preview), tax is computed from the buyer's `vatStatus` and the billing address country,
the credit reservation is taken on the buyer's credit limit
(`packages/modules/credit_limits/src/backend/services/credit-limit-service.ts`), the payment and
delivery method allow-lists are the buyer's (`assertMethodsAllowedForOrganization`, backed by
`organization-payment-method-link` / `organization-delivery-method-link` in
`packages/modules/organizations/src/backend/entities/`), and the invoice's `organizationId` and
`buyerSnapshot` (`packages/modules/invoices/src/backend/entities/invoice.entity.ts`) and the
invoice-ledger client mapping (`packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-client-map.entity.ts`)
all name the buyer.

The only way a buyer can put somebody else's company on the paperwork today is the free-text
override from issue #759 — `billingCompanyName` / `billingTaxId` on `placeOrderRequestSchema`
(`packages/contracts/src/orders.ts`), applied by `billingCompanyData` in `order-service.ts` and
offered in `storefront/components/checkout/AddressSection.tsx`. It changes the printed name and tax
ID and nothing else: tax, credit, payment terms and the invoice's tenant stay the buyer's, nobody
checks that the named company agreed, and the named company cannot see the order.

In construction and project supply this is the normal case, not the exception. A contractor (X)
orders the goods, has them delivered to its site, and the project's investor (Y) — itself a
customer of the store — pays and receives the invoice. The investor wants to see what is being
bought on its account; the contractor must not be able to name any company it likes as payer.

This feature adds a **related payer**: a consented, managed link from a buyer Organization X to a
payer Organization Y in the same store. When X places an order with Y as payer, the order stays
X's (X bought it, X receives it), while **billing follows Y**: Y's billing address, Y's tax
treatment, Y's credit limit, Y's invoice. Y's authorised users can see the orders they pay for.

The organization hierarchy (`parentId` / `path`, and `customer_accounts.subtreeRollupEnabled`
widening order scope to a subtree in `packages/modules/orders/src/backend/services/order-access-service.ts`)
is **a different concept** and is not reused: a payer link is not a parent/child relation, it is
not transitive, and it grants visibility only to orders that name the payer.

## Vocabulary

- **Buyer (X)** — the Organization that places the order. It stays the order's Organization.
- **Payer (Y)** — the Organization named on an order as the party that pays and is invoiced.
- **Payer link** — the X → Y relation that allows X to name Y as payer. Directional: X → Y does not
  imply Y → X.
- **Payer request** — a proposal to create a payer link, started by X ("please pay for us") or by Y
  ("we will pay for you"), which becomes a link only once accepted.
- **Approver** — whoever must accept a payer request: the counterparty's users holding the approving
  permission, the platform operator, or both in sequence, per the channel setting (FR-040).
- **Operator** — an Admin UI user (store staff).

## Owner rulings *(binding; recorded 2026-11-18, not to be reopened by this feature)*

- **RP-1 — Payers are Organizations of the store; the capability is per channel and toggleable.**
  A payer is another Organization in the same store, linked X → Y. The capability is switched on
  per sales channel by a setting that defaults to off. The module is operator-toggleable
  (Principle XVII); while it is off nothing of it is observable — at checkout, in the account, in
  the Admin UI.
- **RP-2 — The payer sees the orders it pays for.** An order placed by X with payer Y is visible to
  Y's users holding a new organization permission *"View orders we pay for"* (*Administrator*
  implicitly). This is a cross-tenant read and MUST be an explicit, sanctioned read path — never a
  widening of the tenant filter (Principle XI).
- **RP-3 — VAT, credit and invoice follow the payer.** Tax is derived from Y's VAT status and the
  chosen Y billing address's country; the credit reservation is taken on Y; the invoice's buyer
  data and the invoice-ledger client mapping are Y's. The order keeps X as its Organization (the
  buyer) and gains a nullable payer reference plus a payer snapshot.
- **RP-4 — Links are created by the operator, by automation through a port, or by request between
  the two Organizations,** with the states, settings, permissions and anti-enumeration guarantees
  set out in FR-020 to FR-051.
- **RP-5 — A payer and the free-text billing override are mutually exclusive (variant A).** With a
  payer chosen, the company fields at checkout are read-only and show Y's data, and the backend
  refuses a placement carrying both a payer and an override. With no payer chosen, checkout is
  unchanged, including the B2C "company invoice" opt-in.

*Second batch (recorded 2026-11-18, answering the first draft's Q-1 to Q-3):*

- **RP-6 — One merge request.** The whole feature is delivered in a single merge request. The user
  story priorities below order the implementation inside it; they are not separate deliveries.
- **RP-7 (Q-1) — Refunds go to the payer.** A refund arising from a return or complaint on an order
  with a payer is made to the payer.
- **RP-8 (Q-2) — The invoice belongs to the payer.** The invoice of an order with a payer is the
  payer's document: it is in the payer's invoice list and the invoice ledger handles it as the
  payer's. The buyer may download it, read-only, from its own order.
- **RP-9 (Q-3) — The payer's payment-method allow-list applies** when a payer is chosen.
- **RP-10 — Commercial terms are a per-link setting, `buyer` (default) | `payer`.** They govern the
  price list and customer-group pricing, promotions and the minimum order value. Under `buyer`
  everything is as today and the payer may be chosen at checkout. Under `payer` prices, promotions
  and the minimum order value are resolved for the payer; because prices must be known before
  checkout, the payer is chosen **on the cart** ("Buying for: our company / Y"), switching it
  reprices the cart and its promotions, and the cart shows what changed. Sales-channel scoping
  (Principle XII) is unchanged: only price lists available in the channel apply, and only the
  Organization the price is resolved for changes. A change of the setting is audited like every
  other link field. Delivery methods stay the buyer's.
- **RP-11 (A-16) — Only an operator or the port sets a link to the payer's commercial terms.** A
  link created by request or invitation starts on the buyer's terms, and neither the buyer nor the
  payer can change the terms from the account (FR-119).

*Plan-phase confirmations (owner, 2026-11-18, accepting `plan.md`):*

- **RP-12 — "Payers" is a section, not a tab.** On the organization card it is a section in the
  card's `organization.detail.after` panel stack; the card gets no tab strip (`research.md` R-7).
  "Payers tab" elsewhere in this spec means that section.
- **RP-13 — No new storefront invoice list.** The payer's users see a paid order's invoices under
  *Orders we pay for*; the Admin UI invoice list and the invoice ledger list the invoice under the
  payer (`research.md` R-11). RP-8's "its invoice list" means those.

*Implementation-phase ruling (owner, 2026-11-18, after the Phase 0 pricing spike, `research.md` R-4):*

- **RP-14 — In a payer's-terms context the VAT rate is the payer's, the display mode the
  buyer's.** The VAT rate a listing, search hit, product page or cart derives a gross price from is
  the payer's (Y's VAT status and country), consistent with checkout (FR-064). The price display
  mode (`gross_only` | `net_only` | `both` | `none`) stays the buyer's: X's organization-level
  override, else the settings default; product and category overrides keep their precedence as
  today. Y's own organization-level mode is not read, so a `none` there does not hide prices from
  X — accepted because only an operator or the port can put a link on the payer's terms (RP-11).
- **RP-15 — The validity window is two instants, not two dates.** A link stores `validFrom` and
  `validTo` as timestamps. The Admin UI picks calendar dates and converts them in the operator's
  browser time zone — *from* to the start of that day, *to* to the end of it; the port and the API
  take instants. The backend compares the current instant with them and needs no store time zone.
- **RP-16 — Checkout details with a payer** (owner, after Phase 2). (a) A request naming a payer
  together with a billing override is refused by the request validation: `400 VALIDATION_FAILED`
  whose issue carries `payer_billing_override_conflict` (FR-062). (b) When the buyer switches
  *Paid by*, the checkout page recomputes its totals through the existing order preview with the
  payer, so the net, VAT and gross shown equal what placement writes (FR-064). (c) The credit-limit
  payment method is offered for a payer exactly as it is for the buyer itself today — hidden when
  the payer holds no grant or its available credit is below the cart total — reading the payer's
  credit through a port under system scope (FR-065, FR-066).
- **RP-17 — Payer visibility details** (owner, after Phase 3). (a) With the module **off**, the
  platform's `503 MODULE_DISABLED` answers the paid-order routes, as every module route
  (Principle XVII); FR-072's indistinguishability holds while the module is on. (b) The payer's
  e-mails are two, both behind the link's `notify_payer_on_orders`: the placement e-mail
  (`related_payer_order_placed`) and a cancellation e-mail (`related_payer_order_cancelled`), each
  with English and Polish defaults; no other status e-mail goes to the payer. (c)
  `GET /api/v1/account/paid-orders` without `view_paid_orders` answers `404`, as the detail does.
  (d) A customer account carries no language, so the payer's e-mails are written in the store's
  default language (the cart-approval precedent). (e) The admin invoice list gains an organization
  filter control, which lists a paid order's invoice under the payer (FR-080).
- **RP-18 — *Buying for* details** (owner, after Phase 4). (a) `pricedAudienceOf` and
  `providePricingSubjectResolver` are published from `@endora-commerce/platform/http` (research
  R-4). (b) Promotions and the minimum order value are evaluated for the payer in a payer's-terms
  context in this merge request (FR-112), and the repricing summary names the promotions added and
  removed (FR-113). (c) `PUT /api/v1/cart/buying-for` is guarded by `carts.create`; the policy port
  checks `related_payers.order_with_payer`. (d) Choosing *Buying for* writes no audit entry: it is
  the buyer's working state, and the order records the terms it was placed on (FR-117).
- **RP-19 — Phase 4 follow-ups** (owner). (a) Search hits and type-ahead get a payer's-terms case in
  the search suite, which runs where Meilisearch does (the nightly suite on `master`). (b) The
  *Buying for* switch summary evaluates promotions exactly as the cart does — the same totals basis,
  line VAT included — so a minimum-spend promotion near its threshold is listed identically. (c) On
  the payer's terms a promotion's use is recorded against the payer (FR-112).
- **RP-20 — Phase 5 follow-ups** (owner, 2026-11-19). (a) The daily request limit (FR-046) starts
  "today" at midnight in the **default store's time zone**, not UTC. No platform-wide store time zone
  exists, so the module declares `related_payers.time_zone` (IANA name, default `Europe/Warsaw`, the
  `tasks.time_zone` / `returns.time_zone` precedent) and reads it for the system-default sales
  channel, so every channel counts the same day. (b) The four request/revoke Commands stay
  **public** hookable actions in `@endora-commerce/contracts` (`RELATED_PAYERS_HOOKABLE_ACTIONS`).
  (c) **Expiry notifies the requester** — by e-mail and in the account, delivered from the
  after-commit outbox like the other notifications, in the store's default language; **withdrawal
  notifies nobody**. (d) The payer's list of the buyers it pays for (`GET /api/v1/account/payees`)
  shows each buyer's tax ID.
- **RP-21 — Phase 6 follow-ups** (owner, 2026-11-19). (a) The module setting
  `related_payers.time_zone` (RP-20 a) **stays** until a platform-wide store time zone exists; the
  module then reads that instead. (b) The `invite` no-account mode carries an **accepted residual
  risk**: a sender who types their **own** address as the contact e-mail receives the invitation to
  register, and so learns that the tax ID has no account in the store — which FR-041 otherwise hides.
  The default mode is `admin`, which has no such channel; the risk is documented beside FR-041 and in
  the operator documentation of the channel settings. (c) `request.expire` and `request.route` stay
  **public** hookable actions, like the four of RP-20 (b). (d) *Create organization* from the operator
  queue requires the new Organization's tax ID to equal the request's. (e) Withdrawing a payer's
  invitation stays available while *payer may invite buyers* is off, so an invitation sent before the
  setting was switched off can still be taken back.
- **RP-22 — The cart's choice reads *Paid by*** (owner, 2026-11-20, after manual testing). The
  storefront labels the cart's *Buying for* control **"Płaci"** / **"Paid by"**, the same word as
  the checkout's payer choice: the cart lets the member choose who pays — their own Organization or
  a payer on its own commercial terms. *Buying for* stays the spec's name for the cart context
  (FR-110 to FR-117, the `buyingFor` API field). The control lists only payers whose link is on the
  payer's terms; FR-110's optional buyer's-terms shortcut is not offered, so a payer on the buyer's
  terms is chosen at checkout (FR-060), which lists exactly those. The control is offered on a cart
  with lines, where the switch has prices to change.

## User Scenarios & Testing *(mandatory)*

Stories are ordered by the value they deliver alone, which is also the implementation order inside
the one merge request (RP-6). US1 + US2 are the core: an operator can link a payer and a buyer can
order on it with billing following the payer. US3 makes it safe for the payer; US9 lets a link
carry the payer's commercial terms; US4 to US7 remove the operator from the loop.

### User Story 1 — An operator links a payer to a buyer (Priority: P1)

An operator opens buyer X's Organization card, goes to **Payers**, and adds Organization Y — an
existing Organization picked from a search, or a new one created on the spot from its tax ID with
the company data pre-filled from the registry lookup. For each link the operator chooses whether
it is active, which of Y's billing addresses X may use (all of them, or one), an optional
validity window, and whose commercial terms apply (the buyer's by default, or the payer's — US9). A link the operator creates is active immediately; no consent from X or Y is
asked.

**Why this priority**: Without a link nothing else in the feature has anything to act on, and the
operator path needs no customer-side UI, so it is the shortest route to a usable payer.

**Independent Test**: With the module on and the capability enabled on a channel, create a link
from X's card, then read it back on the card and in the audit log; deactivate it and see it marked
inactive; delete nothing and see it still listed.

**Acceptance Scenarios**:

1. **Given** Organizations X and Y exist and are approved, **When** an operator with the payer
   management permission adds Y as a payer on X's card, **Then** the link is listed as *active*
   with "all billing addresses", no validity window and the buyer's commercial terms, and the
   audit log records the creation with the operator as actor.
2. **Given** the operator types a tax ID that matches no Organization, **When** they choose
   *Create a new organization*, **Then** the form is pre-filled from the registry lookup, the new
   Organization is created *approved*, the link is active immediately, and the operator may
   optionally send an invitation to a first user of the new Organization through the existing
   Organization invitation flow.
3. **Given** a link X → Y, **When** the operator restricts it to one of Y's billing addresses and
   sets a validity window, **Then** only that address is offered to X at checkout, and only inside
   the window.
4. **Given** an operator without the payer management permission, **When** they open X's card,
   **Then** the Payers section is read-only (with the view permission) or absent (without it).
5. **Given** the module is switched off, **When** the operator opens X's card, **Then** there is no
   Payers section, no palette action and no settings group for it.

---

### User Story 2 — A buyer places an order that its payer pays for (Priority: P1)

A user of X whose role allows ordering with a related payer reaches checkout on a channel where
the capability is enabled. Next to the billing address they choose *Paid by* and pick Y from X's
active payers, then one of Y's allowed billing addresses. The company name and tax ID shown are
Y's and cannot be edited. The totals are recomputed for Y's tax treatment, and the payment methods
offered are those Y may use. The order is placed under X, with Y as payer: Y's credit is reserved,
the invoice will be made out to Y, and X's delivery address and delivery methods are unchanged. On
a link with the buyer's commercial terms (the default) X's prices and promotions are unchanged;
a link with the payer's terms is chosen on the cart instead (US9).

**Why this priority**: This is the feature. Everything else is how the link comes to exist.

**Independent Test**: With a link created as in US1, place an order as a permitted X user with Y
as payer, and verify on the order: buyer X, payer Y, billing snapshot Y, tax computed from Y's VAT
status and Y's billing country, credit reserved on Y and not on X, invoice made out to Y.

**Acceptance Scenarios**:

1. **Given** an active link X → Y valid today and a permitted X user, **When** they open checkout,
   **Then** they can choose between *our organization* and Y as payer; choosing Y shows only Y's
   allowed billing addresses and shows Y's company name and tax ID read-only.
2. **Given** Y is a VAT-exempt Organization and X is a VAT payer, **When** the X user selects Y as
   payer, **Then** the checkout totals are recomputed with Y's VAT treatment and the placed order
   carries the same totals the preview showed.
3. **Given** Y's credit limit has less available than the order total and the chosen payment method
   draws on credit, **When** the X user places the order, **Then** placement is refused for
   insufficient credit exactly as it would be for Y ordering itself, and X's own credit limit is
   untouched.
4. **Given** an X user whose role lacks *"Place orders with a related payer"*, **When** they open
   checkout, **Then** no payer choice is offered, and a placement request naming a payer is
   refused.
5. **Given** a placement request that names a payer **and** carries a billing company name or tax
   ID override, **When** it is submitted, **Then** it is refused with a validation error naming the
   conflict, and no order is created.
6. **Given** a checkout session in which Y was chosen, **When** the link is revoked, deactivated or
   leaves its validity window before the order is placed, **Then** placement is refused with a
   message saying the payer is no longer available, and nothing is reserved or written.
7. **Given** the capability is disabled on the request's channel, or the module is off, **When** an
   X user opens checkout, **Then** there is no payer choice and checkout behaves exactly as today;
   a placement request naming a payer is refused.
8. **Given** no payer is chosen, **When** an X user checks out, **Then** behaviour is identical to
   today, including the free-text billing override and the B2C company-invoice opt-in.

---

### User Story 3 — The payer sees the orders it pays for (Priority: P1)

A user of Y holding *"View orders we pay for"* opens their account and finds, separate from Y's own
orders, a list of orders other Organizations placed with Y as payer: who placed them, when, the
lines, the totals, the status, and the invoices made out to Y. The view is read-only.

**Why this priority**: RP-2 makes it a condition of the feature, and a payer that cannot see what
it is paying for will not consent to links.

**Independent Test**: Place an order X → payer Y; sign in as a Y user with and without the
permission, and as a user of an unrelated Organization Z; check what each sees, including that
Z's and the unpermitted user's answers are indistinguishable from "no such order".

**Acceptance Scenarios**:

1. **Given** an order placed by X with payer Y, **When** a Y user with *"View orders we pay for"*
   opens *Orders we pay for*, **Then** the order is listed with the buyer's name, and its detail
   shows lines, totals, status, the billing snapshot and Y's invoice documents.
2. **Given** the same order, **When** a Y user without the permission, or any user of an unrelated
   Organization, requests it by id, **Then** the answer is the same as for an order that does not
   exist.
3. **Given** the link X → Y is later revoked, **When** a permitted Y user opens the list, **Then**
   orders placed while the link was active are still listed; no new ones appear.
4. **Given** a Y user viewing such an order, **When** they look for buyer actions (cancel, reorder,
   start a return, edit), **Then** none is offered and the corresponding API calls are refused.
5. **Given** an order placed by X with payer Y, **When** an X user who may see the order today opens
   it, **Then** it shows *Paid by Y* with Y's billing snapshot, and X's own order list is otherwise
   unchanged.

---

### User Story 4 — A buyer asks a company to become its payer (Priority: P2)

A user of X holding *"Manage payers"* opens **Payers** in the account and requests a new payer by
entering the company's exact tax ID, a contact e-mail and an optional comment. The confirmation is
the same whatever the tax ID belongs to. If the tax ID belongs to an eligible Organization Y, Y's
users holding *"Approve payer requests"* are told by e-mail and in their account and can accept or
reject; the contact e-mail X typed is not used. X sees the request as *pending* until it is
accepted (link active) or rejected (with the reason, if one was given).

**Why this priority**: It removes the operator from the common case, but US1 already covers the
need, so it can follow the MVP.

**Independent Test**: Submit two requests — one with Y's tax ID, one with a tax ID matching no
Organization — and verify both replies, both statuses visible to X and the outbound messages; then
accept the first as a Y approver and place an order on the resulting link.

**Acceptance Scenarios**:

1. **Given** a permitted X user, **When** they request a payer by tax ID, **Then** the reply (status,
   body and message) is identical whether the tax ID belongs to an existing Organization, to none,
   or to one that is not eligible, and the request is listed for X as *pending*.
2. **Given** the tax ID belongs to Y and the channel's approval mode is `payer`, **When** the request
   is submitted, **Then** every Y user holding *"Approve payer requests"* receives an e-mail and an
   in-account notification, and no message is sent to the contact e-mail.
3. **Given** a Y approver accepts, **Then** the link X → Y becomes active (all billing addresses, no
   validity window, buyer's commercial terms), X's requester and X's payer managers are notified, and the audit log records
   the acceptance with the Y user as actor.
4. **Given** a Y approver rejects with a reason, **Then** the request is *rejected* for X with that
   reason shown, and no link exists.
5. **Given** the approval mode is `admin`, **When** the request is submitted, **Then** it goes to the
   operator queue and Y is not asked; under `payer_then_admin` Y's acceptance moves it to the
   operator queue and the link becomes active only when the operator approves.
6. **Given** approval mode `payer` and Y has no user holding *"Approve payer requests"* (or no
   active user at all), **When** the request is submitted, **Then** it goes to the operator queue.
7. **Given** X has sent the channel's daily maximum of requests and invitations today, **When** an X
   user sends another, **Then** it is refused with a rate-limit error that is the same whether or
   not the tax ID exists.
8. **Given** a pending request, **When** its expiry period elapses without a decision, **Then** it
   becomes *expired* and X sees it as such.

---

### User Story 5 — The requested payer has no account yet (Priority: P2)

X requests a payer whose tax ID matches no eligible Organization. What happens depends on the
channel's *payer without an account* setting: under `admin` (default) the request enters the
operator queue, where the operator creates the Organization, sends an invitation, or rejects with a
reason shown to X; under `invite` the contact e-mail receives an invitation to register with the
tax ID pre-filled, and once the new Organization has registered and been approved the request
appears to its approvers. An Organization is never created automatically from an invitation.

**Why this priority**: The first payer a contractor brings is often not a customer yet; without
this the request in US4 dead-ends in the operator queue, which `admin` mode already handles.

**Independent Test**: In `invite` mode, request an unknown tax ID; follow the invitation, register,
have the operator approve the registration, and see the request waiting for the new Organization's
approver. In `admin` mode, see the request in the operator queue and exercise each of the three
operator outcomes.

**Acceptance Scenarios**:

1. **Given** mode `admin`, **When** X requests an unknown tax ID, **Then** the request appears in the
   operator queue with the tax ID, the contact e-mail and X's comment; the reply to X is the one
   from US4 scenario 1.
2. **Given** that queue entry, **When** the operator chooses *Create organization*, **Then** the
   creation form is pre-filled from the registry lookup, the Organization is created approved and
   the link becomes active; **When** they choose *Send invitation*, **Then** the `invite` flow below
   starts; **When** they choose *Reject* with a reason, **Then** X sees *rejected* with that reason.
3. **Given** mode `invite`, **When** X requests an unknown tax ID, **Then** the contact e-mail
   receives a registration invitation in the channel's language with the tax ID pre-filled, and
   nothing is created.
4. **Given** that invitation, **When** the invitee registers with the same tax ID and the
   registration is approved by the existing registration approval, **Then** the payer request is
   attached to the new Organization and enters approval as in US4 (scenario 2 onward).
5. **Given** that invitation, **When** it expires unused, **Then** the request becomes *expired*; a
   later registration with that tax ID attaches nothing.
6. **Given** a registration is rejected by the operator, **Then** the request stays *pending* until
   it expires; X sees no difference.

---

### User Story 6 — A payer invites a buyer (Priority: P3)

A user of Y holding *"Approve payer requests"* invites a buyer: they enter X's exact tax ID and a
contact e-mail, and X's users holding *"Manage payers"* accept or reject. The flow mirrors US4 with
the roles reversed. The channel setting *payer may invite buyers* (default on) allows it; the
operator is involved only under `payer_then_admin`.

**Why this priority**: The investor-initiated direction is real but less common than the
contractor asking; it reuses everything US4 builds.

**Independent Test**: As a Y approver, invite X by tax ID; accept as an X payer manager; place an
order on the link. Switch the setting off and see the invite action disappear and its API refuse.

**Acceptance Scenarios**:

1. **Given** the setting is on, **When** a Y approver invites X by tax ID, **Then** the reply is
   identical whether X exists or not, and X's users holding *"Manage payers"* are notified by e-mail
   and in their account.
2. **Given** an X payer manager accepts, **Then** the link X → Y becomes active; under
   `payer_then_admin` it goes to the operator queue first.
3. **Given** the setting is off on the channel, **When** a Y user looks for the invite action,
   **Then** it is absent and the API refuses it.

---

### User Story 7 — Either side, or the operator, revokes a link (Priority: P2)

A user of X holding *"Manage payers"*, a user of Y holding *"Approve payer requests"*, or an
operator revokes an active link. From then on X cannot place new orders with Y as payer; orders
placed earlier keep Y as payer and stay visible to Y. The other side is notified.

**Why this priority**: A payer must be able to withdraw consent without calling the store; this is
the counterweight to US4 and US6 and must ship with them.

**Independent Test**: Revoke a link from each of the three sides in turn and check: no payer
choice at checkout, placement naming the payer refused, earlier orders still visible to Y, the
other side notified, the audit entry naming the actor.

**Acceptance Scenarios**:

1. **Given** an active link, **When** a permitted Y user revokes it, **Then** the link is *revoked*,
   X's payer managers are notified, and X's next checkout offers no Y.
2. **Given** a revoked link, **When** the operator opens X's card, **Then** the link is shown as
   revoked with who revoked it and when; a new link to Y requires a new request or an operator add.
3. **Given** an operator deactivates (not revokes) a link, **Then** it can be reactivated by an
   operator; a revoked link cannot.

---

### User Story 8 — Automation adds and removes payers (Priority: P2)

A deployment's overlay module (for example one that adds a project's investor as payer of every
contractor on the project) adds and removes payer links through a published port. Each write is
audited with an automation actor and the overlay's stated source, distinct from an operator or a
customer user.

**Why this priority**: RP-4 names it, and the motivating deployment needs it, but no core surface
depends on it.

**Independent Test**: From a test-only module, call the port to add X → Y with a validity window,
then remove it; read the audit log; switch the module off and see the port answer
module-disabled.

**Acceptance Scenarios**:

1. **Given** the module is present, **When** a caller adds a link through the port with a source
   label, **Then** the link is active and the audit entry shows an automation actor with that
   source.
2. **Given** the same add is repeated, **Then** no duplicate link is created and the call succeeds.
3. **Given** the module is off, **When** the port is called, **Then** it answers the platform's
   module-disabled error and writes nothing.

---

### User Story 9 — A buyer shops on the payer's commercial terms (Priority: P1)

On some projects the payer has negotiated the prices: the investor buys the materials at its own
price list and the contractor only places the orders. An operator sets the link X → Y to the
payer's commercial terms. A permitted X user then picks, on the cart, **Buying for: our company /
Y**. Choosing Y reprices the whole cart for Y — Y's price lists and customer-group prices,
promotions Y is eligible for, the minimum order value as it applies to Y — and the cart shows what
changed. Product listings, the product page and search show prices in the same context while the
cart is in it. At checkout the payer is already fixed by the cart.

**Why this priority**: RP-10 makes it part of the feature, and for links that carry it an order on
the buyer's prices would bill the payer at the wrong price, so it ships with US2.

**Independent Test**: Give X and Y different price lists on the same channel and a promotion only Y
is eligible for; set the link to the payer's terms; put products in X's cart, switch *Buying for*
to Y and back, and verify each repricing, the change summary, the listing prices and that the
placed order carries exactly the prices the cart showed.

**Acceptance Scenarios**:

1. **Given** a usable link X → Y with the payer's terms and a permitted X user, **When** they open
   the cart, **Then** a *Buying for* choice lists their own Organization and Y.
2. **Given** a cart of three lines, **When** the user switches *Buying for* to Y, **Then** every line
   is repriced from the price lists available on the channel for Y, promotions are re-evaluated for
   Y, and the cart shows for each line the price before and after and which promotions were added
   or removed.
3. **Given** the cart is in Y's context, **When** the user browses listings, search or a product
   page on the same channel, **Then** prices shown are Y's, and a price list not available on the
   channel never applies, for Y or for X.
4. **Given** a line whose product has no price for Y on the channel, **When** the user switches to
   Y, **Then** the line stays in the cart marked as unpriced in this context, the cart says so, and
   the order cannot be placed with it — exactly as an unpriced line is handled today.
5. **Given** the cart is in Y's context, **When** the user checks out, **Then** the payer is Y,
   fixed, with Y's allowed billing addresses; changing payer means returning to the cart.
6. **Given** the cart is in Y's context, **When** the link is revoked, deactivated, leaves its
   validity window, or its terms are changed to the buyer's, **Then** the next read of the cart
   returns it to the buyer's own context, reprices it and tells the user why; a placement already
   under way is refused with nothing written.
7. **Given** the cart is in Y's context, **When** the order is placed, **Then** the minimum order
   value is checked as it applies to Y, the credit reservation is on Y (US2), and the order's prices
   equal the cart's.
8. **Given** a link with the buyer's terms, **When** a permitted X user opens the cart, **Then** the
   *Buying for* choice may be offered as a shortcut for the checkout payer, but choosing it changes
   no price.
9. **Given** an operator changes a link's commercial terms, **Then** the change is in the audit log
   with before and after values, like any other link field.

---

### Edge Cases

- **X names itself.** A request or link from X to X is refused with a validation error (X's own tax
  ID reveals nothing).
- **A link already exists.** Requesting a payer X already has active returns the same reply as any
  request and creates no duplicate; X sees its existing link. An operator or port add of an
  existing active link is idempotent; of an inactive one, reactivates it only when it is the
  operator.
- **The tax ID matches several Organizations** (`specs/177-tax-id-scope/`, scope `per-tree-root`).
  The request goes to the operator queue, where the operator picks the Organization. The reply to
  the requester is unchanged.
- **Personal (B2C) Organizations.** A personal Organization can neither be a payer nor have one. It
  carries no tax ID (`specs/177-tax-id-scope/`), so no request can match one; the checkout payer
  choice is never offered to a personal Organization, and an operator or port add involving one is
  refused.
- **Y is blocked, rejected, not yet approved or archived.** Y is not offered at checkout and
  placement naming it is refused; its links keep their state and become usable again when Y is
  approved / unblocked. A request whose tax ID matches only such an Organization is *ineligible*:
  it goes to the operator queue, whatever the no-account mode, with the same reply to the sender.
- **Y's allowed billing address is removed or archived.** A link restricted to that one address has
  no usable address; Y is not offered at checkout until an operator changes the restriction.
- **Y has no billing address at all.** Y is not offered at checkout.
- **X and Y are in the same Organization tree.** Allowed; the link is independent of the hierarchy,
  and roll-up visibility rules are unchanged by it.
- **Y's credit limit is inherited from Y's parent** (feature 056). The reservation follows Y's
  credit owner under the existing inheritance rule, exactly as for an order Y places itself.
- **The validity window.** Outside it the link behaves as inactive for new orders; the window is
  judged at preview and again at placement against the current instant, both ends inclusive
  (RP-15: the Admin UI turns the operator's *from* / *to* dates into the start / end of those days).
- **A cart awaiting approval** (`specs/170-organization-roles/` OR-3). On a buyer's-terms link the
  payer is chosen by the person who places the order at checkout; the permission is checked against
  that person. A cart in a payer's-terms context carries the payer into approval: the approver sees
  *Buying for Y* and Y's prices, and the person who places it must hold the permission too.
- **Other placement paths** — one-click purchase, the API order intake, reorder and admin order
  creation — do not offer a payer and refuse a request naming one (Assumption A-6). A cart in a
  payer context is not reachable through them.

**Payer's commercial terms (US9)**

- **The link stops being usable while the cart is in Y's context** (revoked, deactivated, outside
  its window, Y blocked, or its terms switched to the buyer's). The cart returns to X's own context
  on its next read, is repriced for X, and shows why; it is never left priced for Y without a
  usable link. A placement that races the change is refused with nothing written.
- **A line has no price for Y.** It stays in the cart, marked unpriced in Y's context; the cart
  cannot be ordered with it, as for any unpriced line today; switching back to X restores X's
  price. The switch itself is never refused because of unpriced lines.
- **A product is not visible to Y.** Catalogue visibility is not part of commercial terms: what X
  may see and buy stays X's. A product that would be visible to X and has a price for Y is
  orderable in Y's context.
- **Promotion codes.** A code applied in X's context is re-evaluated for Y on the switch; a code Y
  is not eligible for is removed and the change summary says so. Switching back re-evaluates it
  for X, but a removed code is not re-applied automatically.
- **The minimum order value** is checked in the cart's context at cart, preview and placement; on
  today's configuration (a global value with a sales-channel override) the outcome for X and Y is
  the same, and the rule is written so a value that varies by Organization is resolved for Y.
- **The credit limit already follows the payer** on every link (RP-3); commercial terms do not
  change it.
- **Y's own access to the channel.** A link with the payer's terms prices for Y on the channel the
  cart is on, using only price lists bound to that channel; whether Y must itself have access to
  that channel (`specs/154-sales-channel-access/`) is decided in `plan.md` (Assumption A-17).
- **Two X users, one payer.** The pricing context belongs to a cart, not to the user or the
  Organization: another X user's cart, and X's other carts, are unaffected.
- **A setting changes while requests are pending.** Approval and no-account settings apply to
  requests created after the change; pending requests finish under the setting they started with.
  Disabling the capability on a channel hides it there at once; links and pending requests are
  kept.
- **The module is switched off with active links and pending requests.** Nothing is deleted;
  pending requests do not expire while it is off (expiry resumes on reactivation, with the elapsed
  time counted), and placed orders keep their payer reference and snapshot as order data.
- **The payer hides its prices, the buyer does not** (RP-14). Y's organization-level display
  mode is `none` and X's is not: in a payer's-terms context X still sees prices (X's mode
  governs), priced for Y and grossed at Y's VAT rate. The reverse — X's mode `none` — hides prices
  and price sorting from X exactly as today. Accepted because only an operator or the port can set
  a link to the payer's terms (RP-11).
- **Concurrent decisions.** Two approvers act on one request at once: exactly one decision wins,
  the other is told the request was already decided.
- **Language.** Messages to Y's users use each recipient's language; an invitation to a contact
  e-mail uses the channel's default language.

## Requirements *(mandatory)*

### Functional Requirements

**Presence and configuration**

- **FR-001**: The capability MUST be delivered as an operator-toggleable module (Principle XVII)
  with an activation default of off. While it is not effectively present: no payer choice at
  checkout, no account screens, no Admin UI section, palette action or settings group, no
  notifications or expiry processing, and its port answers module-disabled.
- **FR-002**: The capability MUST be enabled per sales channel by a setting (global default plus
  channel override, default off). Where it is disabled, every customer-facing surface of it is
  absent on that channel and every customer-facing call naming a payer is refused.
- **FR-003**: The module MUST declare these settings, each with a global value and a sales-channel
  override, in English and Polish: capability enabled (off); approval mode for an existing
  counterparty — `payer` | `admin` | `payer_then_admin` (`payer`); payer without an account —
  `invite` | `admin` (`admin`); payer may invite buyers (on); request / invitation lifetime in days
  (30); maximum requests plus invitations per Organization per day (10, Assumption A-9); and the
  time zone the daily limit's day is counted in (`Europe/Warsaw`, read for the system-default
  channel, RP-20 a).
- **FR-004**: Turning the module off MUST NOT delete or alter links, requests, order payer
  references or settings; turning it on MUST restore them as they were.

**Payer link**

- **FR-010**: A payer link MUST connect exactly one buyer Organization to exactly one other payer
  Organization, both company (non-personal) Organizations. At most one non-revoked link may exist
  per ordered pair.
- **FR-011**: A link MUST carry: state (`active` | `inactive` | `revoked`), allowed billing addresses
  (all of the payer's billing addresses, or exactly one), an optional validity window (from / to,
  each an optional instant, RP-15), commercial terms (`buyer` | `payer`, default `buyer`, RP-10), how it was created
  (operator, automation with source, request, invitation), and who revoked it and when, if
  revoked.
- **FR-012**: A link MUST be usable for a new order only when: the module is present and the
  capability is enabled on the order's channel; the link is `active` and the current instant is
  inside its validity window (both ends inclusive, RP-15); the payer is approved and not blocked; the payer has at least one allowed,
  live billing address.
- **FR-013**: `inactive` MUST be reversible by an operator; `revoked` MUST be terminal. Re-linking a
  revoked pair MUST create a new link through any of the creation paths.

**Operator management (Admin UI)**

- **FR-020**: X's Organization card MUST show a **Payers** section listing X's links (payer, state,
  addresses, window, origin) and, separately, the links in which X is the payer.
- **FR-021**: An operator with the management permission MUST be able to: add an existing
  Organization as payer; create a new Organization from a tax ID with the registry lookup's
  pre-fill, created *approved*, with the link active immediately and an optional invitation of a
  first user through the existing Organization invitation flow; activate / deactivate; revoke;
  change the address restriction, the validity window and the commercial terms.
- **FR-022**: Operator link actions are immediate audited writes; the section MUST carry the
  Admin UI's immediate-action marking and MUST NOT join the card's single Save
  (`specs/conventions/module-admin-surfaces.md` § *Zone-panel editors save once*, item 4).
- **FR-023**: The module MUST provide an operator queue of payer requests awaiting an operator
  decision, with the reason each is there (approval mode `admin`; second step of
  `payer_then_admin`; no eligible approver; no account under mode `admin`; ambiguous tax ID), and
  actions approve, reject with a reason shown to the requester, create Organization (FR-021 pre-fill),
  send invitation, and pick the Organization for an ambiguous tax ID.
- **FR-024**: The module MUST declare its operator permission codes (at least *view payers* and
  *manage payers*), labelled in English and Polish, enforced on its routes, and a command-palette
  action for the operator queue gated on the view code (Principle XVI;
  `specs/conventions/module-admin-surfaces.md`).
- **FR-025**: The operator MUST be notified of new queue entries through the Admin UI's existing
  notification channel.

**Automation port**

- **FR-030**: The module MUST publish a port that adds a link (with optional address restriction,
  validity window and commercial terms, and a required source label) and removes (revokes) one. Add MUST be idempotent
  on an active link.
- **FR-031**: Port writes MUST bypass customer-side approval and MUST be refused for pairs that
  violate FR-010.
- **FR-032**: When the module is not effectively present the port MUST answer the platform's
  module-disabled error and write nothing.

**Requests and invitations (customer side)**

- **FR-040**: A user of X holding *"Manage payers"* MUST be able to request a payer by giving an
  exact tax ID, a contact e-mail and an optional comment; a user of Y holding *"Approve payer
  requests"* MUST be able to invite a buyer the same way when *payer may invite buyers* is on.
- **FR-041**: The response to a request or invitation MUST be identical — status, body, message and
  side effects visible to the sender — whether the tax ID matches an eligible Organization, an
  ineligible one, several, or none. The sender MUST see one *pending* state until the request is
  accepted, rejected or expires; intermediate states (awaiting registration, awaiting operator)
  MUST NOT be distinguishable by the sender.
  *Residual risk, accepted (RP-21 b):* under the `invite` no-account mode a sender who gives their
  own address as the contact e-mail receives the invitation to register and so learns that the tax
  ID has no account. The reply itself stays identical; the default mode `admin` sends nothing to the
  contact e-mail.
- **FR-042**: When the tax ID matches exactly one eligible Organization, the contact e-mail MUST NOT
  be contacted; the request MUST go to the counterparty's users holding the approving permission
  (*"Approve payer requests"* on Y for a buyer's request, *"Manage payers"* on X for a payer's
  invitation), by e-mail and in-account notification, or to the operator queue per FR-043.
- **FR-043**: Routing MUST follow the approval mode in force on the channel when the request was
  created: `payer` — counterparty decides; `admin` — operator queue only; `payer_then_admin` —
  counterparty, then operator. Under `payer` and `payer_then_admin`, a counterparty with no active
  user holding the approving permission sends the request to the operator queue instead. A tax ID
  matching more than one Organization, or only an ineligible one, always goes to the operator
  queue.
- **FR-044**: When the tax ID matches no eligible Organization: under `admin` the request MUST go to
  the operator queue; under `invite` an invitation to register, with the tax ID pre-filled, MUST be
  sent to the contact e-mail. When an Organization with that tax ID registers through the
  invitation and its registration is approved, the request MUST be attached to it and enter
  approval per FR-043. No Organization MAY be created automatically from an invitation. A payer's
  invitation of a buyer with no account follows the same rule (Assumption A-15).
- **FR-045**: A request MUST move `pending` → `active` (link created) | `rejected` (optional reason,
  shown to the sender) | `expired` (lifetime elapsed) | `withdrawn` (sender cancels while pending).
  Exactly one decision MUST win under concurrency. An expiry tells the sender's requester, by
  e-mail and in the account; a withdrawal tells nobody (RP-20 c).
- **FR-046**: Requests plus invitations sent by one Organization MUST be limited per day by the
  channel setting; the limit MUST be checked before the tax ID is looked up, so a refusal reveals
  nothing. The day starts at midnight in the default store's time zone (RP-20 a,
  `related_payers.time_zone` read for the system-default channel).
- **FR-047**: X's account MUST list X's payers (state, allowed addresses, window) and X's requests;
  Y's account MUST list the buyers Y pays for, each with its tax ID (RP-20 d), and requests awaiting
  Y — each under the permission that governs it.

**Revocation**

- **FR-050**: An active or inactive link MUST be revocable by a user of X holding *"Manage payers"*,
  a user of Y holding *"Approve payer requests"*, an operator, or the port. The other side MUST be
  notified.
- **FR-051**: Revocation MUST NOT affect orders already placed: they keep Y as payer, Y's
  visibility of them, Y's credit reservation and Y's invoices.

**Checkout and placement**

- **FR-060**: At checkout on an enabled channel, a user of X holding *"Place orders with a related
  payer"* MUST be offered the choice of X itself or any payer whose link is usable (FR-012) and
  carries the buyer's commercial terms, and for the chosen payer only its allowed billing
  addresses. When the cart is in a payer's-terms context (FR-110), the payer MUST be shown fixed at
  checkout and MUST NOT be changeable there.
- **FR-061**: With a payer chosen, the billing company name and tax ID MUST be shown read-only from
  the payer's data; with no payer chosen, checkout MUST be unchanged (RP-5).
- **FR-062**: Placement MUST refuse a request that names a payer together with a non-empty billing
  company name or tax ID override, with a validation error that identifies the conflict
  (RP-16: `400 VALIDATION_FAILED`, issue `payer_billing_override_conflict`).
- **FR-063**: Placement MUST accept a payer's billing address only when it is an allowed, live
  billing address of a payer whose link is usable for this user at the moment of placement; any
  other billing address MUST be refused as today (address not owned). The checkout preview MUST
  apply the same rule.
- **FR-064**: With a payer chosen, tax MUST be computed from the payer's VAT status and the chosen
  payer billing address's country, in both preview and placement, so the placed totals equal the
  previewed ones.
- **FR-065**: With a payer chosen, the credit reservation MUST be taken on the payer's credit (under
  the existing credit-owner inheritance) and never on X's; an insufficient payer credit MUST refuse
  placement as it would for the payer itself.
- **FR-066** *(RP-9)*: With a payer chosen, the payment methods offered and accepted MUST be those
  the payer's allow-list permits, and the buyer's list MUST NOT restrict them further. Delivery
  methods and the delivery address MUST stay the buyer's on every link. Price lists and
  customer-group prices, promotions and the minimum order value MUST stay the buyer's on a link
  with the buyer's commercial terms and follow FR-110 to FR-117 on a link with the payer's.
- **FR-067**: The order MUST keep X as its Organization and record a payer reference and a payer
  snapshot (name, tax ID, VAT status, billing address); the order's billing snapshot MUST be the
  payer's.
- **FR-068**: A placement naming a payer MUST be refused when the module is off, the capability is
  disabled on the channel, the user lacks the permission, or the link is not usable — with nothing
  reserved, written or emitted.

**Visibility of paid orders**

- **FR-070**: A user of Y holding *"View orders we pay for"* MUST be able to list and open orders
  whose payer is Y, through a dedicated read path that does not widen Y's tenant scope.
- **FR-071**: That view MUST be read-only: no cancel, reorder, quote, return, comment or edit, and
  each such API call on such an order MUST answer as for a non-existent order.
- **FR-072**: Every out-of-scope request for a paid order (another Organization, a Y user without the
  permission, the capability off on the channel) MUST be indistinguishable from "order does not
  exist". With the module off, the platform's `503 MODULE_DISABLED` answers first (RP-17 a).
- **FR-073**: X's own views (account and Admin UI) MUST show the payer on orders that have one; the
  operator order list MUST allow filtering by payer.
- **FR-074**: Whether Y's users receive e-mails for paid orders MUST be a per-link choice
  (Assumption A-4). The e-mails are the placement and the cancellation of a paid order, sent to Y's
  members holding `view_paid_orders`, in the store's default language (RP-17 b, d).

**Invoicing and downstream**

- **FR-080** *(RP-8)*: An invoice for an order with a payer MUST belong to the payer's Organization:
  its buyer snapshot is the payer snapshot; the Admin UI invoice list (organization filter and
  reach) and the invoice ledger list it under the payer; and the payer's users who may see the
  order see and download it under *Orders we pay for* (RP-13 — no new storefront invoice list).
  The buyer's users who may see the order MUST be able to download its invoice documents,
  read-only, from that order, as today, and the Admin UI MUST NOT list it under the buyer.
- **FR-081**: The invoice-ledger client mapping for such an invoice MUST resolve the payer's client,
  not the buyer's.
- **FR-082** *(RP-7)*: A refund arising from a return or complaint on such an order MUST be made to
  the payer: any correction document is the payer's (following FR-080), and a refund that releases
  credit releases the payer's. The return or complaint itself stays the buyer's to start and
  follow, as today.

**Payer's commercial terms** *(RP-10)*

- **FR-110**: On a channel where the capability is enabled, a user of X holding *"Place orders with
  a related payer"* MUST be able to set a cart's *Buying for* to X or to any payer whose link is
  usable (FR-012). For a link with the payer's commercial terms this is the only place the payer
  can be chosen; for a link with the buyer's terms the choice MAY be offered on the cart and, if
  chosen there, carries to checkout without changing any price. The storefront labels the choice
  *Paid by* and offers payers on the payer's terms only (RP-22).
- **FR-111**: While a cart is in a payer's-terms context, every price of the cart — line prices,
  customer-group prices, tier prices — MUST be resolved for the payer Organization, from the price
  lists available on the cart's sales channel only (Principle XII). Only the Organization the price
  is resolved for changes; the channel, currency and the client's inability to name a price list
  are unchanged.
- **FR-112**: In that context promotions (automatic and coded) MUST be evaluated with the payer as
  the Organization and its customer group, and the minimum order value MUST be resolved as it
  applies to the payer. A promotion's use is recorded against the payer, so a per-Organization
  usage limit counts the payer's uses (RP-19 c).
- **FR-113**: Switching *Buying for* MUST reprice the cart and re-evaluate its promotions in the
  same operation, and the response MUST say what changed: per line the unit price before and after
  and lines that became unpriced, and promotions added or removed.
- **FR-114**: A line with no price in the new context MUST remain in the cart, marked unpriced, and
  MUST block placement as an unpriced line does today; the switch MUST NOT be refused because of
  it.
- **FR-115**: While a cart is in a payer's-terms context, product listings, search results and
  product pages that user sees on the same channel MUST show prices in that context, and the
  amounts MUST equal what the cart shows for the same product and quantity.
- **FR-116**: When the link behind a payer's-terms context stops being usable or its terms change
  to the buyer's, the cart MUST return to the buyer's own context on its next read, be repriced,
  and tell the user why. Placement MUST re-check the context and refuse, with nothing written, if
  it no longer holds.
- **FR-117**: An order placed from a payer's-terms context MUST carry exactly the prices,
  promotions and totals the cart and checkout preview showed, and MUST record on the order that it
  was priced on the payer's terms.
- **FR-118**: A change of a link's commercial terms is a link write (FR-100): audited with before
  and after values and the actor.
- **FR-119** *(RP-11)*: Only an operator holding the management permission, or the port, MAY set
  or change a link's commercial terms. A link created by request or invitation MUST start on the
  buyer's terms, and no customer-facing surface or API MAY change them.
- **FR-120** *(RP-14)*: In a payer's-terms context every price-carrying read that derives a gross
  price (product listing and price sort, product page, cross-sell tiles, search hits and type-ahead,
  comparisons, the storefront price endpoint, cart upsells, the cart itself) MUST use the payer's
  VAT rate (Y's VAT status and country) — the rate checkout uses (FR-064) — and MUST resolve the
  price display mode, and with it whether price sorting and price filters are offered, for the
  buyer (X's organization override, else the settings default; product and category overrides
  unchanged). Y's organization-level display mode MUST NOT be read for it.

**Customer-side permissions** (declared by this module per `specs/170-organization-roles/` FR-020
to FR-025; *Administrator* holds all implicitly; none is member-default)

- **FR-090**: The module MUST declare four organization permissions, labelled and described in
  English and Polish: *Manage payers* (request, withdraw and revoke payers; accept invitations from
  payers), *Approve payer requests* (accept or reject requests naming us as payer; invite buyers;
  revoke as payer), *Place orders with a related payer*, *View orders we pay for*.
- **FR-091**: While the module is off, these permissions MUST be absent from the role editor and
  existing grants MUST be preserved (`specs/170-organization-roles/` FR-025).

**Auditing and notifications**

- **FR-100**: Every link and request write — create, accept, reject, withdraw, expire, activate,
  deactivate, revoke, change of addresses, window or commercial terms — MUST run as an audited Command whose actor
  distinguishes operator, automation (with the port caller's source) and customer user (with the
  Organization they acted for); expiry runs as a system actor.
- **FR-101**: Every customer-facing message (e-mails, in-account notifications, account screens,
  checkout labels, refusals) and every operator-facing string MUST exist in English and Polish.
- **FR-102**: Expiry of requests and invitations MUST be processed in the background on the
  platform's queue pattern (Principle X) and MUST stop while the module is off.

### Key Entities *(include if feature involves data)*

- **Payer link** — buyer Organization, payer Organization, state, address restriction (all / one
  payer billing address), validity window, origin (operator / automation + source / request /
  invitation), commercial terms (`buyer` | `payer`), revocation actor and time, per-link "send
  order e-mails to payer" choice. Visible to both Organizations and to operators.
- **Cart (extended)** — gains a *Buying for* payer and whether it is priced on the payer's terms.
  Owned by carts; the cart stays the buyer's.
- **Payer request** — direction (buyer asks / payer invites), sender Organization and user, the
  entered tax ID, contact e-mail, comment, resolved counterparty (if any, never shown to the
  sender), routing (counterparty / operator / awaiting registration), approval mode and no-account
  mode captured at creation, state, decision actor, reason and time, expiry, channel.
- **Order (extended)** — keeps buyer Organization; gains a nullable payer reference, a payer
  snapshot and whether it was priced on the payer's terms. Owned by orders.
- **Invoice (extended)** — belongs to the payer's Organization and carries the payer as buyer when
  the order has a payer (RP-8). Owned by invoices.
- **Settings** — the per-channel settings of FR-003, owned by the module.
- **Organization permissions** — the four codes of FR-090, and the operator codes of FR-024.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every order placed with a payer, the tax, the credit reservation, the billing
  snapshot and the invoice buyer are the payer's, and the placed totals equal the previewed ones —
  verified across VAT-payer / VAT-exempt and domestic / foreign-country combinations of X and Y.
- **SC-002**: The reply to a payer request or invitation is byte-identical across the four tax-ID
  outcomes (eligible, ineligible, ambiguous, unknown) and across the rate-limit refusal paths.
- **SC-003**: No user outside Y with *"View orders we pay for"* (and Y's *Administrator*) can obtain
  any data of a paid order beyond what they could obtain today; every such attempt is
  indistinguishable from a request for a non-existent order.
- **SC-004**: With the module off, or the capability disabled on a channel, checkout, the account,
  the Admin UI and the API on that channel are indistinguishable from an installation that never
  had the module, and switching it back on restores every link, request and setting unchanged.
- **SC-005**: An operator can link an existing payer to a buyer in under one minute from the
  buyer's card, and a buyer user can choose a payer at checkout with at most two additional
  selections compared with an ordinary checkout.
- **SC-006**: Every link and request write appears in the audit log with an actor that tells
  operator, automation and customer user apart, and no write path exists that does not produce
  one.
- **SC-007**: With no payer chosen, checkout and placement outcomes are unchanged for every existing
  checkout test, including the free-text billing override and the B2C company-invoice opt-in.
- **SC-008**: For a cart in a payer's-terms context, the price of every product is the same on the
  listing, search, the product page, the cart, the checkout preview and the placed order, and
  equals the price the payer would get ordering the same product on the same channel itself.
- **SC-009**: Switching *Buying for* and back returns every line to its original price, and the
  change summary lists every line and promotion whose value changed and no other.
- **SC-010**: A refund on a paid order, and every invoice and correction document of it, names the
  payer, and the buyer can download the invoice from its order but finds it in no invoice list of
  its own.

## Assumptions

- **A-1 — Price list, promotions and minimum order value follow the link's commercial terms**
  (RP-10): the buyer's by default, the payer's on a link set to the payer's terms. *Superseded the
  first draft's "always the buyer's".*
- **A-2 — Delivery address and delivery methods stay the buyer's on every link**; X receives the
  goods, and the delivery-method allow-list is about where and how X takes delivery, not about who
  pays. No reason was found to tie it to commercial terms; a deployment where the payer negotiates
  freight would be the case that reopens it.
- **A-3 — Quote requests (RFQ) and quote-to-order conversion with a payer are out of scope for this
  feature.** A quote is X's commercial negotiation; naming a payer on a quote can follow later.
- **A-4 — Payer order e-mails are a per-link choice, default off.** A payer always has the account
  view (US3); e-mail copies are opt-in per link, set by the operator or by Y's approver.
- **A-5 — Y's view of paid orders is not limited by Y's own sales-channel access**: it lists every
  order naming Y as payer, on whichever channel it was placed, because the consent is per link and
  not per channel. Confirm in planning against `specs/154-sales-channel-access/`.
- **A-6 — A payer is offered only on the storefront cart and at storefront checkout.** The cart is
  where a payer's-terms link is chosen (FR-110), checkout where a buyer's-terms link is chosen or
  confirmed (FR-060). One-click purchase, the API order intake, reorder and admin order creation
  refuse a payer; extending admin order creation is a candidate follow-up.
- **A-7 — A request's tax ID is matched exactly after normalisation** (the same normalisation the
  Organization tax ID uses); no fuzzy match, no lookup by name.
- **A-8 — The payer's VAT status is the one stored on its Organization at placement**; the feature
  does not trigger a new VAT validation.
- **A-9 — Default daily limit of 10 requests plus invitations per Organization**, a setting.
- **A-10 — Contact e-mail is retained on the request** for the operator's information when the
  counterparty exists, but never contacted (RP-4).
- **A-11 — Deployment overlays build on the port (FR-030)**; core ships no project-to-payer
  automation. The motivating overlay is a deployment's, not core's.
- **A-12 — ERP connectors that model their own payer / bill-to party** will need to map the order's
  payer reference; that mapping is downstream work for each connector, not this feature's scope.
- **A-13 — The capability is delivered as a new module** owning the link, the requests, its
  settings, permissions, notifications and port, and extending `orders`, `invoices` and
  `invoice_ledger` only through their published seams. Settled in `research.md` R-2: the order's
  payer is a set of columns owned by `orders`, not a module-declared extension column
  (`specs/178-extensible-columns/`).
- **A-14 — The organization card's admin section** is contributed through the card's existing zone
  (`organization.detail.after` in `packages/contracts/src/admin-contributions.ts`). Settled: a
  section, no tab strip (RP-12).
- **A-15 — A payer's invitation of a buyer mirrors a buyer's request in full** (US6), including the
  no-account modes of FR-044: the ruling fixes only that X accepts and that the operator is involved
  under `payer_then_admin`; extending the no-account handling to this direction is assumed.
- **A-16 — Confirmed by the owner as RP-11 (2026-11-18).** The payer's terms show the payer's
  negotiated prices to the buyer's users, so the decision stays with the operator, who already
  holds the price agreements.
- **A-17 — Pricing for the payer on a channel the payer has no access to.** Assumed allowed: the
  price lists are those bound to the channel, and the link, not the payer's own channel access, is
  the consent. `plan.md` confirms against `specs/154-sales-channel-access/`.
- **A-18 — In a payer's-terms context the payer is named to the pricing engine as the
  Organization, with no account-level override from the buyer's user**
  (`specs/conventions/pricing.md`, *A buyer is named, not resolved by the caller*), so an X user's
  personal customer group never leaks into Y's prices.
- **A-19 — The minimum order value is a global value with a sales-channel override today** (the
  `orders.min_order_value` setting), so resolving it "as it applies to the payer" changes no
  outcome on current configuration; FR-112 keeps the rule correct if a per-Organization value is
  added later.

## Open questions

No clarification marker remains: RP-7, RP-8 and RP-9 answered the first draft's Q-1 to Q-3, and
RP-11 confirmed A-16. The owner let the assumptions below stand as written (2026-11-18); they are
kept here so a later change of mind has a place to land.

| # | Assumption | Why it may matter |
| --- | --- | --- |
| A-17 | The payer's own channel access does not gate pricing for it. | The alternative refuses a payer's-terms link on channels the payer is not bound to. |
| A-3 | Quote requests with a payer are out of scope. | A payer's-terms link makes RFQ priced for Y a natural next ask. |
| A-4 | Payer order e-mails are per link, default off. | — |
| A-5 | The payer's view of paid orders ignores its channel access. | — |
| A-15 | A payer's invitation of an unregistered buyer follows the no-account modes. | — |

## Notes for `plan.md`

- **Pricing cache and price surface.** The pricing cache is keyed by pricing profile and the price
  surface (sort, price range) is precomputed per profile (`specs/conventions/pricing.md`). FR-115
  needs listings and search in a payer's-terms context to read Y's profile; verify that the
  request-time pricing context can name a profile other than the session's Organization without a
  new invalidation path, and add the identity test that convention requires for a new resolution
  path (cart read equals placement in a payer context; listing equals cart).
- **Who owns the cart context.** The *Buying for* field is cart data; carts consumes the module's
  port to ask whether a link is usable and on which terms, and fails closed to the buyer's own
  context when the module is off.

## Delivery

**One merge request for the whole feature (RP-6).** Inside it, the implementation order follows the
story priorities: links, operator surface and port (US1, US8); checkout, payer visibility,
invoicing and refunds (US2, US3); the payer's commercial terms on the cart (US9); requests,
approval and revocation (US4, US7); no-account handling and payer invitations (US5, US6).
The module ships with its activation default off and the capability disabled on every channel, so
the merge changes nothing for an installation until an operator turns it on. Documentation in
English and Polish ships in the same merge request.
