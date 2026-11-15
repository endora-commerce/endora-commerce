---
'@endora-commerce/mod-megamenu': patch
---

**The storefront megamenu reads `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #1011). `GET /api/v1/megamenu/by-channel` used to take the header's first entry with its `;q=` parameter as the binding language, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` or `pl` found no active menu and answered `404 MEGAMENU_NOT_FOUND`. Without `?language=`, it now resolves the language through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language, so `pl` reaches a `pl-PL` channel language), the first one the channel offers winning, else the channel's default language. A header naming only languages the channel does not offer now gets the channel default's menu instead of a `404`. An explicit `?language=` still wins, and a request with neither behaves as before.
