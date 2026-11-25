---
'@endora-commerce/platform': patch
---

The merge freeze answers a write naming an archived Project with the Project host's own
`409 PROJECT_MERGED` (with `survivorId`), instead of `RECORD_MERGE_RECORD_UNAVAILABLE` (issue #1907,
`specs/192-organization-merge/` US6).
