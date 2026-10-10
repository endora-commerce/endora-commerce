---
title: admin_users
description: Platform Administrator accounts + impersonation
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
| `PATCH /api/v1/admin/me` | The signed-in administrator edits their own first and last name and changes their own password; no permission code is needed. A new `password` must come with `currentPassword`: without it the request is refused with 400 `VALIDATION_FAILED`, with a wrong one with 403 `CURRENT_PASSWORD_INVALID`, and a refused request changes nothing — not the name either |
| `GET /api/v1/admin/admin-users` | List admin users (deleted rows filtered) |
| `POST /api/v1/admin/admin-users` | Create admin user. `adminRoleId` is required: an account with no role is refused with 400 `ADMIN_USER_ROLE_REQUIRED`. Rejects dup email with `EMAIL_ALREADY_REGISTERED` |
| `PATCH /api/v1/admin/admin-users/:id` | Update name / role assignment / status. A role can be changed for another, never cleared: `adminRoleId: null` is refused with 400 `ADMIN_USER_ROLE_REQUIRED` |
| `DELETE /api/v1/admin/admin-users/:id` | Soft delete (sets `deletedAt` + `status='inactive'`) |
| `GET /api/v1/admin/admin-roles` | List roles with their permission arrays |
| `PUT /api/v1/admin/admin-roles/:code` | Upsert role by code; unknown permissions return 400 `VALIDATION_FAILED` |
| `DELETE /api/v1/admin/admin-roles/:id` | Delete; refuses with 409 `ADMIN_ROLE_IN_USE` if any user is still assigned — **including a soft-deleted one**, whose assignment comes back when the account is restored. The refusal names which population holds the role (`details.code` is `assigned` or `assigned_to_deleted`) and how many there are |
| `GET /api/v1/admin/permissions` | Canonical permission catalogue (module / code / label) used by the matrix UI |
| `POST /api/v1/admin/organizations/:id/impersonate` | Begin impersonation; writes `impersonation.start` audit row before issuing the cookie |
| `POST /api/v1/admin/impersonation/end` | Restore the original admin session |

## Every administrator holds a role

An administrator's permissions and the organizations they reach are both read
off the role the account holds, so an account always has exactly one. The admin
surface refuses to create an account without a role or to clear the role of an
existing one, and `admin_users create` assigns `platform_admin` unless `--role`
names another role.

An account that has no role anyway — one created before this rule — is refused
rather than interpreted: a permission-gated route answers 403
`ADMIN_ROLE_REQUIRED`, and so does the first read of organization data. It is
never treated as reaching every organization. Such an account can still sign
in, see who it is (`GET /api/v1/admin/me` answers `role: null`) and sign out.

At boot the module logs a warning naming how many accounts hold no role. Give
each one a role on the Users screen, or — when no administrator can sign in to
do that — from the command line:

```bash
pnpm run admin:create -- --email=<their e-mail> --password-stdin \
  --first-name=<first name> --last-name=<last name> [--role=<code>]
```

The command updates the existing account, sets the password it is given and
assigns `platform_admin` unless `--role` names another role. Accounts are not
given a role automatically on upgrade: that would grant access nobody chose.

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
