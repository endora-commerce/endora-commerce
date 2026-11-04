---
'@endora-commerce/mod-customer-accounts': minor
---

Every customer account holds an organization role (`specs/170-organization-roles/`, WP-02b).

- Migration `Migration20261103T190132CustomerAccountsOrganizationRoleAssignment` adds `customer_accounts.organization_role_id`, backfilled for every account (blocked and deleted ones included) from `role` — and to *Administrator* for every account of a personal organization, whose `role` is left as it was — then `not null`, a composite foreign key to the account's own organization's roles (`on delete restrict`), and a `before insert` trigger that fills it for a row inserted without one.
- Changing a member's role, removing a member and the operator's break-glass promotion are the Commands `customer_account.change_role`, `customer_account.remove_member` and `customer_account.promote_organization_admin`, audited against the organization; a role change emits `customer_account.organization_role_changed.v1`. The last-administrator refusals (`CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN`) now count active (unblocked) administrators under a row lock, so two concurrent demotions cannot both pass. `RoleService` and its `customerRoleService` registration are removed; `customerRolePort` keeps its shape.
- New port `customerAccountRoleCommandPort`; `customerAccountReadPort.countAdministrators`; the account record carries `organizationRoleId`; `customerOrgResolver` answers it, so the request actor carries the member's role.
- Self-registration and an account created by a federated sign-in hold their personal organization's *Administrator* role; moving an account to another organization writes the destination's role with it.
