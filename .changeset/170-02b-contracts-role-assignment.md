---
'@endora-commerce/contracts': minor
---

Organization role assignment (`specs/170-organization-roles/`, WP-02b). Breaking for an implementer or a hand-built caller of the changed ports:

- `CustomerAccountRecord` gains the required `organizationRoleId: string` — the organization role the account holds, a role of its own organization.
- `CustomerAccountCreateInput` gains the required `organizationRoleId`; the deprecated `role` stays and is passed with the matching value (`organization_admin` only for the *Administrator* role).
- `CustomerAccountReadPort` gains `countAdministrators(organizationId, options?)`, the replacement for the deprecated `countByOrganizationRole(organizationId, 'organization_admin', options?)`.
- `CustomerAccountMemberWritePort.attachToOrganization(customerAccountId, organizationId)` becomes `attachToOrganization(customerAccountId, organizationId, organizationRoleId)`.
- `CustomerAccountLifecycleWritePort.setOrganization` and `detachToPersonalOrganization` take `input: CustomerAccountOrganizationMoveInput` — `{ actorAdminUserId, organizationRoleId }` where it was `{ actorAdminUserId }`; the role is a role of the destination organization.
- `PersonalOrganizationPort.provisionPersonalOrganization` answers `ProvisionedPersonalOrganizationRecord` (`OrganizationRecord` plus `administratorRoleId`) where it answered `OrganizationRecord`.
- `OrganizationRoleReadPort` gains `findRole(organizationId, roleId)` answering `OrganizationRoleSummary | null` (`{ id, kind, name }`).
- New: `CustomerAccountRoleCommandPort` (`changeRole(input)` answering a `CustomerAccountRoleChangeCommand` to run on the Command Bus or as a child Command, and `holdersOf(organizationId, roleId)`), with `CustomerAccountRoleChangeInput`, `CustomerAccountRoleChangeResult`, and the event `CUSTOMER_ACCOUNT_ORGANIZATION_ROLE_CHANGED_EVENT` (`customer_account.organization_role_changed.v1`) with `CustomerAccountOrganizationRoleChangedEventV1`.
