---
'@endora-commerce/mod-customers': patch
---

The retention sweep now blanks every row of the anonymised account in the retired personal address book (`customer_addresses`), whether the retirement job moved it, erased it or refused it, or the customer deleted it; each row is audited `customer_address.anonymized` with `customerAccountId`, `kind` and `wasDeleted` only, and keeps its `deletedAt`, `mergedIntoAddressId` and `mergeRefusal`. It runs for every anonymised account, before the account's own scrub, and writes nothing on a repeat run (issue #927). `CustomerDeletionService` takes the retired book as a ninth constructor argument.
