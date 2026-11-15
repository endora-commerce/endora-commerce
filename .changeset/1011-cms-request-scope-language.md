---
'@endora-commerce/mod-cms': patch
---

**The CMS storefront lookups read `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #1011). `GET /api/v1/cms/pages/by-slug`, `GET /api/v1/cms/blocks/by-code` and `GET /api/v1/cms/hooks/by-code` used to take the header's first entry with its `;q=` parameter, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` was answered in the channel default and `pl` matched no content language. Without `?language=`, they now resolve the language through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language, so `pl` reaches a `pl-PL` channel language), the first one the channel offers winning, else the channel's default language. An explicit `?language=` still wins, and a request with neither behaves as before.
