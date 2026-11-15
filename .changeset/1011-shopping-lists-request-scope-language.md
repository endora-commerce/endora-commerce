---
'@endora-commerce/mod-shopping-lists': patch
---

**Saving to a shopping list and converting a list to a quote request read `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #1011). `POST /api/v1/shopping-lists/:id/items` and `POST /api/v1/shopping-lists/:id/convert-to-rfq` took the header's first tag alone as the language a product's availability is judged in, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the channel default: a product available only in Polish could not be saved (`404`), and a conversion skipped it as `product_not_found`. The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. A request without the header behaves as before.
