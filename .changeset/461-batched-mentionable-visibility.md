---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-projects': patch
---

Issue #461 — the Projects `@` list (`GET /api/v1/admin/projects/lookups/mentionable`) judges who may see the Project for every candidate administrator at once, instead of several reads per person.

- **`@endora-commerce/contracts`** adds `PermissionReadPort.resolveRoles(adminUserIds)` — a `Map` holding, for every id asked, what `resolveRole` answers — and `AdminTenantScopePort.resolveForAdmins(adminUserIds)` — a `Map` holding, for every id asked, the scope `resolveForAdmin` answers. Every implementation of these ports must provide the new method; consumers are unaffected.
- **`@endora-commerce/mod-admin-roles`** implements `resolveRoles` in two statements whatever the number of ids, and adds `holdersOf(adminUserIds, permission)` beside `hasPermission` on the `permissionService` container entry: the ids `hasPermission` answers yes for, refusing with `ADMIN_ROLE_REQUIRED` as `hasPermission` does when an active administrator asked holds no role.
- **`@endora-commerce/mod-organizations`** implements `resolveForAdmins` with the same rule as `resolveForAdmin` — one batched role read, and the roll-up question asked once for the sales representatives only. A failure of that question leaves every representative asked unresolved, holding no organization, as one call at a time would. `SalesRepAssignmentService` gains `hasRollupCapabilities(adminUserIds)`.
- **`@endora-commerce/mod-projects`** adds `ProjectAccess.canSeeAsMany(adminUserIds, projectId)`: the accounts, their roles and their reach each read once, and both visibility rules evaluated for everybody in one statement. `canSeeAs` is now that check for one person. The mentionable lookup asks it once; the people it offers, their order and the limit of 20 are unchanged.
