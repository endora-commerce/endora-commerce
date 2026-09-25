---
'@endora-commerce/mod-catalog': minor
---

`catalog` now creates the nine stock-management columns its entities map, in `Migration20260925T125527CatalogInventoryColumns`: `products.{manage_stock, backorder_enabled, low_stock_threshold, low_stock_threshold_mode, fulfilment_strategy, fulfilment_strategy_warehouse_order}` and `categories.inventory_threshold_{high,medium,low}`, together with `products_fulfilment_strategy_check` and `products_low_stock_threshold_mode_check`.

Until now only `@endora-commerce/mod-inventory`'s migrations created them. `inventory` is switchable and `catalog` does not depend on it, so an instance assembled without `inventory` — the default free set — could not read or insert a product or a category, and a hard uninstall of `inventory` dropped the columns. The new migration uses `add column if not exists` with the original types and defaults, and adds each constraint behind a `pg_constraint` check: on every database that already has them it is a no-op that keeps every value, and on a fresh one it creates them. Its `down()` is deliberately empty, because `products` and `categories` are the platform's tables and their rows outlive `catalog`.

Regenerate the migration registry (`pnpm --filter backend run composer:generate` in this repository, `endora generate` in an instance) so the migration runs.
