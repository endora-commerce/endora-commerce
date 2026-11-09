---
'@endora-commerce/platform': minor
'@endora-commerce/contracts': minor
---

A new tenant mode, `excluded-set`: every organization **except** a named set, for a sales representative's reach (issue #305). `AdminTenantScope` (`@endora-commerce/contracts`) gains the member `{ allowAll: false, reach: 'excluding', excludedOrganizationIds, assignedOrganizationIds }`; `resolveTenantContext` maps it to the new mode, whose filter is `organizationId IS NOT NULL AND organizationId NOT IN (excluded)` on the row's own column, for `@OrgScoped` and for `@CustomerScoped` entities that carry the column (those that do not are refused, as under `allowed-set`). A customer or a bound API key is refused an `excluded-set` context.

**Breaking: `OrgConstraint`'s `'set'` arm is removed.** It is `{ kind: 'allowed', organizationIds }` now (was `{ kind: 'set', organizationIds }`), beside the new `{ kind: 'excluded', excludedOrganizationIds, assignedOrganizationIds }`. A `constraint.kind === 'set'` comparison no longer compiles, deliberately: read the constraint through the helpers instead of its ids. `orgScopeWhere`, `isOrgInScope` and `ruleVisibleForScope` handle every arm and now also accept an `OrgConstraint` in place of a context; new on `@endora-commerce/platform/tenancy` are `orgScopeWhere` (now exported), `orgScopeSql(columnSql)` (one array parameter, for raw SQL), `reachesNoOrganization`, `assignedOrganizationIdsForRanking` and `orgConstraintForAdminScope(scope)`.

`PreferenceActor` (`@endora-commerce/contracts`): the `salesperson` member is `{ kind: 'salesperson', reaches(organizationId) }` (was `{ kind: 'salesperson', assignedOrganizationIds }`).
