---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': patch
'@endora-commerce/mod-cms': patch
---

The rich-text toolbar's **Read more passage** now seeds the passage's summary in the content locale being edited, not always in English (issue #1684): "Czytaj więcej" on a Polish page, "Read more" on an English one or in a language with no defaults.

`@endora-commerce/page-builder-core` exports `PageBuilderContentLocaleProvider` (`locale` is the BCP-47 content language a host is editing), `useContentDefault()`, `contentDefaultFor(locale, key)` and the per-language table `PAGE_BUILDER_CONTENT_DEFAULTS`, one entry per shipped language. Outside a provider the defaults are English, as before. The CMS `PageBuilderEditor` mounts the provider with its `activeLanguage`, so every CMS, blog and catalog content editor gets it.
