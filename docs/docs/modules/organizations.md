---
title: organizations
---

# `organizations`

Customer Organizations — registration, email verification, member management,
invitations, and the suspension state. The first user of a registering
Organization becomes its `organization_admin`.

## Public surface

Org-Admin-only routes are enforced server-side via the
`assertOrganizationAdmin` helper. Admin routes (`/api/v1/admin/*`) are
gated by `customers:manage`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anon | Register Org + first member, email verification dispatched |
| `POST /api/v1/auth/email-verification/verify` | anon | Redeem verification token |
| `POST /api/v1/auth/customer/login` | anon | Customer login → sets `b2b_session` cookie; merges anonymous cart |
| `POST /api/v1/auth/customer/logout` | customer | Destroy session |
| `POST /api/v1/auth/password-reset/request` | anon | Always 202 (defends against account enumeration) |
| `POST /api/v1/auth/password-reset/confirm` | anon | Redeem the emailed reset token |
| `GET /api/v1/me` | customer | Current customer + their organization, plus `impersonation: { impersonatorAdminUserId }` when an admin is acting as the buyer (T194) |
| `POST /api/v1/me/password` | customer | Change password (rejects wrong `currentPassword`) |
| `POST /api/v1/me/two-factor/{enable,confirm,disable}` | customer | TOTP enrolment lifecycle |
| `GET /api/v1/organizations/mine/members` | org admin | List members |
| `DELETE /api/v1/organizations/mine/members/:id` | org admin | Remove member (last-admin guard) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | org admin | Promote / demote (last-admin guard) |
| `GET /api/v1/organizations/mine/invitations` | org admin | List pending invitations (T177) |
| `POST /api/v1/organizations/mine/invitations` | org admin | Invite a new user; emails the redemption link via the injected Mailer |
| `DELETE /api/v1/organizations/mine/invitations/:id` | org admin | Revoke a pending invitation (T177) |
| `POST /api/v1/organizations/invitations/:token/accept` | anon | Redeem invitation, mint Customer Account |
| `GET /api/v1/organizations/mine/addresses` | customer | List delivery / billing addresses |
| `POST /api/v1/organizations/mine/addresses` | customer | Create address |
| `PATCH /api/v1/organizations/mine/addresses/:id` | customer | Update |
| `DELETE /api/v1/organizations/mine/addresses/:id` | customer | Remove |
| `GET /api/v1/admin/organizations` | admin | List with `filter[status]` / `filter[vatStatus]` / `q` |
| `GET /api/v1/admin/organizations/:id` | admin | Org + member roster |
| `PATCH /api/v1/admin/organizations/:id` | admin | Update name / `status` (suspend = `status='suspended'`) / `vatStatus` |

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
