---
'@endora-commerce/mod-invoice-ledger': minor
---

Organization merge participants (issue #1907, `specs/192-organization-merge/` T045, OQ-10), through the new irreversible `invoice_ledger.merge_reassign` Command: `client-maps` (`configuration`) moves a loser client mapping only where the survivor has none for its adapter, credential and environment, and lists the loser's mappings it keeps as the `INVOICE_LEDGER_CLIENT_MAP_KEPT` preview warning; `document-maps` (`records`) re-points document mappings. The delivery log is kept.
