---
'@endora-commerce/mod-customers': minor
---

**Breaking:** the personal address book is retired for everyone (`specs/173-b2c-address-book-merge/` release 1 of 2).

- Every former personal-address-book endpoint answers `410 Gone` with `CUSTOMER_ADDRESS_BOOK_RETIRED`, in Polish or English: `GET`/`POST /api/v1/me/customer/addresses`, `PATCH`/`DELETE /api/v1/me/customer/addresses/:addressId`, `PUT /api/v1/me/customer/addresses/:addressId/default`, `POST /api/v1/admin/customers/:id/addresses`, and a `PUT /api/v1/me/customer/defaults` whose body carries `billingAddressId` or `shippingAddressId`. Manage addresses on `/api/v1/organizations/mine/addresses`.
- `GET /api/v1/me/customer/defaults` (and the admin customer detail's `defaults`) reports the default addresses of the customer's Organization book.
- `GET /api/v1/admin/customers/:id/addresses` answers `{ organization, personal }`, where `personal` lists only the rows the retirement job refused, each with `mergeRefusal`.
- The `customerAddressReadPort` port is no longer published.
- A one-time BullMQ job (`customers.address-book-retirement`, run by the worker process while `customers` is on) moves every live B2C personal-book row into the customer's personal Organization's book without duplicates, keeping an existing Organization default, and erases every other live row — a company member's, one of an individual whose personal Organization was already anonymized, or one of an account with no Organization. The summary it logs counts the last as `erasedWithoutOrganization` and warns when there are any. Each row is audited; a row `addresses` refuses stays live with its reason. A migration adds the provenance columns it writes. The package now peers on `bullmq` and `ioredis`.
- The retention sweep also blanks and soft-deletes a scrubbed personal Organization's saved addresses.
