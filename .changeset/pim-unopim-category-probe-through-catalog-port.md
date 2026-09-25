---
'@endora-commerce/mod-pim-unopim': patch
---

The category-backfill decision at the start of an import's product phase no longer reads
`catalog`'s `product_categories` table in raw SQL. It asks `catalog` through the
`CatalogCategoryReadPort.listAssignmentsForProducts` method this module already resolves
(`catalogCategoryReadPort`), in chunks of 500 product ids, stopping at the first chunk that holds
an assignment. The answer is unchanged: re-walk the product stream only when the connection has
linked products and none of them carries a category.

No new peer range: `@endora-commerce/contracts` already declares the port, and `catalog` already
publishes it. Consumers need to do nothing.
