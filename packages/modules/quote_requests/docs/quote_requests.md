---
title: Quote requests
description: RFQ lifecycle (draft → quote → accept/reject)
---

# Quote requests (`quote_requests`)

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

Customer endpoints require a customer session, and the three that create a
quote request or fill a basket also an organization permission of the
member's role — see *Organization permissions*; admin endpoints are
gated by `rfqs:handle`. PATCH-shaped endpoints accept `If-Match`
versions for optimistic concurrency, and customer accept/reject
revision additionally pin `expectedRevisionNumber`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/quote-requests` | customer | List visible Quote Requests (the *Administrator* role expands to whole-org visibility — see *Visibility model*). |
| `GET /api/v1/quote-requests/:id` | customer | Detail with optional `comparisonAgainstLastSeen` block while awaiting acceptance. |
| `POST /api/v1/quote-requests` | customer | Create + submit in one call. Needs `quote_requests.create`. |
| `PATCH /api/v1/quote-requests/:id` | customer | Edit a Pending RFQ that the internal side has not yet revised — see *Customer draft edits*. |
| `POST /api/v1/quote-requests/:id/accept-revision` | customer | Accept the seller's latest revision (also covers `Created from admin`). Needs an offer from the seller with every line priced — see *Agreed prices*. |
| `POST /api/v1/quote-requests/:id/reject-revision` | customer | Reject the latest revision with optional reason. |
| `POST /api/v1/quote-requests/:id/resubmit` | customer | Clone an old Quote Request into a new Pending one at the customer's current prices. Needs `quote_requests.create`. |
| `POST /api/v1/quote-requests/:id/convert-to-order` | customer | Seed the customer's cart from an Approved RFQ at the agreed unit prices and return the checkout URL. Needs `carts.create`. |
| `GET /api/v1/admin/quote-requests` | admin | List, scoped by sales-rep assignment + filterable by status / organization. |
| `GET /api/v1/admin/quote-requests/:id` | admin | Detail with full actor identity in the event log, and per line the reference price and the customer's proposal — see *Reference price*. |
| `GET /api/v1/admin/quote-requests/:id/history` | admin | The request's history as readable entries — see *History*. |
| `POST /api/v1/admin/quote-requests` | admin | Create on customer's behalf → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | admin | Modify a Pending or Created from admin RFQ → triggers customer re-acceptance. |
| `POST /api/v1/admin/quote-requests/:id/approve` | admin | Approve a Pending RFQ whose every line has an agreed unit price. |
| `POST /api/v1/admin/quote-requests/:id/prepare-customer-basket` | admin | Seed the basket of the customer who owns an Approved RFQ at the agreed unit prices, replacing what it held, for that customer to check out. The basket is the one of the channel the request was raised on. The same rules as the customer's own conversion; audited as `quote_request.prepare_customer_basket`. |
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
- **A unit price has up to four decimal places.** An agreed or a desired unit
  price may be typed as `0.0125`; a fifth place is refused with
  `400 UNIT_PRICE_PRECISION_EXCEEDED` (*A unit price may have at most four
  decimal places.*), never rounded. The price is stored as typed
  (`numeric(14,4)`), reaches the basket and the order unrounded, and only a
  line's value — the unit price × the quantity — is rounded to two places,
  once: 0.0125 for 10 000 pieces is 125.00. The screens and the PDF show a
  unit price with its significant places, up to four.
- **Every price on a request is in one currency: the default currency of the
  sales channel the request was raised on.** It is decided once, when the
  request is created — by the customer or by an operator on their behalf — and
  every later write of its lines (a draft edit, a seller revision, a
  resubmission) keeps it, so one request never mixes currencies. Each line
  stores it as `lineCurrency`. A resubmission copies the source request's
  lines, prices included, so it keeps their currency even when it is raised on
  a channel whose default currency differs: relabelling the currency would
  change what those prices mean. A request with no channel, raised before
  requests recorded one, is in PLN. Requests created before this rule stay in
  the currency they were stored with (PLN), whatever their channel's currency.
- `reject-revision` is not affected: a customer can still withdraw a request
  the seller has not answered yet.
- A request that reached `Approved` with an unpriced line before these rules
  existed cannot be converted into an order. Its lines can no longer be
  edited, so the way forward is `resubmit`, which raises a new request for the
  seller to price.

## Validity date

An operator can date an offer — *Valid for N days* when revising a request or
creating one on a customer's behalf (`expiresInDays`, stored as `expiresAt`).
Both parties are shown *expires &lt;date&gt;*, and the date is **the last moment
an order can be placed at the agreed prices**, not only the last moment the
basket can be prepared. Without a date the agreed prices have no deadline.

| When | After the date | Code |
| --- | --- | --- |
| The buyer accepts the offer (`accept-revision`) | Refused | `410 RFQ_EXPIRED` |
| The buyer converts the accepted quote into a basket (`convert-to-order`) | Refused | `410 QUOTE_VALIDITY_ENDED` |
| The order is placed from that basket | Refused | `410 QUOTE_VALIDITY_ENDED` |

**The basket is checked again at placement.** Each basket line filled by
`convert-to-order` remembers the quote its agreed price came from. When the
order is placed from that basket — at the storefront checkout or by any
other path that places the buyer's basket — every line still priced at
its agreement (still at the agreed quantity) is checked against that quote as
it is *now*. A basket converted on the last valid day therefore cannot be
ordered at the agreed prices the day after: a new quote must be issued. The
refusal changes nothing — the basket stays as the buyer left it, and the quote
stays `Approved`.

The refusal's `details.code` says why, and the buyer reads a sentence in their
language for each:

| `details.code` | Meaning |
| --- | --- |
| `lapsed` | The quote's validity date has passed. |
| `withdrawn` | The quote no longer applies: the seller re-opened it with a new revision, it was cancelled or expired, or it no longer exists. |
| `unavailable` | The Quote Requests module is switched off, so nothing can confirm the agreed prices. |

The storefront checkout asks the same question before the buyer presses
*Place order*: the order-total preview (`POST /api/v1/orders/preview-total`)
answers `quoteCommitmentRefusal` with one of the three values, or `null`, and
the checkout shows a notice and disables the button. For a lapsed or withdrawn
quote it leads to the buyer's quote requests, where they ask for a new quote.

What still places:

- **A line moved off its agreed quantity.** It is priced from the price list,
  like any basket line, so it consumes nothing the seller agreed and the
  quote's date does not bind it.
- **A basket with the quoted lines removed.** The buyer can always order the
  rest at current prices.
- **A second basket of the same quote after the first was ordered** (two
  colleagues who each converted it). The quote is then `Completed`; the second
  order names no quote, and while the validity date has not passed its lines
  keep the agreed prices.

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
**every** line carries a proposal; a cart-converted request therefore has none
until it is priced. The admin list carries the same two totals, and its
customer-price total survives the seller's revisions, because a revision keeps
each line's proposal.

**The amount of a quote request** is one figure, computed by this module and
shown by the admin list, by a CRM opportunity's linked quote requests and by a
project's linked records alike. Each line counts at its quantity × its agreed
unit price, or — while it has none — the unit price the customer asked for.
Each line's value is rounded half up to two places, and the line values are
added. A line with neither price adds nothing. The amount is net of tax and in
the first line's currency. A revised line the customer left unpriced counts at
the proposal carried from the customer's last draft edit until the seller sets
an agreed price.

| The lines | Shown |
| --- | --- |
| every line has an agreed price | the amount |
| some lines have an agreed price | the amount, marked **Partially agreed** |
| no line has an agreed price, at least one has an asked price | the amount, marked **Not yet agreed** |
| no line has any price, or the request has no lines | `—` |

The admin list answers `amount` (`null` when no line has a price) and
`agreement` (`agreed`, `partial` or `none`) on each row. Other modules read
both through `quoteRequestReadPort.amountOf(id)`, which answers `{ amount,
currency, agreement }`, or `null` for a request the caller cannot see.

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
- **Who was told.** Under an entry that notified anybody, the deliveries are
  listed — recipient, channel and outcome; see *Notifications*. Admin-only,
  like the names.
- **Bounded.** The history reads the **most recent 100 events**. When older
  events exist, the reply carries `truncated: true` and the tab says that older
  entries are not shown.

Requests raised before this history existed are described from the data
already stored; nothing is backfilled.

**The history, not the audit log, holds the values.** The platform audit log is
read by everybody holding `audit_log:read`, whichever organizations they may
see, so a request's audit entries carry names and structure only. A
cancellation records `hasReason`, never the reason. A grouping records each
group's line count, never its name. A PDF send records how many addresses it
went to, never the addresses. A preparation of the customer's basket records
the basket and its size, not the customer. A carry from a sales opportunity
names the carried fields as `changedCustomFields`, without their values. The
values stay on the request, its revisions and this history, which is read
under the request's own visibility.

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
`quote_request.create_on_behalf`, with each group's line count before and
after; the names are in the revisions, not the audit log). **A save that changes only the grouping is a revision like
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
change its lock — and, since issue #305, its customer accounts' overrides too:
the accounts are reached by the same rule as their organization. Every change is an audited write that records the
administrator, the organization or account and the old and new value.

**Switched off.** While this module is off, the panels, the four admin routes,
the storefront read and the enforcement are gone; the stored values are kept
and apply again once the module is switched back on.

## Visibility model

A sales representative is a platform administrator with the
`sales_representative` role. The
`SalesRepAssignmentService.canSeeOrganization(adminUserId, organizationId)`
predicate centralises the visibility rule:

1. Any role other than `sales_representative` (`platform_admin`, or a custom
   role holding `rfqs:handle`) → sees every organization (issue #957).
2. A `sales_representative` sees an organization iff a row in
   `organization_sales_rep_assignments` ties them together, OR the
   organization has zero rows in that table (the "unassigned-org
   fallback" — visible to every sales rep). With `organizations:rollup`
   the nearest ancestor-or-self carrying any row decides instead.

It is the one rule on every surface (issue #305): the tenant filter every
admin quote-request read runs under is that rule — every organization except
those governed by another representative — so the list, the detail, the
history and the global search all agree, and an unassigned organization's
requests are listed and readable by every representative.

A sales representative who names a quote request of an organization they may
not see gets the same `404` as for an id that does not exist, on every admin
quote-request route — the detail, the history and every action. (Earlier releases answered
`403` on some of those routes, which told the caller the request existed.)

A member holding their organization's *Administrator* role sees every Quote
Request in the organization, not just their own — on the list, the detail and
every action that names one. Every other member sees only their own; a
colleague's answers `404`. The rule reads the role the member holds, never the
legacy `role` column, and no organization permission widens it: a custom role
granting every code still sees only its own requests. (When internal approval
of quote requests ships, this visibility moves to a permission of its own.)

`RfqCustomerPort.listForCustomer` — what `customers` reads for a buyer's own
list and for one customer's list in the Admin UI — always answers the requests
that account itself raised, whatever role it holds.

## Organization permissions

`quote_requests` declares one organization permission — a code an
Organization's administrator grants to a role on the storefront role screens
(see the `organizations` module):

| Code | Label | Member role holds it by default | Gates |
| --- | --- | --- | --- |
| `quote_requests.create` | Create quote requests | yes | `POST /api/v1/quote-requests` and `POST /api/v1/quote-requests/:id/resubmit`; the modules that create a quote request for the buyer — from a cart, a shopping list, a quick-order build — check it too |

`POST /api/v1/quote-requests/:id/convert-to-order` fills the buyer's basket, so
it is gated by the `carts` module's `carts.create` instead.

A member whose role lacks the code is refused `403
ORGANIZATION_PERMISSION_REQUIRED`, naming the permission, before the body is
validated or the quote request is looked up. An anonymous visitor still gets
`401`. While `quote_requests` is switched off, its code leaves the permission
catalogue and every member's effective permissions; a role's stored grant is
kept, and is effective again when the module is switched back on.

On the storefront a member without `quote_requests.create` is offered no
add-to-quote button on the product page or the product cards and no *Convert to quote
request* on the cart. The quote-request draft stays reviewable, but its submit
button is disabled with the reason beside it: *"Your role does not allow
sending quote requests."* On a quote request's page, resubmitting is offered
only with `quote_requests.create`, and placing the order from an approved
request only with `carts.create`.

## Custom fields

Quote requests take custom fields, defined on **Custom fields**. They follow this module: while
`quote_requests` is switched off its fields are not listed there, cannot be created or edited and
are not offered by the definitions API; the fields, their options and the stored values are kept
and come back unchanged when the module is switched on again.

### Values carried into and out of a request

A quote request field can carry its value on, and an opportunity field can carry its value into a
quote request — set per field with **Carry value to …** on **Custom fields**, whose page has the
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
  one the list's default scope applies: that still keys on the literal
  `platform_admin` role. So an admin with a custom role may delete a colleague's
  shared view, and sees every organization's requests (*Visibility model*), yet
  opens the list on *My organizations*.
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
  test, which the list's default scope uses.
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
revision), the buyer organisation with its tax ID and address (for a personal
(B2C) Organization, only the person's name: its tax ID is an internal
placeholder and it has no head office), the requesting customer and the
assigned representative, the quote's note, the line items
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
PDF itself, and only how many addresses it went to, not which. Customers do not see it in their own history. When the mail server
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

The notification delivery worker runs beside it, on the queue
`quote_requests.notifications.deliver`: every minute, and within seconds of
every change that recorded a notification. See *Notifications*.

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
date is enforced when the buyer accepts, converts and places the order (`410`,
see *Validity date*); it does not, on its own, close the request.

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
- **Nobody is notified about an expiry that is old news.** A request that
  became due more than 24 hours before the tick that reaches it is expired,
  gets its history entry and is announced as `rfq.expired.v1` like any other,
  but no notification is recorded for it, so neither side is told — the same
  24 hours after which no notification is sent at all (see *Notifications*).
  A tick that recorded notifications wakes the delivery worker once, after its
  commits.
- **An idle tick is silent.** When nothing is due, the tick enters no system
  scope and writes no `tenant.escape_hatch` audit row.

### Turning it on expires the backlog

`expiry_days` is not applied from the day it is set: it is applied to
everything that is open. **Changing it from `0` to `N` expires, over the next
ticks, every open request that has been quiet for more than `N` days** — on an
instance that has run with `0` for a year, that can be most of the open
requests. The same holds for lowering it. Requests with an offer that is still
valid are not touched (rule 3), and nobody is notified about the ones that
became due more than 24 hours earlier.

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
- `quote_request_notifications` — one delivery record per history entry ×
  recipient × channel (unique on `(source_event_id, recipient_kind,
  recipient_id, channel)`), with its status, attempts, next attempt, last
  error, the time of the change it announces and when it closed. It is
  organization-scoped, deleted with the request, and holds no foreign key to
  the recipient's table. It replaced `quote_request_notification_events`, which
  the migration `20261113T081826_quote_requests_notifications_redesign.ts`
  dropped with its rows — nothing had ever delivered them.

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

This module's `20260503T141344_quote_requests_workflow.ts` migration
still creates the table, for historical reasons: it was the first
migration to need it. Since issue #1033 the statement is
`create table if not exists`, and the owner's own
`20261109T144721_organizations_reach_governor.ts` creates the table
with the same shape. The table's two indexes are created only by the
owner's migration. So a platform can migrate `organizations` without
this module, and installing this module later leaves the table and its
rows as they are. A database that has already applied the migration
does not run it again. `module:uninstall quote_requests --hard` never
drops the table, its rows or the triggers `organizations` puts on it.

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

Every change of a quote request that the other side should hear about is
**delivered**: the buyer side is e-mailed, gets an entry in the storefront
notification centre and, if they opted in, a push on their device; the operators
who handle the request get an entry on the admin bell and, for a new request, an
e-mail. Who was told, how, and whether it went out is shown on the request's
**History**.

### Who is told, and when

There are two sides.

- **The buyer side** is the customer account that raised the request **plus**
  every member of its organization who may open it on the storefront — today
  the holders of the organization's *Administrator* role. A member who holds
  only *Member* rights and did not raise the request is not told, because they
  cannot open it. Deleted, blocked and anonymised accounts are left out. In a
  personal (B2C) organization the buyer side is the requester alone. A
  requester who is also an *Administrator* is told once per channel.
- **The operator side** is the administrator the request is assigned to plus
  the sales representatives assigned to the organization, each only while
  active and holding `rfqs:handle`. When none of them remains — nobody is
  assigned, or nobody assigned may handle quote requests — **every active
  administrator holding `rfqs:handle`** is told instead, and nobody without it.

| Change | Buyer side | Operator side |
| --- | --- | --- |
| A buyer submits a request | e-mail; centre entry and push for everybody but the buyer who submitted | bell and e-mail |
| A buyer re-submits a request (a new request) | as above | bell and e-mail |
| A buyer accepts the offer | as above | bell |
| A buyer rejects the offer | as above | bell |
| The request expires | e-mail, centre entry, push | bell |
| An operator creates a request on the buyer's behalf | e-mail, centre entry, push | — |
| An operator saves a new offer (revision) | e-mail, centre entry, push | — |
| An operator approves the request | e-mail, centre entry, push | — |
| An operator cancels the request | e-mail, centre entry, push | — |
| An order completes the request | nothing — the order confirmation covers it | — |

The buyer whose own action caused a change gets the **e-mail** as a
confirmation but no centre entry and no push: they are looking at the result.
The buyer's own draft edits, notes, *Send PDF to customer* and the other
history entries tell nobody.

**Who is told is fixed when the change is saved.** At delivery each person is
checked again: an account that has since been deleted, blocked or anonymised,
has left the organization or may no longer open the request, and an
administrator who is no longer active or has lost `rfqs:handle`, is skipped. A
role change after the change was saved adds nobody.

### What each channel carries

- **Buyer e-mail** — one of nine e-mails in the *Quote requests* group of
  **E-mail templates**, in the default language of the request's sales channel
  (English for a request raised with no channel). It names the request number
  and links to the request on the storefront when the channel has a storefront
  address (the `sales_channels.storefront_url` setting, *Storefront URL*);
  without one it names the number and carries no link. The approval e-mail
  carries the link and **no PDF** — *Send PDF to customer* stays a separate
  action.
- **Centre entry** — one sentence naming the request by number, linking to the
  request, shown in the language the buyer is browsing in, on the request's own
  sales channel only (on every channel for a request raised with none). See the
  *Customer notifications* module's page.
- **Push** — the same sentence, under the title *Quote request update*, written
  in the default language of the request's sales channel (Polish or English;
  English for any other language), opening the request. It needs push switched
  on for the channel, quote pushes switched on (*Notify on quote status
  changes*), the buyer's own *Quote updates* choice left on, and a device the
  buyer subscribed on that channel. See the *PWA* module's page.
- **Bell entry** — one entry per administrator, naming the request by number
  only, linking to the request's admin screen.
- **Operator e-mail** — for a submitted or re-submitted request only, in the
  administrator's Admin UI language (Polish for Polish, English otherwise),
  naming the request number, the organization, the buyer who acted and the
  number of lines. It carries no link to the Admin UI yet; the bell entry does.

No centre entry, push or bell entry names a product, a price or an
organization: they are read outside the request's own screen, so they say the
number and nothing more.

### The e-mails

All eleven are switched on by default. Their subject and content are edited
per language and sales channel, or each e-mail is switched off, under
**E-mail templates**; each ships English and Polish defaults.

| Code | Sent to | When |
| --- | --- | --- |
| `quote_request_customer_submitted` | buyer side | a request is submitted |
| `quote_request_customer_resubmitted` | buyer side | a request is re-submitted as a new one |
| `quote_request_customer_offer_accepted` | buyer side | a buyer accepts the offer |
| `quote_request_customer_offer_rejected` | buyer side | a buyer rejects the offer |
| `quote_request_customer_expired` | buyer side | the request expires |
| `quote_request_customer_prepared` | buyer side | an operator creates a request on the buyer's behalf |
| `quote_request_customer_revised` | buyer side | an operator saves an offer awaiting the buyer |
| `quote_request_customer_approved` | buyer side | an operator approves the request |
| `quote_request_customer_canceled` | buyer side | an operator cancels the request |
| `quote_request_operator_submitted` | operator side | a buyer submits a request |
| `quote_request_operator_resubmitted` | operator side | a buyer re-submits a request |

Every e-mail can use `quote.number`, `customer.name` (the recipient),
`organization.name` and `channel.name`; the buyer e-mails also `quote.url`
(empty when there is no link, and the button is then left out). Per e-mail:
`actor.name` (the buyer who acted) for submitted, re-submitted, accepted,
rejected and both operator e-mails; `quote.previousNumber` for both
re-submitted e-mails; `reason` for rejected and canceled; `quote.validUntil` for
prepared, revised and approved; `quote.revisionNumber` for revised;
`quote.lineCount` for both operator e-mails.

### Late, failed and switched-off deliveries

- **24 hours at most.** A notification that could not go out within 24 hours of
  its change — a stopped worker, Redis down — is skipped as stale and never
  sent, on every channel. An expiry that became due more than 24 hours before
  the expiry sweep reached it notifies nobody (see *Background jobs*).
- **Retries.** A delivery that fails (the mail server refuses, an error) is
  tried again after 1 minute, 5 minutes, 30 minutes and 2 hours; the fifth
  failure records it as failed, with the last error. A retry never sends a
  second e-mail or push for an attempt that was already accepted.
- **An e-mail switched off** on **E-mail templates**, a buyer's *Quote updates*
  choice turned off, push switched off for the channel, no subscribed device,
  no mail server configured, or a recipient with no e-mail address: that one
  delivery is skipped, with the reason, and the other channels go out.
- **A receiving module switched off** — *Admin notifications* (the bell),
  *Customer notifications* (the centre) or *PWA* (push): its deliveries are
  skipped as *module off* when the worker reaches them, and are **not** sent
  later when the module comes back. Every other channel still delivers, and no
  quote request change ever fails because a channel is unavailable.
- **Quote requests itself switched off**: no change can happen, so nothing new
  is recorded, and the delivery worker stops. When the module is switched back
  on, the waiting deliveries go out — those still within their 24 hours.

### On the History

Under each **History** entry that notified anybody, the admin detail lists the
deliveries: the recipient (operator or customer, by name), the channel
(*Admin notification*, *E-mail*, *Account notification*, *Push notification*),
the outcome — *Pending*, *Sent*, *Failed*, or *Skipped* with the reason (older
than 24 hours, module off, switched off, no mail server configured, written to
the log only, no address or account, turned off by the recipient, no subscribed
device) — and the number of attempts. A failed delivery shows its last error
behind *Show error*. A person who can no longer be read is shown as an unknown
user. It needs `rfqs:handle`, like the rest of the History; the buyer's view of
the request never shows any of it.

### For developers

**Recording.** `RfqNotificationService.record(em, { change, sourceEvent, rfq, actor })`
(`src/backend/services/rfq-notification-service.ts`) writes one row of
`quote_request_notifications` per recipient and channel, **in the transaction of
the change** and its history entry: a transition that rolls back leaves no
record, and one that commits always has them. Who is told is data —
`src/backend/services/notifications/notification-matrix.ts`, the table under
*Who is told, and when* as code, and the only place recipients are decided —
and the two sides are resolved by
`notifications/recipients.ts` through published ports only
(`customerAccountReadPort`, `organizationRoleReadPort`,
`organizationSalesRepScopePort`, `adminUserReadPort`, `permissionService`). The
customer side's rule is `orgWideViewerRoleIds`, the same function the
storefront's visibility check uses, so a person is never told about a request
they would get a `404` for. A record is unique per (history entry, recipient,
channel).

**Delivery.** After each committing change the writer adds one job to the BullMQ
queue `quote_requests.notifications.deliver` (fixed job id
`quote_requests.notifications.kick`, not awaited; a failure is logged at `warn`
and never fails the transition), and a Job Scheduler on the same queue ticks
every minute. The table is the queue: a tick first asks, outside any tenant
scope, whether anything is due, and only then enters the system scope; it
delivers up to 200 due records, oldest first, each in a transaction of its own
locked `for update skip locked`, so several worker processes share the table.
The consumer is registered through `ctx.worker`, so nothing runs while the
module is off. `RfqNotificationDeliveryService`
(`notifications/delivery-service.ts`) closes each record in this order:

1. its change is more than 24 hours old → `skipped_stale`;
2. the channel's owner is not present → `skipped_module_off` (decided in front
   of the port; a `ModuleDisabledError` raised by the port all the same closes
   it the same way);
3. otherwise the channel's adapter (`notifications/channel-adapters.ts`)
   delivers it.

| Channel | Owner | Delivered through | Closing |
| --- | --- | --- | --- |
| `admin_in_app` | `admin_notifications` | `adminNotificationRecordPort.recordWithin(em, …)`, on the record's transaction | `sent` |
| `admin_email` | `transactional_emails` | `TransactionalEmailSender.send`, `salesChannelId: null` | by the sender's answer |
| `customer_email` | `transactional_emails` | `TransactionalEmailSender.send`, the request's channel | by the sender's answer |
| `customer_in_app` | `customer_notifications` | `customerNotificationRecordPort.recordWithin(em, …)`, `sourceModule 'quote_requests'`, `sourceKey` = record id, on the record's transaction | `sent` |
| `customer_push` | `pwa` | `customerPushPort.push(…)`, `category 'quote'`, `sourceKey` = record id; `pwa` commits on its own | by `pwa`'s answer |

The bell and centre entries commit with the record's closing, so each is
delivered exactly once. Every e-mail is sent with
`messageId = quote_request_notification:<record id>` and every push with the
record id as its key, so a retry after a crash between the transport's
acceptance and the commit produces no second message. The sender's answer maps
`sent` → `sent`, `logged` → `skipped_logged`, `deactivated` →
`skipped_deactivated`, `no_transport` (or no sender) → `skipped_no_transport`,
and `no_definition` → `failed` at once. `pwa`'s answer maps `enqueued` → `sent`,
`skipped:customer_preference` → `skipped_preference`, `skipped:no_subscription`
→ `skipped_no_subscription`, `skipped:no_account` → `skipped_no_recipient`, and
`skipped:switched_off` → `skipped_deactivated`. A recipient who no longer
qualifies, or has no e-mail address for an e-mail, closes
`skipped_no_recipient`. Any thrown error is a failed attempt: the attempt's
transaction rolls back, and the attempt is counted in a second one with the
next try backed off 1 min / 5 min / 30 min / 2 h; the fifth failure closes the
record `failed`, with the error (at most 2 000 characters, the recipient's
address replaced by `<recipient>`) in `last_error`.

The bell titles are `notifications.<change>.title`, the centre and push
sentences `customerNotifications.<change>.title` and the push title
`customerPush.title`, all in this module's `i18n/{en,pl}.json`. The e-mail
defaults are `src/backend/email-templates/quote-notification-defaults.ts`,
pushed through `emailDefaultsPort` at boot; the definitions are the
`transactionalEmails` of `src/manifest.ts`. The module declares
`degrades-without` edges on `admin_notifications`, `customer_notifications` and
`pwa`.

**History.** `GET /api/v1/admin/quote-requests/:id/history` adds an optional
`deliveries` array (`quoteRequestDeliverySchema` in
`@endora-commerce/contracts`) to every entry whose `eventIds` contain the
records' history entry: `id`, `channel`, `recipient` (`kind`, `id`,
`displayName`, `''` once the person is gone), `status`, `attempts`, `lastError`
and `closedAt`. An entry with no records has no `deliveries` key. The customer
`GET /api/v1/quote-requests/:id` never carries it.

The *Send PDF to customer* e-mail (see *Quote PDF*) is separate from all of
this: it is sent while the representative waits and recorded as its own
History entry.

## Archived products are never quote lines

A product archived with the Catalog module's **Archive** action cannot be put
on a quote request by any path; restore it first. What each path answers:

- **A customer** — creating a request, editing a draft and resubmitting it,
  and so converting a basket, a quick-order list or a shopping list into a
  request, or cloning an order into one — gets `404 PRODUCT_NOT_FOUND`,
  exactly what a product that does not exist gets, so nothing about the
  product is disclosed.
- **An operator** — `POST /api/v1/admin/quote-requests` (create on a
  customer's behalf) and `PATCH /api/v1/admin/quote-requests/:id` (modify) —
  gets `409 PRODUCT_ARCHIVED` ("Product is archived."), with the archived
  products' ids in `details.productIds`, and nothing is written. A product id
  that does not exist still answers `404 PRODUCT_NOT_FOUND`. A line that is
  unavailable for any other reason — switched off in the request's sales
  channel or language, outside its publication window or its audience — is
  still accepted there with the `PRODUCT_UNAVAILABLE_IN_SCOPE` warning.
- **Converting an approved quote** whose product was archived after approval
  answers `409` before the customer's basket is touched.

Price lists are not affected: an archived product can still be priced.

## Conversion to order

`POST /api/v1/quote-requests/:id/convert-to-order` fills the customer's
basket with the lines of an `Approved` quote request at the agreed unit
prices, and marks the basket with the quote request it was filled from. The
order placed from that basket records it (`source_quote_request_id`) — while
the quote request is still `Approved` and at least one line is still in the
basket at the agreed price; the Orders module's page says what drops the mark.

When an order is created with a populated `source_quote_request_id`,
an event subscriber inside the module flips the originating Quote
Request to `Completed` and populates `converted_order_id`, and nobody is
notified: the order confirmation covers it. A completed quote request cannot be ordered a second
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
  line of quantity 1 — at most 200 in one step. Inactive products may be
  added. Archived products are not offered: the browser has no Archived tab
  and its **All** tab leaves them out. Grouped and bundle parents are listed
  with their reason and cannot be ticked. A product already on the request can be added again, as a
  line of its own — for instance to put it in a second group.
- **Quick add by name or SKU**, beside it, appends one product under the same
  rules. An archived product is listed in its results, disabled, with the
  reason *archived*, as on the order create screen.

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

**The sales channel the request is raised on** is chosen under the customer,
among the active sales channels of the customer's organization. When the
organization has exactly one, it is preselected; when it has several, choose one —
**Create quote request** stays disabled until you do. When the organization has no
active sales channel, the screen says so and **Create quote request** stays disabled
until the organization is assigned to one. The channel is sent as
`salesChannelId`: the request is stored on it, its line names are taken in that
channel's default language, and its availability is judged there. The agreed
prices are prefilled on that channel too, and choosing another channel clears
every price not typed by hand and resolves it again. Without the field the
request is raised on the channel the admin request itself resolves to — the
system default, unless the request names another with `X-Sales-Channel`. Either
way the server checks the channel: one that is not one of the organization's
active sales channels — unknown, assigned only to other organizations, or
inactive — is refused with `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` before anything
is written, also when no channel was chosen and the fallback is not one of
them. When the organization's channels cannot be read — the read fails or is
refused, for instance on a network error — the screen says so with a **Retry**
button, and **Create quote request** stays disabled until they have been read;
while a retry is under way the button is inactive. Agreed prices are prefilled
only once a channel is settled.

When a line's product is not available to the customer on that channel —
switched off there, outside its publication window or outside its audience —
the request is still created and the answer names the line in `warnings` with
`PRODUCT_UNAVAILABLE_IN_SCOPE`. The screen then stays open and lists those
products under **Quote request created with warnings**, and **Open the quote
request** goes on to it; the request cannot be sent a second time from there.

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
| Quote request number | yes |
| Organization name | yes |
| Customer name or e-mail | yes |
| Customer's note | no |

A result shows the number, the organization, the date submitted and the status, and opens the quote request. Quote requests appear for a role holding `rfqs:handle`, with the same organization visibility as the Quote Requests list.
