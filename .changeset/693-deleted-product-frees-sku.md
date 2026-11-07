---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/contracts': patch
---

Deleting a product now frees its SKU and the SKUs of its variants, so a new product or variant
can take them (issue #693). Until now the SKU of a deleted product stayed taken for good, and the
only remedy was SQL. This includes products deleted before the upgrade.

- A new catalog migration replaces the table-wide `products_sku_unique` and
  `product_variants_sku_unique` constraints with partial unique indexes
  (`products_sku_live_unique`, `product_variants_sku_live_unique`, `where deleted_at is null`).
  `product_variants` gains a nullable `deleted_at`, which the `product.delete` Command sets on the
  product's variants. The migration back-fills it from products that are already deleted.
- The deleted row keeps its real SKU, for audit and ERP/PIM reconciliation. Order lines keep the
  SKU they snapshotted.
- Every SKU check and lookup in `catalog` now ignores deleted rows: create, PATCH, duplicate
  (`-copy` allocation), variant create, the product bulk import, and
  `PUT /api/v1/catalog/products/by-sku/:sku`. For a SKU that only a deleted product holds, that
  route now creates a new product (`201`) instead of addressing the deleted one.
- **The read port's default lookup now prefers the live row.** `CatalogProductReadPort.findBySku`,
  `findBySkus` and `findVariantsBySkus` answer the live product or variant when one holds the
  SKU, otherwise the most recently deleted one, and return at most one record per SKU. Without
  `liveOnly`, a SKU that only a deleted product holds still resolves, as before. With duplicates
  now possible, the previous default would have picked an arbitrary row. The inventory CSV stock
  import and the stock-level import therefore write the live product.
