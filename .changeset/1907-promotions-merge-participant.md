---
'@endora-commerce/mod-promotions': minor
---

Organization merge participant (issue #1907, `specs/192-organization-merge/` T049), through the new irreversible `promotion.merge_reassign` Command (`records` phase): the loser's Organization-specific promotions and its usages are re-pointed to the survivor, and its per-Organization usage counters are added to the survivor's, so a merge cannot reset a per-Organization limit.

Recording a redemption asks the merge freeze first: a buyer's Organization being merged or merged away
refuses it, as every other write naming it is refused.
