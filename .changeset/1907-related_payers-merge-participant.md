---
'@endora-commerce/mod-related-payers': minor
---

Organization merge participant (issue #1907, `specs/192-organization-merge/` T047), through the new irreversible `related_payer.merge_reassign` Command (`records` phase): payer links and requests naming the loser on either side are re-pointed to the survivor; a link between the two is revoked and stays on the archived loser, a link duplicating one of the survivor's live links is revoked, and a pending request between the two is withdrawn with `decided_by_kind = 'merge'`. Cached links are dropped for every buyer affected.
