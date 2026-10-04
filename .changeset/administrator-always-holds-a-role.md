---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-admin-actions': patch
'@endora-commerce/mod-i18n': patch
---

**An administrator always holds a role, and one without a role is refused.** An administrator's
permissions and the organizations they reach are both read off the role the account holds. An
account with no role used to be treated as reaching every organization; it now reaches none and is
refused by name.

**After upgrading, an administrator account that has no role is refused until it is given one.**
Accounts are deliberately not given a role by the upgrade — any default would grant access nobody
chose. The instance logs a warning at every boot naming how many accounts are affected. To repair
one:

- from the Admin UI, on the Users screen, choose a role for the account; or
- from the command line, which is the way when no administrator can sign in:
  `pnpm run admin:create -- --email=<their e-mail> --password-stdin --first-name=<f> --last-name=<l> [--role=<code>]`.
  The command updates the existing account, sets the password it is given and assigns
  `platform_admin` unless `--role` names another role.

What an operator sees for such an account: every permission-gated admin route answers 403
`ADMIN_ROLE_REQUIRED`, and so does the first read of organization data on any other route. The
account can still sign in, read `GET /api/v1/admin/me` (which answers `role: null`) and sign out.

**Every instance has the platform-administrator role.** `platform_admin` — shown as *Platform
administrator* / *Administrator platformy* — holds every permission. Installing
`@endora-commerce/mod-admin-roles` creates it and every boot ensures it exists with full access, on
an instance with or without demo data. It cannot be deleted (409 `ADMIN_ROLE_PROTECTED`), whether
or not anybody holds it, and withdrawing the demo data no longer removes it. The role code is
unchanged; an operator's own rename of the role is kept.

**The admin surface no longer produces an account without a role.**

- `POST /api/v1/admin/admin-users` requires `adminRoleId`; without one it answers 400
  `ADMIN_USER_ROLE_REQUIRED`. A client that created accounts and assigned the role afterwards must
  send the role with the create.
- `PATCH /api/v1/admin/admin-users/:id` with `adminRoleId: null` answers 400
  `ADMIN_USER_ROLE_REQUIRED`. A role is changed for another, never cleared.
- The Users screen requires a role when creating an account and offers no "unassigned" choice for
  an account that has one.

For code that consumes the packages:

- `ERROR_CODES` gains `ADMIN_ROLE_REQUIRED` (declared by `admin_roles`) and
  `ADMIN_USER_ROLE_REQUIRED` (declared by `admin_users`), each with an `en` and a `pl` sentence.
- `PermissionReadPort` (container name `permissionService`) gains
  `resolveRole(adminUserId): Promise<AdminRoleResolution>`, which answers `{ role }` or
  `{ refusal }`. An implementation of the port must add it.
- `hasPermission` on that service **throws** the 403 `ADMIN_ROLE_REQUIRED` refusal for an active
  administrator with no role, where it used to answer `false`. An unknown or inactive
  administrator is still `false`.
- `AdminTenantScope`'s confined member gains an optional `unresolved: Error`.
  `adminTenantScopePort.resolveForAdmin` no longer answers `{ allowAll: true }` for an id that
  names no live administrator or for an administrator with no role: it answers
  `{ allowAll: false, allowedOrganizationIds: [], unresolved }`, and the platform's tenant guard
  raises `unresolved` on the first tenant-scoped read.
- `@endora-commerce/mod-admin-roles` exports an `installHook`.
