---
'@endora-commerce/platform': minor
'@endora-commerce/contracts': minor
---

The `excluded-set` tenant filter no longer ships the excluded organizations into each statement (issue #955, architect ruling of 2026-11-09). `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) gains a required `excludedOrganizationsQuery: { sql, params }` — the owner's uncorrelated `SELECT` of one uuid column — and `AdminScopeInput`, `TenantContext` and `OrgConstraint`'s `excluded` arm (`@endora-commerce/platform/tenancy`) carry it. An `excluding` scope or an `excluded` constraint without it is refused (`resolveTenantContext`, `orgConstraintFor`, `orgConstraintForAdminScope` throw), never read as "nothing excluded".

Both global filters and `orgScopeWhere(field)` render it as `{ [field]: { $ne: null, $nin: <query builder> } }` — `field is not null and field not in (<S>)` (was `{ [field]: { $ne: null, $nin: [...ids] } }`); `orgScopeSql(column)` renders `(column is not null and column not in (<S>))` with S's parameters (was `column <> all(?::uuid[])` with one array literal). Code that passes these fragments to the entity manager or into SQL needs no change; a test that builds an `excluded` constraint by hand must add the query.
