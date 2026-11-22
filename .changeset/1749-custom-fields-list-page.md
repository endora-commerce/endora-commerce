---
'@endora-commerce/mod-custom-fields': patch
---

The *Custom fields* screen is now the admin's standard list page (issue #1749). *New field* sits in the header once, the record-type select is the toolbar, and the field count is announced beside it. Loading shows the list skeleton, and a failed read says why and offers *Retry*. A row's *Edit* and *Delete* moved into its actions menu. A deletion is confirmed in a dialog, or in the carry warning when the field is part of a carry. The *Visible to* value changes through a confirm dialog instead of a select that saved on change, and that dialog shows the carry warning when the change stops a value from carrying. Removed bundle keys: `customFields.table.keep`, `customFields.table.loading`, `customFields.table.delete`.
