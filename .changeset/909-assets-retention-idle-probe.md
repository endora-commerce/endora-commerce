---
'@endora-commerce/mod-assets-library': patch
---

The retention sweep's "is anything due?" question is now one `exists(…)` statement over the
four passes' own row sources, instead of four ORM counts. Each pass (previous versions,
soft-deleted assets, assets parked in `pending_cleanup`, the cleanup ledger) lists its batch
through the same row source the question asks about, so the two cannot drift apart. A question
that fails still counts as "yes", so a sweep is never skipped. No behaviour changes for an
operator.
