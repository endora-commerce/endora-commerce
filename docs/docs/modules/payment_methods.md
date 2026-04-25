---
title: payment_methods
---

# `payment_methods`

CRUD over the configured payment methods that Customers can pick at
checkout. Each `PaymentMethod` row references a driver kind from the
`payments` module and a per-Sales-Channel visibility list.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/payment-methods` | customer | Methods visible in active Sales Channel |
| `GET /api/v1/admin/payment-methods` | admin | Full list |
| `POST /api/v1/admin/payment-methods` | admin | Create |
| `PATCH /api/v1/admin/payment-methods/:id` | admin | Update (driver kind is immutable post-create) |
| `DELETE /api/v1/admin/payment-methods/:id` | admin | Soft-archive (rejected if referenced by open orders) |

## Entities

`PaymentMethod` (driver kind, label per locale, ordering, sales-channel
allowlist).

## Extension points

- **Driver capability matrix** — `payment-method-service.ts` filters out
  methods whose driver returns `supports = false` for the current
  Cart/Customer/Sales Channel context. Wire new capability checks here.
