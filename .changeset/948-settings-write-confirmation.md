---
'@endora-commerce/mod-settings': minor
---

Issue #349 (E-349-1) — the owning module can ask a question before a write.

- `SettingNoticeRegistry.confirmationFor(input)` asks the present providers' optional `confirmation`. A provider that fails is logged and skipped, as for notices. Every admin settings read carries the answer as `confirmation`, and leaves the key out when there is none.
- The Settings screen asks before saving a draft equal to `confirmation.whenValue`. It re-reads the setting just before asking and builds the question from that read, so a count is the one in force at save time; a re-read with no confirmation saves without asking. The question is in the owner's words (`settingLabels.<setting code>.confirmation.<code>`, interpolated with `params`), else `message`. Declining saves nothing. After an accepted save the screen shows `settingLabels.<setting code>.confirmed.<code>` when the owner ships it.
- `settings.value_changed` now carries `actorAdminUserId` and `actorSessionId`, so a subscriber that ends sessions can spare the one the write was made from.
