---
'@endora-commerce/mod-admin-feedback': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/platform': patch
---

The command-palette actions of the administration modules (`admin_feedback`, `admin_roles`, `admin_search`, `admin_users`, `api_keys`, `audit_logs`, `mfa`, `settings`, `webhooks`, the kernel-served `module_lifecycle`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`użytkownicy`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
