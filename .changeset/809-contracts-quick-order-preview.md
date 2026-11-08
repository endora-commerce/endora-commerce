---
'@endora-commerce/contracts': minor
---

Quick-order preview contracts (issue #809). New exports: `quickOrderPreviewSchema` and its type `QuickOrderPreview` — the import's response as the buyer has edited it, whose recognised lines may carry `notAdded` (`quickOrderPreviewNotAddedSchema`) after a partial cart build — plus `quickOrderPreviewRecognizedItemSchema` and `quickOrderPreviewSummarySchema`, the import summary with `overflowCount` (rows past the import's limit, kept as a count) and `rowLimit` (the limit they were past). Three constants: `QUICK_ORDER_PREVIEW_MAX_LINES` (10 000, the hard maximum of the line cap, which is the effective `quick_order.import_max_rows`), `QUICK_ORDER_PREVIEW_MAX_BYTES` (2 MiB) and `QUICK_ORDER_PREVIEW_TTL_SECONDS` (one hour). Nothing existing changes.
