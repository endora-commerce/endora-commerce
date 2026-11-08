---
'@endora-commerce/mod-addresses': minor
---

`anonymizeForOrganization(organizationId)` now blanks **every** address of the Organization, including the ones the customer deleted before anonymisation, which until now kept their recipient, street, city, postal code and phone (issue #927). The fields and values are unchanged (`'-'`, phone `null`, not default, country kept); a row that is already soft-deleted keeps its `deletedAt`. A row already fully scrubbed is not selected, so a repeat call writes nothing and records nothing. Each `address.anonymized` audit entry now carries `wasDeleted` in `stateBefore`, beside `organizationId` and `kind`. `addressReadPort` implements the new `listIdsForOrganization`.
