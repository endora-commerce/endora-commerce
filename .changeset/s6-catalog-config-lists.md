---
'@endora-commerce/mod-catalog': patch
---

The **Attachment types** and **Attribute sets** admin screens use the standard list page (UX audit, issues #1439, #1441 and #1448):

- *New attachment type* and *New attribute set* sit in the page header and open a dialog. The create form drawn under or above the list is gone.
- Row actions are in the row's "…" menu. *Delete* is no longer a filled red button in every row and still asks for confirmation. A set's attributes are managed in a dialog, opened from the menu, instead of an expanded table row.
- An empty list shows an empty state with its one action, a load failure offers *Retry*, and results are shown beside the *New …* button instead of in a banner.
- Without the catalogue write permission neither screen offers *New* or *Delete*; the attribute-set menu offers *View attributes*.
