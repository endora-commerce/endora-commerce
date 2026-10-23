---
title: quote_requests
description: RFQ lifecycle (draft → quote → accept/reject)
---

# `quote_requests`

The Quote Requests module implements the B2B negotiation loop.
A customer (or sales representative on the
customer's behalf) drafts a Quote Request, the other side reviews it,
either side may modify the request and require explicit re-acceptance,
and an approved Quote Request can be turned into an order through the
standard checkout. Every transition is captured in an append-only
event log so the customer-facing detail page and the admin detail page
both render the same chronological history.

## Statuses

Six values, replacing the foundation-era set:

- `Created from admin` — drafted by a sales rep / admin, awaiting customer acceptance.
- `Pending` — submitted by the customer, awaiting internal-side response.
- `Approved` — green-lit by the responsible party.
- `Completed` — an order has been placed from this Quote Request.
- `Canceled` — rejected by either party (with optional reason).
- `Expired` — auto-flipped by the expiry worker when the configured threshold elapses.

`Canceled`, `Completed`, and `Expired` are terminal.

## Public surface

Customer endpoints require a customer session; admin endpoints are
gated by `rfqs:handle`. PATCH-shaped endpoints accept `If-Match`
versions for optimistic concurrency, and customer accept/reject
revision additionally pin `expectedRevisionNumber`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/quote-requests` | customer | List visible Quote Requests (org-admin role expands to whole-org visibility). |
| `GET /api/v1/quote-requests/:id` | customer | Detail with optional `comparisonAgainstLastSeen` block while awaiting acceptance. |
| `POST /api/v1/quote-requests` | customer | Create + submit in one call. |
| `PATCH /api/v1/quote-requests/:id` | customer | Edit a Pending RFQ that the internal side has not yet revised — see *Customer draft edits*. |
| `POST /api/v1/quote-requests/:id/accept-revision` | customer | Accept the seller's latest revision (also covers `Created from admin`). Needs an offer from the seller with every line priced — see *Agreed prices*. |
| `POST /api/v1/quote-requests/:id/reject-revision` | customer | Reject the latest revision with optional reason. |
| `POST /api/v1/quote-requests/:id/resubmit` | customer | Clone an old Quote Request into a new Pending one at the customer's current prices. |
| `POST /api/v1/quote-requests/:id/convert-to-order` | customer | Seed the customer's cart from an Approved RFQ at the agreed unit prices and return the checkout URL. |
| `GET /api/v1/admin/quote-requests` | admin | List, scoped by sales-rep assignment + filterable by status / organization. |
| `GET /api/v1/admin/quote-requests/:id` | admin | Detail with full actor identity in the event log, and per line the reference price and the customer's proposal — see *Reference price*. |
| `GET /api/v1/admin/quote-requests/:id/history` | admin | The request's history as readable entries — see *History*. |
| `POST /api/v1/admin/quote-requests` | admin | Create on customer's behalf → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | admin | Modify a Pending or Created from admin RFQ → triggers customer re-acceptance. |
| `POST /api/v1/admin/quote-requests/:id/approve` | admin | Approve a Pending RFQ whose every line has an agreed unit price. |
| `POST /api/v1/admin/quote-requests/:id/cancel` | admin | Cancel with optional reason. |
| `POST /api/v1/admin/quote-requests/:id/assign` | admin | Set `assignedAdminUserId` (informational). |
| `GET`, `POST /api/v1/admin/quote-requests/list-views`; `PATCH`, `DELETE …/list-views/:id` | admin | Saved views on the quote request list — see *Saved views*. |
| `GET /api/v1/admin/sales-reps/:adminUserId/organizations` | admin | Reverse view — organizations a rep is responsible for, with the count of open quote requests in each. |
| `GET /api/v1/storefront/settings/quote-requests` | public | Returns the two storefront visibility flags. |
| `GET /api/v1/quote-requests/price-negotiation` | customer | The signed-in customer's own effective price-negotiation value — see *Price negotiation lock*. |
| `GET` / `PUT /api/v1/admin/organizations/:id/quote-price-negotiation` | admin | Read / set an organization's price-negotiation value. Read needs `customers:read`, write `customers:manage`. |
| `GET` / `PUT /api/v1/admin/customers/:id/quote-price-negotiation` | admin | Read / set a customer account's override, with the resulting effective value. Read needs `customers:read`, write `customers:manage`. |

The customer create and draft-edit bodies accept at most **200 lines**; a longer
list is refused with `400 VALIDATION_FAILED`.

The three endpoints that assign a sales representative *to* an organization —
`GET`, `POST` and `DELETE` under
`/api/v1/admin/organizations/:id/sales-reps` — belong to the **organizations**
module and are gated by `organizations:assign-sales-rep`, not by `rfqs:handle`.
They used to be registered here, and the split is not cosmetic: assigning a
representative qualifies an organization, so it must keep working when quote
requests is switched off, and it cannot be gated by a permission code declared
by a module that can disappear. The one endpoint left above is the one that
reads a quote request, and it is gated `rfqs:handle` precisely so that it
disappears with this module.

## Agreed prices

A Quote Request becomes an order only at unit prices the seller agreed. A
line's agreed unit price is set by an operator — when revising a request
(`PATCH /api/v1/admin/quote-requests/:id`) or when creating one on a
customer's behalf — and is empty until then. An empty agreed price is never
read as a number: nothing falls back to zero, to the customer's desired price
or to the list price.

Three operations depend on it, and each answers `409` when the rule is not
met:

| Operation | Refused when | Code |
| --- | --- | --- |
| `accept-revision` | The seller has made no offer to accept: the request is not `Created from admin` and is not awaiting the customer's acceptance of a seller revision. | `RFQ_NOT_QUOTED` |
| `accept-revision` | The seller's offer leaves a line without an agreed unit price. | `QUOTE_INCOMPLETE` |
| admin `approve` | Any line has no agreed unit price. | `QUOTE_INCOMPLETE` |
| `convert-to-order` | Any line has no agreed unit price. | `QUOTE_INCOMPLETE` |

What this means in practice:

- An operator who wants to approve a request as the customer raised it prices
  every line first, then approves. There is no "approve at the list price"
  shortcut.
- The rules are about a **missing** price. An agreed unit price of exactly
  `0` that an operator entered — a free sample line — is an agreed price like
  any other, and such a request can be accepted, approved and ordered.
- `reject-revision` is not affected: a customer can still withdraw a request
  the seller has not answered yet.
- A request that reached `Approved` with an unpriced line before these rules
  existed cannot be converted into an order. Its lines can no longer be
  edited, so the way forward is `resubmit`, which raises a new request for the
  seller to price.

## Reference price

Every quote line carries a **reference price**: what the request's customer
would pay for that product, variant and quantity on a normal order. It is
what the seller compares the customer's proposal with.

- **Net, per base unit.** The price is the net unit price of one base piece —
  the unit every line quantity is counted in — whatever packaging unit the
  customer chose. It is what the price books charge this customer for the
  line's product, variant and quantity — the base price, a catalogue price for
  everyone on the channel, the customer's organization or customer-group price,
  and a sale when it is lower (see the `price_lists` module's page) — in the
  request's currency when it names one, else in the channel's default currency.
- **Resolved on the server, for the request's owner, on the request's sales
  channel.** The owner is the customer account that raised the request and its
  organization — also when an organization administrator edits a colleague's
  draft. A price sent by a client is never used: an unknown key in the customer
  body is stripped.
- **Stored at request time.** It is captured on every customer write — the
  storefront form, a cart converted to a quote request, a draft edit, a
  resubmission, quick order, a shopping list and an order copied to a quote
  request — and kept for the life of the request; a seller's revision does not
  change it. A draft edit keeps the stored price of an unchanged line and
  resolves a changed or new line again. When no price can be resolved, the line
  stores none and the request is still accepted.
- **A cart is its own reference.** A request converted from a cart stores each
  cart line's unit price as that line's reference price. It does **not** record
  it as the customer's proposal: such lines carry no proposed price.

For developers: the stored reference is resolved through `price_lists`'
`buyerLinePricePort` (`BuyerLinePricePort.resolveForBuyer` in
`@endora-commerce/contracts`), which prices every line of a request in batches
through the same resolution as the cart; the port performs no authority check,
so this module passes the request's owner it has already authorised. The admin
screens' *current price* comes from `POST /api/v1/admin/price-books/resolve`,
gated by `price_lists:read`.

The admin detail shows, per line, the reference price, the customer's proposed
unit price, their difference as a signed amount and a percentage of the
reference (two decimals), and the agreed unit price. The Modify tab shows the
same beside the agreed-price input, with the live difference of the price being
entered. A line with no stored reference — raised before reference prices were
stored, added by the seller, or on a request an administrator created — shows
the customer's **current** price on the request's channel instead, labelled
*current price* rather than *price at request*. Where the difference cannot be
computed — no price, a reference in another currency than the line, or a
reference of `0` — the screen shows `—`. An empty agreed price is prefilled
with the same customer-specific price, not with the administrator's own
storefront price.

The reference price, the customer's proposal and the request's
`salesChannelId` are in the **admin** replies only; the customer's API does not
carry them.

Readers of `quoteRequestReadPort.listItems` — exports and connectors — find the
stored price in `referenceUnitPrice` and `referenceCurrency` (both `null` when
none is stored). A line converted from a cart has `desiredUnitPrice = null`;
read the cart price from `referenceUnitPrice`.

**Totals.** The reference price is never used as a fallback for a total. The
customer list's `totalAtCustomerPrice` is `null` — shown as `—` — unless
**every** line carries a proposal, the rule the admin list already applied; a
cart-converted request therefore has none until it is priced. The admin list's
customer-price total survives the seller's revisions, because a revision keeps
each line's proposal. The CRM opportunity value of a request with no proposal
and no agreed price is `0`; a revised line the customer left unpriced is valued
at the proposal carried from the customer's last draft edit until the seller
sets an agreed price.

## History

`GET /api/v1/admin/quote-requests/:id/history` — and the History tab of the
admin detail — turns the request's stored events into readable entries, in
English and Polish:

- **One entry per decision.** Records that belong together are merged:
  the customer's acceptance and the approval, the customer's rejection and the
  cancellation, an administrator's note and the approval, and the system pairs
  written when a request is created, resubmitted or created on a customer's
  behalf.
- **Who did it.** Every entry names the person who acted, not the requester:
  an administrator by first and last name and role, a customer user by name and
  e-mail address, and *System* for an expiry or a completion by an order. An
  actor who can no longer be resolved is shown by the recorded role as an
  unknown user, and the rest of the history still renders. Names appear on the
  admin surface only; the customer's API exposes no more than before.
- **What changed.** A modification lists, against the previous revision: lines
  added (with quantity and agreed price) and removed, quantity, agreed price,
  the customer's proposed price, line note, header note and validity date, each
  as old → new. Lines are named by product and variant. Packaging-unit and
  custom-field changes are not listed. Changes to the line groups are listed
  too — *group added*, *group removed*, *group renamed* (from → to), a line
  *moved* from one group to another (*Ungrouped* standing for no group), and
  *order changed* when lines or groups were only reordered — see *Line groups*.
  A revision with no listed change reads *offer re-sent without changes*. A reason or note given with a cancellation,
  rejection or approval is shown.
- **Values not carried from a sales opportunity.** When a request created from
  a sales opportunity could not take some of the opportunity's custom-field
  values (see *Custom fields*), the history holds one entry by *System*,
  *Custom field values not carried from a sales opportunity*, naming the
  opportunity by its number and listing each skipped field — by the name of the
  opportunity's field, as it read when it was skipped — with the reason. It shows no value, and anybody who
  can open the request reads it. The entry is **admin-only**: the customer's view
  of the request never shows it. Values that were carried are not an entry of
  their own.
- **Bounded.** The history reads the **most recent 100 events**. When older
  events exist, the reply carries `truncated: true` and the tab says that older
  entries are not shown.

Requests raised before this history existed are described from the data
already stored; nothing is backfilled.

## Customer draft edits

A customer edits a `Pending` request with `PATCH /api/v1/quote-requests/:id`
as often as they like until a seller **revises** it. Once an administrator has
modified the request, the edit is refused with `409 RFQ_NOT_DRAFT` and the
customer resubmits instead. Edits by customers — an organization
administrator's edit of a colleague's draft included — never close the draft.

- An edit keeps each line's variant, line note and packaging unit as sent.
- The route accepts at most **30 edits per minute for one request**, counted
  per customer; more answer `429 RATE_LIMITED` with a `Retry-After` header. A
  request refused before it is authenticated is not counted.

A seller's revision (`PATCH /api/v1/admin/quote-requests/:id`) keeps each
surviving line's variant, line note, packaging unit, customer proposal and
stored reference price, unless the seller changed them. The stored reference
price stays even when the seller changes the line's quantity: a seller's
revision never resolves it again. A line the seller adds carries the variant
and note chosen and no packaging unit.

## Line groups

An operator can sort a quote's lines into **named groups** — *Ground floor*,
*First floor*, *Options* — so that a long offer reads the way the customer
thinks about the job. Groups are **presentation only**: they change no price,
discount, quantity or total, and a grouped quote totals exactly what the same
lines total ungrouped.

**Where.** The **Modify** tab of a quote and the **Create quote request**
screen, while the quote's lines can be edited — *Created from admin* and
*Pending*. In every other state the grouping is shown read-only, and a write
that sends one is refused like any other line edit (`409 RFQ_NOT_QUOTED`). No
new permission is involved: grouping needs `rfqs:handle` and the quote's
organisation in the representative's reach, as editing its lines does.

**What an operator can do.**

- **Add group** creates a group and puts the focus in its name. A name is
  trimmed and holds 1 to 120 characters; two groups may share a name. A quote
  holds at most **50** groups — *Add group* is then disabled and says so. An
  empty name reads *Enter a group name.* and blocks the save.
- **Rename** a group in its name field; **delete** it with its delete button.
  Deleting a group never deletes a line: its lines move to the **Ungrouped**
  section, in their order.
- **Move a line** to another group, or to a chosen place in its own, by
  dragging its handle, from the keyboard — focus the handle, press Space or
  Enter, move with the arrow keys (past a group's last line the line enters the
  next section), Space or Enter to drop, Escape to cancel — or with the line's
  **Move to group** menu, which needs no dragging. Every move is announced to
  screen readers.
- **Reorder groups** by dragging, from the keyboard, or with the *Move group
  up* / *Move group down* buttons. **Ungrouped** is always last and cannot be
  moved, renamed or deleted.
- A product added with a group's own **Add product** joins that group; any
  other added line joins *Ungrouped*.
- A group emptied of its lines **stays** until it is deleted, shown as an empty
  drop area (*Drag lines here or use Move to group.*). Empty groups are never
  shown to the customer, printed or carried to an order.
- **One product on several lines.** The same product may sit on several lines —
  in different groups, or twice in one: *5 pieces in Hall A, 3 in Hall B*. On
  the *Modify* tab, **Split line** (the button beside *Move to group*, on a line
  of quantity 2 or more) asks for the quantity to move to a new line (from 1 to
  the line's quantity minus 1) and the new line's group — the line's own by
  default — and adds a line of the same product, variant, packaging unit, agreed
  price and customer's proposal, reducing the original. On *Create quote
  request* a product already on the request can simply be added again.

**Summaries.** Every section shows its item count and its net, VAT and gross,
by the same rule the quote's own totals use, and its discount against the list
price where the screen shows list prices. They are recomputed as lines are
edited and moved. The create screen shows no VAT, so its sections show the
item count and the net.

**Saving.** The grouping is saved by the button that saves the lines — **Save
revision** or **Create** — in the same write, under the same concurrency check,
and recorded in that write's audit entry (`quote_request.modify` or
`quote_request.create_on_behalf`, with the groups' names and line counts
before and after). **A save that changes only the grouping is a revision like
any other**: the customer is notified and asked to accept it. The **History**
tab lists the grouping changes of each revision (see *History*).

**What the customer sees.** The storefront quote shows each group that holds a
line as a headed section, in order, with its lines and its summary, then the
lines without a group under **Other items**; a quote with no group looks
exactly as before. The customer cannot create, rename, delete or reorder a
group, and no customer request accepts a grouping. The comparison with the last
revision the customer saw says, in one entry, that *the arrangement of the
lines changed*, and names nothing else. Each line is compared with its own: for
a product on several lines, an entry names the group of the line it is about —
*Bolt (Hall B): quantity 3 → 2* — and the admin *History* does the same. Accepting and rejecting a revision work
as before: the grouping is never a reason to refuse an acceptance.

**What keeps a line's group.** A customer's own draft edit keeps every line it
keeps in its group. An API client that saves a quote's lines without sending
`groups` keeps every line it keeps in its group and puts new lines in
*Ungrouped*. Where a line carries no id, it is matched to a stored line of the
same product by its group first, then by its quantity, then by position — so
removing one of two lines of a product keeps the other in its group. A **resubmission** starts ungrouped: it is a new request, re-priced,
for the representative to group again. **Convert to order** fills the basket
in the quote's order, and the order placed from it keeps the groups — see the
Orders module's page.

**The PDF** prints the groups — see *Quote PDF*.

**API.** `PATCH /api/v1/admin/quote-requests/:id` and
`POST /api/v1/admin/quote-requests` accept an optional `groups` list — the
whole grouping, in display order, each `{ key, id?, name }` (`id` keeps an
existing group, a group without one is created, a stored group left out is
deleted) — and per line an optional `groupKey` (`null` = ungrouped); lines are
sent in display order. `groups` without `items` answers `400`; an `id` that is
not a group of this quote answers `422 VALIDATION_FAILED`. A new line split off
a stored one carries `splitFromId` (the stored line's id): it then keeps that
line's packaging unit, customer's proposal, note and reference price; a
`splitFromId` that names no line of this quote is ignored. Every reply carries
`itemGroups` (`{ id, name, position }`) and, per line, `groupId` and
`position`, with lines in display order — the admin reply lists empty groups
too, the customer reply only the groups that hold a line. The published read
port `quoteRequestReadPort.listItems` answers each line's `group` and
`position`, in display order.

## Order minimums and packaging units

Quote requests apply the catalogue's minimum order quantities — the product's
minimum in pieces and each packaging unit's minimum in units, counted over every
line of the product in the request (the Catalog module's page defines both).
**The rule follows who is writing, not the route.**

**Packaging units are named by id.** A customer's line (create, draft edit,
cart → quote request) may carry `packagingUnitId`. It must be a current unit of
the line's product; the server stores that unit's catalogue name and base
quantity and ignores any name or base quantity the line also sent. A line that
sends a packaging name and base quantity without an id is accepted only when
both match one of the product's units. Anything else is refused whole with
`422 PACKAGING_UNIT_MISMATCH`, nothing written; `details.lines[]` gives each
failing line's `index` and a `reason`. Every failure of an id — unknown,
deleted, or another product's unit — has the same reason, `unknown_unit`, so
the answer reveals nothing about other products; a name has `name_unknown` or
`base_quantity_mismatch`. This also refuses a draft edit that sends back a
line whose stored packaging label no longer matches a catalogue unit.
`packagingUnitId` is returned on the admin and the customer read, and an
administrator's revision keeps it on the lines it keeps.

**A customer's write is refused below a minimum.** Create
(`POST /api/v1/quote-requests` — directly, from the cart, from quick order,
from a shopping list or by cloning one of their orders), draft edit
(`PATCH /api/v1/quote-requests/:id`) and resubmit
(`POST /api/v1/quote-requests/:id/resubmit`) answer
`422 PRODUCT_BELOW_MINIMUM_QUANTITY` or
`422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]` for every
offending line, and write nothing; the sentence and the product names are in
the language the response is answered in (the request's `Accept-Language`,
q-weights honoured, otherwise the channel's default language). The order of
checks: a product the customer
may not see or the channel does not publish is refused as unknown first, so
nothing about it is disclosed; then packaging, then minimums — all before any
reference price is resolved.

- **Draft edit.** A line the customer left unchanged — same product, variant,
  packaging and quantity as a stored line — is not refused, even below its
  minimum; its pieces still count toward the product's total when another line
  of that product is checked. A line names its packaging unit by the unit's id,
  so a unit renamed in the catalogue since the line was stored is still the
  same unit, and the line stays unchanged (and keeps its stored reference
  price).
- **Resubmit** is judged as a new request, with no exemption, in pieces (it
  carries no packaging). A request whose product no longer exists is refused
  with `404`.
- **Accepting or rejecting a revision** is never refused for minimums.

**An administrator's write is never refused for a minimum.** Create on behalf,
**Modify** (including negotiated quantities), cloning an order to a quote
request from the admin and the admin's quick-order build to a quote request
write below-minimum lines. The admin read (`GET /api/v1/admin/quote-requests/:id`)
gives each such line a `minimumWarning` (`{ kind, minimum, packagingUnitName? }`),
judged over the request's current lines, and the quote request screen shows it
as a *Below minimum* badge on the line, on **Overview** and in **Modify**. The
warning informs and blocks nothing; it never reaches the customer's read.
The admin's clone-to-quote and quick-order build still validate packaging.

**Ordering the accepted quote keeps its quantities.**
`convert-to-order` fills the basket at the agreed quantities without checking
minimums; in the basket each line seeded from the quote is exempt while its
quantity equals the quote's, and checkout honours that only while this request
is still valid (the Carts and Orders modules' pages). With this module switched
off nothing can vouch for the quote, so such a basket loses its exemptions at
checkout.

Migration `20261018T122118_quote_requests_item_packaging_unit_id.ts` adds
`quote_request_items.packaging_unit_id` (nullable, no foreign key — the unit's
name and base quantity stay snapshotted on the line).

## Price negotiation lock

An administrator can decide whether a customer may **propose prices** on a
quote request:

- **On the organization** (`/organizations/:id`) — *Members may propose
  prices*: allowed (the default) or not allowed, for every customer account of
  the organization.
- **On the customer account** (`/customers/:id`) — an override: *as
  organization* (the default), *allowed* or *not allowed*. The screen shows the
  resulting value and whether it comes from the override or the organization.

The effective value of an account is its override if set, else its
organization's value, else *allowed*. There is no platform-wide or
per-channel default: the value applies on every sales channel, and two members
of one organization can differ.

**What a locked customer meets.**

- The storefront draft hides the proposed-price input and shows the catalogue
  unit price, read-only, where it is known, with a note that sales will price
  the request. Prices the customer typed before stay in the browser's draft but
  are never sent. The storefront learns the value from
  `GET /api/v1/quote-requests/price-negotiation`, which answers the signed-in
  customer's effective value and nothing else; if that read fails, the page
  shows the input — the display fails open.
- **The API is the guarantee.** A customer create or draft edit whose lines
  carry a proposed price — `0` included — is refused with
  `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED`, translated, and nothing is written.
  The lock is decided in the same request that writes the quote request and
  never fails open: if the owner's value cannot be read, a request carrying a
  proposal fails and writes nothing, while one without a proposal does not
  need the lock and goes through.
- Converting a cart and resubmitting keep working: they carry no proposal.

**The lock binds the request's owner, not the acting user.** On create and
resubmit the owner is the acting customer; on a draft edit by an organization
administrator it is the colleague who owns the draft. A locked organization
administrator may therefore propose prices on an unlocked colleague's draft,
and an allowed one may not on a locked colleague's.

The lock does not touch the seller's side — admin create, modify, approve and
the agreed price — and does not alter proposals already stored. It is read for
every request, uncached, so a change applies to the next request.

**Who sees and changes it.** Both controls are panels on the organization and
customer screens, shown to roles with `customers:read`; changing a value needs
`customers:manage`, and the panel's control is disabled without it. A role that
holds `customers:manage` but **not** `customers:read` sees no panel. A sales
representative reaches only the organizations they may see; any other id
answers `404`. An organization with no assigned sales representative is visible
to every representative (see *Visibility model*), so any representative may
change its lock; issue #305 tracks that rule itself. Its customer accounts are
not reachable that way: they sit behind the assigned-organization filter, so a
representative's request for an account's panel — read or change — answers
`404`, and its overrides stay with a platform administrator. Every change is an audited write that records the
administrator, the organization or account and the old and new value.

**Switched off.** While this module is off, the panels, the four admin routes,
the storefront read and the enforcement are gone; the stored values are kept
and apply again once the module is switched back on.

## Visibility model

A sales representative is a platform administrator with the
`sales_representative` role. The
`SalesRepAssignmentService.canSeeOrganization(adminUserId, organizationId)`
predicate centralises the visibility rule:

1. `platform_admin` role → sees every organization.
2. Otherwise the admin sees an organization iff a row in
   `organization_sales_rep_assignments` ties them together, OR the
   organization has zero rows in that table (the "unassigned-org
   fallback" — visible to every sales rep).

A sales representative who names a quote request of an organization they may
not see gets the same `404` as for an id that does not exist, on every admin
quote-request route — the detail, the history and every action. (Earlier releases answered
`403` on some of those routes, which told the caller the request existed.)

A customer with the `org_admin` role on their own organization sees
every Quote Request in the organization, not just their own.

## Custom fields

Quote requests take custom fields, defined on **Custom Fields**. They follow this module: while
`quote_requests` is switched off its fields are not listed there, cannot be created or edited and
are not offered by the definitions API; the fields, their options and the stored values are kept
and come back unchanged when the module is switched on again.

### Values carried into and out of a request

A quote request field can carry its value on, and an opportunity field can carry its value into a
quote request — set per field with **Carry value to …** on **Custom Fields**, whose page has the
rules (same key, compatible type and options, the audience rule). Only an empty field is filled,
and only once:

- **Into the order** placed from an accepted request, at placement — see the Orders module's page.
- **Into a sales opportunity** the CRM module opens for the request, or that an order placed from
  the request joins — see the CRM module's page.
- **From a sales opportunity**, into a request an administrator creates with **Create quote
  request** on the opportunity's *Links* tab. The values arrive once the CRM module has linked the
  request to the opportunity, in a change attributed to the **system** (`quote_request.custom_fields.carry`
  in the audit log); the request's creation stays attributed to the administrator. A value that
  cannot be carried is skipped and named in the request's *History* (see *History*), and the
  request is created all the same. A request linked to an opportunity by hand receives nothing, and
  neither does a request a customer cloned from an order.

  **The version moves right after the create.** A carry that fills a field is a change to the
  request like any other and raises its `version`, and it runs just after the create request has
  answered. A client that edits the new request with the version the create response returned is
  therefore refused with `409 VERSION_CONFLICT` once values have been carried: read the request
  again and send the version it reports now. A carry that fills nothing leaves the version alone.
  The carry holds the request's row while it reads and writes it, so it never overwrites an
  administrator's edit made at the same moment.

While this module is switched off nothing is carried into or out of a quote request, and nothing is
replayed when it returns. For integrators: the stored event is of type
`custom-field-carry-skipped`; on `GET /api/v1/admin/quote-requests/:id/history` it is an entry of
`kind` `custom_field_carry_skipped` whose `customFieldCarry` holds `source` (`entityType:
"opportunity"`, `recordId`, `reference`) and `skipped` (`key`, `reason`, `label`).

### Custom-field filters on the list

A quote request field whose **Use as list filter** option is on is offered as a filter on the
quote request list, labelled in your language: the text it contains, a number or date range, yes
or no, or one or more options. A request without a value for the field never matches. The filter
is applied by the server, so it narrows the whole list — the total and every page — not only the
requests already loaded; status, search, sorting and paging keep working beside it. Each filter is
shown as a removable chip, is kept in the page address and in saved views, and returns the list to
its first page when it changes.

If the address names a filter that is no longer available, the list says so by the field's name
and offers **Remove this filter**. A saved view holding such a filter drops it on load, with a
notice naming it. API callers send the filters as `customFieldFilters` on
`GET /api/v1/admin/quote-requests` and read the offered fields from
`GET /api/v1/admin/quote-requests/custom-field-filters` (`rfqs:handle`). An inverted range (`min` above `max`, `from` after `to`) or an operator that does not apply to the field's type answers `400` `VALIDATION_FAILED`.

## Saved views

A saved view is a named setup of the quote request list — its filters, sort and
columns — that an admin can apply again with one selection.

### Using saved views

The quote request list's toolbar carries a **Saved views** selector, whose
first entry is **— Select a view —**, and two buttons beside it: **Save view**
and **Delete view**.

- **What a view remembers.** Seven things: the **Visibility** scope, the
  organization, the status selection, the search text, the custom-field
  filters, the sort and the visible columns. Choosing a view replaces all seven
  with the view's values, discards anything you had changed and not saved, and
  goes back to the first page. A status or column the list no longer knows is
  dropped; a custom-field filter that is no longer available is dropped with a
  notice naming it; a view with no columns shows the default ones; a view with
  no usable scope opens on your own default scope.
- **A view never widens what you can see.** It stores filter values, never
  results. After you load a view, the list is read with *your* permissions and
  *your* organizations, whoever saved it. *My organizations* means the
  organizations assigned to you, the admin loading the view — not to the one
  who saved it — and *All* still shows only what you are allowed to see. The
  organization is stored as an id: if it is outside your reach, its name is not
  shown and the list is simply empty.
- **Saving.** **Save view** opens one dialog with a **Name** field and a
  **Share with every admin who can open this list** checkbox. The checkbox
  starts unchecked, so a new view is private unless you tick it. The name is
  required, leading and trailing spaces are removed, and it can be at most 160
  characters long. Problems are shown on the field and nothing is sent until
  they are fixed; a refusal from the server is shown inside the dialog, which
  stays open with what you typed.
- **Private or shared.** A private view is listed only for you. A shared view
  is listed for every admin who can open the quote request list, with
  **(shared)** after its name. The selector does not show who saved a shared
  view.
- **One name per admin.** You cannot hold two views on this list whose names
  differ only in letter case or in surrounding spaces. The dialog answers
  **You already have a view with this name.** before sending anything, and the
  server refuses the name as well. Accented letters are different letters:
  *Łódź* and *Lodz* are two names. Names other admins use, and names
  used on other lists, do not count.
- **Deleting.** **Delete view** is enabled only when the selected view is one
  you may delete. It asks for confirmation and names the view —
  **Delete the view “…”?** — and for a shared view adds that it will disappear
  for every admin who can open this list. Nothing is deleted until you press
  **Delete**.
- **Who may delete or change a shared view.** Its owner, or **any admin whose
  role is not `sales_representative`** — not only the `platform_admin` role: a
  custom role counts as well. **Such a deletion or change leaves no audit
  trail**: saved views are not written to the audit log. Decide which roles you
  grant with that in mind before your team relies on shared views. A sales
  representative can delete only their own views, and nobody can see or delete
  another admin's private view.
- **Two meanings of "platform admin" on this list.** The rule above is not the
  one *Visibility model* applies: the list's default scope and its
  every-organization visibility still key on the literal `platform_admin` role.
  So an admin with a custom role may delete a colleague's shared view yet opens
  the list on *My organizations*.
- **Only save, load and delete.** The Admin UI does not rename a view, change
  whether it is shared, or overwrite it with the current setup; save a new view
  and delete the old one instead. There is no limit on the number of views.
- **When quote requests are switched off,** the saved views go with the rest of
  the module but are not deleted. Switch the module back on and every view is
  there as it was.

### Saved views API

| Method and path | Answers |
| --- | --- |
| `GET /api/v1/admin/quote-requests/list-views` | `200` — the caller's own views plus every shared view, ordered by name |
| `POST /api/v1/admin/quote-requests/list-views` | `201` — the created view |
| `PATCH /api/v1/admin/quote-requests/list-views/:id` | `200` — the modified view; any of `name`, `shared`, `filters`, `sort`, `visibleColumns`. The Admin UI does not call it. A body that changes nothing — empty, or every value as stored — writes nothing, logs nothing and answers the current view |
| `DELETE /api/v1/admin/quote-requests/list-views/:id` | `200` — `{ data: { deleted: <id> } }` |

- **Gate.** All four routes are gated by `rfqs:handle` — the code that gates the
  list — and registered behind the module's presence gate with the rest of its
  admin routes. There is no separate permission code. A request without an
  admin actor is refused with `401 UNAUTHORIZED`. The static `list-views`
  segment takes precedence over `quote-requests/:id`.
- **Off-state.** While `quote_requests` is not effectively present, all four
  answer as `GET /api/v1/admin/quote-requests` does — `503 MODULE_DISABLED`.
  The rows in `quote_request_list_saved_views` are not touched.
- **Body.** `name` (trimmed, 1–160 characters, no Unicode control or format
  characters), `shared` (boolean), `filters` (an object, at most 8192 bytes as
  UTF-8 JSON), an optional `sort` (`{ field, dir }`, `field` at most 64
  characters, `dir` `asc` or `desc`, or `null`) and an optional
  `visibleColumns` (at most 64 ids of at most 64 characters each, or `null`).
  The Admin UI writes `filters` as `{ scope, organizationId?, status?, q? }`.
  Anything outside those bounds is `400 VALIDATION_FAILED`. The shapes are
  `createQuoteRequestSavedViewRequestSchema` and
  `updateQuoteRequestSavedViewRequestSchema` in `@endora-commerce/contracts`.
- **Loading is a new list read.** A view's values only set the list's
  controls; the list is then read through the ordinary
  `GET /api/v1/admin/quote-requests` as the loader, so the server applies the
  loader's own visibility and `scope=mine` resolves against the loader. A view
  never carries an organization name.
- **Two caller-relative flags.** Every view in a response carries
  `ownedByCaller` and `canModify` — `true` when the caller owns the view, or
  the view is shared and the caller is a platform admin in the sense below. The
  Admin UI enables **Delete view** from `canModify`, and before saving runs a
  best-effort duplicate-name pre-check against the listed views with
  `ownedByCaller`. The server's `lower(btrim(name))` comparison is
  authoritative: a name the pre-check lets through can still be refused with
  `409`.
- **Platform admin, for saved views,** is an admin whose request tenant context
  has `mode === 'all'` — every role except `sales_representative`. The order,
  product and quote request lists derive it the same way, and it fails closed:
  an admin whose reach cannot be resolved is not a platform admin.
  It is deliberately not the module's own `role.code === 'platform_admin'`
  test, which the list's visibility uses.
- **Refusals.** An absent view, or another admin's private view, is
  `404 NOT_FOUND` — the two are indistinguishable. A shared view the caller
  neither owns nor may modify as a platform admin is `403 FORBIDDEN`. A name
  whose key the view's owner already uses on this list is
  `409 RFQ_SAVED_VIEW_NAME_TAKEN`, *"You already have a saved view with this
  name on the quote request list. Choose a different name."*, in the request's
  language.
- **The name key** is the name trimmed and lower-cased — no accent folding. The
  rule binds the view's **owner**: a platform admin renaming a colleague's
  shared view is refused when the colleague already uses that key. Creating a
  view and changing a name's key take a transaction-scoped advisory lock keyed
  on the owner, and a unique index on `(owner_admin_user_id, lower(name))`
  backs it, so two concurrent saves under one name leave exactly one view.
- **No audit.** Saved views are personal UI configuration and do not run
  through the Command Bus. When an admin modifies or deletes a view they do not
  own, the service writes one `info` log record:
  `{ event: 'saved_view.updated' | 'saved_view.deleted', list: 'quote_request_list_saved_views', viewId, ownerAdminUserId, actorAdminUserId }`.
  That log line is the only trace.

## Quote PDF: export and send to the customer

A sales representative turns a quote request into a PDF from its admin screen,
in **every state** of the quote. Two buttons in the page header open the same
dialog:

- **Export PDF** downloads the PDF, named after the quote's number.
- **Send PDF to customer** e-mails it.

Both appear only while the **Document templates** module is switched on (the
send also needs the transactional e-mails, which cannot be switched off), and
both need the `rfqs:handle` permission and the quote's organisation in the
representative's reach — exactly as opening the quote does. No new permission
is involved.

**Template.** The dialog offers the *Quote request* templates designed in
**Document templates** that apply to the quote's sales channel — templates for
all channels and templates of that channel, never another channel's. The
template **remembered** for this quote is preselected, else the default of the
quote's channel, else the default for all channels; when none exists only the
**built-in layout** is offered. Choosing a different template and exporting or
sending remembers it for the quote — for every representative — and the
change is recorded in the audit log; keeping the preselected default remembers
nothing, so a later change of the default still reaches the quote. A
remembered template that was deleted is never cleared automatically: the
dialog says so and the default is used. Remembering a template does not change
the offer, its revision or its version, so it never conflicts with a
colleague's edit. **Manage PDF templates** in the dialog leads to the quote
templates for a representative who may view document templates.

**Language.** The dialog offers the languages the chosen template holds,
preselected with the default language of the quote's sales channel (the system
default channel's for a quote without one). Every printed text, number, amount
and date follows it, and so does the e-mail.

**What the PDF prints.** The quote's **current** lines and prices, built for
the requesting representative: the header (number, date, validity date,
revision), the buyer organisation with its tax ID and address, the requesting
customer and the assigned representative, the quote's note, the line items
table, the quote's custom fields that customers may see, and any text and logo
the template adds. Lines without an agreed price print an empty price, and the
totals that need every price are left out — the same rule as the quote
screens.

The line items table offers these fields per line: position, product name,
variant, SKU, quantity, packaging unit, quantity in packaging units, **list
price**, the customer's proposed price, price after discount, gross unit price,
**discount %**, **unit discount**, **line discount**, **value at list price**,
net value, VAT rate, VAT, gross value, the line note, and one field per product
attribute shown on the product page (a shop's *lead time* attribute, for
example). Totals: total at list prices, discounts, total net, VAT rate, VAT,
total gross.

- **List price** is the price recorded when the line was requested (see
  *Reference price*). A **discount** exists only where the agreed price is
  lower than the list price in the same currency; otherwise the discount fields
  have no value, so a column shown *only if any line has a value* disappears
  when nobody got a discount.
- The fields in bold are **internal**: customers do not otherwise see them. A
  template may print them, and the editor marks every column, detail entry and
  total that does.
- **VAT** is computed from the net total at the quote's one VAT rate and
  `gross = net + VAT`, as on the quote screens; a line's own VAT column is
  rounded per line and may differ from the VAT total by a cent.
- SKU and attributes are read from the catalogue when the PDF is produced; a
  product deleted since prints its stored name and no SKU or attributes.

The built-in layout prints position, product, SKU, quantity, packaging unit,
list price and discount % (both only when a line is discounted), price after
discount, VAT rate, net and gross, the line note under its line, and the
totals, in English and Polish.

**Groups on the PDF.** A grouped quote prints each group that holds a line as
a heading row — its name and item count — then its lines, then a subtotal row
for each of the table's totals computed over the group; the lines without a
group follow under **Other items** (*Pozostałe pozycje*), then the quote's
totals as before. Positions run 1…n across the groups. The built-in layout and
every template saved before groups existed print them with no change; a
template can print the quote flat or group it by a field instead (the Line
items table's *Grouping* setting, on the Document templates page). A quote with
no group prints exactly as before. While **Document templates** is switched
off there is no PDF, as above, and the grouping on every screen is unaffected.

**Sending.** *Send PDF to customer* preselects the requesting customer's e-mail
address. The representative may remove it and add other addresses — any
well-formed address, at most **5**, duplicates merged — and an optional personal
message of up to 2 000 characters. Each address receives its own e-mail
**Quote request PDF**, with the PDF attached, in the chosen language. The
e-mail's subject and body are edited, per language and sales channel, or the
e-mail switched off, under **E-mail templates**; its variables are
`quote.number`, `quote.validUntil`, `customer.name`, `salesRep.name`,
`salesRep.email`, `channel.name` and `message`.

A successful send adds a **PDF sent** entry to the quote's **History** (who
sent it, to which addresses, with which template, in which language, and the
message) and one `quote_request.send_document` row to the audit log — never the
PDF itself. Customers do not see it in their own history. When the mail server
refuses one address and accepts another, the PDF stays sent to the accepted
ones, the dialog names the refused ones, and only the accepted ones are
recorded. A send is refused, with nothing recorded, when:

| Situation | Answer |
| --- | --- |
| The *Quote request PDF* e-mail is switched off, no mail server is configured, or the e-mail is not set up | `409 QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE` (`details.code`: `deactivated`, `no_transport`, `no_definition`) |
| The PDF is larger than 10 MiB | `422 QUOTE_REQUEST_PDF_TOO_LARGE` |
| The mail server refused every address | `502 QUOTE_REQUEST_PDF_SEND_FAILED` |
| More than 10 sends by one administrator within a minute | `429 RATE_LIMITED` |

**API** (all behind `rfqs:handle` and the quote's visibility; `503
MODULE_DISABLED` while document templates are off):

| Route | Purpose |
| --- | --- |
| `GET /api/v1/admin/quote-requests/:id/document-templates` | the templates, the remembered one, the default, the languages, the suggested language and the requester's e-mail |
| `PUT /api/v1/admin/quote-requests/:id/document-template` | remember a template (`{ documentTemplateId }`, `null` forgets) |
| `GET /api/v1/admin/quote-requests/:id/pdf?templateId=&language=` | the PDF; headers `X-Document-Template-Id`, `-Version`, `-Source`, `-Missing` |
| `POST /api/v1/admin/quote-requests/:id/pdf/send` | `{ recipients, templateId?, language?, message? }` → `{ sent, failed, templateId, templateSource, requestedTemplateMissing }` |

Templates themselves are designed in **Document templates**; see that module's
page for the editor and the line items table.

## Settings

Three settings drive the module — all live under the `quote_requests`
group and are configured through the existing settings module.

| Code | Type | Default | Effect |
| --- | --- | --- | --- |
| `quote_requests.expiry_days` | integer | `0` | Expire Pending / Created from admin requests after N days without activity, unless they carry an offer that is still valid. Per sales channel: each request is held to its own channel's value, and `0` exempts a channel. Setting it expires the existing backlog — see *Background jobs*. |
| `quote_requests.show_add_to_quote_on_card` | boolean | `true` | Toggle the "Add to quote" button on storefront product cards. |
| `quote_requests.show_add_to_quote_on_pdp` | boolean | `true` | Toggle the "Add to quote" button on product detail pages. |

## Background jobs

The expiry sweep runs **every 30 minutes** in every process that consumes
queues (`BACKEND_ROLE=worker` or `all`): a BullMQ Job Scheduler on the queue
`quote_requests.expiry.sweep`, installed by the module itself. While the module
is switched off, no tick runs.

### Which requests it expires

Each tick reads `quote_requests.expiry_days` **for every sales channel**, and
holds each request to the value of its own channel — see
[Per sales channel](#per-sales-channel). `0` — the default — exempts a channel;
set to `0` everywhere, the sweep does nothing. Otherwise a request is moved to
`Expired` when **all three** hold:

1. **It is still open** — `Pending` or `Created from admin`. That covers a
   request waiting for the seller's first answer and an offer waiting for the
   buyer.
2. **Nothing has happened to it for its channel's `expiry_days`.** The clock is the request's
   latest history entry — the entries both parties see on the request. What
   restarts it: the submission, an edit by the customer, a revision or a note
   by the seller. What does **not**: the customer opening the request (which
   only marks the revision as seen), an assignment to another administrator,
   and any other write that adds no history entry.
3. **It carries no offer that is still valid.** When the seller put a validity
   date on an offer (`expiresInDays` → `expiresAt`), that date wins over
   `expiry_days`: the request is never expired by this sweep while the date is
   ahead, however long it has been quiet. Once the date has passed, or where
   the seller set none, the inactivity rule applies as to any other request.

The sweep does not expire a request *because* its validity date passed. That
date is enforced when the buyer accepts or converts (`410`); it does not, on
its own, close the request.

### What one tick does

- **One request at a time.** The status change, the `expired` history entry
  and the notification records of one request commit together, and
  `rfq.expired.v1` is emitted once they have. A request that fails stays as it
  was; the worker process leaves it alone for two hours and then tries again,
  so requests that keep failing cannot hold up the others.
- **It cannot cross somebody's answer.** A buyer accepting or declining, and a
  seller approving, revising, cancelling or assigning, hold the request while
  they write it. The sweep skips a request that is held, and an answer to a
  request the sweep has just expired is refused with `409 VERSION_CONFLICT`:
  exactly one of the two happens.
- **A bounded batch.** A tick expires at most 500 requests, oldest first. A
  larger backlog is worked off over the following ticks.
- **No notification record for an expiry that is old news.** A request that
  became due more than 24 hours before the tick that reaches it is expired,
  gets its history entry and is announced as `rfq.expired.v1` like any other,
  but no notification record is written for it. See *Notifications* below for
  what a notification record is today.
- **An idle tick is silent.** When nothing is due, the tick enters no system
  scope and writes no `tenant.escape_hatch` audit row.

### Turning it on expires the backlog

`expiry_days` is not applied from the day it is set: it is applied to
everything that is open. **Changing it from `0` to `N` expires, over the next
ticks, every open request that has been quiet for more than `N` days** — on an
instance that has run with `0` for a year, that can be most of the open
requests. The same holds for lowering it. Requests with an offer that is still
valid are not touched (rule 3), and no notification record is written for the
ones that became due more than 24 hours earlier.

Releases up to and including 0.104.0 documented this sweep and never ran it, so
an instance that already has `expiry_days` set meets the same backlog on the
first ticks after upgrading. Set it to `0` before the upgrade to review the
open requests first.

### Per sales channel {#per-sales-channel}

`expiry_days` can be set for all channels and overridden for one, and the sweep
honours both: a request is held to the value resolved for the sales channel it
was raised on. A channel set to `0` is exempt, whatever the other channels say,
and a channel with its own number of days is held to it. A request that carries
no channel — raised before requests recorded one, or by a tool that set none —
is held to the default channel's value.

The `expired` history entry records the value that applied to the request.

Until this was fixed the sweep read one value, the default channel's, and
applied it to every request. An instance that already set a different value for
some channel therefore sees that value take effect on the first ticks after
upgrading — a channel with a lower value expires its backlog of quiet requests,
and a channel set to `0` stops expiring.

## Data model

Three tables on top of the foundation `quote_requests` and
`quote_request_items`:

- `quote_request_revisions` — full snapshot per modify event.
- `quote_request_events` — append-only history (one row per state
  transition or modification, with discriminated-union payload).
- `quote_request_notification_events` — one row per recipient ×
  channel; unique on `(quote_request_id, source_event_id, recipient*,
  channel)` so retries are idempotent.

`quote_request_items` carries the stored reference price in
`reference_unit_price`, `reference_currency` and `reference_captured_at` — all
three set or all three `null`.

Two tables hold the price negotiation lock: `quote_request_org_policies` (one
row per organization that has a value) and `quote_request_account_policies`
(one row per customer account with an override; `null` = as organization).
A missing row means the default. Deleting the organization or the customer
account deletes its row and nothing else — no quote request refers to either
table.

`quote_requests.document_template_id` holds the PDF template remembered for the
quote (see *Quote PDF*), or `null`. It has no foreign key: the template belongs
to the document templates module, and a deleted template leaves the id in
place, so the export falls back to the default and says so. Writing it moves
`updated_at` but not `version`. A `quote_request_events` row of type
`pdf-sent` records each delivered *Send PDF to customer*; it is shown on the
admin History only.

`quote_request_item_groups` holds a quote's line groups — `name` and
`position` per group, deleted with the quote request. `quote_request_items`
carries each line's `group_id` (`null` = ungrouped; deleting a group sets it to
`null`) and its `position` within its section. Each revision's line snapshot
also records the line's group and position, so the history and the customer's
comparison describe the grouping as the customer was shown it. A quote created
before groups existed reads as ungrouped, its lines in their original order.

`quote_request_list_saved_views` holds the list's saved views (see *Saved
views*). It is platform-global, not organization-scoped: it stores filter
values, never quote requests, and is not removed when the module is switched
off.

`organization_sales_rep_assignments` — the m:n relation between
organizations and admin users that the visibility model above reads —
is **not** one of them: it is owned by the `organizations` module,
which qualifies the organization with it, and this module reaches it
through that module's `organizationSalesRepScopePort`.

The canonical `quote_requests` row carries the current state plus
`current_revision_number`, `last_customer_seen_revision_number`, and
`awaiting_customer_revision_acceptance`. The customer's "what changed
since I last visited" diff is computed on read by comparing the
revision identified by `last_customer_seen_revision_number` against
the revision identified by `current_revision_number`.

### `sales_channel_id` is nullable, and stays nullable

Every request records the sales channel it was raised on, taken from
the resolved request channel. The column is nullable and will remain
so.

It was added nullable on purpose: the deploy that shipped it must not
depend on the boot-time default-channel reconciler having already run,
which is the ordinary phased shape — add nullable, start writing,
backfill, flip to `NOT NULL`. The middle step is the one that cannot
be taken here. Nothing wrote the column between the migration that
added it and the change that started populating it, so every request
raised in that window carries `null`, and no record anywhere says
which channel it came from. Projecting the system-default channel over
that gap would not recover an attribution, it would invent one — and
the sales-channel delete guard would then start refusing deletions on
evidence the platform made up.

A deployment that genuinely needs the column non-nullable therefore
deletes the null tail, or takes a per-row answer from a source that
knows one. There is no backfill script, and there deliberately never
will be one.

## Notifications

Every state transition **records** who should be told: `RfqNotificationService`
writes one row per recipient and channel (`email`, `in_app`) into
`quote_request_notification_events`, with status `queued` — the customer for
admin-side actions, sales reps and platform admins for customer-side actions,
both parties on expiry. The unique constraint on that table keeps it to one
row per (transition, recipient, channel).

**Nothing delivers these rows yet.** No worker reads the table, so no e-mail
and no in-account notification is sent for any quote-request transition; the
rows stay `queued`. They are the record a delivery worker would work from. The
one e-mail this module does send is the explicit *Send PDF to customer* (see
*Quote PDF*), delivered while the representative waits and recorded on the
quote's History.

## Conversion to order

`POST /api/v1/quote-requests/:id/convert-to-order` fills the customer's
basket with the lines of an `Approved` quote request at the agreed unit
prices, and marks the basket with the quote request it was filled from. The
order placed from that basket records it (`source_quote_request_id`) — while
the quote request is still `Approved` and at least one line is still in the
basket at the agreed price; the Orders module's page says what drops the mark.

When an order is created with a populated `source_quote_request_id`,
an event subscriber inside the module flips the originating Quote
Request to `Completed`, populates `converted_order_id`, and fires the
`completed` notification. A completed quote request cannot be ordered a second
time, and the conversion is refused while any line has no agreed unit price
(see *Agreed prices*). The subscriber waits for the order to be committed — a little over two
seconds at most — and completes nothing for an order of another organization.

With this module switched off, a basket filled earlier is still checked out, at
the agreed prices, as an ordinary order: it records no quote request and the
quote request is not completed.

## Created by an administrator: the event and its origin

A quote request an administrator creates through
`POST /api/v1/admin/quote-requests` is announced on the in-process event bus as
`rfq.created_by_admin.v1`, once, after its rows are written:

| Field | Meaning |
| --- | --- |
| `rfqId` | The new quote request. |
| `organizationId` | The organization it was created for. |
| `adminUserId` | The administrator who created it. |
| `origin` | What the create request carried as `origin`, or `null`. |

`rfq.created.v1` remains the event of a customer's own submission and is
**not** emitted on this path, so nothing that listens to it starts seeing
requests an administrator prepared.

The create request may carry an optional `origin: { type, id }` saying where
the quote request is being created from — `type` a lower-case identifier of the
sender's own (letters, digits, underscores), `id` a UUID. The module validates
the shape and hands the value on, unread, with the event: it is not stored, not
returned and changes nothing about the quote request. A module that recognises
the `type` may act on it — the CRM module links such a quote request to the
opportunity it was created from. The customer's own endpoint accepts no such
field.

The create screen (`/quote-requests/new`) reads the same from its query string
when another screen opens it: `originType` and `originId`, `organizationId` and
`customerAccountId` to preselect the customer, and `returnTo`, a path inside
the Admin UI to go back to once the quote request exists.

## Events offered to outbound webhooks

The module contributes two event types to the `webhooks` module's
`webhookEventRegistry`, so a webhook subscription can name them while both
modules are switched on. The payload is sent whole; the strict schemas are
`QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS` in `@endora-commerce/contracts`.

| Event | Sent when | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- |
| `rfq.created.v1` | A customer submits a quote request. A quote request an administrator creates is `rfq.created_by_admin.v1`, which is not offered to webhooks. | `rfqId` (UUID), `organizationId` (UUID) |
| `rfq.expired.v1` | The expiry sweep (`RfqExpiryWorker.sweep()`) moves a quote request to `Expired`. One event per quote request. Nothing else sends it, so it occurs only where that sweep runs. | `rfqId`, `organizationId` |

- **No content leaves.** The payloads carry the two identifiers and nothing of
  the request: no line, quantity, price, note, customer or administrator. A
  receiver reads the quote request through the API with its own permissions.
- **One Organization's data.** A platform-wide subscription receives every
  Organization's events. A subscription bound to an Organization receives only
  the events whose `organizationId` is that Organization — never another's.
- **After the write.** `rfq.created.v1` is sent once the request, its lines and
  its history are saved; a submission that is refused sends nothing.
  `rfq.expired.v1` is sent after the status change is saved.
- **While the module is switched off** neither type is offered and a new
  subscription to them is refused; stored subscriptions are kept and receive
  nothing until it is back on.

No other quote-request event is delivered to webhooks: approval, modification,
cancellation and conversion are announced on the in-process event bus only.

## Line items on the Create quote request screen

The admin screen that drafts a quote request on a customer's behalf
(`/quote-requests/new`, sent as `POST /api/v1/admin/quote-requests`) adds
products in two ways:

- **Browse products** opens the admin's shared product browser on the
  **Active** tab: the catalogue in pages, with status tabs and their counts, a
  type filter and a search by SKU, slug or name. The selection survives page,
  page-size and filter changes, and **Add N** adds every ticked product as a
  line of quantity 1 — at most 200 in one step. Draft and inactive products
  may be added; grouped and bundle parents are listed with their reason and
  cannot be ticked. A product already on the request can be added again, as a
  line of its own — for instance to put it in a second group.
- **Quick add by name or SKU**, beside it, appends one product under the same
  rules.

Both are disabled, each with a hint, for an operator without `catalog:read`.

Each line shows the product's name and SKU, an editable whole-number quantity,
an editable agreed unit price and a remove action.

**The agreed unit price is prefilled from the customer's current price**, through
`POST /api/v1/admin/price-books/resolve` for the chosen customer and the
line's quantity, with at most four requests in flight. A price is prefilled
only once a customer with an organization is chosen — lines added before that
are prefilled then — and an answer is applied only while it still matches the
line's product, quantity and customer. Where no price resolves the field stays
empty. **A price typed by hand is never overwritten**: changing the quantity
leaves it as it is. A prefilled price follows the quantity instead: it is
resolved again for each new valid quantity, and cleared as soon as the
quantity is not a whole number of 1 or more — it no longer answers any
quantity — then resolved again once the quantity is valid. Changing the
customer clears every price that was not typed by hand and resolves it again
for the new customer, so such a price may become empty.

**An incomplete line blocks the request instead of being dropped.** A line with
no agreed price, or with a quantity that is not a whole number of 1 or more, is
marked, and **Create quote request** stays disabled until it is fixed or
removed; every line on screen is sent. The running total counts the lines that
have both a valid quantity and a price. A customer without an organization
still shows the existing warning, since a quote request needs one.

## Panels on the quote request screen

The admin zone `quote_request.detail.after` is mounted once at the end of a
quote request's screen, below the card that holds its tabs, and hands a
contribution `{ quoteRequestId }`. A module adds a panel by declaring
`zoneComponent('quote_request.detail.after', …)` in its own admin
contributions; this module names no contributor and imports none. With nothing
contributed — no such module, the module switched off, or a person without the
panel's permission — the zone renders nothing and the screen is exactly the one
without it. The CRM module contributes the opportunity a quote request is
linked to.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds quote requests. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| Quote Request number | yes |
| Organization name | yes |
| Customer name or e-mail | yes |
| Customer's note | no |

A result shows the number, the organization, the date submitted and the status, and opens the quote request. Quote requests appear for a role holding `rfqs:handle`, with the same organization visibility as the Quote Requests list.
