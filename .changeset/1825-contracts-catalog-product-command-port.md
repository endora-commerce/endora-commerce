---
'@endora-commerce/contracts': minor
---

New `CatalogProductCommandPort` (container name `catalogProductCommandPort`, owner `catalog`) — the Product aggregate's write port (issue #1825, `specs/186-aggregate-ports/`): `create`, `update` (`CatalogProductUpdateInput`, the admin `PATCH` body without `version`), `archive`, `restore`, `delete`, `createVariant`, `updateVariant`, `deleteVariant`, `setCustomFieldValues` (a `CustomFieldMerge` over the product's `attributeValues`) and `applyScopedValues` (`ProductScopedWriteInput` → `ProductScopedWriteResult`). New `CatalogAttributeCommandPort` (`catalogAttributeCommandPort`) for attribute definitions: `create`, `update`, `delete`, `addOption`, `updateOption`, `deleteOption`. Every method ends in `AggregateCommandOptions`. The option inputs of the attribute writes are now named types, `CatalogAttributeOptionCreateInput` and `CatalogAttributeOptionPatch` (the same shapes as before).

Deprecated since 0.113.0, removed in a later release — each delegates to its replacement and behaves as before:

- `catalogProductWritePort.createProduct(req, auditCtx)` → `catalogProductCommandPort.create(req)` (`auditCtx` was never read)
- `catalogProductWritePort.updateProduct(id, { …patch, version })` → `catalogProductCommandPort.update(id, patch, { expectedVersion: Number(version) })`
- `catalogProductWritePort.createVariant` / `updateVariant` / `deleteVariant` → `catalogProductCommandPort.createVariant` / `updateVariant` / `deleteVariant`
- `catalogProductWritePort.createAttribute(req)` → `catalogAttributeCommandPort.create(req)`
- `catalogProductWritePort.updateAttributeByIdOrKey(idOrKey, req)` → `catalogAttributeCommandPort.update(idOrKey, req)`
- `catalogProductWritePort.addAttributeOption` / `patchAttributeOption` → `catalogAttributeCommandPort.addOption` / `updateOption`
- `catalogProductWritePort.listAttributes()` / `listAttributesByFlag(flag)` → `catalogAttributeReadPort.listAll()` / `listByFlag(flag)` (`isRequired` and `isMassEditable` are not read-port flags: filter `listAll()`)
- `catalogProductScopeWritePort.applyScopes(id, input, { source })` → `catalogProductCommandPort.applyScopedValues(id, input, { source })` (the new method accepts any `source` code of `aggregateCommandSourceSchema`, not only a registered module id)
