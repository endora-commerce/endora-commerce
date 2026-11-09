---
'@endora-commerce/mod-orders': patch
---

The admin orders list no longer applies a sales representative's reach twice per statement (issue #955): `orderListScopeFor()` with no argument — the ambient scope — answers `where: {}`, because the `@OrgScoped` filter already carries that predicate. With an explicit constraint (`orderListPort.list(query, { allowedOrganizationIds })`) it still narrows; `sql` (for the knex search) and `empty` are unchanged.
