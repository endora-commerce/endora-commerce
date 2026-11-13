---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': patch
---

Attribute-option admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `attributeOptionListResponseSchema` / `AttributeOptionListResponse` for `GET /api/v1/admin/catalog/attributes/:attributeId/options`, `{ data: { items: AttributeOption[] } }`. The rows (`attributeOptionSchema`) were already described, but the list envelope was not.
- `mod-catalog` builds every option reply as the contract's `AttributeOption` instead of `Record<string, unknown>`. The list handler returns `AttributeOptionListResponse`, and the create and patch handlers return `{ data: AttributeOption }`. Nothing on the wire changes.
