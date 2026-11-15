---
'@endora-commerce/mod-comparisons': patch
---

**A product comparison reads `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #1011). The comparison routes (`/api/v1/comparisons/me...` and the shared-link view) took the header's first tag alone as the reader's language, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` judged availability and named products in English, `de-DE, pl;q=0.5` in the channel default, and a product available only in Polish could not be added. The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language, so `pl` reaches a `pl-PL` channel language), the first one the channel offers winning, else the channel's default. A request without the header behaves as before.
