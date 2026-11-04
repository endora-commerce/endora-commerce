---
'@endora-commerce/mod-organizations': minor
---

Admin UI for organization roles (`specs/170-organization-roles/`, US 7). The Organization screen (`/organizations/:id`) gains a **Roles** tab for a company Organization, shown to an operator holding `organizations:read-roles` (read-only) or `organizations:manage-roles` (create, edit, delete — a held role is deleted only with a replacement role), with the permission editor grouped by module and a *History* link to the Organization's audit log. The members table's role select and the invite and direct-create forms now offer the Organization's roles and send `roleId` instead of `role`; they read each member's `organizationRole` instead of `role`, and last-administrator protection keys off `organizationRole.kind`. The admin layer therefore needs the backend's `roleId` member endpoints of the same release.
