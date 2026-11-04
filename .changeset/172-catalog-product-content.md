---
'@endora-commerce/mod-catalog': minor
---

Product content attributes (`specs/172-product-content-attributes/`).

- A new attribute type, **Page Builder content** (`page_builder`): one Page Builder document per language and product, stored in the new `product_content_values` table (migration `catalog_product_content_values`). The type is always language-scoped and every other capability is held off — setting one on create or update is refused with `400 VALIDATION_FAILED`, and the type cannot be changed to or from (`409`).
- New admin routes: `GET /api/v1/admin/catalog/products/:id/content`, `GET` and `PUT /api/v1/admin/catalog/products/:id/content/:attributeKey` (`catalog:read` / `catalog:write`; the save runs the audited command `product.content.update` and emits `product.content.updated.v1`). A content attribute's key in `attributeValues` is refused with `400 ATTRIBUTE_VALUE_REJECTED` on every write path.
- The product page read `GET /api/v1/catalog/products/:idOrSlug?include=content` carries `contentAttributes`, and carries none while the CMS module is off. Without `include` the response is unchanged.
- Admin: a content card on the product's Attributes tab, the product content screen `/catalog/products/:id/content/:attributeKey` (its editor is the `product.content.editor` zone), and a **Delete** action with a usage dialog for every attribute type on the attributes screen.
- Duplicating a product copies its content; assets embedded in content are reported as in use (`product_content`).
- New: `GET /api/v1/admin/catalog/attributes/:idOrKey/usage`.

**Behaviour change for API callers of `DELETE /api/v1/admin/catalog/attributes/:idOrKey`**:

- a per-sales-channel override (`product_value_overrides`) or a variant value now **refuses** the delete with `409`, as a value on the product always did — such rows were previously left orphaned;
- a value held only by a **soft-deleted** product **no longer** refuses it;
- a `page_builder` attribute's content rows are deleted with it, counted in the audit row's `before.productContentCount`;
- the delete now emits `attribute.updated.v1` with `isSearchable: false` and `isFilterable: false` after commit.

Promotion conditions, price-list rows and feed rules naming the deleted key are neither refused nor removed; their owners already treat an unknown key as matching nothing.
