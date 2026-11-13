---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-dictionaries': patch
---

Dictionary admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `dictionaryTranslationListResponseSchema` / `DictionaryTranslationListResponse` for `GET /api/v1/admin/dictionary/translations/:entryType/:entryCode`, and `dictionaryOrphanRowSchema` / `DictionaryOrphanRow` with `dictionaryOrphanReportResponseSchema` / `DictionaryOrphanReportResponse` for `GET /api/v1/admin/dictionary/audit/orphans`. No schema described either reply before.
- `mod-dictionaries` builds every country, currency, language, language-country and translation reply as the contract's type (`Country`, `DictionaryCurrency`, `DictionaryLanguage`, `LanguageCountry`, `DictionaryTranslation`) instead of `Record<string, unknown>`, and each handler declares its reply type. The admin dictionary client and the orphan audit page use the contract types instead of hand-written interfaces. Nothing on the wire changes.
