---
'@endora-commerce/mod-shopping-lists': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the loser's shopping lists move to the survivor, in batches of the new audited, irreversible Command `shopping_list.merge_reassign`. A moved default list stays its customer's default only when that customer has no default list on the survivor.
