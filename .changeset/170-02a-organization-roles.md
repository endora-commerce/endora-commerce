---
'@endora-commerce/mod-organizations': minor
---

Organization roles (`specs/170-organization-roles/`). Every organization now has an *Administrator* and a *Member* role — created with the organization, by a database trigger, whichever path creates it — and up to 50 custom roles, each a set of organization permissions declared by the modules in their manifests' `organizationPermissions`.

- Migration `Migration20261103T173304OrganizationsOrganizationRoles` creates `organization_roles`, gives every existing organization its two predefined roles, withholds `carts.order_without_approval` and `quick_order.one_click` from *Member* where the organization required cart approval, and adds `organization_invitations.organization_role_id` (backfilled from `role`, `not null`, a composite foreign key to the invitation's own organization's roles). The invitation service writes both `role` and the new column.
- Storefront routes for an organization's administrator: `GET/POST /api/v1/organizations/mine/roles`, `GET/PATCH/DELETE /api/v1/organizations/mine/roles/:id`, `GET /api/v1/organizations/mine/permission-catalogue`; and `GET /api/v1/organizations/mine/role` for every member. A personal organization answers `404`.
- Operator routes `GET/POST /api/v1/admin/organizations/:id/roles`, `PATCH/DELETE /api/v1/admin/organizations/:id/roles/:roleId` and `GET /api/v1/admin/organizations/:id/permission-catalogue`, gated by the new operator codes `organizations:read-roles` and `organizations:manage-roles` (which requires the first).
- The role writes are the Commands `organization_role.create`, `organization_role.update` (emits `organization_role.permissions_changed.v1` with `added` / `removed`) and `organization_role.delete`, audited against the organization.
- New ports `organizationPermissionPort` (`can`, `assert`, `isAdministrator`, `effective`, `rolesHolding`) and `organizationRoleReadPort` (`predefinedRoleId`), over a per-process role cache dropped on every role change and announced on `b2b:organization-roles:changed`.
- Seven new error codes declared and translated (EN, PL): `ORGANIZATION_PERMISSION_REQUIRED`, `ORGANIZATION_ROLE_NAME_TAKEN`, `ORGANIZATION_ROLE_STALE`, `ORGANIZATION_ROLE_LIMIT_REACHED`, `ORGANIZATION_ROLE_PROTECTED`, `ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`, `ORGANIZATION_PERMISSION_UNKNOWN`.

Members are not yet assigned to roles individually: until they are, a member counts as *Administrator* when they are the organization's administrator (or the member of a personal organization) and *Member* otherwise, and a custom role somebody holds cannot be deleted.
