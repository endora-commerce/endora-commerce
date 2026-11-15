---
'@endora-commerce/mod-sales-channels': patch
---

On the sales-channel editor, Deactivate and Re-activate in the page header no longer drop unsaved edits (issue #407). The form used to re-seed every field from the toggle's answer. Now a field the operator changed and the toggle did not keeps the operator's value, the status follows the toggle, and the panels below keep their unsaved changes. The next Save writes the new version and the new status, so it does not undo the toggle. After the form's own Save every field still shows the saved channel.
