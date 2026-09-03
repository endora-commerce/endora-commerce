---
title: credit_limits
description: Credit-limit grant + atomic reservation
---

# `credit_limits`

The Credit Limit payment method. Admins grant a per-Organization limit;
Customers consume it at checkout. Reservations are atomic and idempotently
released on invoice paid or order cancellation.

## Public surface

All admin routes are gated by the `credit_limits:manage` permission.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/me/credit-limit` | customer | View granted limit + currently reserved (404 `CREDIT_LIMIT_NOT_GRANTED` if none) |
| `GET /api/v1/admin/credit-limits` | admin | Roster of every granted limit with active reservations |
| `GET /api/v1/admin/organizations/:id/credit-limit` | admin | One organization's limit + reservations |
| `POST /api/v1/admin/organizations/:id/credit-limit` | admin | Grant initial limit |
| `PATCH /api/v1/admin/organizations/:id/credit-limit` | admin | Adjust amount (rejects below active reservations unless `allowOverAllocation`) |

Storefront UX (T219): the Account profile and Checkout page render a
`CreditLimitWidget` (granted / available / reservation breakdown) when
the limit exists; `credit_limit`-kind payment methods are filtered out
of Checkout when no limit is granted or the cart total exceeds the
available credit.

## Concurrency model

`CreditLimitService.reserve()` opens a `SELECT … FOR UPDATE` on the
`credit_limits` row, then inserts the reservation. Two simultaneous orders
that would together exceed the limit are serialized; one succeeds and the
other receives `409 LIMIT_INSUFFICIENT`. See
`backend/test/contract/credit_limits/concurrent-race.test.ts` (T207).

## Entities

`CreditLimit`, `CreditLimitReservation` (status: `active | released`).
Index on `(credit_limit_id, status)` keeps the available-balance query fast.

## Events emitted

`credit_limit.granted.v1`, `credit_limit.adjusted.v1`,
`credit_limit.reservation_released.v1`.

## Extension points

- **Release reasons** — `releaseByOrder(reason)` accepts
  `'invoice_paid'` and `'order_cancelled'` today. New reasons (e.g.
  `'manual_override'`) are added by extending the enum and wiring the
  caller.
