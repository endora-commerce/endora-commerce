---
'@endora-commerce/mod-credit-limits': minor
---

Organization merge participants (issue #1907, `specs/192-organization-merge/` T046, OQ-8), through the new irreversible `credit_limit.merge_reassign` Command: `credit-limit` (`configuration`) keeps the survivor's limit or gives it the loser's when it has none; `credit-exposure` (`records`) moves the loser's reservations — and every reservation on the loser's limit, onto the survivor's — and its return top-ups. The limit is never raised; the preview warns with `CREDIT_LIMIT_MERGE_OVER_LIMIT` when the moved exposure exceeds it.
