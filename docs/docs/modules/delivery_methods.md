---
title: delivery_methods
---

# `delivery_methods`

CRUD over delivery methods (in-person pickup, parcel courier, freight,
…). Mirrors the structure of `payment_methods` and feeds the checkout flow.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/delivery-methods` | customer | Methods available to the active cart |
| `GET /api/v1/admin/delivery-methods` | admin | Full list |
| `POST /api/v1/admin/delivery-methods` | admin | Create |
| `PATCH /api/v1/admin/delivery-methods/:id` | admin | Update |
| `DELETE /api/v1/admin/delivery-methods/:id` | admin | Soft-archive (open-order guard) |

## Entities

`DeliveryMethod` (kind, label per locale, base price, weight thresholds,
sales-channel allowlist).

## Extension points

- **Carrier integration** — pluggable label/tracking adapters live in the
  `integrations` module; the delivery method just stores the carrier
  identifier.
- **Pricing rules** — per-zone or weight-tier pricing extends
  `delivery-method-service.ts#priceFor(cart)`.
