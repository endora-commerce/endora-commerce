---
'@endora-commerce/admin-kit': patch
---

**`RowActionMenu`: the icon-only trigger is a 44 × 44 touch target.** On a coarse pointer the ⋮ trigger, and the move-up, move-down and delete buttons of a `LineGroupsEditor` group heading, grow their hit area to 44 × 44 px with a transparent pseudo-element. Before, they were 32 px, below the touch minimum. They still look 32 px, and nothing changes with a mouse.
