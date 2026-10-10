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
| `PATCH /api/v1/admin/me` | The signed-in administrator edits their own first and last name and changes their own password; no permission code is needed. A new `password` must come with `currentPassword`: without it the request is refused with 400 `VALIDATION_FAILED`, with a wrong one with 403 `CURRENT_PASSWORD_INVALID`, with a new password equal to the current one with 400 `NEW_PASSWORD_UNCHANGED`, and a refused request changes nothing — not the name either. An accepted password change signs out every other session of the account (see *Sessions and password changes*) |
| `GET /api/v1/admin/admin-users` | List admin users (deleted rows filtered) |
| `POST /api/v1/admin/admin-users` | Create admin user. `adminRoleId` is required: an account with no role is refused with 400 `ADMIN_USER_ROLE_REQUIRED`. Rejects dup email with `EMAIL_ALREADY_REGISTERED` |
| `PATCH /api/v1/admin/admin-users/:id` | Update name / role assignment / status; it sets no password — a `password` field is refused with 400 `VALIDATION_FAILED`. A role can be changed for another, never cleared: `adminRoleId: null` is refused with 400 `ADMIN_USER_ROLE_REQUIRED`. Setting `status: 'inactive'` signs the account out of every session |
| `DELETE /api/v1/admin/admin-users/:id` | Soft delete (sets `deletedAt` + `status='inactive'`) and signs the account out of every session |
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

## Sessions and password changes

A session is a credential, so it is withdrawn when the thing it stood for is:

| Write | Sessions revoked |
| --- | --- |
| An administrator changes their own password (`PATCH /api/v1/admin/me`) | Every session of the account **except the one the request was made from** |
| A peer resets the password (`POST /api/v1/admin/admin-users/:id/password`) | Every session of the account |
| The account is deactivated (`status: 'inactive'`) or deleted | Every session of the account |
| `admin_users create` (`admin:create`) is run again for an account that already exists | Every session of the account. The write is audited as `admin_user.change_password` with `via: 'cli'` and no acting administrator |
| The administrator disables their own two-factor authentication (`POST /api/v1/admin/account/mfa/disable`) | Every session of the account **except the one the request was made from** |

"Every session" means the sign-ins on other browsers and devices and the impersonation sessions
the administrator started. The same writes withdraw every sign-in the account had begun and not
finished — a pending second-factor challenge or two-factor setup ticket — so a login started with
the old password cannot be completed afterwards. The new state is written first and the sessions
are revoked after it, so nothing can be obtained with the old password once revocation has run. After a self-service change the administrator stays signed in where
they made it — no new cookie is issued and the profile screen stays open — and has to sign in
again everywhere else, with the new password. A refused change (a wrong or missing
`currentPassword`) revokes nothing, and neither does a request that changes only the name.

Revocation is not the only line. The admin guard also refuses a session whose account is no
longer active — deactivated, deleted or gone — with 401, on every route it gates, whether or not
anything revoked that session. An active account that lacks a permission is still answered 403.

A refused password change is not written to the audit log, as a failed sign-in is not.

API keys are not sessions and are not affected, and neither is the account's second factor.
`admin_users create` run again for an existing account replaces its password but does not revoke
its sessions.

Both password writes are recorded in the audit log as `admin_user.change_password`. The entry's
`via` field tells them apart — `self_service` or `peer_reset` — as does its actor, and it never
carries the password or its hash. A self-service request that also changes the name records an
`admin_user.update` entry beside it.

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
