---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
---

The admin kit's primitives draw their own words from the `core` bundle instead of English literals (issue #1433), so a Polish operator no longer reads English where a caller passed no copy: `RuleBuilder`, `MultiSelect`, `FileDropzone`, `AssetFieldPicker`, `CmsBlockPicker`, `CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti` and `CustomFieldValuesPanel`'s fallback errors. Every prop that overrode a default still does.

`RuleBuilderLabels` gains optional entries for each word the builder draws (`addCondition`, `addGroup`, `combineWith`, `groupOperatorLabel`, `groupAll`, `groupAny`, `groupSuffix`, `addChildCondition`, `addChildGroup`, `removeCondition`, `removeChild`, `valuesInputPlaceholder`, `fieldLabel`, `operatorLabel`). Its icon-only remove buttons and its field, operator and AND / OR selects now have accessible names. The default `matchAll` sentence is "No conditions: everything matches." rather than "Matches all carts.", which was wrong on every rule editor that does not filter carts; pass `labels.matchAll` to keep a domain-specific sentence.

`@endora-commerce/mod-i18n` ships the new `core` keys in English and Polish.
