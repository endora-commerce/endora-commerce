---
'@endora-commerce/mod-comparisons': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the loser's product comparisons move to the survivor, in batches of the new audited, irreversible Command `comparison.merge_reassign`.
