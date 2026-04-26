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

## Extension points

- **Payment drivers** — `payments/drivers/*-driver.ts` plug new payment
  methods. The driver's `reserve` call runs inside the order-placement
  transaction.
- **Access scoping** — `order-access-service.ts` is the single place that
  enforces the Regular User / Organization Admin / Admin User scoping rule;
  add new actor kinds here.
