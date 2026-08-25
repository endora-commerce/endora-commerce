---
'@endora-commerce/contracts': minor
---

Add Akeneo admin run list and detail envelopes.

`akeneoImportRunListQuerySchema`, `akeneoImportRunListResponseSchema` and
the expanded `akeneoImportRunDetailSchema` (counters plus `issuesTruncated`)
are the source of truth for `GET /api/v1/admin/pim-akeneo/runs`. Additive.
