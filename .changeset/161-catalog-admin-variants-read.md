---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-price-lists': patch
---

An admin read of a product's variants (feature 161, Checkpoint 5 review).

- **`GET /api/v1/admin/catalog/products/:productId/variants`** (`catalog:read`): every variant of the product by SKU, serialized as the variant writes answer them (`id`, `parentProductId`, `sku`, `variantAttributeValues`, `stockLevel`, `createdAt`, `updatedAt`), whatever the product's status, sales channels or audience; an unknown or deleted product is `404`. `CatalogAdminService.listVariants(productId)` is new. The storefront's `GET /api/v1/catalog/products/:id`, which answers an inactive product `410` and an out-of-channel one `404`, is unchanged.
- **Contracts:** `adminProductVariantSchema`, `adminProductVariantsResponseSchema` and their types.
- **The price-book grid** expands a product line through this read (the action is absent without `catalog:read`).
