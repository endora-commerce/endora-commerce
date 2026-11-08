---
title: Returns
description: Returns and complaints (RMA) — submission, verification, reverse-logistics shipments and settlement over a configurable status graph
---

# Returns (`returns`)

Returns & complaints (Refunds, RMA). Manages the lifecycle of a return or
complaint case raised against a completed order — submission, verification and
RMA-number assignment, reverse-logistics shipments, and settlement (money
refund, store credit, replacement, or repair) including the corrective invoice.
Mirrors the `orders` module's configurable status-graph workflow.

## Public surface

Admin routes are gated by `returns:read` (read) / `returns:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/orders/:orderId/returnable` | customer | Returnable lines + eligibility for an order |
| `POST /api/v1/returns` | customer | Open a return/complaint case |
| `GET /api/v1/returns` | customer | List the caller's cases, or the Organization's (see *Who may open, see and act on a case*) |
| `GET /api/v1/returns/:id` | customer | Case detail (customer-visible comments only) |
| `POST /api/v1/returns/:id/comments` | customer | Reply on a case |
| `POST /api/v1/returns/:id/select-delivery-method` | customer | Choose a return delivery method |
| `POST /api/v1/returns/:id/cancel` | customer | Withdraw the case |
| `GET /api/v1/returns/reasons` | customer | Active reasons for the storefront form |
| `GET /api/v1/admin/returns` | admin | List/filter/search cases + per-status counts |
| `GET /api/v1/admin/returns/export` | admin | CSV export of the current view |
| `POST /api/v1/admin/returns/bulk-transition` | admin | Bulk status change (skips disallowed) |
| `GET /api/v1/admin/returns/:id` | admin | Case detail (incl. internal comments) |
| `POST /api/v1/admin/returns/:id/authorize` | admin | Assign RMA number, advance to `authorized` |
| `POST /api/v1/admin/returns/:id/reject` | admin | Reject with a mandatory reason |
| `POST /api/v1/admin/returns/:id/transition` | admin | Guarded status transition |
| `GET\|POST /api/v1/admin/returns/:id/settlement` | admin | Prefill / execute settlement |
| `GET\|POST /api/v1/admin/returns/:id/comments` | admin | List / add comment (visibility + notify) |
| `GET\|POST /api/v1/admin/returns/:id/shipments` + `/:shipmentId/receive` | admin | Return shipments |
| `GET\|POST /api/v1/admin/returns/list-views` | admin | The caller's own saved views plus every shared one / save a view |
| `PATCH\|DELETE /api/v1/admin/returns/list-views/:id` | admin | Change / delete a saved view (owner, or a platform admin for a shared one) |
| `…/statuses`, `…/transitions`, `…/reasons`, `…/delivery-methods` | admin | Configuration |

## Who may open, see and act on a case

On the storefront a buyer's reach follows their organization role. This module
declares two organization permissions, which an Organization's administrator
grants per role:

| Permission | Code | *Member* holds it |
| --- | --- | --- |
| **Create returns and complaints** | `returns.create` | yes (member default) |
| **View the organization's returns and complaints** | `returns.view_organization` | no |

*Administrator* holds both, as it holds every permission. One code covers returns
and complaints alike: they are one form and one route.

- **Opening a case** (`POST /api/v1/returns`) needs `returns.create`. Without it
  the request is refused `403 ORGANIZATION_PERMISSION_REQUIRED`, naming the
  permission, before the order is read; nothing is created.
- **Which orders a case may be opened for**: any order the buyer may read — the
  orders they placed, and a colleague's order when their role holds the `orders`
  module's **View the organization's orders** (`orders.view_organization`). The
  rule is the `orders` module's, through `OrderReadPort.findByIdForCustomer`, so
  it matches the order list. An order out of reach answers `404` to the
  returnable-lines read and to the submission alike. A case opened from a
  colleague's order is filed in the name of the member who opened it: its
  e-mails go to them, and the colleague who placed the order sees the case only
  with `returns.view_organization`.
- **Seeing cases** (`GET /api/v1/returns`, `GET /api/v1/returns/:id`): the cases
  the buyer filed, or — with `returns.view_organization` — every case of their
  Organization, and of its subtree for a head-office login with roll-up enabled.
  Roll-up widens the reach; it never grants the permission. A case out of reach
  answers `404`, never `403`. Each case in the list carries `customerAccountId`,
  the member who filed it.
- **Acting on a case** — commenting, attaching files, choosing the return
  delivery method and cancelling — stays with the member who filed it, whatever
  anyone else's permissions; to anyone else these requests answer `404`. None of
  them needs `returns.create`, so a member whose role loses it can still follow
  up the cases they already filed. Reading an order's returnable lines needs no
  permission either.

Before organization roles, every buyer — administrators included — saw and
opened cases for the orders they placed only. *Member* keeps exactly that; an
administrator now sees every case of the Organization and may open a case from a
colleague's order.

On the storefront:

- **Returns** (`/returns`) lists the cases the member may see. A colleague's case
  is marked *Filed by a colleague*. **Start a new return** is offered only to a
  member whose role holds `returns.create`; the order page offers its return or
  complaint entry on the same rule.
- Without `returns.create`, the new-case page (`/returns/new`) says so instead of
  showing the form: *"Your role does not include the “Create returns and
  complaints” permission, so you can't start a return or a complaint. Ask your
  organization's administrator if you need it."*
- A colleague's case opens read-only. The page offers no comment box,
  attachment upload, return delivery choice or cancel button, and says why in
  one line: *"This case was filed by a colleague. You can read it, but only they
  can add messages or change it."* The filer's messages are labelled
  *Colleague*, not *You*.

When the module is switched off, both permissions leave the Organization's
permission catalogue and every member's effective permissions; a role's stored
grant is kept and applies again when the module is switched back on.

## Status machine (configurable)

The case lifecycle is **admin-configurable** (`return_statuses` +
`return_status_transitions`, seeded on install). Defaults:

- **new** (initial) → **authorized** → **received** → **resolved** → **closed** (terminal)
- **rejected** (terminal) reachable from new/authorized/received; **cancelled** (terminal) from new/authorized.

Transitions are enforced; the initial status is immutable; terminal statuses
have no outgoing edges. Each transition emits templated `return.status.*`
before/after events and is written to the audit log.

## Key behaviours

- **Eligibility & free-return window** — a case is allowed once the order
  reaches its fulfilment-completing status; the free-return window
  (`returns.free_return_days`, default **14** per EU Directive (EU) 2023/2673)
  is counted from that moment and governs who bears the return shipping cost.
- **RMA numbering** — `${prefix}${sequence}${suffix}` from
  `returns.rma_number_prefix` / `returns.rma_number_suffix`, assigned on
  authorization, unique and never reused.
- **Partial / repeat returns** — per-line quantity up to the remaining
  returnable amount, excluding quantities already covered by non-rejected /
  non-cancelled cases.
- **Settlement** — per-line refund defaults to the amount paid for the returned
  quantity and may never exceed it. For an order placed under the per-rate VAT
  method that amount is the drop in the value of the goods the buyer keeps: what
  was left paid less what the kept goods are worth after the return (VAT per
  rate on the kept nets, less the discount they carry), so it can differ by a
  cent from the returned units' own value and the order's returns together still
  refund exactly what was paid. Resolutions: refund (money), credit (tops up
  the organization's `credit_limits` grant), replacement, or repair. A corrective
  invoice (`invoices` kind `correction`) is requested for money/credit settlements.
  An order that was never invoiced has no VAT document to correct, so none is
  issued: the settlement succeeds, the refund is recorded on the return case and
  the payment record, and the result states `correctiveInvoice: { issued: false,
  reason: "order_not_invoiced" }`. The invoice issued later lists only what the
  buyer kept: a return settled with a refund or a credit takes its quantity off
  the order line, a line returned in full is left off, and the discount the
  refund carried comes off the invoice's discount line. On an order that was
  invoiced, a return's correction credits the returned goods and leaves on the
  invoice the VAT per rate on the nets the buyer kept.
- **A complaint refund is a price reduction** — a complaint settled with a
  refund or a credit leaves the goods with the buyer, so on an invoiced order
  its correction credits the approved amount at the line's VAT rate as a price
  reduction: quantity 0, no share of the order discount, and no effect on the
  quantity a later return of the line is credited from. A complaint resolved by
  replacement or repair issues no correction. A complaint refunded before the
  order was invoiced currently shows on the invoice as amount due.
- **The default refund is recomputed at settlement** — the figure a case shows
  when it is opened is provisional. The settlement recomputes it, one
  settlement of an order at a time, from the cases settled by then. Only a
  return settled with a refund or a credit takes goods off what the buyer
  keeps; a rejected, replaced or repaired case and every complaint take nothing
  off. So the figure can move by a cent or two when cases are settled in a
  different order from the one they were opened in, or after an earlier case
  was rejected. The settlement form shows the recomputed figure. An approved
  amount equal to a default the case showed settles at the recomputed default,
  a lower amount is kept as typed, and a higher one is refused with
  `422 VALIDATION_FAILED` (`code: refund_exceeds_paid`) with nothing written:
  reload the form and confirm. The `return.settled` audit entry records a
  default that moved (`recomputedDefaults`).
- **No line refunds more than it was paid** — a complaint refund counts against
  the line it names, and the unabsorbed part of it counts against what is left
  paid for the order: once a return of the line has been cut by the complaint,
  that amount is not counted twice. A later
  return of that line still gets its full default, until the line's refunds,
  the complaint included, reach what the line was paid; from then on the
  case shows, and the settlement form offers, at most what is left of it, and
  the audit entry records the bound (`lineCeilings`). The platform cannot tell which unit came
  back. Before settling a return, check the order's other cases for an earlier
  complaint on the same line: if the defective unit the complaint compensated
  is the one coming back, lower the amount by hand.
- **A consumer's withdrawal refunds the delivery and the payment surcharge**
  (Directive 2011/83/EU art. 13(1), Polish Consumer Rights Act art. 32 ust. 1).
  The case that brings back the last returned unit of a B2C order (the order's
  organization is a personal one) refunds the order's delivery cost and payment
  surcharge as well as the goods. All of these must hold:
  - the case is a return, not a complaint;
  - with this case, every unit of every order line has come back in a return
    settled with a refund or a credit. An order with a line that could not be
    returned can never be withdrawn in full, so it never refunds them;
  - the case is settled as a refund or a credit. A replacement or a repair
    refunds neither charge.

  A partial withdrawal refunds neither charge, and the settlement form does not
  offer them. The settlement form shows a *Delivery cost* row and a *Payment
  surcharge* row, each with what was paid as its maximum. The row is filled in
  with the full amount when the case was opened within the withdrawal window:
  14 days from the order's completion, or the channel's
  `returns.free_return_days` when that is longer. A channel set to `0` still
  has the 14 days. Outside the window the row starts at 0 and you may raise it
  to what was paid. Lower the delivery to the price of the cheapest standard
  delivery when the customer chose a more expensive one (art. 13(2)). An amount
  above what was paid is refused with `422 VALIDATION_FAILED`
  (`code: refund_exceeds_paid`). Through the API, send
  `deliveryRefundAmount` and `surchargeRefundAmount`; when you leave them out,
  the prefilled amounts apply. The case's `totalRefundAmount` then includes the
  charges, so it is more than the sum of the lines. The case detail reports
  them as `chargeRefunds`, and the `return.settled` audit entry records each
  one's maximum and the approved amount (`charges`). A business customer's
  return and every complaint are unchanged.

  On an invoiced order, the correction credits the delivery and the surcharge on
  lines of their own, at the VAT rate the invoice charged them at (0 % today).
  When everything came back and was refunded, the invoice nets to zero. On an
  order not invoiced yet, the invoice issued later charges only what is left of
  each charge, and leaves a line out when nothing is left. So a premium delivery
  reduced to the standard price is invoiced alone for the difference. When
  everything was refunded, there is no sale left and the invoice is refused.

  Cases settled before this behaviour existed are not changed. To find B2C
  orders that were returned in full without a delivery refund, see the upgrade
  guide.
- **A switched-off payment gateway refuses the settlement**.
  Money resolutions on a gateway-paid order call the PSP module that took the
  payment; when an operator has that module switched off — or the deployment
  does not offer it — the settlement answers `503 MODULE_DISABLED` naming the
  module, with `Retry-After`. Nothing moves: the case keeps its status, no
  `refunds` row is written, no corrective invoice is issued and no customer
  e-mail goes out. Switching the module back on is the whole remedy. This is
  distinct from a deployment that has **no** PSP refund integration at all,
  which still settles as `pending_manual` for a person to pay out by hand —
  there is nothing there to switch on.
- **Saved views on the Returns list** — the *Saved views* control above the
  list stores its status, kind and RMA-number filters and its sort (the list
  has no column picker), privately or shared with every admin who can open the
  list. The four `list-views` routes are gated by `returns:read` and follow the
  same rules as the order, product and quote request lists' saved views: names
  are trimmed, 1–160 characters, without control or format characters; one
  admin cannot hold two views whose names differ only by case or surrounding
  spaces (`409 RETURN_SAVED_VIEW_NAME_TAKEN`); `filters` is capped at 8 KB,
  `visibleColumns` at 64 entries of 64 characters and `sort.field` at 64
  characters; `shared` and `sort` are required on create. Another admin's
  private view and an id that is not a UUID both answer `404`; a shared view
  is changed or deleted by its owner or by an admin whose access is not
  restricted to a set of organizations (`403` otherwise). List items carry
  `ownedByCaller` and `canModify`, and `DELETE` answers `{ data: { deleted:
  <id> } }`. Views saved before these rules keep their names as stored —
  including blank names and duplicates — until their owner renames or deletes
  them; a change that leaves the name alone is never refused for it.

## Returnable products

Whether a line may be returned is decided by the product's **Returnable** flag
as it stood when the order was placed — the Orders module records it on each
order line at placement, and later changes to the product do not reach orders
already placed. The flag is set on the product in the catalogue (the Catalog
module's page describes it, including how to set it for many products at once
through **Bulk edit**).

- **Per-line answer.** `GET /api/v1/orders/:orderId/returnable` gives each line
  `returnable` (always present) and, for a line that may not be returned,
  `notReturnableReason: 'product_not_returnable'`. A line of an order placed
  before the flag was recorded carries no recorded value and **counts as
  returnable**.
- **`eligible` answers for return-kind cases only.** The order-level verdict
  is, in this order of precedence: `order_not_completing`, `fully_returned`,
  then `no_returnable_lines`. `eligible: false` with
  `reason: 'no_returnable_lines'` means the order still has quantities left
  but none of them on a returnable line: **no return can be opened, but a
  complaint still can.**
- **A return naming a non-returnable line is refused.** `POST /api/v1/returns`
  with `kind: 'return'` answers `422 RETURN_LINE_NOT_RETURNABLE` when any
  requested line was recorded as not returnable, with `details.productName`
  (the first such line), `details.orderItemIds[]` and `details.lines[]`
  (`orderItemId`, `productName`) naming every such line. Nothing is written.
- **Complaints are never restricted** by the flag: a `complaint` may name any
  line of the order. **Nothing is refunded for a non-returnable line by
  default**: such a complaint line is stored with an approved refund of `0`,
  while its default refund stays the amount paid — the most the operator may
  approve. The admin case view marks the line **Not returnable at purchase**
  and the settlement form starts from `0` for it, so a refund or credit for it
  happens only when the operator enters an amount. The case detail gives each
  line `returnableAtPurchase` (`true`, `false`, or `null` for a line placed
  before the value was recorded).
- **Duplicate lines are summed.** When a request names one order line more
  than once, the quantities are added up per order line and that total is
  checked against the line's remaining quantity, for both kinds; a total above
  it is refused with `422 VALIDATION_FAILED`, `details.code:
  'qty_exceeds_returnable'`. The entries are still stored as sent.
- **Order of the checks.** A line that does not belong to the order
  (`details.code: 'unknown_line'`) is reported before any quantity error, the
  quantity check runs before the reason check (`unknown_reason`), and
  returnability is checked last. Cases opened before a product was marked not
  returnable are never re-evaluated.

**On upgrade, every existing product is not returnable.** The flag defaults to
off, so lines of orders placed after the release are not returnable until the
product is marked returnable in the catalogue — select the products on the
product list and use **Bulk edit → Returnable → Yes — returnable**. Orders
placed before the release are unaffected: their lines carry no recorded value
and stay returnable.

## Cross-module interfaces

The module reads/affects other domains only through documented ports, never
internal imports:

- `OrderReadPort.findByIdForCustomer` (orders) — whether the buyer may read the
  order a case is opened for (their own, or a colleague's with
  `orders.view_organization`).
- `OrganizationPermissionPort` (organizations) — `returns.create` and
  `returns.view_organization`, asked per request.
- `OrderReturnContextPort` (orders) — paid-per-line amounts + completing-status
  time, and each line's `returnableAtPurchase` (`true`/`false` as recorded at
  placement, `null` for an order placed before it was recorded). Orders reports
  the fact; the policy for `null` — returnable — is this module's. It also
  reports the order's delivery cost and payment surcharge.
- `OrganizationDetailsPort` (organizations) — whether the order's organization
  is a personal one (B2C), which decides whether a withdrawal refunds the
  delivery and the surcharge.
- `PaymentRefundPort` (payments) — issue the refund, answer `pending_manual`
  where no PSP integration exists, or refuse when the gateway that took the
  payment is switched off.
- `CorrectiveInvoicePort` (invoices) — create a `correction` invoice, or answer
  that none is due because the order carries no invoice to correct. A
  consumer's completing withdrawal also names the delivery and surcharge it
  refunds (`charges`).
- `CreditTopupPort` (credit_limits) — credit the organization grant.
- `ShipmentService` (shipments) — optional replacement outbound shipment.

## Schema

Migration `20260625T144227_returns_init.ts` creates `return_cases`, `return_case_items`,
`return_case_comments`, `return_statuses`, `return_status_transitions`,
`return_reasons`, `return_delivery_methods`, `refunds`, `return_shipments`,
`return_case_attachments`, `return_list_saved_views`, and the
`return_cases_rma_seq` sequence.

Migration `20261108T125405_returns_case_charge_refunds.ts` adds four columns to
`return_cases`: `default_delivery_refund`, `approved_delivery_refund`,
`default_surcharge_refund` and `approved_surcharge_refund`, each `0.00` by
default. Existing cases keep `0.00`.
