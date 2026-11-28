---
'@endora-commerce/mod-customer-notifications': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the loser's in-app customer notifications move to the survivor, read state included, in batches of the new audited, irreversible Command `customer_notification.merge_reassign`.
