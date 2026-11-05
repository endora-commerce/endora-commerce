---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-shopping-lists': patch
'@endora-commerce/mod-carts': patch
---

A customer record read by an id that is not a UUID answers `404` with the route's own not-found code, exactly as a well-formed id that names nothing does, instead of `500` (issue #753). This covers `GET /api/v1/orders/:id` (`ORDER_NOT_FOUND`), `GET /api/v1/returns/:id`, `GET /api/v1/quote-requests/:id`, `GET /api/v1/shopping-lists/:id` and `GET /api/v1/organization/carts/:id` (`NOT_FOUND`), and every other route that reads its record through the same lookup.
