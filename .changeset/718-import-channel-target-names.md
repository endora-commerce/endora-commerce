---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-import-export': minor
---

`GET /api/v1/admin/import-export/channel-targets` now answers each channel's per-language `name` beside its `id`, `code` and `languages`, and `importChannelTargetSchema` requires it. Code that builds an `ImportChannelTarget` must add `name` (a record of language code to name; an empty record is valid).

The import profile dialog labels each target as "channel name / language name", with the channel code as secondary text; a channel with no name in any language is labelled by its code, and a saved target whose channel no longer exists is listed as a missing channel.

`MultiSelectOption` gains an optional `description`, shown muted after the option's label.
