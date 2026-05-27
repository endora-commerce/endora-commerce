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

## Status machine

Order statuses: `new → confirmed → in_fulfilment → shipped → completed`,
with `cancelled` as a terminal side branch. Payment statuses run
`awaiting_payment → paid` with `deferred` and `refunded` as alternatives.
Transitions are guarded by `order-service.ts#transitionStatus` /
`#transitionPaymentStatus`.

## Entities

`Order`, `OrderItem`, `Payment`. `OrderItem` snapshots the product +
variant + unit price + tax rate at placement so historical orders
survive pricing / catalog changes. `Order.deliveryMethodSnapshot` and
`paymentMethodSnapshot` capture the configured method shape verbatim
for the same reason.

## Events emitted

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`,
`payment.settled.v1`.

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
