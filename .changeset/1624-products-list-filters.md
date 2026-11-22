---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-inventory': minor
---

**Products list: real Category, Channel and Stock filters, and "select all matching" honours them (issue #1624).**

- **Admin.** The products list toolbar has a **Category** select (the category and every category below it), a **Sales channel** select (shown when there is more than one channel) and a **Stock** select with **Low stock** and **Out of stock** (shown while the Inventory module is on). Saved views remember them. "Select all matching" resolves the selection under the same filters, so a bulk edit or delete never reaches a product outside them.
- **API.** `GET /api/v1/admin/catalog/products` takes `categoryId`, `salesChannelId` and `stock` (`low` | `out`) as query parameters, and `POST /api/v1/admin/catalog/products/resolve-ids` takes them as body fields; both apply them through one clause. A malformed value answers `400 VALIDATION_FAILED` naming the field. `resolve-ids` now also honours the category, which it used to ignore. The list answers `stockFilterAvailable` beside its page; while `inventory` is off it is `false`, and a request naming `stock` answers `503 MODULE_DISABLED` instead of ignoring the filter.
- **Stock definitions** are the Inventory list's: *out* is a product with managed stock whose cumulative on-hand is 0 or less; *low* is a product with managed stock and a low-stock threshold whose cumulative on-hand is above 0 and at or below it. A product with no stock row is neither.
- **`@endora-commerce/contracts`:** new `productStockFilterSchema` and `adminProductListFiltersSchema`; `resolveProductIdsRequestSchema` gains `categoryId`, `salesChannelId` and `stock`; `InventoryStockReadPort` gains `stockStatePredicate()`, the Inventory list's low / out definitions as a SQL predicate the products list embeds, so the database filters and pages. A third-party implementation of that port must add the method.
- **`@endora-commerce/mod-catalog`:** declares `inventoryStockReadPort` as `refuses-without` on `inventory`.
