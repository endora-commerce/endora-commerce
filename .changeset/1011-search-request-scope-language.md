---
'@endora-commerce/mod-search': patch
---

**The search typeahead reads `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #1011). `GET /api/v1/search/suggest` used to take the header's first entry, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` searched and named products in English. It now resolves the language through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language, so `pl` reaches a `pl-PL` channel language), the first one the channel offers winning, else the channel's default language. A request with no `Accept-Language` header behaves as before.
