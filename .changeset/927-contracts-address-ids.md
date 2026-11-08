---
'@endora-commerce/contracts': minor
---

`AddressReadPort` gains `listIdsForOrganization(organizationId, options?: { includeDeleted?: boolean }): Promise<string[]>`: the ids of an Organization's addresses, oldest first, live ones only unless `includeDeleted` is `true`. An implementation of the port must add it. `AddressServicePort.anonymizeForOrganization` is now documented as scrubbing every address of the Organization, soft-deleted ones included (issue #927).
