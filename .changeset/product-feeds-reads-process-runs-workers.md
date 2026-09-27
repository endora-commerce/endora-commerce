---
'@endora-commerce/mod-product-feeds': patch
---

The module decides whether to build its feed generation and reaper consumers, and whether to reconcile their schedules at boot, from the platform's `processRunsWorkers` host value instead of a `productFeedsRunWorkers` flag a composition root registered for it. Behaviour is unchanged: both carried the same answer, `false` when `BACKEND_ROLE` is `api` and in the test kit. A composition that registers the module itself must register `processRunsWorkers`, which `composeApp` and `composeTestServer` both do.
