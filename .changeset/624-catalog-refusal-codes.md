---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/contracts': patch
---

`catalog` refusals that the stored state makes have error codes of their own instead of
`VALIDATION_FAILED`, and a sentence in English and Polish that names the values in `details`
(issue #624, part of #86). **A caller that matches on `VALIDATION_FAILED`, or on a token in the
message (`sku_in_use`, `option_in_use`, `missing_required_attribute_values`), now sees the specific
code.** Two statuses move, marked below. Until now the operator read the English message or the
machine token whatever their language, because the error envelope never replaces the message of
`VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/catalog/attributes` | `409 VALIDATION_FAILED`, `Attribute key "<key>" already exists.` | `409 ATTRIBUTE_KEY_TAKEN` | `attributeKey` |
| `PATCH /api/v1/admin/catalog/attributes/:idOrKey` (type change) | `409 VALIDATION_FAILED`, the custom-fields message | `409 ATTRIBUTE_VALUE_TYPE_LOCKED` | `attributeKey` |
| `PATCH /api/v1/admin/catalog/attributes/:idOrKey` (`displayAsSlider` on a stored non-numeric type) | `400 VALIDATION_FAILED`, `displayAsSlider is only valid for …` | `400 ATTRIBUTE_SLIDER_NOT_SUPPORTED` | `attributeKey`, `valueType` |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | `409 VALIDATION_FAILED`, `Attribute is still referenced by N attribute set(s) …` / `… N product(s) …` | `409 ATTRIBUTE_IN_USE`, token `attribute_sets` / `products` | `attributeKey`, `attributeSetCount` / `productCount` |
| `POST /api/v1/admin/catalog/attributes/:attributeId/options` | `409 VALIDATION_FAILED` (duplicate value, second default), `400 VALIDATION_FAILED` (type takes no options) | `409 ATTRIBUTE_OPTION_VALUE_TAKEN`, `409 ATTRIBUTE_DEFAULT_OPTION_TAKEN`, `400 ATTRIBUTE_OPTIONS_NOT_SUPPORTED` | `attributeKey`, `value` / `valueType` |
| `PATCH /api/v1/admin/catalog/attributes/:attributeId/options/:optionId` (`isDefault`) | **`400`** `VALIDATION_FAILED` | **`409`** `ATTRIBUTE_DEFAULT_OPTION_TAKEN`, as on create | `attributeKey`, `value` |
| `DELETE /api/v1/admin/catalog/attributes/:attributeId/options/:optionId` | `409 VALIDATION_FAILED`, `option_in_use: N product(s) …` | `409 ATTRIBUTE_OPTION_IN_USE`, token `products` | `attributeKey`, `value`, `productCount` |
| `PATCH /api/v1/admin/catalog/products/:id` (`sku`) | **`400`** `VALIDATION_FAILED`, `sku_in_use { conflictingProductId / conflictingVariantId, conflictingSku }` | **`409`** `SKU_ALREADY_EXISTS`, as on create; token `held_by_product` / `held_by_variant` | `sku`, `conflictingProductId` / `conflictingVariantId` |
| `PATCH /api/v1/admin/catalog/products/:id` (attribute set or values) | `400 VALIDATION_FAILED`, `missing_required_attribute_values: <keys>` | `400 ATTRIBUTE_VALUES_REQUIRED` | `attributeKeys` (joined) |
| `POST`, `PATCH /api/v1/admin/catalog/products[/:id]`, `PATCH …/products/:id/scopes` (minimum on a type that takes none) | `422 VALIDATION_FAILED` | `422 MIN_ORDER_QUANTITY_NOT_SUPPORTED_FOR_TYPE` | `field: 'minOrderQuantity'` (kept), `productType`; per channel `channelId` |
| `POST /api/v1/admin/catalog/products/:productId/variants` (parent not configurable) | `400 VALIDATION_FAILED` | `400 PRODUCT_TYPE_MISMATCH`, token `variants_need_configurable` | `productId`, `productType` |
| `POST /api/v1/admin/catalog/products/:id/grouped-items` (the group itself) | `400 VALIDATION_FAILED` | `400 SELF_LINK_NOT_ALLOWED`, token `grouped` | `productId` |
| `POST /api/v1/admin/catalog/products/:id/grouped-items` (child already in the group) | `409 VALIDATION_FAILED` | `409 GROUPED_ITEM_ALREADY_EXISTS` | `parentProductId`, `childProductId`, `childSku` |
| `POST`, `PATCH /api/v1/admin/catalog/categories[/:id]` (slug a sibling holds) | `409 VALIDATION_FAILED` | `409 CATEGORY_SLUG_TAKEN` | `slug`, `parentCategoryId` |
| `DELETE /api/v1/admin/catalog/categories/:id` (subcategories left) | `409 VALIDATION_FAILED` | `409 CATEGORY_HAS_CHILDREN` | `categoryId`, `childCount` |
| `PATCH /api/v1/admin/catalog/categories/:id` (beneath a descendant) | `409 VALIDATION_FAILED` | `409 CATEGORY_MOVE_CYCLE` | `categoryId`, `parentCategoryId` |

The product editor already reads `SKU_ALREADY_EXISTS` onto the SKU field, so a rename onto a taken
SKU is now shown there too. Malformed requests stay `VALIDATION_FAILED`: an invalid key, option
value or SKU, options or a slider on a type the same request names, a value out of range, an
unknown attribute set or category, a reorder list that does not match. Fourteen codes are new
members of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `catalog` manifest with
the tokens above; the module's documentation lists them. No setting, permission or migration
changes.
