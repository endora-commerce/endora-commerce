---
'@endora-commerce/mod-webhooks': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) webhooks bound to the loser are re-pointed to the survivor before the merge finalizes, so they receive `organization.merged.v1` (new audited, irreversible Command `webhook.merge_reassign`).
