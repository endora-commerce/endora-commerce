---
'@endora-commerce/mod-carts': patch
---

The cart-view serialisers are typed by the published contract (issue #128).

The functions behind `GET /api/v1/cart`, `GET /api/v1/cart?view=mini` and the line-mutation replies returned inferred object literals, so the compiler held them to nothing. They now return `CartFullPayload` and `CartMiniPayload` from `@endora-commerce/contracts`, empty basket included: a required field that stops being emitted, or a value of the wrong type, is a compile error. No reply changed.
