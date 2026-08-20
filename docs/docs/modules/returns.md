---
title: returns
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
| `…/statuses`, `…/transitions`, `…/reasons`, `…/delivery-methods`, `…/list-views` | admin | Configuration + saved views |

## Status machine (configurable — US3)

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
- **A switched-off payment gateway refuses the settlement** (issue #104, D-71).
  Money resolutions on a gateway-paid order call the PSP module that took the
  payment; when an operator has that module switched off — or the deployment
  does not offer it — the settlement answers `503 MODULE_DISABLED` naming the
  module, with `Retry-After`. Nothing moves: the case keeps its status, no
  `refunds` row is written, no corrective invoice is issued and no customer
  e-mail goes out. Switching the module back on is the whole remedy. This is
  distinct from a deployment that has **no** PSP refund integration at all,
  which still settles as `pending_manual` for a person to pay out by hand —
  there is nothing there to switch on.

## Cross-module interfaces (Principle I)

The module reads/affects other domains only through documented ports, never
internal imports:

- `OrderReturnContextPort` (orders) — paid-per-line amounts + completing-status time.
- `PaymentRefundPort` (payments) — issue the refund, answer `pending_manual`
  where no PSP integration exists, or refuse when the gateway that took the
  payment is switched off (D-71).
- `CorrectiveInvoicePort` (invoices) — create a `correction` invoice, or answer
  that none is due because the order carries no invoice to correct.
- `CreditTopupPort` (credit_limits) — credit the organization grant.
- `ShipmentService` (shipments) — optional replacement outbound shipment.

## Schema

Migration `080_returns_init.ts` creates `return_cases`, `return_case_items`,
`return_case_comments`, `return_statuses`, `return_status_transitions`,
`return_reasons`, `return_delivery_methods`, `refunds`, `return_shipments`,
`return_case_attachments`, `return_list_saved_views`, and the
`return_cases_rma_seq` sequence.
