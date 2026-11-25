---
'@endora-commerce/mod-analytics': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the loser's analytics events are re-pointed to the survivor, so per-Organization reports show one history (new audited, irreversible Command `analytics.merge_reassign`). The step runs in batches of 500 and may finish after the merge completes.
