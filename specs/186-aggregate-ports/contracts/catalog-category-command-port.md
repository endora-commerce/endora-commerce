# Contract: `catalogCategoryCommandPort` (Category, #1826)

Owner `catalog` (non-deactivatable). Declared in `packages/contracts/src/catalog.ts`.

## Operations

| Method | Command action (kept) | Admin route | Readiness | Work |
| --- | --- | --- | --- | --- |
| `create(input, options?)` | `category.create` | `POST /api/v1/admin/catalog/categories` | C | port only |
| `update(id, input, options?)` | `category.update` | `PATCH …/categories/:id` | C | port only |
| `move(id, { parentId, position }, options?)` | `category.update` (a parent/position-only change), unless T007 finds a dedicated move | `PATCH …/categories/:id` | ? | port only, or convert |
| `delete(id, options?)` | `category.delete` | `DELETE …/categories/:id` | C | port only |
| `setCustomFieldValues(id, merge, options?)` | `category.update` (values-only change) or a dedicated action (T007) | `PATCH …/categories/:id` | C/? | port only |
| `setInventoryThresholds(id, patch, options?)` | `category.inventory_thresholds.set` (new) | inventory's threshold admin (`ThresholdAdminService.patch`) | N here | convert; `inventory` stops auditing the category part itself (no double audit) |

`setInventoryThresholds` today carries `command-coverage-ignore` in
`packages/modules/catalog/src/backend/services/category-admin.service.ts` because `inventory`'s caller
audits the change as `low_stock_threshold.update`. As a Command owned by `catalog` the category row's
write is audited by its owner; `inventory`'s summary entry keeps auditing its own settings only. T007
records the exact split.

**Not offered**: category content (`category.content.update` — the content editor's), category import
(`catalogBulkImportPort.importCategories`), product assignment (a Product-side operation).

**Read**: `listAll` is `catalogCategoryReadPort.listAll` (exists).

## Owner off

`catalog` is non-deactivatable.

## Deprecated by this port

`catalogCategoryWritePort` (all methods).

## Tests

`backend/test/contract/catalog/catalog-category-command-port.test.ts` (parity incl. navigation cache
refresh), `backend/test/integration/catalog/catalog-category-command-port.worker.test.ts` (move from a
worker), a no-double-audit test for thresholds, delegation tests.
