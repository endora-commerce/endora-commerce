---
'@endora-commerce/admin-kit': minor
---

`StickyFormActions` is now the one place of an editor's single Save (issue #1449). It takes `primary` and `secondary` actions (the primary drawn last), a `note` that also describes the primary, `dirty` for the unsaved-changes hint, and `error` / `status` regions that say the last save's outcome beside the button. `desktop="sticky"` keeps the bar in view at the bottom of a long editor at 1024 px and wider; the default, `inline`, keeps the previous behaviour, and `children` still renders as before.
