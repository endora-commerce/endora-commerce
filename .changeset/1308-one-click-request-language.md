---
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-carts': patch
---

**One-click buy judges its product in the request's language** (issue #1308). `POST /api/v1/quick-order/one-click` wrote its line into the working basket and placed the order without the request's scope language, so the product was asked about at the sales channel's default language whatever the buyer browsed in: a product switched off in the default language but on in the buyer's was refused with `404 PRODUCT_NOT_FOUND`. The route now passes the channel language `Accept-Language` asks for, resolved through `requestScopeLanguage` as `POST /api/v1/cart/items` does since #1011, to `CartWritePort.addItems` and `OrderPlacementPort.placeOrder` through their new `languageTag`; `mod-carts` honours it on the port, and `mod-orders` judges the working basket and names the order's lines in it. A request without the header behaves as before.
