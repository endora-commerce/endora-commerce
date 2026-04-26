---
title: payment_methods
---

# `payment_methods`

CRUD over the configured payment methods that Customers can pick at
checkout. Each `PaymentMethod` row references a driver kind from the
`payments` module and a per-Sales-Channel visibility list.

## Public surface

Admin routes are gated by `catalog:read` (list) / `catalog:write` (mutations).
The storefront filters out `credit_limit`-kind rows when no limit is granted
or the cart total exceeds available credit (T219).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/payment-methods` | anon | Active methods for the storefront checkout |
| `GET /api/v1/admin/payment-methods` | admin | Full list (active + inactive) |
| `PUT /api/v1/admin/payment-methods/:code` | admin | Upsert by code; the `kind` field picks the backend driver |
| `DELETE /api/v1/admin/payment-methods/:id` | admin | Hard delete (the kind snapshot is captured on every placed Order, so removal doesn't rewrite history) |

## Entities

`PaymentMethod` (driver kind, label per locale, ordering, sales-channel
allowlist).

## Extension points

- **Driver capability matrix** — `payment-method-service.ts` filters out
  methods whose driver returns `supports = false` for the current
  Cart/Customer/Sales Channel context. Wire new capability checks here.
