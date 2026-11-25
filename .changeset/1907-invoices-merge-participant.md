---
'@endora-commerce/mod-invoices': minor
---

Organization merge participant (issue #1907, `specs/192-organization-merge/` T044): the loser's invoices are re-pointed to the survivor through the new irreversible `invoice.merge_reassign` Command (`records` phase). The issued document — number, buyer snapshot, amounts — is not changed (FR-043).
