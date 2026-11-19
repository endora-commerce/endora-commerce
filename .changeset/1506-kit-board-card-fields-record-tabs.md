---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-forms': patch
---

New kit composite `BoardCardFieldsEditor` (`@endora-commerce/admin-kit/components`), with the types `BoardCardFieldChoice`, `BoardCardFieldsConfig`, `BoardCardFieldsEditorCopy` and `BoardCardFieldsEditorProps` (issue #1506). It edits which fields a board card shows and in what order: `load` and `save` answer `{ fields, available, maxFields }` (the catalogue and the limit come from the server), `fieldLabel` names a field, and `copy` carries the three lines that name the module's record. Its other copy is `core`'s new `boardCardFields.*` keys in `@endora-commerce/mod-i18n`.

CRM's and Tasks' own `BoardCardFieldsEditor` copies are removed, along with their duplicated `boardCard.*` keys (the title, `shown.titleAlways`, `available.builtin` and `available.noCustom` stay). CRM's `ITEM_COUNT_LABEL_KEY` and `opportunity.tabs.counted` are removed too, because the kit's `common.tabs.counted` reads the same. The Opportunity and Project record tabs now use the kit `RecordTabs`, and the form builder's tabs use `Tabs` / `TabPanel`. The form builder's strip now looks like every other strip in the admin.
