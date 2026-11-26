---
'@endora-commerce/contracts': minor
---

`CustomerAccountAdminSearchCriteria` gains an optional `customFieldCondition` (issue #1903): a
`CustomFieldListFilterCondition` built by `custom_fields`' `customFieldListFilterPort` for the
`customer` entity type. `customerAccountAdminSearchPort.search()` intersects it with its own
tenant-scoped statement, so the page and the total narrow to the accounts that match, and a
sales representative's reach is unchanged. Absent or `null` narrows nothing, so existing callers
are unaffected.
