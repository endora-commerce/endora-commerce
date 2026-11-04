---
'@endora-commerce/mod-customers': minor
---

Customers by organization role (`specs/170-organization-roles/`, WP-03).

- The depletion guard (`409 ORG_OWNER_DEPLETION`) on blocking, deleting and detaching a customer protects the last active holder of a **company** organization's *Administrator* role, read from the role rather than the legacy `role` column. Blocked administrators no longer count on any of the three paths (deletion and detaching counted them before), so deleting or detaching the last unblocked administrator is refused. Blocking or deleting a personal organization's member is no longer refused.
- `GET /api/v1/me/customer` answers `organizationRole` and `permissions`; the impersonation start answers `impersonatedCustomerAccount.organizationRole`.
- `CustomerModerationService` and `CustomerDeletionService` take an `OrganizationDepletionGuard` as their last constructor argument; `customersModule` requires `organizationPermissionPort` and an `organizationRoleReadPort` that also answers `roleRef`.
