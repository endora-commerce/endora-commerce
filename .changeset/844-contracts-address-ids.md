---
'@endora-commerce/contracts': minor
---

`AddressReadPort` gains `listIdsForOrganization(organizationId, options?: { includeDeleted?: boolean }): Promise<string[]>`: the ids of an Organization's addresses, oldest first, live ones only unless `includeDeleted` is `true`. An implementation of the port must add it. The customers retention sweep uses it to name every address an anonymised subject ever had when it erases their audit history (issue #844). `ORGANIZATION_AUDIT_KEEP_KEYS` now also keeps `orderConfirmationEmailCount`, the count the `organization.anonymized` entry records, so the sweep's redaction leaves the entry it has just written as it was.
