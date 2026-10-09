---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
---

The configured admin idle-logout window now applies to every administrator, not only to those whose
role includes `settings:read`. The Admin UI learned the window by requesting
`GET /api/v1/admin/settings/admin.idle_logout_minutes`, which requires `settings:read`: an
administrator with a narrower role was answered 403 on every sign-in and was signed out after the
built-in 60 minutes whatever the operator had configured.

`GET /api/v1/admin/me` now carries the window as `idleLogoutMinutes` (`number | null`), described
by the new `adminMeResponseSchema` in `@endora-commerce/contracts`, and the Admin UI reads it from
there — it no longer calls the settings endpoint for it. `AdminMe` in `@endora-commerce/admin-kit`
gains the matching optional field. The field is additive; the Admin UI keeps its 60-minute default
when the field is absent (a backend older than this release) or `null` (the setting could not be
resolved).

The permission gate on the settings admin API is unchanged. No setting or permission changes.
