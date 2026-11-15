---
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-shopping-lists': patch
---

**Every storefront route that fills the basket in a batch judges its lines in the request's language** (issue #1293). `POST /api/v1/quick-order/build` with target `cart`, `POST /api/v1/shopping-lists/:id/convert-to-cart`, `POST /api/v1/cart/from-shopping-list/:id` and `POST /api/v1/cart/from-quote-request/:id` reached the basket's batch add without the request's language, so every line was asked about at the sales channel's default language whatever the buyer browsed in: a product switched off in the default language but on in the buyer's was refused (`404` from quick order) or skipped (`product_not_found` / `not_purchasable` from the conversions). They now pass the channel language `Accept-Language` asks for, resolved through `requestScopeLanguage` as `POST /api/v1/cart/items` does since #1011, through `CartWritePort.addItems`' new `languageTag`; `mod-carts` honours it on the port and on its own conversion routes. A request without the header behaves as before.
