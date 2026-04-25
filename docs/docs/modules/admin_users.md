---
title: admin_users
---

# `admin_users`

Platform Administrator accounts (separate from Customer Accounts), plus
the impersonation flow.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/auth/admin/login` | Admin login (2FA challenge if Role requires it) |
| `POST /api/v1/auth/admin/logout` | Destroy admin session |
| `POST /api/v1/admin/users` | Create admin user, assign Roles |
| `GET /api/v1/admin/users` | List admin users |
| `POST /api/v1/admin/organizations/:id/impersonate` | Begin impersonation; writes `impersonation.start` audit row before issuing the cookie |
| `POST /api/v1/admin/impersonation/end` | Restore the original admin session |

## Impersonation model

`impersonation-service.ts` implements the switch-user pattern: starts a
new session keyed to the target Customer + admin shadow id; ends cleanly,
writing `impersonation.end`. Every action taken during an impersonated
session carries both `actorAdminUserId` and `impersonatedCustomerAccountId`
through the audit log.

## Entities

`AdminUser` (email, passwordHash, twoFactorState, roles[]).

## Extension points

- **Custom login challenges** — slot before the password verify in
  `admin-auth-service.ts`.
- **Impersonation audit consumers** — every audit row with action
  `impersonation.start|end` is structured the same way; downstream
  reporting can join on those.
