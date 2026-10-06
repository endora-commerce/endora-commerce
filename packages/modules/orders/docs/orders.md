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
`OrderListSavedView`, and the
`organizations.order_confirmation_emails` column (owned by `organizations`,
read via a port). `OrderItem` snapshots the product + variant + unit price +
tax rate at placement so historical orders survive pricing / catalog changes.

## Events emitted

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`. Each
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
  `…/list-views` (private or shared).
- **Bulk** — `POST …/bulk/status` (eligible orders move; skipped reported with
  reason — a skipped order has not moved) and `…/bulk/print-invoices`.
- **Comments** — admin/customer `…/:id/comments` with customer-visibility +
  notify flags; closed on terminal orders.
- **Reorder** — `…/:id/reorder` rebuilds the cart (gated by
  `orders.reorder_enabled`); **clone-to-quote** — `…/:id/clone-to-quote`.

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
