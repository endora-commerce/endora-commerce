---
'@endora-commerce/mod-price-lists': minor
---

Organization merge participant (issue #1907, `specs/192-organization-merge/` T048), through the new irreversible `price_list.merge_reassign` Command (`configuration` phase): the loser's price-book audience memberships are unioned into the survivor's, and its Organization display-mode override fills the survivor's gap (the survivor's own wins). The pricing generation is bumped with the books whose audience changed after each batch.
