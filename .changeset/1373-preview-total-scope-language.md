---
'@endora-commerce/mod-orders': patch
---

**The checkout preview judges availability in the language the basket was judged in** (issue #1373). `POST /api/v1/orders/preview-total` now judges the basket's lines in the channel language the request's `Accept-Language` asks for (`requestScopeLanguage`), as `POST /api/v1/cart/items` does; it used to use the message language only, so on a channel language the interface does not offer (`de-DE` where messages are en/pl) a line the basket admitted could be reported as `product_unavailable`. A request without the header behaves as before.
