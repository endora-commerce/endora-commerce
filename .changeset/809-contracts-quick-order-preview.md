---
'@endora-commerce/contracts': minor
---

Quick-order preview contracts (issue #809). New exports: `quickOrderPreviewSchema` and its type `QuickOrderPreview` — the import's response as the buyer has edited it, whose recognised lines may carry `notAdded` (`quickOrderPreviewNotAddedSchema`) after a partial cart build — plus `quickOrderPreviewRecognizedItemSchema`, and three constants: `QUICK_ORDER_PREVIEW_MAX_LINES` (2 000, recognised and rejected lines together), `QUICK_ORDER_PREVIEW_MAX_BYTES` (2 MiB) and `QUICK_ORDER_PREVIEW_TTL_SECONDS` (one hour). Nothing existing changes.
