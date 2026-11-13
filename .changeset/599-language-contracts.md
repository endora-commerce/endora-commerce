---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-languages': patch
---

Language and i18n-config replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `languageListResponseSchema` / `LanguageListResponse` for `GET /api/v1/admin/languages`, a `data` array of `languageSchema` rows. The rows were already described, but the list envelope was not.
- `mod-languages` builds its language rows as the contract's `Language` and its currency rows as the contract's `Currency`, instead of `Record<string, unknown>`. `GET /api/v1/i18n/config` returns `{ data: I18nConfigResponse }`, the admin list returns `LanguageListResponse`, and the upsert and set-default handlers return `{ data: Language }`. Nothing on the wire changes.
