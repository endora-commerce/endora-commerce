---
'@endora-commerce/mod-catalog': patch
---

`CatalogAdminService.createProduct` now persists `categoryIds`. The field is required by
`createProductRequestSchema` and was accepted and discarded: `POST /api/v1/admin/catalog/products`,
the creating call of `PUT /api/v1/catalog/products/by-sku/:sku` and
`CatalogProductWritePort.createProduct` all returned a product in no category, and only a later
update assigned the ones the caller had named. The `product_categories` rows are now written
inside the `product.create` Command, so they commit or roll back with the product, appear as
`categoryIds` in that Command's audit entry, and are in place before `product.created.v1` is
emitted. A category id that does not exist now fails the create instead of being ignored, and a
repeated id in `categoryIds` is treated as one membership on both create and update.
