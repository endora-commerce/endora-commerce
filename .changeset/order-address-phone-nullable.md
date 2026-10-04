---
'@endora-commerce/contracts': patch
---

`addressSnapshotSchema.phone` is now `string | null | undefined`; it was `string | undefined`. An
order has always answered `phone: null` in `deliveryAddress` and `billingAddress` when the source
address carries no phone number, so every order response with such an address was refused by the
published `orderSchema` — a consumer parsing `GET /api/v1/orders/:id`, the order lists, the admin
order detail or the external order routes with it got a `ZodError` on a correct response. Nothing
on the wire changes; the schema now accepts what the API sends. The inferred `AddressSnapshot` and
`Order` types widen with it, so TypeScript code that passed `order.deliveryAddress.phone` where a
`string | undefined` is required has to handle `null`. `companyName` and `taxId` are unchanged.
