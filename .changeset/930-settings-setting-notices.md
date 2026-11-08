---
'@endora-commerce/mod-settings': minor
---

Issue #930 — a setting can say it is not in force. New registry `settingNoticeRegistry` (`SettingNoticeRegistryPort`), filled from module boot hooks like `settingWriteValidatorRegistry` and filtered by contributor presence. Every admin settings read and write response carries the first notice a present provider gives, as `notice: { code, message }`, and omits the field otherwise (never `notice: null`). A provider that throws is logged with its contributor id and the setting code and skipped, so the setting is shown without its notice and the read still answers. The Settings screen shows it under the setting's description, translated from the owner's bundle at `settingLabels.<setting code>.notice.<code>`, or the API's `message` when there is no translation.
