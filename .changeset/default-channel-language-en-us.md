---
'@endora-commerce/platform': patch
'@endora-commerce/mod-languages': patch
---

The system-default sales channel is created with `en-US`, a language the dictionary holds,
instead of the bare `en`, which it never did. The `languages` module seeds `en-US` and `pl-PL`
only, and the admin `PATCH /api/v1/admin/sales-channels/:code` validates every listed language
against that dictionary — the unchanged `en` included — so in a freshly installed shop adding a
language to the default channel answered `409 DICTIONARY_ENTRY_NOT_FOUND`.
`DefaultChannelReconciler` (`@endora-commerce/platform`) now falls back to `en-US`, and the
channel's display name is keyed by that same code.

Existing instances are repaired by a new `@endora-commerce/mod-languages` migration,
`Migration20261003T115043LanguagesRepairDefaultChannelLanguage`, which runs on the next
`endora upgrade` or `pnpm run setup`. It changes only a `sales_channels` row whose `languages` is
exactly `["en"]` and whose `default_language` is `en` — the shape the reconciler wrote — and only
while `en` is not a dictionary language and `en-US` is. Such a row becomes `["en-US"]` / `en-US`
with its `version` bumped by one; its display name is left as it is. A channel whose languages an
operator configured, or an instance where `en` was added to the dictionary, is not touched.
