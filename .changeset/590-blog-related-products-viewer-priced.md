---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-blog': minor
---

A blog post's related products are shown as product cards priced for the viewer (issue #590).

- **`@endora-commerce/contracts`** — `productListQuerySchema` gains an optional `ids`
  (`productListIdsSchema`: a comma-separated list of distinct uuids, at most
  `PRODUCT_LIST_MAX_IDS` = 24). `blogResolvedPostSchema` gains an optional `relatedProductIds`:
  the post's related products by id, in the editor's order, with no price. Additive; a payload
  without either still parses.
- **Deprecated, removed in a later minor:** `blogProductCardSchema`, the `BlogProductCard` type and
  `blogResolvedPostSchema.relatedProducts`. No shipped composition ever filled them, and their
  `price` could not be a correct one: the post payload is cached per channel and language for
  every visitor. Read `relatedProductIds` and fetch the products from
  `GET /api/v1/catalog/products?ids=…` as the viewer instead.
- **`@endora-commerce/mod-catalog`** — `GET /api/v1/catalog/products?ids=<id>,<id>` restricts the
  listing to the named products: the subset the viewer may see, priced like any listing card for
  that viewer, in the listing's order, always from PostgreSQL. More than 24 ids or a value that is
  not a uuid is `400 VALIDATION_FAILED`.
- **`@endora-commerce/mod-blog`** — the storefront post payload carries `relatedProductIds`.
  `BlogStorefrontDeps.resolveProductCard` is deprecated: nothing reads what it produces any more,
  and it is removed in a later minor.
