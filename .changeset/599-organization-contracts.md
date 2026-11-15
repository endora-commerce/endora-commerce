---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': patch
---

Organization admin, member, invitation and registration replies are described by their contract (issue #599, section 1):

- `adminOrganizationSchema` in `@endora-commerce/contracts` now declares the keys every admin organization reply has answered: `legalName`, `orderConfirmationEmails`, `version`, `blockedReason`, `blockedAt`, `rejectedReason`, `rejectedAt`, `approvedAt`, `approvedByAdminUserId`, `vatValidation` (`outcome`, `provider`, `validatedAt`) and `customFieldValues`. This applies to the list, the detail and the answer of each write. The Admin UI's organization page reads these keys. They are optional, so a client that does not read them is unaffected.
- `@endora-commerce/contracts` publishes schemas for replies that had none: `adminOrganizationListResponseSchema` for `GET /api/v1/admin/organizations`; `adminOrganizationDetailSchema` for `GET /api/v1/admin/organizations/:id` (the Organization, its `members` and its `predefinedRoles`); `adminOrganizationMemberSchema` for the detail's member rows and the admin member writes; `organizationMemberSchema` and `organizationMemberListResponseSchema` for `GET /api/v1/organizations/mine/members` and the member role change; `organizationInvitationSchema` and `organizationInvitationListResponseSchema` for `GET /api/v1/organizations/mine/invitations`; `inviteMemberResponseSchema` for `POST /api/v1/organizations/mine/invitations`; and `acceptInvitationResponseSchema` for `POST /api/v1/organizations/invitations/:token/accept`. Each has its inferred type.
- `mod-organizations` builds these replies, and the registration reply, as the contract's types instead of `Record<string, unknown>` or an undeclared shape. The handlers declare their reply types. The Admin UI's organization page uses `AdminOrganizationDetail` and `AdminOrganizationMember` instead of hand-written interfaces. Nothing on the wire changes.
