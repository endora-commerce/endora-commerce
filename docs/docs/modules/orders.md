---
title: orders
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

## Status machine (configurable — feature 038)

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

## Entities

`Order`, `OrderItem`, `Payment`, plus feature 038: `OrderStatus`,
`OrderStatusTransition`, `OrderComment`, `OrderListSavedView`, and the
`organizations.order_confirmation_emails` column (owned by `organizations`,
read via a port). `OrderItem` snapshots the product + variant + unit price +
tax rate at placement so historical orders survive pricing / catalog changes.

## Events emitted

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`. Each
transition X→Y additionally emits four **templated** events (feature 038,
built by `events/order-status-events.ts`):
`order.status.from_<x>_to_<y>.before`, `order.status.from_<x>.before`
(synchronous, veto-capable) and `order.status.from_<x>_to_<y>.after`,
`order.status.to_<y>.after` (post-commit, isolated).

## Admin operations (feature 038)

- **Create on behalf** — `POST /api/v1/admin/orders` builds the customer's cart
  from admin-entered items and runs on-behalf `placeOrder`; the customer is
  emailed to pay it.
- **List** — `GET /api/v1/admin/orders` server-side filter/sort/search +
  per-status counts; `GET …/export` streams CSV; saved views via
  `…/list-views` (private or shared).
- **Bulk** — `POST …/bulk/status` (eligible orders move; skipped reported with
  reason) and `…/bulk/print-invoices`.
- **Comments** — admin/customer `…/:id/comments` with customer-visibility +
  notify flags; closed on terminal orders.
- **Reorder** — `…/:id/reorder` rebuilds the cart (gated by
  `orders.reorder_enabled`); **clone-to-quote** — `…/:id/clone-to-quote`.

## Settings (feature 038)

`orders.min_order_value` (number, gates Checkout + admin create),
`orders.reorder_enabled` (boolean), `orders.confirmation_recipients`
(string list) — all global or per-sales-channel. Plus per-org
`order_confirmation_emails`. The confirmation email CCs the customer + org
list + scope list (best-effort, never blocks placement).

## Order-confirmation e-mail (feature 034)

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
