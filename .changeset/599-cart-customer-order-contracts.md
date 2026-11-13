---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-orders': patch
---

Response contracts for replies #128's survey did not reach (issue #599, sections 3–5):

- `@endora-commerce/contracts` publishes `adminCustomerListResponseSchema` / `AdminCustomerListResponse` for `GET /api/v1/admin/customers`. The rows were already described; the `meta: { page, pageSize, total }` envelope was not.
- `GET /api/v1/cart/upsells` now answers `unitPrice: null` on every row, as `upsellProductSchema` declares. The key used to be absent. The strip resolves no price, and the storefront shows its "no price" label either way. `CartUpsellCandidate` in `@endora-commerce/mod-carts` is now the contract's `UpsellProduct`.
- `mod-orders` builds order comments as the contract's `OrderComment`, so a key the contract does not declare is a compile error. The customer reply still leaves out `authorAdminUserId` and `systemNote`. The admin customer list route now returns the contract's `AdminCustomerListResponse` type.
