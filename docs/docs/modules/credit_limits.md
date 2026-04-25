---
title: credit_limits
---

# `credit_limits`

The Credit Limit payment method. Admins grant a per-Organization limit;
Customers consume it at checkout. Reservations are atomic and idempotently
released on invoice paid or order cancellation.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/me/credit-limit` | customer | View granted limit + currently reserved |
| `POST /api/v1/admin/organizations/:id/credit-limit` | admin | Grant initial limit |
| `PATCH /api/v1/admin/organizations/:id/credit-limit` | admin | Adjust amount (rejects below active reservations unless `allowOverAllocation`) |
| `DELETE /api/v1/admin/organizations/:id/credit-limit` | admin | Revoke when no active reservations |
| `GET /api/v1/admin/credit-limits/reservations` | admin | List active + historical reservations |

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
