---
'@endora-commerce/admin-kit': minor
'@endora-commerce/page-builder-admin': minor
---

**`ScopedField` — one inherited-value control for scoped product fields (feature 170).** `@endora-commerce/admin-kit` exports `ScopedField` and its types (`ScopedFieldProps`, `ScopedFieldControlProps`, `ScopedFieldViewWithParent`, `ScopedInheritedValue`): a field at Global, a channel, or a channel and language, showing "Use value from *parent scope*", an own value, or a deliberately empty value. `use-unsaved-changes-prompt` honours a `[data-own-unsaved-guard]` opt-out.

**Breaking:** the product browser and the page-builder catalog pickers read a product's `name` as a string (the Global name); a caller passing a per-language name map passes the string instead.

`CategoryTreePicker`'s list is a labelled `role="group"` instead of `role="tree"`: its rows are checkboxes, not `treeitem`s, and it has no tree keyboard model. A test that queried `getByRole('tree', …)` queries `getByRole('group', …)`.
