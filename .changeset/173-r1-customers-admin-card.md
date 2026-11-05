---
'@endora-commerce/mod-customers': minor
---

The customer's *Addresses* card in the Admin UI (`AddressesPanel`) is read-only (`specs/173-b2c-address-book-merge/`, OD-6). It lists the customer's Organization address book, then any personal-book row the retirement job refused, with its reason. The add form is gone, and so are its bundle keys `detail.addresses.recipient`, `.street`, `.city`, `.postal`, `.country` and `.add`. New keys: `detail.addresses.organizationBook`, `.refused`, `.refusedHint` and `.refusalReason`. The module page documents the retired personal book.
