---
'@endora-commerce/mod-inventory': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the loser's back-in-stock notification requests move to the survivor, in batches of the new audited, irreversible Command `availability_notification.merge_reassign`.
