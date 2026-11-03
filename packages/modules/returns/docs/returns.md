---
title: returns
description: Returns and complaints (RMA) — submission, verification, reverse-logistics shipments and settlement over a configurable status graph
---

# `returns`

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
| `GET /api/v1/returns` | customer | List the caller's cases |
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
  quantity and may never exceed it. Resolutions: refund (money), credit (tops up
  the organization's `credit_limits` grant), replacement, or repair. A corrective
  invoice (`invoices` kind `correction`) is requested for money/credit settlements.
  An order that was never invoiced has no VAT document to correct, so none is
  issued: the settlement succeeds, the refund is recorded on the return case and
  the payment record, and the result states `correctiveInvoice: { issued: false,
  reason: "order_not_invoiced" }`.
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

- `OrderReturnContextPort` (orders) — paid-per-line amounts + completing-status
  time, and each line's `returnableAtPurchase` (`true`/`false` as recorded at
  placement, `null` for an order placed before it was recorded). Orders reports
  the fact; the policy for `null` — returnable — is this module's.
- `PaymentRefundPort` (payments) — issue the refund, answer `pending_manual`
  where no PSP integration exists, or refuse when the gateway that took the
  payment is switched off.
- `CorrectiveInvoicePort` (invoices) — create a `correction` invoice, or answer
  that none is due because the order carries no invoice to correct.
- `CreditTopupPort` (credit_limits) — credit the organization grant.
- `ShipmentService` (shipments) — optional replacement outbound shipment.

## Schema

Migration `20260625T144227_returns_init.ts` creates `return_cases`, `return_case_items`,
`return_case_comments`, `return_statuses`, `return_status_transitions`,
`return_reasons`, `return_delivery_methods`, `refunds`, `return_shipments`,
`return_case_attachments`, `return_list_saved_views`, and the
`return_cases_rma_seq` sequence.
