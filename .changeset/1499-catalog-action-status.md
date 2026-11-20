---
'@endora-commerce/mod-catalog': patch
---

The catalog's admin screens show an action's result beside the control that caused it, not as a success banner (issue #1499, UX audit SALES-17 and CAT-09; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a banner, and an error clears the result.

- Product editor: "Saved N changes" appears beside Save, and "Archived" / "Restored" beside the Product menu. The banner between the header and the tabs, which pushed the form down after every save, is gone.
- Product and category content screens: "Saved" appears beside Save; the next edit in the canvas clears it.
- Categories: a create, save, activation, deactivation or delete is reported beside "New root category" in the page header, because the form or row that did it is closed or gone by then.
- Attributes: a created or updated attribute is reported in the attribute form's header, and saved list flags above the table.
- Attachment types: a created type is reported beside Add, and a deleted one in the list's header.
- Bulk operation detail: the undo result appears in the summary header where Undo was, as a warning when some products could not be reverted. An operation undone earlier is a plain note there.
