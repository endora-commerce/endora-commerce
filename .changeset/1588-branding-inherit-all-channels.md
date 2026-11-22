---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-settings': minor
'@endora-commerce/mod-transactional-emails': minor
---

A sales channel's e-mail branding override can be removed again, so the channel inherits the all-channels value (issue #1588).

- `@endora-commerce/contracts`: `SettingsAdminPort` gains `resetValuesForSubset(code, channelCodes, actor)`, returning `SettingsResetValuesResult` (`resetChannelIds`, `newVersion`). It removes only the named channels' own values and refuses an empty subset with `SETTING_EMPTY_SUBSET`; the platform-wide value is never touched. An implementation of the port outside this repository must add the method. New schemas `emailBrandingFieldSchema` and `resetEmailBrandingQuerySchema` (types `EmailBrandingField`, `ResetEmailBrandingQuery`).
- `@endora-commerce/mod-settings`: `SettingsAdminService.resetValuesForSubset` implements the port method over the existing `resetValues`.
- `@endora-commerce/mod-transactional-emails`: `DELETE /api/v1/admin/transactional-emails/branding?salesChannelId=…&fields=logoAssetId,accentColor` (`transactional_emails:write`) removes the channel's own value for the named fields and answers the resolved branding. On the Email branding screen, a field a channel sets differently shows "Set for this channel" and a "Use all-channels value" control; it is staged, and Save removes the channel's value rather than copying the all-channels one in.
