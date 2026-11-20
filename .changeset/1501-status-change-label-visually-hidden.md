---
'@endora-commerce/admin-kit': minor
---

`StatusChangeControl` takes `labelVisuallyHidden` (issue #1501). The `label` stays the accessible name of the *Change…* button and of the dialog's radio group, but is no longer drawn above the badge — for a control inside a table cell, whose column header already says it. Default `false`; existing call sites render as before.
