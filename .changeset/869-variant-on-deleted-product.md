---
'@endora-commerce/mod-catalog': patch
---

Adding a variant to a deleted product now answers `404 PRODUCT_NOT_FOUND`, the same as for an unknown product, and writes nothing (#869). Before this, `POST /api/v1/admin/catalog/products/:productId/variants` read the parent without excluding soft-deleted products and created the variant.
