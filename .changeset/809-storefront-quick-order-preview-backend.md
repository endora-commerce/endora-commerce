---
---

Storefront: the quick-order page keeps the buyer's preview on the backend (issue #809) instead of in the `b2b_quick_order_preview` cookie of #805, so a review holds as many lines as the import reads (`quick_order.import_max_rows`) instead of a few dozen; the rows past the import's limit read as one sentence with their count. Past 200 recognised lines the review step says that a build takes at most 200 and disables *Add all to cart* and *Send as quote request* until lines are removed. Only the `storefront` application changes here, which is in the Changesets `ignore` list. An edit, a removal or a build that finds the preview expired tells the buyer to paste the list again, in English and Polish. Sign-out drops the preview before the session ends.
