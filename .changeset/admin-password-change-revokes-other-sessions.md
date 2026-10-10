---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-auth': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

An administrator's sessions are revoked when the credential behind them is withdrawn.

Three writes used to leave every session of the account answering:

- **Changing your own password** (`PATCH /api/v1/admin/me`) replaced the hash and nothing else, so
  a browser signed in elsewhere — the one the password was being changed because of — stayed
  signed in for up to thirty days. It now revokes **every other session of the account**: the
  sign-ins on other browsers and devices and the impersonation sessions the administrator started.
  The session the request was made from is kept, no new cookie is issued, and the profile screen
  stays open. A refused change (wrong or missing `currentPassword`) and a name-only edit revoke
  nothing.
- **Deactivating an administrator** (`PATCH /api/v1/admin/admin-users/:id` with
  `status: 'inactive'`) and **deleting one** (`DELETE /api/v1/admin/admin-users/:id`) now revoke
  every session of the account. A permission check already refused an inactive account, but a
  route gated on the session alone — `GET` and `PATCH /api/v1/admin/me` among them — kept
  answering it, and reactivating the account brought the old sessions back.

A peer reset (`POST /api/v1/admin/admin-users/:id/password`) already revoked every session and is
unchanged. API keys are not sessions and are not touched; neither is the account's second factor.

**A revoked session could come back.** `SessionService.destroyAllForAdmin` and
`destroyAllForCustomer` cleared the Redis cache entries and then deleted the rows, so a request from
a session being revoked could read the row in between and cache it again — after which it answered
from the cache until its thirty-day expiry. Rows are deleted first now, and `loadSession` looks for
the row again after filling the cache and takes the entry back out when it is gone.

**Logins begun with the old password are withdrawn.** A pending second-factor challenge or setup
ticket issued after the old password verified could still be completed after a password change, a
peer reset, a deactivation or a delete. `MfaLoginPort` gains a required method,
`invalidatePending(subject)` (**breaking for implementers**), which `mfa` implements with a
per-subject generation counter in its challenge store, and `AdminUserService` calls it wherever it
revokes sessions. `AdminUserService`'s constructor takes the lazily resolved MFA port as an optional
fifth argument.

**Write first, revoke second.** The self-service change, the peer reset, deactivation and deletion
now persist the new state and then revoke, where the peer reset used to revoke first: a sign-in with
the old password between the two steps kept a session nothing revoked. A refusal from the session
port therefore surfaces as the request's error with the new password already in force.

**Audit.** A self-service password change is now recorded as `admin_user.change_password` with
`via: 'self_service'` — the action a peer reset already records with `via: 'peer_reset'` — where it
used to be an `admin_user.update` indistinguishable from a rename. The entry carries neither the
password nor its hash. A request that changes the name as well records an `admin_user.update`
entry beside it; a password-only request no longer records one.

**A session of an account that is not active is refused, revoked or not.** Revocation is a step
each write has to remember, so the admin guard no longer relies on it: `requireAdmin` and
`requireAdminAny` answer `401 UNAUTHORIZED` to a session whose administrator account is
deactivated, deleted or gone. **This changes a status code:** a permission-gated route used to
answer such a session `403 FORBIDDEN`, and a route with no permission code answered it in full. An
active account that lacks the permission is still answered 403. The extra account read is made
only on a route with no permission code and after a refused permission check, so a granted
permission costs what it did. While `admin_roles` or `admin_users` is absent from the deployment the
check is not made — it has nobody to ask — so `GET /api/v1/admin/module-presence` keeps answering in
that state as before.

**A new password equal to the current one is refused** on `PATCH /api/v1/admin/me` with
`400 NEW_PASSWORD_UNCHANGED` ("The new password is the same as the current one. Choose a different
password." / "Nowe hasło jest takie samo jak obecne. Wybierz inne hasło."). It would have reported
a change, and signed the other sessions out, without changing the credential. The check runs after
the current password is verified. The buyer-side change-password route and the peer reset do not
make this check: the peer does not know the target's password, and comparing would tell them.

**Log redaction.** The request logger censored `*.password`, `*.passwordHash` and `*.secret` but not
`*.currentPassword` or `*.newPassword`, the two other names a password travels under in a request
body. Both are on the list now, which `buildServer` and `createLogger` share instead of each
carrying its own copy.

**API — two breaking changes, named first.**

- `AdminPermissionChecker` in `@endora-commerce/platform` gains a required method,
  `isActiveAdministrator(adminUserId): Promise<boolean>`; `PermissionService` in
  `@endora-commerce/mod-admin-roles` implements it. A hand-written checker passed to
  `createRequireAdmin` / `createRequireAdminAny` has to add it.
- `AdminAuthService.changePassword` in `@endora-commerce/mod-admin-users` is **removed**, and the
  class's constructor loses its fourth argument (the audit port). The method had no caller,
  answered a wrong current password with 401 and revoked nothing; `AdminUserService.updateSelf` is
  the one implementation.
- `AuthSessionPort.destroyAllForAdmin` in `@endora-commerce/contracts` takes an optional second
  argument, `{ exceptSessionId }` (`AuthDestroyAllForAdminOptions`), which spares that one session
  when it is one of the administrator's own; `SessionService.destroyAllForAdmin` in
  `@endora-commerce/mod-auth` implements it. A port implementation that ignores the argument still
  type-checks but revokes the calling session too.
- `AdminUserService.updateSelf` takes an optional third argument, `{ sessionCookieValue }`, from
  which it works out which session to keep.
- `ERROR_CODES.NEW_PASSWORD_UNCHANGED` joins `@endora-commerce/contracts`, owned by `admin_users`.

A refused password change is not written to the audit log, as a failed sign-in is not.

**Admin UI.** After a password change the profile screen says that the other sessions were signed
out (`profile.info.passwordChanged`, English and Polish) instead of "Profile updated."
