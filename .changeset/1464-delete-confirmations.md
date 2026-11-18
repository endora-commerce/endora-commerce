---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-megamenu': patch
---

Deletes that fired on one click now ask first (issue #1464).

`useConfirmDialog().confirm` accepts an `action` and a `describeError` beside the usual options. With them, the dialog runs `action` itself on confirm: busy while it is pending (both buttons and Escape inert, so it cannot be submitted twice), resolving `true` once it succeeds, and on a throw staying open with `describeError(err)` as its announced error, so the operator can retry or cancel where they are looking. A call without `action` behaves as before.

The newsletter's e-mail block, subscriber, tag and custom-field deletes, the Google Analytics custom-event delete and the megamenu tree's item delete now confirm, naming the object and what deleting it does; focus opens on Cancel. The Google Analytics Delete moves out of the row beside Save into its own section below the form. The megamenu confirmation says how many nested items go with the item, and that nothing changes on the storefront until the tree is saved.
