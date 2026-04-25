---
title: organizations
---

# `organizations`

Customer Organizations — registration, email verification, member management,
invitations, and the suspension state. The first user of a registering
Organization becomes its `organization_admin`.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anon | Register Org + first member, email verification dispatched |
| `POST /api/v1/organizations/email-verification/verify` | anon | Redeem verification token |
| `GET /api/v1/organizations/mine` | customer | View own Organization |
| `GET /api/v1/organizations/mine/members` | customer | List members (org admin only) |
| `POST /api/v1/organizations/mine/invitations` | customer | Invite a new user (org admin only) |
| `POST /api/v1/organizations/invitations/:token/accept` | anon | Redeem invitation, mint Customer Account |
| `DELETE /api/v1/organizations/mine/members/:id` | customer | Remove member (last-admin guard) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | customer | Promote / demote (last-admin guard) |
| `POST /api/v1/admin/organizations/:id/suspend` | admin | Suspend (blocks new orders) |

## Entities

`Organization`, `OrganizationInvitation`, `EmailVerificationToken`. Tax-ID
uniqueness is enforced at the DB level; duplicate registrations return
`409 ORGANIZATION_TAX_ID_EXISTS`.

## Events emitted

`organization.registered.v1`, `organization.verified.v1`,
`organization.suspended.v1`, `organization.member_invited.v1`,
`organization.member_role_changed.v1`.

## Extension points

- **Verification dispatch** — `email-verification-service.ts` exposes a
  pluggable mailer interface; swap the dev-mode console mailer for a real
  SMTP/SendGrid driver in production composition.
- **Last-admin guard** — codified in `role-service.ts#changeRole` and
  `invitation-service.ts#revoke`; add new "must keep at least one admin"
  call sites here.
