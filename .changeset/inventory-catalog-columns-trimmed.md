---
'@endora-commerce/mod-inventory': patch
---

`Migration20260503T182812InventoryWorkflow` and `Migration20260611T140348InventoryPerWarehouseLowStockThresholds` no longer touch `catalog`'s `products` and `categories` tables. The nine stock-management columns and two check constraints they used to add — and drop on revert — belong to `@endora-commerce/mod-catalog`, which now creates them in its own migration. Every statement on `inventory`'s own tables is unchanged.

The class names are unchanged, so databases that already recorded these migrations see nothing new. Two paths change behaviour, both for the better: installing `inventory` on a database where `catalog` already created the columns no longer fails with `column "manage_stock" of relation "products" already exists`, and a hard uninstall of `inventory` no longer drops columns `catalog` maps. Upgrade `@endora-commerce/mod-catalog` together with this release.
