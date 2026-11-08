---
---

Storefront: the quick-order page keeps the buyer's preview on the backend (issue #809) instead of in the `b2b_quick_order_preview` cookie of #805, so a review holds up to 2 000 lines instead of a few dozen. Only the `storefront` application changes here, which is in the Changesets `ignore` list. An edit, a removal or a build that finds the preview expired tells the buyer to paste the list again, in English and Polish. Sign-out drops the preview before the session ends.
