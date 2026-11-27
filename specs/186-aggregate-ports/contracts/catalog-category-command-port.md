# Contract: `catalogCategoryCommandPort` (Category, #1826)

Owner `catalog` (non-deactivatable). Declared in `packages/contracts/src/catalog.ts`.

## Operations

Measured by T007 on `origin/master` `d936722d5` (2026-11-26). Readiness: C = a Command already; N = no
audit. "Factory" is the one function in `packages/modules/catalog/src/backend/commands/category.commands.ts`
that the admin route (through `CategoryAdminService`) and the port both run.

| Method | Command action (kept) | Factory | Admin route | Readiness | Side effects outside the write | Work |
| --- | --- | --- | --- | --- | --- | --- |
| `create(input, options?)` | `category.create` | `makeCreateCategoryCommand` | `POST /api/v1/admin/catalog/categories` | C | after the commit, `salesChannelMembership.bindToDefaultIfEmpty('category', id)` (the kernel writer, own transaction); **no event** | factory extracted; port |
| `update(id, input, options?)` | `category.update` | `makeUpdateCategoryCommand` | `PATCH …/categories/:id` | C | `category.updated.v1` on commit → `search` re-indexes the subtree, `catalog` flushes the storefront's `catalog:categories` tag, `price_lists` refreshes the subtree's price surface | factory extracted; port |
| `move(id, { parentId, position? }, options?)` | `category.update` (parent and sort order only) | `makeUpdateCategoryCommand` | `PATCH …/categories/:id` with `parentCategoryId` (+ `sortOrder`) | C | as `update` — the navigation flush of US8 scenario 1 | port only (R-20.1) |
| `delete(id, options?)` | `category.delete` | `makeDeleteCategoryCommand` | `DELETE …/categories/:id` | C | **none** — no event, so no navigation flush (finding 2) | factory extracted; port |
| `setCustomFieldValues(id, merge, options?)` | `category.update` (custom-field bag only) | `makeUpdateCategoryCommand` (`customFields` = the caller's merge) | `PATCH …/categories/:id` with only `customFieldValues` | C | as `update` | port only (R-20.2) |
| `setInventoryThresholds(id, patch, options?)` | `category.inventory_thresholds.set` (**new**) | `makeSetCategoryInventoryThresholdsCommand` | `inventory`'s `PATCH /api/v1/admin/inventory/thresholds` (`ThresholdAdminService.patch`, per category) | N | none (no product document carries the thresholds) | convert; `inventory` stops counting the category half (R-20.3) |

`category.content.update` (`PUT …/:id/content`) also moved into the factory file
(`makeSetCategoryContentCommand`) so the service has one runner, but it is **not** on the port.

**Not offered**: category content (`category.content.update` — the content editor's), category import
(`catalogBulkImportPort.importCategories`), product assignment (a Product-side operation), channel
membership beyond the default bind of `create` (the kernel's membership writer; Principle XII — the port
adds no channel write path).

**Read**: `listAll` is `catalogCategoryReadPort.listAll` (exists); the deprecated method answers
`listAll({ liveOnly: true })`.

**Options**: `expectedVersion` is ignored (no `version` column; R-5). No category action is hookable, so
every `extensions` key is refused `422 COMMAND_EXTENSION_UNCLAIMED` (R-18.8's precedent).

## Inventory findings

1. **No dedicated move.** The tree editor (`CategoriesTree.tsx`) moves a category with the same `PATCH`
   that edits it, sending `parentCategoryId` (and the tree has no drag-reorder that renumbers siblings).
   `move` is therefore `category.update` with the parent and, when given, `sortOrder` — R-20.1.
2. **`category.create` and `category.delete` emit no event.** The storefront's `catalog:categories`
   cache (5-minute TTL) is flushed only on `category.updated.v1` and `category.content.updated.v1`, so a
   created or deleted category reaches the storefront navigation on the TTL, from the admin and the port
   alike. Parity is kept; the gap is pre-existing and is not this feature's to change (it would add an
   event to two published actions). Recorded for a follow-up issue.
3. **The default-channel bind of `create` runs after the commit**, on the kernel writer's own
   transaction (`bindToDefaultIfEmpty` without `em`). The port inherits it unchanged because it runs the
   route's runner; moving it into the Command would change a sales-channel write path (Principle XII),
   so it is left as it is and named here.
4. **`category.update`'s audit state does not name the custom fields** it changed (`before`/`after`
   carry the five columns only). `setCustomFieldValues` inherits that, since it runs the same Command;
   adding `changedCustomFields` would change the admin entry's shape and is left to a follow-up.
5. **The threshold write was unaudited by `catalog`** (`command-coverage-ignore`) and counted in
   `inventory`'s `low_stock_threshold.update` summary as `perCategoryCount`. Now a Command of its own; the
   summary keeps `global` and `perProductCount` and is not written for a categories-only patch (R-20.3).
6. **The deprecated port never parsed its input** with the admin schemas; it keeps not doing so for
   `create` / `update` in 0.113.0 (R-20.4).

## Owner off

`catalog` is non-deactivatable.

## Deprecated by this port

`catalogCategoryWritePort` (all methods). In-repository consumer moved: `inventory`
(`ThresholdAdminService`). Remaining consumers are in `../paid-modules` (`pim_akeneo`, `pim_unopim`,
`pim_ergonode`, `pim_pimcore`, `comarch_xl`), which migrate after 0.113.0 publishes (T103).

## Tests

`backend/test/contract/catalog/catalog-category-command-port.test.ts` (parity per method incl. the
navigation event and the default-channel bind; the no-double-audit case for thresholds; delegation of the
deprecated port; `source`, extensions, refusals), `backend/test/integration/catalog/catalog-category-command-port.worker.test.ts`
(build, move and prune a tree from a worker under `withSystemScope`; no tenant context refused),
`packages/modules/catalog/src/backend/commands/category.commands.test.ts` (DB-free: the threshold no-op,
the merge copy, the port's call-level refusals), `packages/contracts/src/catalog.category-command-port.test.ts`
(the type).
