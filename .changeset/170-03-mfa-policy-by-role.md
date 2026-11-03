---
'@endora-commerce/mod-mfa': minor
---

Setting an organization's two-factor policy is reserved to its *Administrator* role, judged by `organizationPermissionPort.isAdministrator` rather than the legacy `role` column (`specs/170-organization-roles/`, WP-03; FR-011). `createOrganizationAdminResolver(accounts)` becomes `createOrganizationAdminResolver(accounts, permissions)`.
