---
'@endora-commerce/mod-inventory': minor
---

The threshold admin (`PATCH /api/v1/admin/inventory/thresholds`) writes each category's thresholds through `catalogCategoryCommandPort.setInventoryThresholds` (issue #1826), so each is audited by `catalog` as `category.inventory_thresholds.set`. Its own `low_stock_threshold.update` entry records only the global and per-product thresholds: `perCategoryCount` is no longer in its state, and a patch that changes only category thresholds writes no `low_stock_threshold.update` entry. An audit filter or report that counted category changes through `perCategoryCount` reads `category.inventory_thresholds.set` instead.
