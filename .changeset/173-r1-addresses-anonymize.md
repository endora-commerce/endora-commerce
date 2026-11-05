---
'@endora-commerce/mod-addresses': minor
---

`addressServicePort` gains `anonymizeForOrganization(organizationId)`: it blanks the personal fields of every live address of the Organization (`'-'`, phone `null`, not default, country kept), soft-deletes them and records one `address.anonymized` audit entry per address. `customers`' retention sweep calls it for a scrubbed personal Organization (`specs/173-b2c-address-book-merge/`, OD-7).
