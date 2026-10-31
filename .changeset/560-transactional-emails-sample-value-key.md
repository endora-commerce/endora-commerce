---
'@endora-commerce/mod-transactional-emails': minor
---

A template variable's `sampleValueKey` (issue #560) is resolved, through `_i18n`'s `adminI18nService`, in the language being edited: the e-mail detail (the editor's variable list and live preview) and the server preview both show that language's sample. The manifest's `sampleValue` answers when the key does not resolve, when the content language has no shipped bundle, or when the resolver refuses. The module now declares `_i18n` in its `dependencies`; `_i18n` cannot be switched off, so no operator loses an activation control.
