---
title: admin_users
---

# `admin_users`

Platform Administrator accounts (separate from Customer Accounts), plus
the impersonation flow.

## Public surface

User + role CRUD is gated by the `admin_users:manage` permission.

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/auth/admin/login` | Admin login (2FA challenge if Role requires it) |
| `POST /api/v1/auth/admin/logout` | Destroy admin session |
| `GET /api/v1/admin/admin-users` | List admin users (deleted rows filtered) |
| `POST /api/v1/admin/admin-users` | Create admin user; rejects dup email with `EMAIL_ALREADY_REGISTERED` |
| `PATCH /api/v1/admin/admin-users/:id` | Update name / role assignment / status |
| `DELETE /api/v1/admin/admin-users/:id` | Soft delete (sets `deletedAt` + `status='inactive'`) |
| `GET /api/v1/admin/admin-roles` | List roles with their permission arrays |
| `PUT /api/v1/admin/admin-roles/:code` | Upsert role by code; unknown permissions return 400 `VALIDATION_FAILED` |
| `DELETE /api/v1/admin/admin-roles/:id` | Delete; refuses with 409 `ADMIN_ROLE_IN_USE` if any user is still assigned — **including a soft-deleted one**, whose assignment comes back when the account is restored. The refusal names which population holds the role (`details.code` is `assigned` or `assigned_to_deleted`) and how many there are |
| `GET /api/v1/admin/permissions` | Canonical permission catalogue (module / code / label) used by the matrix UI |
| `POST /api/v1/admin/organizations/:id/impersonate` | Begin impersonation; writes `impersonation.start` audit row before issuing the cookie |
| `POST /api/v1/admin/impersonation/end` | Restore the original admin session |

## Impersonation model

`impersonation-service.ts` implements the switch-user pattern: starts a
new session keyed to the target Customer + admin shadow id; ends cleanly,
writing `impersonation.end`. Every action taken during an impersonated
session carries both `actorAdminUserId` and `impersonatedCustomerAccountId`
through the audit log.

## Entities

`AdminUser` (email, passwordHash, two-factor state, single `adminRoleId`,
`status`, soft-delete `deletedAt`).

`AdminRole` (code, display name, JSONB `permissions[]`,
`requiresTwoFactor`). The wildcard `*` is bootstrap-only and rejected by
the upsert route.

## Extension points

- **Custom login challenges** — slot before the password verify in
  `admin-auth-service.ts`.
- **Impersonation audit consumers** — every audit row with action
  `impersonation.start|end` is structured the same way; downstream
  reporting can join on those.
