---
'@endora-commerce/contracts': minor
---

Issue #948 and issue #349 (E-349-1), all additive.

- `ActorAdmin.sessionId?`: the id of the session the admin actor was resolved from.
- `MfaAdminEnforcementTrigger` gains `'setting_enabled'`. `MfaEndUnprotectedAdminSessionsOptions` becomes a union: a role trigger carries `roleCode`, `setting_enabled` carries `settingCode`.
- `SettingWriteConfirmationSchema` / `SettingWriteConfirmation` (`{ whenValue, code, message, params? }`), the optional `SettingDto.confirmation`, the optional `SettingNoticeProvider.confirmation(input)`, and `SettingNoticeRegistryPort.confirmationFor(input)`.
- `SettingsValueChangedPayload`, the payload of `settings.value_changed`, with the new optional `actorAdminUserId` and `actorSessionId`.
- `adminRoleTwoFactorNoticeSchema` / `AdminRoleTwoFactorNotice`, and the optional `twoFactorNotice` on `adminRoleSchema`: present while a role's `requiresTwoFactor` is set and not applied, because `mfa` has no encryption key.
