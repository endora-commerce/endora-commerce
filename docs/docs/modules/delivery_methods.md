---
title: delivery_methods
---

# `delivery_methods`

CRUD over delivery methods (in-person pickup, parcel courier, freight,
…). Mirrors the structure of `payment_methods` and feeds the checkout flow.

## Public surface

Admin routes are gated by `catalog:read` (list) / `catalog:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/delivery-methods` | anon | Active methods for the storefront checkout |
| `GET /api/v1/admin/delivery-methods` | admin | Full list (active + inactive) |
| `PUT /api/v1/admin/delivery-methods/:code` | admin | Upsert by code |
| `DELETE /api/v1/admin/delivery-methods/:id` | admin | Hard delete (cost is captured per-Order at placement, so removing the method doesn't rewrite history) |

## Entities

`DeliveryMethod` (kind, label per locale, base price, weight thresholds,
sales-channel allowlist).

## Extension points

- **Carrier integration** — pluggable label/tracking adapters live in the
  `integrations` module; the delivery method just stores the carrier
  identifier.
- **Pricing rules** — per-zone or weight-tier pricing extends
  `delivery-method-service.ts#priceFor(cart)`.
