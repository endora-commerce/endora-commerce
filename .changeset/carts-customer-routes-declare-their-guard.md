---
'@endora-commerce/mod-carts': patch
---

Four customer routes answer a request without a customer session with `401` before they
validate its body.

`PATCH /api/v1/organization/policies/cart-approval`, `POST /api/v1/organization/carts/:id/reject`,
`POST /api/v1/cart/convert-to-quote-request` and
`POST /api/v1/cart/items/:itemId/save-to-shopping-list` checked the session inside the handler,
which runs after schema validation, so an anonymous request with a malformed body was answered
`400` with the field details. Each now declares `auth`'s `requireCustomer` guard on the route,
which the platform runs ahead of validation. The `401` message for these four is the guard's,
`Customer session required.`; the code stays `UNAUTHORIZED`. A signed-in customer gets the same
`400` as before, and the organisation-administrator and cart-ownership rules are unchanged.
