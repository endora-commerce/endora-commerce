---
title: inventory
---

# `inventory`

Multi-warehouse stock module: warehouse identity, per-`(product, warehouse)`
on-hand and reserved counters, sales-channel binding, low-stock alerts,
display bands, backorder + unmanaged + notify-when-available, CSV import,
and per-line `stock_allocations` writes.

This module replaces the foundation 001 single-bucket model under
feature 010. Migration 030 keeps the foundation `stock_levels` table but
extends its uniqueness shape to `(product_id, variant_id, warehouse_id)`,
seeds a `Default` warehouse with the deterministic UUID
`00000000-0000-4000-8000-00000000d017`, and pairs every active sales
channel with that warehouse via the new
`warehouse_channel_assignments` table.

## Module-owned entities

| Entity | Purpose |
| --- | --- |
| `Warehouse` | Stocking location identity (name, code, active flag, contact, address) |
| `StockLevel` | `(product_id, variant_id, warehouse_id)` row carrying `on_hand` + `reserved` |
| `WarehouseChannelAssignment` | m:n binding warehouse ↔ sales channel; at most one `is_default = true` per channel |
| `InventoryThreshold` | Display-band thresholds at `global` / `category` / `product` scope |
| `StockAllocation` | One row per `(order_item, warehouse)` — fulfilment provenance + release support |
| `AvailabilityNotification` | Customer or anonymous email subscribed to a back-in-stock signal |

## Settings (Module Settings — feature 004)

Seven keys under the `inventory` group:

| Code | Type | Default | Notes |
| --- | --- | --- | --- |
| `inventory.display_mode` | string | `band` | Storefront display: `exact` / `band` / `available_or_not` |
| `inventory.fulfilment_strategy` | string | `default_first` | `any` / `default_first` / `lowest_stock_first` / `highest_stock_first` / `defined_order` |
| `inventory.fulfilment_strategy_warehouse_order` | json | `[]` | Walk order for `defined_order` strategy |
| `inventory.global_threshold_high` | number | `100` | Cumulative on-hand at-or-above which a product is "high stock" |
| `inventory.global_threshold_medium` | number | `20` | At-or-above for "medium" |
| `inventory.global_threshold_low` | number | `1` | At-or-above for "low"; below is out-of-stock |
| `inventory.low_stock_alert_recipient_email` | string | `''` | Empty falls back to env `INVENTORY_LOW_STOCK_RECIPIENT` |

## Public surface

Admin routes are gated by `inventory:read` (read) / `inventory:write` (write) —
this module's own codes since 2026-08-29. All 21 used to enforce `orders:read`
and `catalog:write`; see **Permissions** below.

The table lists all 21 admin sites. It listed ten until 2026-08-29 and omitted
the per-(product, warehouse) threshold write and both foundation-001
backward-compatibility routes, which is the kind of gap the four preceding
permission repairs each found in a module page.

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/inventory` | `inventory:read` | Landing KPIs: products tracked, total on-hand, out-of-stock count, low-stock count, per-warehouse totals |
| `GET /api/v1/admin/inventory/levels` | `inventory:read` | Per-product roster with cumulative on-hand, per-warehouse breakdown, display band |
| `PUT /api/v1/admin/inventory/levels` | `inventory:write` | Set absolute on-hand for `(productId, warehouseId, variantId?)`; emits `inventory.adjusted.v1` |
| `PUT /api/v1/admin/inventory/warehouse-low-stock-thresholds` | `inventory:write` | Per-(product, warehouse) low-stock thresholds |
| `GET /api/v1/admin/inventory/low-stock` | `inventory:read` | Products whose cumulative on-hand is at-or-below `lowStockThreshold` |
| `GET /api/v1/admin/inventory/thresholds` | `inventory:read` | Read global / per-category / per-product display-band thresholds |
| `PATCH /api/v1/admin/inventory/thresholds` | `inventory:write` | Update them |
| `GET /api/v1/admin/warehouses[/:id]` | `inventory:read` | Warehouse list and detail |
| `POST/PATCH/DELETE /api/v1/admin/warehouses[/:id]` | `inventory:write` | Warehouse CRUD; refuses delete when warehouse is a channel default or holds stock |
| `GET /api/v1/admin/sales-channels/:id/warehouses` | `inventory:read` | The channel's bound warehouses |
| `POST/PATCH/DELETE /api/v1/admin/sales-channels/:id/warehouses[/:assignmentId]` | `inventory:write` | Sales channel ↔ warehouse binding with at most one default per channel |
| `GET /api/v1/admin/inventory/availability-notifications` | `inventory:read` | Admin browses the back-in-stock queue |
| `PATCH /api/v1/admin/inventory/availability-notifications/:id` | `inventory:write` | Cancels a subscription |
| `POST /api/v1/admin/inventory/import` | `inventory:write` | CSV stock import (`?dryRun=true` validates without writing) |
| `PUT /api/v1/admin/inventory` | `inventory:write` | **Deprecated** foundation-001 single-bucket write; delegates to `StockLevelService.setOnHand` against the seeded Default warehouse |
| `GET /api/v1/admin/inventory/legacy` | `inventory:read` | **Deprecated** foundation-001 single-bucket list |
| `GET /api/v1/storefront/inventory/display-mode` | — | Storefront-public read: which display mode the channel uses |

## Permissions

`inventory:read` and `inventory:write`, this module's own since 2026-08-29.

Before that all 21 admin routes enforced two other modules' codes — nine reads
on `orders:read` and twelve writes on `catalog:write`. So whoever could edit a
product description could create, rename and delete a warehouse, rewrite a stock
count, run a CSV import across every product's stock, and bind or unbind a
warehouse from a sales channel; and whoever could read orders could enumerate
every warehouse and the address on it. Neither code names the data being
touched, which is the discriminator
`specs/080-f4-real-scope/payments-permission-ownership.md` §7.2 sets and
`specs/first-deployment-window.md` §2 applies per route rather than per module.

There is **no data migration**: a role that reached these screens through
`catalog:write` or `orders:read` is granted the new codes explicitly, on
`/admin-roles`, where the manifest puts them automatically. Granting them to
every holder of the old codes would reproduce the over-grant the split removes.

`test/contract/inventory/permission-authority.test.ts` pins both directions and
both old codes.
| `GET /api/v1/storefront/inventory/stock/:id` | Storefront-public per-product stock with cumulative on-hand summed only over the caller's channel-bound warehouses |
| `POST /api/v1/catalog/products/:id/notify-when-available` | Customer subscribes to back-in-stock; signed-in callers have email pre-filled |

### Deprecated

Two foundation-001 routes predate the per-warehouse surface above and always
address the seeded Default warehouse. Nothing in the platform calls either one
— no admin screen, no `@endora-commerce/api-client` method, no seed, no script — so they
exist for a deployment's own integration and nothing else. Do not build against
them.

| Verb + Path | Purpose | Replacement |
| --- | --- | --- |
| `PUT /api/v1/admin/inventory` | Set absolute on-hand for `(productId, variantId?)` in the Default warehouse | `PUT /api/v1/admin/inventory/levels`, which takes an explicit `warehouseId` |
| `GET /api/v1/admin/inventory/legacy` | Flat `stock_levels` rows, newest first, optionally filtered by `productId` | `GET /api/v1/admin/inventory/levels` for everything except `variantId` and `updatedAt`, which it does not carry |

Since issue #139 the `PUT` delegates to the same service as
`PUT .../levels`, so it emits `inventory.adjusted.v1` and answers `404` for an
unknown product instead of writing a stock row for one. It will be removed once
a production access log or the deployment owner confirms nothing calls it.

## Per-product flags

Five new fields live on `products` and ride through `PATCH /api/v1/admin/catalog/products/:id`:

- `manageStock` (default `true`) — when `false`, the storefront treats the product as always available and the cart/order paths skip reservation entirely.
- `backorderEnabled` (default `false`) — when `true`, zero-stock checkout is accepted; the resulting `stock_allocations` row is flagged `is_backorder = true`.
- `lowStockThreshold` — optional integer; when null the product is exempt from low-stock alerts.
- `fulfilmentStrategy` — per-product override of the global strategy.
- `fulfilmentStrategyWarehouseOrder` — when the strategy is `defined_order`, the ordered list of warehouse UUIDs to walk.

## Display-band resolution

`(product, category[], global)` triple lookup runs per-key (high / medium / low) so a product can override only `low` while inheriting `high` and `medium` from the global default. The resolver lives at
`backend/src/modules/inventory/services/threshold-resolver.ts` and is a pure function with full unit-test coverage.

The display-band resolver in
`backend/src/modules/inventory/services/display-band-resolver.ts` then maps cumulative on-hand to one of `high | medium | low | out_of_stock | available` (`available` is the special bucket for `manageStock = false`).

## Fulfilment strategies

Five strategies live in `fulfilment-strategy-resolver.ts`:

| Strategy | Behaviour |
| --- | --- |
| `any` | Pick the first warehouse (lex by code) that can satisfy the line in full |
| `default_first` | The only strategy that splits a line across warehouses; default warehouse first, others lex by code |
| `lowest_stock_first` | Pick the warehouse with the smallest sufficient `available` (lex tie-break) |
| `highest_stock_first` | Pick the warehouse with the largest `available` (lex tie-break) |
| `defined_order` | Walk the configured warehouse-id list in order; first sufficient wins |

When `backorderEnabled = true`, all five strategies allow the line to go through with the residual flagged as a backorder against the first-choice warehouse.

The order-placement path writes one `stock_allocations` row per order item. Cancellation runs `OrderService.releaseAllocations(orderId)` which decrements `stock_levels.reserved` per allocation and stamps `released_at`.

## Reserve / release contract

`OrderService.placeOrder` opens a `SELECT … FOR UPDATE` per `(product_id, variant_id, warehouse_id)` row inside the placement transaction. The default warehouse is resolved from `warehouse_channel_assignments` for the order's sales channel. Concurrent placers serialise; the loser raises `409 STOCK_UNAVAILABLE` unless `backorderEnabled = true` on the product, in which case the line goes through with `is_backorder = true`.

`releaseAllocations(orderId)` is idempotent — already-released rows are filtered out by `released_at IS NULL`. It runs automatically on order cancellation alongside the credit-limit release.

## Notify-when-available

The customer subscribes via either the storefront `/notify-when-available` endpoint (signed-in path; email pre-filled) or the customer-side dialog (anonymous; email supplied in the body). Subscription is refused with `PRODUCT_UNMANAGED_STOCK` when the product has opted out of stock tracking, and idempotent re-subscribes return the existing row.

`AvailabilityWorker.attach(eventBus)` listens for `inventory.adjusted.v1` events. Fan-out fires only when *cumulative across warehouses* crosses 0 → > 0 — single-warehouse top-ups that don't bring the cumulative above zero never trigger emails.

## Low-stock alerts

`LowStockAlertService.attach(eventBus)` listens for the same event. When cumulative on-hand crosses from above the product's `lowStockThreshold` to at-or-below it, one email goes to the recipient configured by `inventory.low_stock_alert_recipient_email`. The detector is platform-wide, not per-channel.

## Boot-time reconciler

`WarehouseChannelReconciler` runs at boot AFTER `DefaultChannelReconciler` so every active sales channel ends up paired with at least one warehouse and exactly one `is_default` assignment. The reconciler is idempotent and handles the case where channels are created post-migration.

## Constants

- `DEFAULT_WAREHOUSE_ID` = `00000000-0000-4000-8000-00000000d017`
- `DEFAULT_WAREHOUSE_CODE` = `default`

Both are exported from `backend/src/modules/inventory/entities/warehouse.entity.ts`.
