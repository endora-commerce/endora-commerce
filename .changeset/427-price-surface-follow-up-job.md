---
'@endora-commerce/mod-price-lists': patch
---

The price-surface worker checks for pending work once each job completes and, when a mark is pending, enqueues a follow-up job (issue #427). A mark committed after a pass's final empty read used to have its enqueue deduplicated against the still-active job under the fixed id, leaving its profile stale until an unrelated write. `startPriceSurfaceWorker` takes two new inputs, `hasPendingWork` and `enqueue`; `PriceSurface` gains `hasPendingWork()`.
