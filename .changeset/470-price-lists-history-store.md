---
'@endora-commerce/mod-price-lists': minor
---

Issue #470 (D-288; owner ruling O-3, 2026-11-10), first stage: the schema of a price book's own price-change history. The migration `Migration20261110T073922PriceListsValueChanges` creates two tables owned by the module, and the package's `entities` array registers their entities. Both are `@RuleScoped` like the book.

- `price_list_value_changes` (`PriceListValueChange`) holds one row per Command that changed a value: the action, the actor, the time, the changed header values and the line count. It is indexed on `(price_list_id, at desc, id desc)`.
- `price_list_row_value_changes` (`PriceListRowValueChange`) holds one line per price row the Command added, changed or removed. Each line has the row's selection and quantity window, and both sides of its price in the row's own types, `numeric(14,4)` and `numeric(7,2)`. It is keyed by `(change_id, seq)` and indexed on `(price_list_id, product_id, at desc)`.

Both tables cascade from their price book. Deleting a book deletes its price history (owner ruling, 2026-11-10). Lines also cascade from their change.

Nothing writes or reads the tables yet, and no behaviour changes. Price-book audit entries keep their current contents until a later stage of #470.
