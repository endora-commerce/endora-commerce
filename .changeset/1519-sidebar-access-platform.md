---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-webhooks': patch
---

The Admin UI sidebar's *System* section, which had 18 entries, is now two sections (issue #1519, UX audit SHELL-11, owner decision DEC-02):

- **Access**: Users, Roles, API keys, Credentials, Audit log.
- **Platform**: Modules, Settings, Custom fields, Import/export, Bulk operations, Webhooks, Global search, PWA, Command hooks, API description.

Host rows are now sorted by weight together with the contributed rows. Before, they always came first, so the API description sat above Settings.

An administrator's own two-step verification is no longer in the sidebar. It is the **Security** tab of **My profile** (`/profile/security`), opened from the avatar or from the palette's *Account security* action, which now targets that tab. `/security` redirects there, so old bookmarks still work. With `mfa` off, the profile has no tab strip and `/profile/security` opens the profile.

**For module authors.** `AdminNavSectionNameSchema` gains `'access'` and `'platform'`, and `AdminZoneNameSchema` gains `'profile.security'`, the body of the Profile's Security tab, with empty props. `'system'` is deprecated but still accepted: the shell puts such an entry under *Platform*, so a module that ships separately keeps its row. It will be removed in a major release.

**Upgrade notes.**

- An administrator who had collapsed *System* sees both *Access* and *Platform* collapsed. The preference is rewritten the next time they toggle a group.
- A pin of `/security` in the sidebar's Pinned section no longer shows, because that destination is no longer a sidebar entry. The stored pin is kept but not displayed.
