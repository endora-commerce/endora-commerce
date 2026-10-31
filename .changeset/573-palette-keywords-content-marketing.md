---
'@endora-commerce/mod-analytics': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-google-tag-manager': patch
'@endora-commerce/mod-linkedin-ads': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-meta-ads': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-transactional-emails': patch
---

The command-palette actions of the content and marketing modules (`analytics`, `assets_library`, `blog`, `cms`, `google_analytics`, `google_tag_manager`, `linkedin_ads`, `megamenu`, `meta_ads`, `newsletter`, `pwa`, `seo`, `transactional_emails`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
