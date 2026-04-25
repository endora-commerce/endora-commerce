---
title: orders
---

# `orders`

Order placement, lifecycle, and access control. Composes the cart price
resolution, stock reservation, payment driver dispatch, invoice generation,
and audit logging.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/orders` | customer | Place order from active Cart |
| `GET /api/v1/orders` | customer | List orders scoped by Role (Regular vs Org Admin) |
| `GET /api/v1/orders/:id` | customer | Order detail |
| `POST /api/v1/orders/:id/cancel` | customer | Cancel before fulfilment |
| `GET /api/v1/orders/:id/invoice` | customer | Download invoice PDF |
| `POST /api/v1/admin/orders/:id/status` | admin | Status transition (audited) |
| `POST /api/v1/admin/orders/:id/payment-status` | admin | Payment status transition (audited) |
| `POST /api/v1/admin/orders/:id/refund` | admin | Refund with optional partial amount |

## Status machine

Order statuses: `new → confirmed → in_progress → shipped → delivered`, with
side branches `cancelled` and `returned`. Payment statuses run
`unpaid → reserved → paid` plus `refunded` and `failed`. Transitions are
guarded by `order-status-service.ts`.

## Entities

`Order`, `OrderItem`, `Payment`, `Invoice`, `Delivery`. `OrderItem` snapshots
unit prices so historical orders survive pricing changes.

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
