---
'@endora-commerce/contracts': minor
---

`ERROR_CODES` gains `MFA_ENFORCEMENT_UNAVAILABLE` (409, issue #930): a write turned `mfa.admin.totp_enforced` on where no second factor can be enrolled. `details.reason` is `encryption_key_missing` and `details.setting` names the setting. A consumer switching exhaustively over `ErrorCode` has one more case.
