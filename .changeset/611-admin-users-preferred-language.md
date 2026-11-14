---
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/platform': patch
---

`admin_users` now creates `admin_users.preferred_language` itself, in the new
`Migration20261114T002913AdminUsersPreferredLanguage` (issue #611). Until now only `_i18n`'s
`Migration20260507T091405I18nAdminI18nInit` created it, although the column belongs to
`admin_users`' `AdminUser` entity. That migration keeps its class name and no longer names
`admin_users` in `up()` or `down()`. The new migration uses `add column if not exists` with the
same type, so a database that has already applied the old migration does not change.
`FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `_i18n` writing `admin_users`.
