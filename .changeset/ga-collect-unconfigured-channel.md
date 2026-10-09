---
'@endora-commerce/mod-google-analytics': patch
---

`POST /api/v1/storefront/google-analytics/collect` no longer enqueues delivery jobs for a sales
channel whose server-side delivery is not configured (the master switch or `server_side_enabled` is
off, or the Measurement ID is blank). It answers `202` with `accepted: 0`. Before, any instance
with Redis wrote one job per storefront event onto `google_analytics.ss.deliver`, and the worker
read the blank Measurement ID and dropped each one. Nothing was ever sent anywhere; the change
removes the queue traffic. `makeEnqueuer` takes a second, required argument that answers whether a
channel delivers, and `GaConfigService` gains `isServerSideOn(salesChannelId)`, which the module
wires to it.
