---
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-catalog': patch
---

Two `EntityManager`-taking seams for renaming an attribute key after create, both additive and both run on the caller's transaction so a definition key and the values stored under it move together.

- `@endora-commerce/mod-custom-fields/ports`: `CustomFieldDefinitionApplyApi.applyRenameKey(em, id, expectedKey, newKey)`, served by the existing `customFieldDefinitionService` registration. It is not an edit — `UpdateCustomFieldDefinitionRequest` still omits `key` — and it refuses a definition whose key is no longer `expectedKey` (`key_changed`), a key another definition of the same entity type holds (`duplicate_key`) and a key outside the grammar (`invalid_key`). It flushes before it returns, dispatches no command and publishes no invalidation: call `publishInvalidate` after your transaction commits. A test double implementing `CustomFieldDefinitionApplyApi` needs the new method.
- `@endora-commerce/mod-catalog/ports` (new, type-only subpath): `CatalogAttributeValueKeyApi.renameValueKey(em, fromKey, toKey)`, registered as `catalogAttributeValueKeyPort`. It moves the key in `products.attribute_values` and `product_value_overrides.attribute_key` and answers how many rows of each moved; `name`, `description` and keys outside the attribute grammar are refused before any statement runs.
