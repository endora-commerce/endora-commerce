---
'@endora-commerce/mod-orders': patch
---

**Order placement judges availability in the language the basket was judged in** (issue #1320). `POST /api/v1/orders` now passes the channel language the request's `Accept-Language` asks for (`requestScopeLanguage`) to the placement, as `POST /api/v1/cart/items` judges its lines; it used to pass the message language only, so a channel language the interface does not offer (`de-DE` where messages are en/pl) was judged at the channel's default and a line the basket admitted was refused with `404 PRODUCT_NOT_FOUND`. `POST /api/v1/admin/orders` now places at the channel's default language, the language its basket add already used; it used to follow the operator's interface language, so a product on at the default and off in `pl-PL` was refused for a Polish-speaking operator. A checkout request without the header behaves as before.
