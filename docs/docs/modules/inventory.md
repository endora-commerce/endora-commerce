---
title: inventory
---

# `inventory`

Numeric stock levels per ProductVariant, transactional reservations during
checkout, and the `notify-when-available` opt-in.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/catalog/products/:id/notify-when-available` | Customer subscribes to back-in-stock notification |
| `GET /api/v1/admin/inventory/levels` | Admin stock view |
| `POST /api/v1/admin/inventory/levels/:variantId` | Set stock level (delta or absolute) |

## Reserve / release contract

`stock-service.ts#reserve(orderId, items)` opens a `SELECT … FOR UPDATE`
loop over the affected `stock_levels` rows; concurrent checkouts of the
last unit serialize so exactly one wins (`409 STOCK_UNAVAILABLE` for the
loser; see T100). `release(orderId)` is idempotent and runs from the order
cancel/return flows.

## Entities

`StockLevel` (per variant), `AvailabilityNotification` (one per
customer × variant subscription).

## Extension points

- **Multi-warehouse** — `StockLevel` is keyed by variant only today; adding
  a `warehouse_id` requires extending the entity, the FOR UPDATE selector,
  and the reservation API.
- **Notification dispatch** — `availability-worker.ts` consumes stock
  increases and dispatches via the email mailer; swap the mailer for SMS by
  injecting a different transport.
