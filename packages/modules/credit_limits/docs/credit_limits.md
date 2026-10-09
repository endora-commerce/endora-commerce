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

Storefront UX: the Account profile and Checkout page render a
`CreditLimitWidget` (granted / available / reservation breakdown) when
the limit exists; `credit_limit`-kind payment methods are filtered out
of Checkout when no limit is granted or the cart total exceeds the
available credit.

## Concurrency model

`CreditLimitService.reserve()` opens a `SELECT … FOR UPDATE` on the
`credit_limits` row, then inserts the reservation. Two simultaneous orders
that would together exceed the limit are serialized; one succeeds and the
other receives `409 LIMIT_INSUFFICIENT`. See
`backend/test/contract/credit_limits/concurrent-race.test.ts`.

## Entities

`CreditLimit`, `CreditLimitReservation` (status: `active | released`).
Index on `(credit_limit_id, status)` keeps the available-balance query fast.

## Events emitted

`credit_limit.granted.v1`, `credit_limit.adjusted.v1`. These are events on the
in-process event bus. `credit_limit.adjusted.v1` is also offered to outbound
webhooks (next section); `credit_limit.granted.v1` is not. Releasing a
reservation emits no event.

## Event offered to outbound webhooks

The module contributes one event type to the `webhooks` module's
`webhookEventRegistry`, so a webhook subscription can name it while both
modules are switched on. The payload is sent whole; the strict schema is
`CreditLimitAdjustedEventV1Schema` in `@endora-commerce/contracts`.

| Event | Sent when | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- |
| `credit_limit.adjusted.v1` | An administrator adjusts an Organization's limit, or a settled return is credited to it. | `organizationId` (UUID) — the Organization that holds the limit; `amount` (number) — the granted limit **after** the change. |

- **`amount` is the new total**, not the difference, in the limit's own
  currency. The currency is not in the payload, and neither are the reserved
  or available amounts, the reason given, or who made the change.
- **One Organization's data.** A platform-wide subscription receives every
  Organization's events. A subscription bound to an Organization receives only
  the events whose `organizationId` is that Organization — never another's. An
  Organization that *inherits* a parent's limit is not named: the event names
  the Organization the limit was granted to.
- **After the commit.** The event is sent for an adjustment that was committed.
  An adjustment that is refused (below the active reservations) or rolled back
  sends nothing, and a return that was already credited is not announced a
  second time.
- **While the module is switched off** the type is not offered and a new
  subscription to it is refused; stored subscriptions are kept and receive
  nothing until it is back on.

## Extension points

- **Release reasons** — `releaseByOrder(reason)` accepts
  `'invoice_paid'` and `'order_cancelled'` today. New reasons (e.g.
  `'manual_override'`) are added by extending the enum and wiring the
  caller.
