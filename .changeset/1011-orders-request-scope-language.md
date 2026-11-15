---
'@endora-commerce/mod-orders': patch
---

**A buyer's clone of an order into a quote request judges its lines in the channel language `Accept-Language` asks for, read as a q-weighted list** (issue #1011). `POST /api/v1/orders/:id/clone-to-quote` took the header's first tag alone, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the channel default, and an order holding a product available only in Polish could not be cloned (`404`). The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. The language messages are worded in is unchanged. A request without the header behaves as before.
