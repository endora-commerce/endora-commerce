---
'@endora-commerce/mod-pwa': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the loser's push subscriptions and push preferences move to the survivor, in batches of the new audited, irreversible Command `pwa.merge_reassign`. A preference stays one per customer account.
