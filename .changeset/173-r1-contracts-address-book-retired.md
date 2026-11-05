---
'@endora-commerce/contracts': minor
---

**Breaking:** the personal address book is retired (`specs/173-b2c-address-book-merge/` release 1 of 2); every customer's one address book is their Organization's.

- Removed `CustomerAddressReadPort` and `CustomerAddressRecord` (the `customerAddressReadPort` container name is no longer registered). Read a buyer's addresses through `AddressReadPort` (`addressReadPort`) over their Organization instead.
- Removed `customerAddressInputSchema` and its `CustomerAddressInput` type: nothing accepts a personal address any more. Use `createAddressRequestSchema` on `/api/v1/organizations/mine/addresses`.
- Removed the error code `ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND`, which nothing raises any more. Added `ERROR_CODES.CUSTOMER_ADDRESS_BOOK_RETIRED`, the code every former personal-address-book endpoint answers with (`410 Gone`).
- `customerAddressSchema` gains an optional `mergeRefusal` (the reason the retirement job could not move a row); `customerAddressBookSchema` is now only the admin card's `{ organization, personal }`, where `personal` holds the refused rows.
- `AddressServicePort` gains `anonymizeForOrganization(organizationId): Promise<number>`. An implementation of the port must add it.
