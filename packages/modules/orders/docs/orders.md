---
title: orders
description: Order placement, status machine, payment + delivery linkage
---

# `orders`

Order placement, lifecycle, and access control. Composes the cart price
resolution, stock reservation, payment driver dispatch, invoice generation,
and audit logging.

## Public surface

Admin routes are gated by `orders:read` (read) / `orders:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/orders` | customer | Place order from active Cart |
| `GET /api/v1/orders` | customer | List orders scoped by Role (Regular vs Org Admin) |
| `GET /api/v1/orders/:id` | customer | Order detail |
| `GET /api/v1/orders/:id/invoice` | customer | Download invoice PDF |
| `GET /api/v1/admin/orders` | admin | List every order (cross-organization) |
| `GET /api/v1/admin/orders/:id` | admin | Order detail (bypasses customer scope) |
| `POST /api/v1/admin/orders/:id/status` | admin | Status transition (audited) |
| `POST /api/v1/admin/orders/:id/payment-status` | admin | Payment status transition (audited) |

## Which sales channel an order records

An order records one sales channel. Where it comes from depends on who places
the order:

| Surface | The order's channel |
| --- | --- |
| Storefront — `POST /api/v1/orders`, one-click buy | The channel **the request resolved**: `X-Sales-Channel`, `?salesChannel=`, the host map, else the system default |
| Admin order creation — `POST /api/v1/admin/orders` | The channel the operator chose for the order (`salesChannelId` in the body) |
| API key — the external order intake | The channel the key is bound to |

On the storefront the optional `salesChannelId` body field does not choose the
channel. A request that omits it is placed on the resolved channel; one that
sends the resolved channel's id is accepted; one that names a **different**
channel — another one, one that does not exist, or one that is switched off —
is refused with `422 VALIDATION_FAILED` and
`details.code = "order_sales_channel_mismatch"` (the details carry
`requestedSalesChannelId` and `resolvedSalesChannelId`), before anything is
written — the basket is left as it was.

In admin order creation the body's `salesChannelId` has to name an existing
channel: one that names no channel is refused with `404 NOT_FOUND` before
anything is written, the customer's basket included. The ordered products are
checked against **that** channel's assortment, not the one the admin request
itself resolved — a product the chosen channel does not sell is refused with
`404 PRODUCT_NOT_FOUND`, and one it sells is accepted even when the system
default does not sell it. Admin creation does accept a channel that exists but
is switched off, which the storefront refuses with `422`
`order_sales_channel_mismatch`. A product outside the chosen channel's
assortment is refused before the customer's basket is touched, so the basket
is left as it was.

What is read from an order's channel:

- at placement — the minimum order value (`orders.min_order_value`), the
  candidate warehouses and the channel's fulfilment settings, the order-number
  prefix and suffix, the extra confirmation recipients, and the channel id the
  payment and shipping adapters' validators are given;
- afterwards — the seller details and number sequence of its invoices, the
  language and channel of its order, payment and shipment e-mails, and whether
  it may be reordered (`orders.reorder_enabled`).

**The storefront has to name the channel on the placement request itself.** The
reference storefront forwards `X-Sales-Channel` on order placement, the
order-total preview, one-click buy and "order again as a quote request". One created by an earlier release did not; the steps are in
*Upgrading an instance*.

### What is not tied to the order's channel

- **The basket.** A basket is created on the system-default channel whatever
  channel the buyer is shopping, and three things are answered for the basket's
  channel rather than the order's: whether a product may be added (the
  assortment of the channel the *adding* request resolved — admin order
  creation, above, is the exception), the line prices,
  and the promotions — at checkout exactly as in the cart. On a multi-channel
  instance an order can therefore be recorded on a channel that does not sell
  one of its products, at the default channel's prices, and a promotion
  restricted to a non-default channel does not yet apply to an order placed
  there.
- **The buyer.** Recording the request's channel does not bind a buyer to a
  channel. `X-Sales-Channel` and `?salesChannel=` are sent by the client, and
  nothing restricts which channels a customer or an Organization may order on.

### Upgrading

**An instance with more than one sales channel.** Until this rule, a storefront
order that did not send `salesChannelId` in the body — which is every order
placed through the reference storefront — was recorded on the system-default
channel whichever channel the buyer was on. New orders placed on a non-default
channel's storefront are now recorded on that channel, so everything listed
above is read for it, and they appear under that channel in the order list and
in reports. Existing orders are not rewritten.

**An instance with one sales channel.** A storefront order used to reach the
minimum-order-value check with no channel at all, and a setting read with no
channel answers its platform-wide value. It now arrives with the default
channel's id, so a minimum order value set **for the default channel** rather
than for all channels is enforced at checkout where it was not before. The
payment and shipping adapters' validators are given that channel id too, where
they were given none. An instance that set the minimum platform-wide, or not at
all, sees no change.

## Method allow-lists at placement

An Organization can be restricted to a subset of delivery and payment methods
(see the `organizations` module, *Per-organization commercial scoping*).
Placement and both previews refuse a method outside a non-empty list with
`400 VALIDATION_FAILED`:

| `error.details.code` | Also carries | Meaning |
| --- | --- | --- |
| `delivery_method_not_allowed_for_organization` | `deliveryMethodId` | The Organization's delivery allow-list does not contain the chosen method |
| `payment_method_not_allowed_for_organization` | `paymentMethodId` | The Organization's payment allow-list does not contain the chosen method |

- **Where** — `POST /api/v1/orders`, `POST /api/v1/orders/preview-total`,
  `POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview`,
  `POST /api/v1/external/orders`, and every other caller of
  `orderPlacementPort.placeOrder`. One-click buy does not reach the refusal: a
  default method the list excludes makes the buyer ineligible
  (`one_click_unavailable`, reason `missing_defaults`).
- **Which Organization** — the one the order is placed for: the signed-in
  buyer's, the one an API key is bound to, or the customer's when an
  administrator creates the order. A request cannot name another.
- **Empty means unrestricted** — an empty list, or no list, allows every active
  method, and the two lists are independent.
- **Nothing is written** — no order, stock reservation or payment, and the
  customer's basket is unchanged. Admin create and the API-key intake check
  before they replace the basket.
- **Administrators are bound too** — by decision, an order created on a
  customer's behalf honours that customer's Organization allow-lists, and no
  setting exempts it. The create form lists every method; the preview and the
  create answer the refusal above for one the Organization does not allow.
- **When both methods are outside the lists** the delivery method is the one
  reported.
- **When the lists cannot be read** the request answers `500 INTERNAL` and
  nothing is placed, as the two method listings do.

## Methods and the order's sales channel

A delivery or payment method can also be restricted to sales channels (see the
`delivery_methods` and `payment_methods` modules, *Sales channels*). Placement
and both previews refuse a method that is not offered on **the order's** channel
with `400 VALIDATION_FAILED`:

| `error.details.code` | Also carries | Meaning |
| --- | --- | --- |
| `delivery_method_not_in_sales_channel` | `deliveryMethodId`, `salesChannelId` | The delivery method is restricted to sales channels and the order's is not one of them |
| `payment_method_not_in_sales_channel` | `paymentMethodId`, `salesChannelId` | The payment method is restricted to sales channels and the order's is not one of them |

- **Where** — the same routes as the allow-lists above. One-click buy does not
  reach the refusal here either: a default method the request's channel does not
  offer makes the buyer ineligible (`one_click_unavailable`, reason
  `missing_defaults`).
- **Which channel** — the one the order records; see *Which sales channel an
  order records* above.
- **No assignment means every channel** — a method assigned to no sales channel
  is offered on all of them.
- **Nothing is written** — as for the allow-lists, and admin create and the
  API-key intake check before they replace the basket.

### A method that fails both

The two refusals are independent, and on every route the Organization's
allow-lists are asked **before** the order's channel. So a method that is both
outside the Organization's allow-list **and** not offered on the order's channel
is refused with the allow-list code (`…_not_allowed_for_organization`); the
channel code (`…_not_in_sales_channel`) is what a method reports when the
Organization may use it — or has no list — and the channel does not offer it.

Where "the method is active" and the adapter's own validator fall between the
two differs by route:

- **Storefront placement and one-click buy** (`placeOrder`) — allow-lists, then
  the method is active, then its adapter's validator, then the channel.
- **Storefront preview** — allow-lists, then the method is active, then the
  channel; the adapter's validator is not run for a preview.
- **Admin order creation and the API-key intake** — allow-lists and the channel
  are both asked first, before the customer's basket is touched; the order then
  goes through `placeOrder`, which repeats them around the active and adapter
  checks. An inactive method that is also not offered on the channel therefore
  reports the channel code on these two routes, and "not active" on the
  storefront.
- **Admin preview** — allow-lists, then the channel; an inactive method is not
  refused by a preview.

## Status machine (configurable)

The order lifecycle is **admin-configurable**: statuses and allowed
transitions live in the `order_statuses` and `order_status_transitions`
tables, seeded on install with nine defaults — `new` (initial,
non-deletable), `pending`, `paid`, `processing`, `shipment_ready`,
`shipment_sent`, `completed` (terminal), `on_hold`, `cancelled` (terminal) —
plus the predefined edges and the universal `→ on_hold` / `→ cancelled` edges
(and `on_hold → any`). Admins manage them via the
`/api/v1/admin/orders/statuses` + `/transitions` endpoints; the graph is
cached in-process and re-validated on every edit.

`OrderTransitionService.apply()` is the single authoritative state machine:
it rejects transitions with no configured edge or out of a terminal status,
runs veto-capable **before-guards** (`onOrderTransitionGuard`), then emits the
templated events (below). Payment/shipping events drive automatic transitions
through the `OrderStatusRegistry` (the method `statusOn*` columns reference
these status codes); `payment_status` is retained as a derived/secondary field.

## What a transition owes: follow-ups

Cancelling an order gives back what the order was holding: its **stock
allocations**, and — for an order placed against a credit limit — its **credit
reservation**. Marking such an order paid gives back the credit reservation.
These releases are the transition's *follow-ups*.

A follow-up is recorded **in the same transaction as the status**, as a row in
`order_transition_effects`, and is run immediately afterwards, in the same
request. So in the ordinary case the stock and the credit are released by the
time the caller is answered. What changed is what happens when a release cannot
complete:

- **The transition is still applied, and the caller is told so.** Every refusal
  — an unknown status, no configured edge, a terminal source, a guard's veto —
  is decided before anything is written. Once the status is committed nothing
  can turn the answer into an error.
- **The release is retried until it completes.** A background sweep runs every
  minute and attempts every outstanding follow-up that is due, backing off from
  one minute up to one hour between attempts. There is no "gave up" state; from
  the fifth failure on, each further failure is logged at `warn` with the order
  id, the release and the last error.
- **Even the response cannot turn it into an error.** If the order cannot be
  read back for the response body after the commit, `POST
  /api/v1/admin/orders/:id/status`, `POST /api/v1/admin/orders/:id/payment-status`
  and `POST /api/v1/orders/:id/cancel` answer `200` with
  `{ data: { id, businessId, status, paymentStatus }, meta: { partial: true } }`
  (`orderCommittedWritePartialResponseSchema` in `@endora-commerce/contracts`).
  Check `meta.partial` before treating `data` as a whole order, and read the
  order again if the rest is needed.
- **Follow-ups are independent.** A credit release that fails does not keep the
  stock held, and the other way round.
- **The status events are always emitted** after the commit, whatever happened
  to the releases.

Repeating a transition to the status an order already has is a no-op, and that
is safe: what the status owes is recorded beside it and will run.

### With `inventory` or `credit_limits` switched off

A follow-up whose owning module is switched off **waits**. Nothing of that
module's is written while it is off, the wait is not counted as a failed
attempt, and the release runs within one sweep (a minute) of the module being
switched back on.

- With `inventory` off, a cancelled order keeps its allocations until the
  module returns.
- With `credit_limits` off, an order placed on credit can still be cancelled or
  marked paid; its reservation is released when the module returns. Placing a
  new order against a credit limit is still refused while the module is off.

### On the order page

The admin order page shows a notice while an order has follow-ups outstanding:
which release, whether it is waiting for a module, and how many attempts have
failed. The admin order response carries the same information as
`pendingEffects` — present only when something is outstanding, and never on the
buyer-facing order responses.

### Repairing orders stranded by an earlier version

Before follow-ups were recorded, a release that failed or was refused could
leave an order cancelled (or paid) while still holding stock or credit, with
nothing able to release it afterwards. Those orders have no follow-up row. An
operator command finds and repairs them. Run it in the root of your instance:

```bash
# List what would be released. Writes nothing.
pnpm run cli orders transition-effects-repair

# Release it.
pnpm run cli orders transition-effects-repair --apply
```

In a checkout of the Endora Commerce repository the same command is
`pnpm --filter backend run cli orders transition-effects-repair`, with the same
options. That form does nothing in an instance: the backend member there has
another name, so pnpm prints `No projects matched the filters` and exits `0`
without running the command.

The dry run prints every order found holding stock allocations or an active
credit reservation it should have given back, with what each holds. `--apply`
records the releases through the same follow-up mechanism, attempts them at
once, and writes one audit entry per page of orders; anything that does not
complete is retried by the sweep. Running it again finds nothing left.

**Run the dry run once after upgrading**, and read the list before applying it:
a release changes reserved-stock counters and available credit. The repair
never runs by itself.

**What the dry run cannot show.** It lists what each order's own rows say the
order holds. If somebody has already corrected a stock counter by hand for one
of those orders, the order is still listed — its allocation row is unreleased —
and applying it lowers the counter a second time, so less stock is reserved than
live orders actually hold (the counter is never driven below zero, which hides
the error rather than preventing it). Leave such an order out, or repair only
the orders you name; both options take the order id the list prints in
brackets and may be repeated:

```bash
pnpm run cli orders transition-effects-repair --apply --except=<order id>
pnpm run cli orders transition-effects-repair --apply --order=<order id>
```

If `inventory` or `credit_limits` is switched off, the command cannot ask that
module what orders hold. It says so, repairs the rest, and should be run again
once the module is back on.

## Entities

`Order`, `OrderItem`, `Payment`, `OrderStatus`,
`OrderStatusTransition`, `OrderTransitionEffect`, `OrderComment`,
`OrderListSavedView`, `OrderItemGroup` (an order's line groups — see *Line
groups*), and the
`organizations.order_confirmation_emails` column (owned by `organizations`,
read via a port). `OrderItem` snapshots the product + variant + unit price +
tax rate at placement so historical orders survive pricing / catalog changes.
It also copies the cart line's `price_source` — `agreed`, `base`, `catalogue`,
`buyer` or `sale`, the price-book step (or the quote agreement) that priced the
line — into `order_items.price_source`; the column is stored for reporting and
for a later promotions rule, and is not part of the order API's answer.

## Events emitted

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`. A
cancellation is announced as `order.status_changed.v1` with the new status and,
after it, as `order.cancelled.v1` — carrying `orderId`, `organizationId`,
`salesChannelId`, the status it was cancelled `from`, the `actor`, the `reason`
and the `businessId` — once the cancelling write has committed, whichever path
cancelled the order. `order.cancelled.v1` is internal to the event bus: outbound
webhooks deliver a cancellation as `order.status_changed.v1`. Each
transition X→Y additionally emits four **templated** events (built by
`events/order-status-events.ts`):
`order.status.from_<x>_to_<y>.before`, `order.status.from_<x>.before`
(synchronous, veto-capable) and `order.status.from_<x>_to_<y>.after`,
`order.status.to_<y>.after` (post-commit, isolated).

`order.created.v1` carries `orderId` and `organizationId`. For an order an
administrator created with an `origin` (see *Create on behalf* below) it also
carries that `origin`, unchanged; for every other order the key is absent.
The value travels wherever the event does — an outbound webhook subscribed to
`order.created.v1` receives it in the payload.

`order.created.v1` is emitted after the placement has committed, on every
placement path: a subscriber can read the order it names, and a placement
that fails announces nothing.

## Admin operations

- **Create on behalf** — `POST /api/v1/admin/orders` builds the customer's cart
  from admin-entered items and runs on-behalf `placeOrder`; the customer is
  emailed to pay it. The request may carry an optional
  `origin: { type, id }` saying where the order is being created from — `type`
  a lower-case identifier of the sender's own (letters, digits, underscores),
  `id` a UUID. The module validates the shape and hands the value on, unread,
  on `order.created.v1`: it is not stored, not returned and changes nothing
  about the order. A module that recognises the `type` may act on it — the CRM
  module links such an order to the opportunity it was created from. Only this
  request accepts it; a storefront placement cannot set one. The create screen
  (`/orders/new`) reads the same from its query string when another screen
  opens it — `originType`, `originId`, plus `organizationId`,
  `customerAccountId` and `salesChannelId` to preselect, and `returnTo`, a path
  inside the Admin UI to go back to once the order exists.
- **List** — `GET /api/v1/admin/orders` server-side filter/sort/search +
  per-status counts; `GET …/export` streams CSV; saved views via
  `…/list-views` — see *Saved views* below.
- **Bulk** — `POST …/bulk/status` (eligible orders move; skipped reported with
  reason — a skipped order has not moved) and `…/bulk/print-invoices`.
- **Comments** — admin/customer `…/:id/comments` with customer-visibility +
  notify flags; closed on terminal orders. The platform also writes internal
  **system notes** here for custom-field values not carried into the order —
  see *The system note* below.
- **Reorder** — `…/:id/reorder` rebuilds the cart (gated by
  `orders.reorder_enabled`); **clone-to-quote** — `…/:id/clone-to-quote`.

### The Create order screen

**Items and the order summary appear once the customer and the sales channel
are chosen.** They are the two inputs pricing needs; the payment method, the
delivery method and the addresses do not gate anything. Until both are set, one
hint names what is still missing. Clearing either field hides both sections
again without discarding the lines, which come back when the field is set. A
screen opened with `customerAccountId` and `salesChannelId` in its query string
shows **Items** at once.

**Products are added in two ways.**

- **Browse products** opens the admin's shared product browser on the
  **Active** tab: the catalogue in pages, with status tabs and their counts, a
  type filter and a search by SKU, slug or name. The selection survives page,
  page-size and filter changes, and **Add N** adds every ticked product as a
  line of quantity 1 — at most 200 in one step. Grouped and bundle parents,
  and draft and inactive products, are listed with their reason and cannot be
  ticked. A product already on the order can be added again: it becomes a line
  of its own (for instance in another group).
- **Quick add by name or SKU**, beside it, appends one product under the same
  rules.

Both are disabled, each with a hint, for an operator without `catalog:read`.

Each line shows the product's name and SKU, an editable quantity, the unit
price, the line total and a remove action. Changing a quantity, the customer,
the sales channel, the delivery method or the payment method prices the lines
again through `POST /api/v1/admin/orders/preview` (`orders:write`). A quantity
that is not a whole number of 1 or more marks the line, keeps it out of the
preview and blocks **Create order**.

**A line the preview cannot price shows why, and blocks Create order until it
is removed or the cause is fixed.** Each unavailable line carries exactly one
code — the first that applies, in this order — and shows one reason:

| Preview code | Line reason | What to change |
| --- | --- | --- |
| `PRODUCT_NOT_FOUND` | *No price* | The product is no longer in the catalogue: remove the line. |
| `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` | *The customer cannot see this product* | The product's visibility or its allowed organizations exclude the customer's Organization: change them on the product in the catalogue, choose another customer, or remove the line. |
| `PRODUCT_NOT_IN_SALES_CHANNEL` | *Not in this sales channel's assortment* | Choose a sales channel whose assortment holds the product, add the product to this channel's assortment, or remove the line. |
| `QUOTE_ONLY` | *No price* | The customer's price for the product is quote-only: remove the line, or create a quote request instead. |
| `UNPRICED` | *No price* | No price book prices the product for this customer, channel and currency — not even a base price: set a base price, remove the line, or create a quote request instead. |
| `BELOW_MINIMUM_QUANTITY` | *Below the minimum of N pcs* | The product's total on the order is below its minimum order quantity: raise the quantity, or remove the line. |

`BELOW_MINIMUM_QUANTITY` carries the `minimum` and is judged only over the
lines that passed the checks above it, summing each product's lines. The lines
are priced from the price books exactly as the customer's basket would price
them — one batched resolution for every line, at each line's own quantity and
variant — so the order created is charged what the preview showed. A
code the screen does not know is shown as *No price* as well. The other lines
keep their prices and the summary counts only the priced ones. The preview
checks the assortment of exactly the sales channel the request names; a
`salesChannelId` that names no channel is refused with `404 NOT_FOUND`, and the
screen shows *Could not calculate prices* without marking any line. A
soft-deleted product is priced as before. The order created is exactly the
lines and quantities on screen, in the `POST /api/v1/admin/orders`
payload.

**At most 200 lines.** `POST /api/v1/admin/orders` and
`POST /api/v1/admin/orders/preview` refuse more than 200 items as their first
step, with `422 VALIDATION_FAILED` and `details: { code: 'too_many_items',
maximum: 200 }`, before any line is evaluated. Create order also refuses a
request in which a product's total is below its minimum, with the minimum
error and `details.lines[]` keyed by the item's `index`.

**Line groups.** The screen's items can be sorted into named groups — *Add
group*, rename, delete, drag and drop, the keyboard and each line's *Move to
group* menu, exactly as on a quote request's *Modify* tab; a group's own *Add
product* adds to that group, anything else to *Ungrouped*. Each group shows its
item count, net, VAT and gross next to the live price summary; for that the
preview answers each priced line's `taxRate` (a fraction, `0.23`, from the
same authority as the summary's tax total; absent on a line it cannot price),
and a group's VAT is the sum of net × rate over its lines. Moving a line between groups does not price the order again. Every
group needs a name before **Create order** enables. See *Line groups* below for
what the order keeps.

**Split line.** A line of quantity 2 or more has a *Split line* button beside
*Move to group*. It asks for the quantity to move to a new line (from 1 to the
line's quantity minus 1) and the group of the new line — the line's own by
default — and adds a line of the same product with that quantity, reducing the
original. This is how one product goes into two groups: for example 5 pieces in
*Hall A* and 3 in *Hall B*. Each line is priced at its own quantity.

## Custom-field values carried into an order

An order can receive custom-field values from the record it came from, for every field whose
**Carry value to Order** option is on (set on **Custom Fields**; the rules — same key, compatible
type and options, the audience rule — are on that module's page). Only an empty order field is
filled, and only once.

- **From a quote request, at placement.** When the customer places an order from the basket filled
  by ordering an accepted quote request, and the order records that quote request (the same rules
  that decide whether it does: the request still approved, used by no other order, in the
  customer's organization, at least one agreed line still in the basket), the request's values —
  as they are at that moment — are written with the order itself. They are part of its creation,
  not a later edit. Nothing is carried when the order does not record a quote request, or while
  the Quote Requests module is switched off.
- **From a sales opportunity.** An order an administrator creates from an opportunity (**Create
  order** on its *Links* tab) receives the opportunity's values once the CRM module has linked it
  to that opportunity, in a separate change attributed to the **system**; the order's creation
  stays attributed to the administrator. An order linked to an opportunity by hand receives nothing.
- **Not the other way.** Cloning an order into a quote request carries no value.
- **Nothing fails.** A value that cannot be carried is skipped, and the order is placed or linked
  all the same.

For an order placed on a customer's behalf, the `order.place_on_behalf` audit entry lists the
carried keys as `carriedCustomFieldKeys`. A customer's own checkout writes no audit entry, as
before. The carried values are on the order from the start, so subscribers of `order.created.v1`
read them.

### The system note

When a value is skipped, the order's **Comments** tab holds one note by **System** for that
placement or link, marked *Internal*: *Not carried from quote request …:* or *Not carried from
sales opportunity …:*, followed by one line per skipped field — the name of the field it came from, as it
read when it was skipped, and the reason (no such field on the order, a different type, a field visible to
customers fed by an internal one, a value the field does not accept). Anybody who can open the
order can read it; it shows no value.

The note is never shown to the customer — not in the storefront and not on the customer's comments
endpoint — and sends no notification. It has no author: `systemNote` on the admin comment reply
(`GET /api/v1/admin/orders/:id/comments`) holds its structure — `kind`
(`custom_field_carry_skipped`), `source` (`entityType`, `recordId`, `reference`) and `skipped`
(`key`, `reason`, `label`) — and `body` holds an English sentence for any reader that does not
translate it. Every other comment answers `systemNote: null`.

## Custom-field filters

An order custom field whose **Use as list filter** option is on (set on **Custom Fields**) is
offered as a filter in the order list's advanced filters, labelled in your language: the text it
contains, a number or date range, yes or no, or one or more options. An order without a value for
the field never matches. Each custom-field filter is shown as a removable chip beside the other
active filters, narrows the total and every page, and returns the list to its first page when it
changes. The filters are in the page address, so a filtered list can be bookmarked or shared, and
the **CSV export** exports the same orders.

If the address names a filter that is no longer available — its option was switched off or the
field deleted — the list says so by the field's name and offers **Remove this filter**; the CSV
export is not offered until it is removed. API callers send the filters as `customFieldFilters` on
`GET /api/v1/admin/orders` and `GET /api/v1/admin/orders/export`, and read the offered fields
from `GET /api/v1/admin/orders/custom-field-filters` (`orders:read`). An inverted range (`min` above `max`, `from` after `to`) or an operator that does not apply to the field's type answers `400` `VALIDATION_FAILED`.

## Saved views

A saved view is a named set of order-list filters that an admin can apply again
with one selection.

### Using saved views

The order list's toolbar carries a **Saved views** selector, whose first entry
is **— Select a view —**, and two buttons beside it: **Save view** and
**Delete view**.

- **What a view remembers.** Every filter on the order list — status, payment
  status, sales channel, payment method, delivery method, the date range, the
  search text, the organization and customer names, the total range and the
  custom-field filters — plus the sort and the visible columns. A custom-field
  filter that is no longer available when the view is loaded is dropped, with a
  notice naming it, and the rest of the view loads. Choosing a view replaces all of them with
  the view's values: a filter the view does not hold is cleared, anything you
  had changed and not saved is discarded, and the list goes back to its first
  page.
- **Saving.** **Save view** opens one dialog with a **Name** field and a
  **Share with every admin who can open this list** checkbox. The checkbox
  starts unchecked, so a new view is private unless you tick it. The name is
  required, leading and trailing spaces are removed, and it can be at most 160
  characters long. Problems are shown on the field and nothing is sent until
  they are fixed; a refusal from the server is shown inside the dialog, which
  stays open with what you typed.
- **Private or shared.** A private view is listed only for you. A shared view
  is listed for every admin who can open the order list, with **(shared)** after
  its name. The selector does not show who saved a shared view.
- **One name per admin.** You cannot hold two views on this list whose names
  differ only in letter case or in surrounding spaces. The dialog answers
  **You already have a view with this name.** before sending anything, and the
  server refuses the name as well. Accented letters are different letters:
  *Zamówienia* and *Zamowienia* are two names. Names other admins use, and names
  used on the product or quote request list, do not count. Views whose names
  already clashed before this rule existed were kept as they are.
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
- **Only save, load and delete.** The Admin UI does not rename a view, change
  whether it is shared, or overwrite it with the current filters; save a new
  view and delete the old one instead. There is no limit on the number of
  views.

### Saved views API

| Method and path | Answers |
| --- | --- |
| `GET /api/v1/admin/orders/list-views` | `200` — the caller's own views plus every shared view, ordered by name |
| `POST /api/v1/admin/orders/list-views` | `201` — the created view |
| `PATCH /api/v1/admin/orders/list-views/:id` | `200` — the modified view; any of `name`, `shared`, `filters`, `sort`, `visibleColumns`. The Admin UI does not call it. A body that changes nothing — empty, or every value as stored — writes nothing, logs nothing and answers the current view |
| `DELETE /api/v1/admin/orders/list-views/:id` | `200` — `{ data: { deleted: <id> } }` |

- **Gate.** All four routes are gated by `orders:read`; there is no separate
  permission code. A request without an admin actor is refused with
  `401 UNAUTHORIZED`.
- **Body.** `name` (trimmed, 1–160 characters, no Unicode control or format
  characters), `shared` (boolean), `filters` (an object, at most 8192 bytes as
  UTF-8 JSON), `sort` (`{ field, dir }`, `field` at most 64 characters, `dir`
  `asc` or `desc`; required on create) and an optional `visibleColumns` (at most
  64 ids of at most 64 characters each, or `null` for the default columns).
  Anything outside those bounds is `400 VALIDATION_FAILED`. The shapes are
  `createOrderSavedViewRequestSchema` and `updateOrderSavedViewRequestSchema` in
  `@endora-commerce/contracts`.
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
- **Refusals.** An absent view, or another admin's private view, is
  `404 NOT_FOUND` — the two are indistinguishable. A shared view the caller
  neither owns nor may modify as a platform admin is `403 FORBIDDEN`. A name
  whose key the view's owner already uses on this list is
  `409 ORDER_SAVED_VIEW_NAME_TAKEN`, *"You already have a saved view with this
  name on the order list. Choose a different name."*, in the request's
  language.
- **The name key** is the name trimmed and lower-cased, compared as
  `lower(btrim(name))` in PostgreSQL — no accent folding. The rule binds the
  view's **owner**: a platform admin renaming a colleague's shared view is
  refused when the colleague already uses that key. Creating a view and
  changing a name's key take a transaction-scoped advisory lock keyed on the
  owner, so two concurrent saves under one name leave exactly one view. Rows in
  `order_list_saved_views` that already shared a key were left alone; the rule
  applies to writes only, and a stored name may be longer than the write rule
  allows.
- **No audit.** Saved views are personal UI configuration and do not run
  through the Command Bus. When an admin modifies or deletes a view they do not
  own, the service writes one `info` log record:
  `{ event: 'saved_view.updated' | 'saved_view.deleted', list: 'order_list_saved_views', viewId, ownerAdminUserId, actorAdminUserId }`.
  That log line is the only trace.
- **Storage.** `order_list_saved_views` (`OrderListSavedView`) is
  platform-global, not organization-scoped: it holds filter values, never list
  results, and every list read after a view is applied runs under the loader's
  own scope.

## An order placed from an accepted quote request

An order placed from the basket an accepted quote request filled records that
quote request in `sourceQuoteRequestId` (`orders.source_quote_request_id`). The
Quote Requests module completes the quote request when it sees such an order,
and other modules read the field to tell which order a quote request became.

The basket only carries a claim, and placement checks it against the quote
request as it is at that moment. The order records the quote request when all
four hold:

- the quote request belongs to the **same organization** as the order;
- it is still `Approved` — not canceled, expired or already completed;
- **no other order records it already** — when two people of one organization
  each turned the same quote request into a basket, the first order placed is
  the quote request's and the second is an ordinary order;
- the basket still holds at least one of its lines — the same product and
  variant at the agreed unit price.

Otherwise the order is placed all the same and records nothing; the refusal is
logged, never shown to the buyer. No request body carries the field: the
storefront, the admin create-order screen and the external order API cannot
name a quote request.

With the Quote Requests module switched off, orders are placed exactly as
before and record no quote request.

## Line groups

An order can show its lines in **named groups** — *Hall A*, *Hall B* — with the
lines without a group under **Other items**. Groups are presentation only: they
change no price, quantity or total. An order gets them in one of two ways, and
**never changes them afterwards**: no screen and no API edits a placed order's
grouping.

**From an accepted quote request.** When placement records the quote request
the basket came from (see the previous section), the order copies the quote's
groups in the same transaction. Each order line is matched to a quote line:
first every line with the **same product, variant, agreed quantity and agreed
unit price**, then by product, variant and price, then by product, variant and
quantity, and finally by **product and variant** alone, each quote line used
once. So a product split over two groups of the quote — 5 pieces in one, 3 in
another, at one price — keeps each line in its group.
A matched line takes the quote line's group and order; a line that matches
nothing — added to the basket after the conversion, or changed so it no longer
matches — goes under *Other items*, after the matched ones. A quote group that
receives no line is not copied. When placement does not record the quote
request, or the Quote Requests module is switched off, the order is placed
without groups, otherwise exactly as before. A later change to the quote leaves
the order's groups alone.

**From the Create order screen.** An operator arranges the lines into groups
before creating the order (see *The Create order screen*); the order is created
with them in the same transaction, and a refused creation writes no group.
Groups without a line are not created. **One product may be on several lines**
— in two different groups, or twice in one: each request line becomes an order
line of its own, in its own group, priced at its own quantity (a product's
minimum order quantity is still judged on its total across its lines).
`POST /api/v1/admin/orders` takes an optional `groups` list
(`{ key, name }`, in display order, at most 50, names of 1 to 120 characters)
and per item an optional `groupKey`. The grouping is recorded in the
`order.place_on_behalf` audit entry (each group's name and line count); a
buyer's own checkout stays unaudited, as before.

**Where they are shown.** The admin order screen and the buyer's order page
show each group as a headed section with its lines and a summary — item count,
net, VAT and gross, adding up the rows above it — then *Other items*. An order
without groups, and every order placed before groups existed, looks exactly as
before. Every order reply — admin, customer and the external order API —
carries `itemGroups` (`{ id, name, position }`) and, per line, `groupId` and
`position`, lines in display order; an integration that ignores them keeps
working.

**What does not carry groups.** Invoices, returns, reorder (it fills a basket),
*order again as a quote request*, the cart and checkout, e-mails, webhooks and
the external order intake. There is no order PDF.

## Order minimums at placement

Placement applies the catalogue's minimum order quantities to every basket
line — the product's minimum in pieces and each packaging unit's minimum in
units, counted over every line of the product (the Catalog module's page
defines both). It is the last word on every path that ends in an order:
checkout, one-click buy, a reorder, a basket filled from a quote request, the
admin's Create order and the external order API.

- **Before any side effect.** The check runs inside the placement transaction
  right after the basket is read — before the order value and credit checks,
  the order number, and any stock or credit reservation. A refusal writes
  nothing.
- **What it answers.** A line whose product record is gone →
  `404 PRODUCT_NOT_FOUND` with `details.cartItemIds`. A line below a minimum →
  `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]`, one entry
  per offending line (`cartItemId`, `productId`, `productName`, `kind`,
  `minimum`, `packagingUnitName`). The sentence and the product names are in
  the language the response is answered in: an administrator's stored
  language, otherwise the request's `Accept-Language` (q-weights honoured),
  otherwise the channel's default language.
- **The checkout preview says the same first.** `POST /api/v1/orders/preview-total`
  answers `belowMinimumLines[]` — the lines placement would refuse, with the
  same exemptions; a line whose product is gone has `kind: 'product_unavailable'`
  and no name or minimum. The storefront lists them and disables **Place
  order**. The preview takes no lock, so under a race placement decides.
- **A basket filled from an accepted quote request.** The Carts module exempts
  each line seeded from the quote while its quantity equals the quote's.
  Placement and the preview honour that exemption **only while the quote
  request is still valid at that moment**: it exists, belongs to the buyer's
  organization, is still `Approved` — not canceled or expired, its validity not
  ended — no order records it yet, and the basket still holds at least one of
  its lines at the agreed price. Otherwise every line is judged like any other.
  The check and its lock run at the start of placement, so the exemption is
  decided before anything is written. With the Quote Requests module switched
  off, nothing can vouch for the quote and no line is exempt.
  The preview's check is also published as `orderQuoteSourcePort`, which the
  Carts module asks when a basket is submitted for approval, so submit judges a
  quote-seeded line as the preview does; placement confirms the quote again.
- **External order API** (`POST /api/v1/external/orders`) and admin Create
  order build the basket from the request and judge each product's total over
  the request's lines; a below-minimum request is refused whole, with
  `details.lines[]` keyed by `index`. The request is judged on its own — the
  basket it replaces counts toward nothing — and refused **before** the
  customer's basket is touched, so a refused request leaves that basket exactly
  as it was. The same holds for a line with no price or one sold on request
  only: it is priced before the basket is replaced. Neither carries a packaging unit, so only
  the pieces minimum applies there. **Both refuse more than 200 lines** with
  `422 VALIDATION_FAILED`, `details.code = 'too_many_items'` — on the external
  API this is checked first, before the `Idempotency-Key` header is required,
  and leaves no idempotency record.

## Returnable at purchase

Each order line records whether its product was returnable when the order was
placed (`order_items.returnable_at_purchase`), on every placement path. Later
changes to the product's **Returnable** flag do not change it. A line whose
product record or flag cannot be read at placement is recorded as **not
returnable**, never left empty. Lines of orders placed before this column
existed hold `null`, which the Returns module treats as returnable. The value
reaches Returns through `OrderReturnContextPort` (`returnableAtPurchase` on each
line); Returns reads no Orders table. Placement records it whether or not the
Returns module is switched on.

Migration `20261016T082022_orders_order_item_returnable_at_purchase.ts` adds
the column (nullable).

## Settings

`orders.min_order_value` (number, gates Checkout + admin create),
`orders.reorder_enabled` (boolean), `orders.confirmation_recipients`
(string list) — all global or per-sales-channel. Plus per-org
`order_confirmation_emails`. The confirmation email CCs the customer + org
list + scope list (best-effort, never blocks placement).

## Order-confirmation e-mail

After a successful checkout, `OrderService.placeOrder` dispatches a
confirmation e-mail (post-commit, best-effort — a mail failure never undoes a
placed order). Built by `email-templates/order-confirmation.ts`, it contains
the ordered products with amounts, the delivery method + cost, the payment
method with any additional payment cost (e.g. `+5.00 PLN` for cash on
delivery), the applied discounts, the order-total summary, and both the
shipping and billing addresses. The payment line is rendered through the
payment e-mail renderer registry (`payments/services/payment-email-renderer.ts`)
— an adapter's `renderers.email` key overrides the platform default.

## Extension points

- **Payment adapters** — see the `payment_methods` module. `placeOrder`
  dispatches start-payment through the `PaymentAdapterRegistry`; new methods
  register an adapter rather than editing the order service.
- **Access scoping** — `order-access-service.ts` is the single place that
  enforces the Regular User / Organization Admin / Admin User scoping rule;
  add new actor kinds here.
- **Panels on the order screen** — the admin zone `order.detail.after` is
  mounted once at the end of an order's screen, below its tabs, and hands a
  contribution `{ orderId }`. A module adds a panel by declaring
  `zoneComponent('order.detail.after', …)` in its own admin contributions; this
  module names no contributor. With nothing contributed — no such module, the
  module switched off, or a person without the panel's permission — the zone
  renders nothing and the screen is exactly the one without it.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds orders. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| Order number | yes |
| Organization name | yes |
| Customer name or e-mail | yes |
| Billing company name | no |
| Billing tax ID | no |

A result shows the order number, the organization, the date placed, the total and the status, and opens the order. An exact order number is listed first. Orders appear for a role holding `orders:read`, and a sales representative sees only the orders of the organizations assigned to them — the orders the Orders list shows them.
