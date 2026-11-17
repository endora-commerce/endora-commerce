---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/contracts': patch
---

**Breaking change:** the two Page Builder content refusals that answer `400 ATTRIBUTE_VALUE_REJECTED`
now carry a token and an object in `details` instead of a list of `{ path, issue }`, so each gets a
sentence in English and Polish that says why and names the key (issue #1223). Before, both were
answered with the code's one sentence, "Some attributes do not belong to this product's attribute
set.", which is false for them. Code and status do not change.

| Route | `details` was | `details` is |
| --- | --- | --- |
| `POST`/`PATCH /api/v1/admin/catalog/products`, `PUT /api/v1/catalog/products/by-sku/:sku`, the catalogue write port (a content attribute's key in `attributeValues`) | `[{ path: 'attributeValues.<key>', issue }]`, one entry per key | `{ code: 'page_builder_content', attributeKeys: '<key>, <key>' }` |
| `PUT /api/v1/admin/catalog/products/:id/content/:attributeKey` (the key is not a content attribute of the product's set) | `[{ path: 'attributeKey', issue }]` | `{ code: 'not_content_attribute', attributeKey }` |

To migrate, a caller that read `details[].path` for these refusals reads `details.code` and the
key(s) from `details.attributeKeys` (comma-separated) or `details.attributeKey`. A key outside the
product's attribute set keeps the old sentence and `details: [{ path, issue }]`. The `catalog`
manifest declares both tokens on `ATTRIBUTE_VALUE_REJECTED`; the module's documentation lists them.
No setting, permission or migration changes.
