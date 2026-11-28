---
'@endora-commerce/mod-quick-order': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the Organization's quick-order defaults follow *survivor wins with fill gaps*: the loser's defaults are adopted only when the survivor has none (new audited, irreversible Command `quick_order.merge_reassign`); otherwise the survivor's stay and the loser's remain on the archived loser.
