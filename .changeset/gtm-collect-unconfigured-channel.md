---
'@endora-commerce/mod-google-tag-manager': patch
---

`POST /api/v1/storefront/google-tag-manager/collect` no longer enqueues relay jobs for a sales
channel whose server-side tagging is not configured (the switch is off, or the server container
URL is blank). It answers `202` with `accepted: 0`. Before, any instance with Redis wrote one job
per storefront event onto `google_tag_manager.ss.relay`, and the worker read the same empty address
and dropped each one. Nothing was ever sent anywhere; the change removes the queue traffic.
`makeEnqueuer` takes a second, required argument that answers whether a channel relays.
