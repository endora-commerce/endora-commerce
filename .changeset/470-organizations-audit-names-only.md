---
'@endora-commerce/mod-organizations': minor
---

Issue #470 (D-288, owner rulings O-1 and O-2) — every remaining `organizations` audit entry holds names and structure, not values. The platform audit log is read under `audit_log:read` without Organization reach, so an Organization's name, tax ID, address and reasons, a member's or invitee's e-mail and names, and a custom role's name and description stay out of it.

- `organization.create` and `organization.register` no longer record the name, tax ID or registered address; `changedFields` names the fields the Organization was created with. The status, VAT status (create), sales channels and parent stay, and so do `changedCustomFields` and `registryLookup`.
- `organization.delete` records `status`, `vatStatus`, `isPersonal`, `parentId` and `version` instead of the full Organization.
- `organization.approved`, `.rejected`, `.blocked` and `.unblocked` record `hasBlockedReason` / `hasRejectedReason` instead of the reasons, and no longer repeat the Organization's id in their state.
- `customer_account.admin_create`, `.admin_profile_update`, `.admin_rollup_change` and `.admin_remove` record the member's `organizationRoleId`, `subtreeRollupEnabled`, `emailVerified` and `twoFactorEnabled` and, after a change, `changedFields`. They no longer record the e-mail, names or the Organization's id.
- `organization_invitation.create` and `.revoke` record `invitationId` and `role: { id, kind }`. They no longer record the invitee's e-mail or a custom role's name. `organization.invite_accept` no longer records the e-mail.
- `organization_role.create`, `.update` and `.delete` record `role: { id, kind, permissions }`. An update adds `changedFields` (`name`, `description`, `permissions`). A custom role's name and description are no longer recorded.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new entries from these writes show no Organization, member, invitation or role values. See *Every other organizations entry leaves its values out of the audit log* in the upgrade guide.
