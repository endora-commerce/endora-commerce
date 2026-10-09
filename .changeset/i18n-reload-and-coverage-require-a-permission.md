---
'@endora-commerce/mod-i18n': patch
---

`POST /api/v1/admin/i18n/reload` and `GET /api/v1/admin/i18n/coverage` now require a permission.
Both required an administrator session and no permission code, so any administrator could call
them whatever their role granted — including an account that holds no role at all, which every
permission-checked route refuses. The reload is a write: it replaces the translation bundles for
the whole instance.

**Breaking for callers without the permission.** The reload now requires `settings:write` and the
coverage report `settings:read`; a caller holding neither is answered `403`. These are the codes
the screen that calls the reload already requires — the **Reload translations** button is on the
cache screen under Settings, which is `settings:write` — so no shipped Admin UI screen loses
anything. A script or integration that called either route with an administrator session whose
role lacks the code has to be granted it.

`GET /api/v1/admin/i18n/bundles` and `PATCH /api/v1/admin/me/preferred-language` are unchanged and
stay open to every administrator session.

No new permission code, setting or migration.
