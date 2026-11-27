---
'@endora-commerce/contracts': minor
---

`CatalogCategoryCommandPort` (container name `catalogCategoryCommandPort`, owner `catalog`) is the Category aggregate's write port (issue #1826, `specs/186-aggregate-ports/`). It declares `create`, `update`, `move` (`CategoryMoveInput`: `{ parentId: string | null; position?: number }`, `position` being the sort order), `delete`, `setCustomFieldValues` (a `CustomFieldMerge`) and `setInventoryThresholds`, each ending in `AggregateCommandOptions` (`expectedVersion` is ignored: a category has no version). `setInventoryThresholds` answers the `CatalogCategoryRecord` rather than `void`.

Deprecated since 0.113.0, removed in a later release — each delegates and writes the same entries:

- `catalogCategoryWritePort.listAll()` → `catalogCategoryReadPort.listAll({ liveOnly: true })`
- `catalogCategoryWritePort.create(input)` → `catalogCategoryCommandPort.create(input, options?)`
- `catalogCategoryWritePort.update(id, input)` → `catalogCategoryCommandPort.update(id, input, options?)`
- `catalogCategoryWritePort.setInventoryThresholds(id, patch)` → `catalogCategoryCommandPort.setInventoryThresholds(id, patch, options?)`

The new `create` and `update` check their input against the admin endpoint's schema (`422 VALIDATION_FAILED`); the deprecated ones keep accepting what they accepted.
