---
'@endora-commerce/mod-organizations': minor
---

Organization roles reach the members (`specs/170-organization-roles/`, WP-02b).

- Deleting a custom role that members or invitations hold now takes `replacementRoleId` and moves every holder in the same transaction: one `customer_account.change_role` Command per account, each audited, then the invitations, then the role. A held role without a replacement is still refused `422 ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`.
- The permission port reads the member's own role (`organizationRoleId`) instead of deriving it from the legacy `role`, and the role list's member counts come from the assignment.
- `organizationRoleReadPort.findRole(organizationId, roleId)`.
- The personal-organization provisioning answers carry `administratorRoleId` (`PersonalOrganizationProvisionApi.provisionFor` from `@endora-commerce/mod-organizations/ports` answers `PersonalOrganizationProvisioned` — `{ id, administratorRoleId }` where it answered `{ id }`); self-registration of a company, an operator's direct member creation and invitation acceptance create the account with its role.
