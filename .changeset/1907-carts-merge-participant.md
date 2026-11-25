---
'@endora-commerce/mod-carts': minor
---

Organization merge participant (issue #1907, `specs/192-organization-merge/` T043): the loser's carts and every cart *Buying for* the loser are re-pointed to the survivor through the new irreversible `cart.merge_reassign` Command (`records` phase). A *Buying for* that would name the cart's own Organization is cleared with its terms, and each moved cart's recompute cache is dropped so it is repriced on its next read.
