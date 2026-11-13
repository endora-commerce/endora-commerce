---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-settings': patch
---

Settings admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `SettingGroupSummaryDtoSchema` / `SettingGroupSummaryDto` for the replies to `POST /api/v1/admin/settings/groups` and `PATCH /api/v1/admin/settings/groups/:code`, and `SettingGroupRowDtoSchema` / `SettingGroupRowDto` with `SettingGroupRowsResponseSchema` / `SettingGroupRowsResponse` for `GET /api/v1/admin/settings/groups`. No schema described these replies before. It also exports the `SettingsListResponse` and `SettingDetailResponse` types of the two schemas that were already published.
- `mod-settings` builds every setting and group reply as the contract's `SettingDto` / `SettingGroupDto` instead of `Record<string, unknown>`, and each handler declares its reply type. The admin `settingsClient` and the groups page use the contract types instead of hand-written interfaces, and `settingsClient.createGroup` / `updateGroup` now declare the summary they have always received. Nothing on the wire changes.
