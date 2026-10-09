---
'@endora-commerce/mod-customers': patch
---

A customer or address id that is not a UUID answers `404` instead of `500`. Every
`/api/v1/admin/customers/:id…` route handed its path parameter to the database unchecked, so a
mistyped URL such as `GET /api/v1/admin/customers/not-a-uuid` came back as
`invalid input syntax for type uuid` behind an `INTERNAL` error. These routes now answer the same
`404 CUSTOMER_NOT_FOUND` they give an unknown customer, after the permission check, so an anonymous
caller still gets `401`. The self-service address routes
(`PATCH`/`DELETE /api/v1/me/customer/addresses/:addressId` and `PUT …/default`) had the same
omission and now answer `404 CUSTOMER_ADDRESS_NOT_FOUND`.

One visible difference beyond the status code: the read-only panels
(`…/:id/addresses`, `/orders`, `/quote-requests`, `/carts`) answer `404` for a malformed id while
still answering `200` with empty lists for a well-formed id no customer has.

No setting or permission changes.
