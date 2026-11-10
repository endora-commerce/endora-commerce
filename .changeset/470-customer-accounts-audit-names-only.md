---
'@endora-commerce/mod-customer-accounts': minor
---

Issue #470 (D-288): a customer account's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without organization reach, so a tenant's account data no longer reaches it.

- `customer_account.update_profile` records `changedFields` instead of the e-mail and the names before and after.
- `customer_account.create`, `.register_standalone` and `.register_social` record `changedFields` (the fields the account was created with), `organizationRoleId` and `emailVerified` instead of the e-mail and the organization.
- `customer_account.organization_assigned`, `.organization_unassigned` and `.attach_organization` record the move as `changedFields: ['organizationId', 'organizationRoleId']` with the role ids, without the organization ids (the tenant anchor).
- `customer_account.blocked` and `.unblocked` record `hasBlockReason` instead of `blockReason`.
- `customer.custom_fields.update` records `changedCustomFields` instead of the custom field values before and after.
- `customer_account.change_role`, `.remove_member` and `.promote_organization_admin` record the role as `{ id, kind }`, without a custom role's name.
- `CUSTOMER_ACCOUNT_AUDIT_KEYS` lists the keys an account audit state may hold, and a sentinel test per write holds it to that list.
- No history reads an account's values back from the audit log, so no value store is added: the account row holds the values. Audit entries written before the upgrade are not rewritten.

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new customer account entries show field names instead of values. See *Customer account values leave the platform audit log* in the upgrade guide.
