---
'@endora-commerce/mod-addresses': minor
---

Organization merge participant (issue #1907, `specs/192-organization-merge/` T042): the manifest declares `merge.participates` (`addresses` phase) and the module registers its participant. An Organization merge re-points the loser's addresses to the survivor through the new irreversible `address.merge_reassign` Command; a moved default of a kind the survivor already has a default for stops being a default.
