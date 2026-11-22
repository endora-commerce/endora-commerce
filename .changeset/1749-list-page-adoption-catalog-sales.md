---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-returns': patch
---

Eight more admin list screens now use the kit `ListPage` (issue #1749): Inventory, Low stock, Warehouses, Availability notifications, Product feeds, Return reasons, Return delivery methods and Return clauses. Each one has the kit's loading skeleton, a load error with **Retry**, and the result count at the end of the toolbar row. The inventory lists' toolbar is a row above the results, not a strip inside their card. A filter or page change on Inventory, Warehouses and Availability notifications keeps the rows on screen while it reloads. Return clauses show the kit empty state instead of a bare sentence. Product feeds no longer show *New feed* twice while there is no feed.

- `@endora-commerce/admin-kit`: the `ListPage` `tabs` slot is documented as the band between the header and the toolbar, which can also hold a KPI strip.
- New `en` / `pl` keys: core `warehouses.count`, `inventory.count`, `inventory.lowStock.count`, `inventory.availability.count`; `product_feeds` `feeds.count`; `returns` `reasons.count`, `methods.count`, `clauses.count`.
