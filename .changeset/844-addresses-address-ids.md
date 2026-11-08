---
'@endora-commerce/mod-addresses': minor
---

`addressReadPort` implements `listIdsForOrganization(organizationId, { includeDeleted })`: the ids of the Organization's addresses, oldest first, the soft-deleted ones included when asked. Never another Organization's rows (issue #844).
