---
'@endora-commerce/mod-catalog': patch
---

The product editor's Variants tab reads `GET /api/v1/admin/catalog/products/:productId/variants` instead of the storefront's channel- and status-filtered product read, so an inactive product, or one outside the request's sales channel, shows its variants instead of a load error (issue #410).
