---
'@endora-commerce/contracts': minor
---

Issue #930:

- `ERROR_CODES` gains `MFA_ENFORCEMENT_UNAVAILABLE` (409): a write turned `mfa.admin.totp_enforced` on where no second factor can be enrolled. `details.reason` is `encryption_key_missing` and `details.setting` names the setting. A consumer switching exhaustively over `ErrorCode` has one more case.
- `ENCRYPTION_KEY_MISSING` (`'encryption_key_missing'`): the one spelling of "`mfa` has no encryption key" as a refusal reason or a notice token.
- `SettingDtoSchema` gains an optional `notice: { code, message }` (`SettingNoticeSchema`): the owning module says the stored value is not in force. New contribution types `SettingNoticeInput`, `SettingNoticeProvider` and `SettingNoticeRegistryPort` (container name `settingNoticeRegistry`, owner `settings`).
