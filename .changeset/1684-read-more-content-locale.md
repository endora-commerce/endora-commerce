---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/mod-cms': patch
---

Content that the Page Builder seeds into a document now follows the content locale being edited, not always English (issue #1684). The defaults are "Czytaj więcej" on a Polish page, and "Read more" on an English page or in a language with no defaults. This covers:
- the summary that the rich-text toolbar's **Read more passage** inserts, in the CMS editors and in the e-mail builder;
- the read-more label of a newly dropped `blog.LatestPosts` block.

`@endora-commerce/page-builder-core` exports:
- `PAGE_BUILDER_CONTENT_DEFAULTS`, the per-language table, with one entry per shipped language;
- `contentDefaultFor(locale, key)`;
- `withContentDefaultProps(config, locale, map)`, which seeds a block's default props in a locale (type `ContentDefaultPropsMap`);
- `PageBuilderContentLocaleProvider` (`locale` is the BCP-47 content language a host edits) and `useContentDefault()`.

Outside a provider, and without a locale, the defaults are English, as before.

`@endora-commerce/cms-components` exports `CMS_CONTENT_DEFAULT_PROPS` and `LATEST_POSTS_CONTENT_DEFAULT_PROPS`. A stored `blog.LatestPosts` block with no `readMoreLabel` now reads the default of the language it renders in (`useBlockRenderEnvironment().language`).

The CMS `PageBuilderEditor` mounts the provider and seeds its config with its `activeLanguage`. `EmailEditorPane` mounts the provider with its `previewLanguage`.
