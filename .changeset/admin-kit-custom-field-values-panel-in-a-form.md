---
'@endora-commerce/admin-kit': minor
---

`CustomFieldValuesPanel` can be embedded in a form. `save` is now optional: with `onChange` and
no `save` the panel renders the fields and no button, and reports the whole edited bag on
every change. Two further optional props: `fieldErrors` (a message per field key, shown at the
field) and `language` (the language labels are shown in; `en` when omitted). A caller passing
none of them sees no change.
