---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
---

**`catalog` declares four hookable actions** (`specs/193-admin-form-extensions/` FR-112 – FR-114, issue #2006), so a deployment's overlay module or an installed package can take part in a Product write through a command hook: `product.create`, `product.update`, `product.scoped_values.save` and `product.scoped_values.import`, each for both phases (`beforeCommit` inside the write's transaction, with a veto that rolls it back; `afterCommit` through the platform's outbox).

`@endora-commerce/contracts` exports the refs as `PRODUCT_HOOKABLE_ACTIONS` (`create`, `update`, `scopedValuesSave`, `scopedValuesImport`) and their data types: `ProductCreateHookData` (the product record and its categories), `ProductUpdateHookData` (the after-state record, `changedFields`, and `categoryIds` when the write named its category set), `ProductScopedValuesHookData` (`productId` and one `ProductScopedValuesHookScope` per saved scope: the scope, the values the write left there and the fields it changed), and `ProductOutbox` (`productId` and `changedFields` — ids and field names only; no row is pinned to an Organization).

**A bulk edit's product writes are now audited as `product.bulk_update.item`** (`specs/193-admin-form-extensions/` D-300.8), on the inline and the queued path, instead of `product.update`. It is the same write with the same audit state (`stateBefore`, `stateAfter`, `changedFields`) and the same `product.updated.v1`; the bulk edit's summary entry `product.bulk_update` and its undo are unchanged. The bulk edit is reversible, so neither `product.bulk_update` nor `product.bulk_update.item` is hookable: a `product.update` hook runs for every product write except a bulk edit's and its undo. To observe bulk edits, listen to `product.updated.v1`. An audit-log filter or report that counted a bulk edit's products under `product.update` now finds them under `product.bulk_update.item`, which the Recent Activity card does not list.

`catalogProductCommandPort`'s `create`, `update`, `setCustomFieldValues` and `applyScopedValues` hand their `extensions` to those Commands; a key no present hook module claims is still refused `422 COMMAND_EXTENSION_UNCLAIMED` before anything is written. Nothing changes for a deployment that registers no hook, nor for a caller that passes no `extensions`.
