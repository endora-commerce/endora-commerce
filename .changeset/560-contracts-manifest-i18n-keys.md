---
'@endora-commerce/contracts': minor
---

`ModuleActionSchema` gains an optional `keywordsKey` and `emailVariableDescriptorSchema` an optional `sampleValueKey` (issue #560). Both are translation keys relative to the declaring module's namespace, the same form as `labelKey`, so a manifest keeps its `keywords` and `sampleValue` in English and carries the other languages' words in its own `i18n/<lang>.json`. A `keywordsKey` bundle value is a comma-separated list; the new `parseBundleKeywords(value)` export reads it. `AdminActionView.keywords` — the `GET /api/v1/admin/admin-actions` row — is now the manifest's `keywords` followed by the words the action's `keywordsKey` resolves to in the requested language, de-duplicated. A manifest that declares neither field parses and behaves exactly as before.
