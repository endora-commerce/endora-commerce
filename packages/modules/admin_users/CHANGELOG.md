# @endora-commerce/mod-admin-users

## 0.105.0

### Minor Changes

- 1ba6b26: An instance can switch the account-wide administrator password limit off, by environment variable.

  The account-wide limit — twenty wrong passwords for one account from all addresses that are not a
  known device — assumes the password is a secret. On an instance that publishes an administrator
  password on purpose, a public demo, every visitor is a first-time device, so anybody could keep all
  of them out of the account with twenty wrong passwords and a few more each half hour.

  `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` in the backend's environment switches off the account-wide
  count of wrong **passwords** and nothing else: the limit per address on one account, the limit per
  known device, both limits on second-factor codes and the delays are unchanged, and an attempt that
  arrives with no client address is still counted for the account. It is read once at start, it is
  not a Setting and cannot be changed from the Admin UI, and while it is off the backend logs
  `account-wide administrator attempt limit is OFF — intended for demo instances with published
credentials` on every start. Any value other than `off` leaves the limit on.

  Do not set it on an instance whose administrator passwords are not public. Without the variable
  nothing changes.

  A scaffolded instance can set it too: the compose file `endora new instance` writes forwards
  `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT` to the backend, and its `.env.example` lists it, empty.

- a65b215: An administrator changing their own password has to supply the current one.

  **Breaking for API clients of `PATCH /api/v1/admin/me`.** The route used to store whatever
  `password` it was sent: a signed-in session was the only proof asked for, so anybody holding one —
  an unattended browser, a copied cookie — could replace the password and keep the account. A
  request that carries `password` must now carry `currentPassword` as well:

  ```jsonc
  // before
  { "password": "<new password>" }
  // now
  { "password": "<new password>", "currentPassword": "<current password>" }
  ```

  - `password` without `currentPassword` is refused with `400 VALIDATION_FAILED`, the issue naming
    the `currentPassword` field.
  - A wrong `currentPassword` is refused with `403 CURRENT_PASSWORD_INVALID`. It is 403 and not the
    401 the buyer-side change-password route answers with, because the Admin UI treats every 401 as
    an expired session and signs the administrator out.
  - A refused request changes nothing: a first or last name sent in the same request is not applied
    either.
  - A request without `password` is unchanged — first and last name stay editable without any
    password, and a `currentPassword` sent alone is ignored.

  The current password is checked with the same hash verification sign-in uses. Nothing else about a
  password change moves: the administrator's sessions and second factor are left as they were.

  `updateAdminUserSelfRequestSchema` in `@endora-commerce/contracts` gains the optional
  `currentPassword` field and the rule that ties it to `password`; `UpdateAdminUserSelfRequest` gains
  the field. `AdminUserService` in `@endora-commerce/mod-admin-users` gains `updateSelf(id, input)`,
  which the route calls, and `AdminUserService.update` no longer accepts `password` — it was the
  unverified write, and the route was its only caller.

  The other ways to set an administrator's password are untouched: creating an account,
  `POST /api/v1/admin/admin-users/:id/password` (a peer reset, gated by `admin_users:manage`) and the
  `admin_users create` command.

  **Admin UI.** The profile screen has a "Current password" field above "New password". It is asked
  for only when a new password is typed, and a wrong one is reported on the field itself, not in
  the page banner.

  **Sentences.** `errors.CURRENT_PASSWORD_INVALID` in the `core` bundle reads "The current password
  is incorrect." / "Obecne hasło jest nieprawidłowe." instead of the placeholders "Current Password
  Invalid." / "Błąd: current password invalid." — the buyer-side change-password route answers with
  the same code, so its message changes too. Three keys join the bundle in English and Polish:
  `profile.field.currentPassword`, `profile.field.currentPasswordHelp` and
  `profile.error.currentPasswordRequired`.

- 9260c36: An administrator's sessions are revoked when the credential behind them is withdrawn.

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

- 560f2e3: More credential changes withdraw the sessions and pending sign-ins obtained before them.

  - **`admin_users create` run again for an existing account** replaces the password, so it now
    ends every session of that account and withdraws its pending second-factor challenges and
    setup tickets, through the same path as a peer reset. The write is audited as
    `admin_user.change_password` with `via: 'cli'` and no acting administrator. Creating a new
    account is unchanged.
  - **Removing a second factor.** Disabling your own two-factor authentication
    (`POST /api/v1/admin/account/mfa/disable`, `POST /api/v1/account/mfa/disable`) ends every other
    session of the account and keeps the one the request was made from. An administrator's reset of
    a customer's second factor (`POST /api/v1/admin/customers/:customerId/mfa/reset`, and the bulk
    route for each account it actually resets) ends every session of that customer. Both withdraw
    the account's pending challenges and setup tickets. Enrolling a factor ends no session, and a
    disable or reset that removes nothing ends none either.
  - **Customer password change** (`POST /api/v1/me/customer/change-password`,
    `POST /api/v1/me/password`) ends every other session of the account and keeps the calling one.
    **Redeeming a reset token** (`POST /api/v1/auth/password-reset/confirm`) ends all of them. Both
    mark every other outstanding reset token of the account as consumed and withdraw its pending
    second-factor challenges and setup tickets.

  In every case the new state is persisted first and the sessions are revoked after it.

  Port changes, all additive: `AuthSessionPort.destroyAllForCustomer` takes an optional
  `{ exceptSessionId }` (`AuthDestroyAllForCustomerOptions`), mirroring `destroyAllForAdmin`;
  `CustomerAuthPort.changePassword` takes an optional fourth argument
  `{ sessionCookieValue }` (`CustomerChangePasswordContext`) naming the session to keep — a caller
  that omits it keeps none. No port member was removed or changed incompatibly.

  Not ports, but changed for anyone constructing these classes directly: `PasswordResetService`'s
  constructor takes the session port as its second argument (the audit port moved to third), and
  `MfaEnrolmentService.disable` returns whether a factor was removed.

### Patch Changes

- 18ae962: Repeated wrong passwords and wrong second-factor codes for an administrator account are now
  throttled. Until now the only limit in front of `POST /api/v1/auth/admin/login` was the global
  ceiling of 1000 requests a minute per address, so a password could be tried a thousand times a
  minute; and the second step's budget of five codes belonged to one challenge, so a new challenge —
  one more password request — bought five more codes.

  **What changes for a caller.** After five wrong attempts from one address on one account, or twenty
  on one account from all addresses together, the attempt is answered
  `429 ADMIN_AUTHENTICATION_THROTTLED` with a `Retry-After` header and
  `error.details.retryAfterSeconds`. The delay is one minute, then doubles with each further wrong
  attempt up to fifteen minutes; the count is cleared by a successful attempt and otherwise forgotten
  thirty minutes after the first wrong one. A correct password or code is refused too while a delay
  is running — it is not checked — and an e-mail address that belongs to no administrator is throttled
  identically. Nothing is locked permanently. An IPv6 client is counted by its /64.

  At most five attempts from one address (twenty for one account) are checked at the same time; one
  beyond that is answered 429 with `Retry-After: 1`, unchecked, and nothing is counted for it.

  It applies to `POST /api/v1/auth/admin/login`, the current password on `PATCH /api/v1/admin/me`,
  `POST /api/v1/auth/admin/mfa/verify`,
  `POST /api/v1/admin/account/mfa/disable` (password or code) and
  `POST /api/v1/admin/account/mfa/recovery-codes/regenerate`. Passwords and codes are counted
  separately. The customer routes are unchanged.

  **Known devices.** A completed administrator sign-in sets a new cookie, `b2b_admin_device`: signed
  with the server's cookie secret, `httpOnly`, 90 days. It is not a session and grants nothing. An
  attempt that carries it is counted against that device's own budget of five and not against the
  account-wide twenty, so wrong passwords sent by somebody else cannot keep an administrator out of a
  device they have signed in on before. It stops being honoured when the account's password changes,
  and is not honoured while the account is deactivated; a second-factor reset does not revoke it.
  Only a password sign-in sets it, so an account that signs in only through Google or Microsoft never
  has a known device. A device the account has never been signed in on can still be
  delayed by somebody who knows the e-mail address and sends twenty wrong passwords from four or more
  addresses.

  **For an operator.**

  - `pnpm run cli admin_users unlock --email=<e>`, from the root of an instance
    (`node dist/cli.js admin_users unlock --email=<e>` in a production image), clears every count for
    one account. Its first line of output names the Redis it acted on (host, port, database index).
  - Behind a reverse proxy, set `TRUSTED_PROXY_HOPS` or `TRUSTED_PROXY_ADDRESSES`: without it every
    client shares the proxy's address.
  - Each delay that starts for an existing account writes one audit row,
    `admin_user.authentication_throttled`, with the factor, the scope (`address`, `account` or
    `device`) and the delay. Refused attempts write nothing.
  - When Redis does not answer within three seconds the attempt is refused with
    `503 ADMIN_AUTHENTICATION_UNAVAILABLE`.

  **In `@endora-commerce/contracts`.** New: `AdminAuthenticationThrottlePort` (container name
  `adminAuthenticationThrottlePort`, owned by `admin_users`) with `verify` and `issueKnownDevice`;
  `AdminAuthenticationAttempt`, `AdminAuthenticationOrigin`, `AdminAuthenticationCheckResult` and
  `AdminAuthenticationFactor`; `ADMIN_KNOWN_DEVICE_COOKIE_NAME` and
  `ADMIN_KNOWN_DEVICE_MAX_AGE_SECONDS`; and the error codes `ADMIN_AUTHENTICATION_THROTTLED` and
  `ADMIN_AUTHENTICATION_UNAVAILABLE`. A route that verifies an administrator credential adopts the
  throttle with one call:

  ```ts
  const ok = await throttle.verify(
    { factor: 'password', account: admin.email, ip: request.ip, knownDevice },
    async () => ({ ok: await verifyPassword(admin.passwordHash, typed), adminUserId: admin.id }),
  );
  ```

  `AdminPasswordVerificationPort.verifyPassword` takes an optional third argument,
  `context?: AdminAuthenticationOrigin`, and now rejects with the 429 or the 503 above instead of
  always resolving to a boolean.

- 8d4440f: The configured admin idle-logout window now applies to every administrator, not only to those whose
  role includes `settings:read`. The Admin UI learned the window by requesting
  `GET /api/v1/admin/settings/admin.idle_logout_minutes`, which requires `settings:read`: an
  administrator with a narrower role was answered 403 on every sign-in and was signed out after the
  built-in 60 minutes whatever the operator had configured.

  `GET /api/v1/admin/me` now carries the window as `idleLogoutMinutes` (`number | null`), described
  by the new `adminMeResponseSchema` in `@endora-commerce/contracts`, and the Admin UI reads it from
  there — it no longer calls the settings endpoint for it. `AdminMe` in `@endora-commerce/admin-kit`
  gains the matching optional field. The field is additive; the Admin UI keeps its 60-minute default
  when the field is absent (a backend older than this release) or `null` (the setting could not be
  resolved).

  The permission gate on the settings admin API is unchanged. No setting or permission changes.

- 38e8818: Sign-in does the same password-hash work whether or not the address belongs to an account.

  Administrator and customer sign-in looked the account up first and verified the password only when
  there was one. An address nobody holds, a deleted customer and an inactive administrator were
  therefore refused tens of milliseconds sooner than a wrong password for a real account, and the
  difference told a caller which addresses have an account. Both now verify the submitted password
  once in every case — against a dummy hash made once per process with the parameters of a stored
  hash when there is no usable account — and answer exactly as for a wrong password.

  `@endora-commerce/platform/kernel` exports `verifyPasswordOrDummy(hash, password)` for this.

  **Behaviour change for customer sign-in.** `403 ACCOUNT_BLOCKED` used to be answered before the
  password was looked at, so it told anybody that the address has an account and that it is blocked.
  It is now answered only when the password is correct; a wrong password for a blocked account is
  `401 INVALID_CREDENTIALS` like any other.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Minor Changes

- 08192f0: **An administrator always holds a role, and one without a role is refused.** An administrator's
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

  **Every instance has the platform-administrator role.** `platform_admin` — shown as _Platform
  administrator_ / _Administrator platformy_ — holds every permission. Installing
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

### Patch Changes

- 7f579d2: **A demo seed or reset that stops part-way no longer leaves the demo administrators without a
  role.** An administrator without a role is refused, and a demo run is not one transaction, so the
  pairing of the three demo accounts with their roles can no longer wait for a late step:
  - `demo seed` creates each demo administrator already holding its role. An account that an
    earlier, interrupted run left without a role is given it on the next `demo seed`; a role
    somebody chose for one of these accounts is never replaced.
  - The composition step "demo administrators take their roles" now runs first and only fills in a
    missing role. Its withdrawal no longer unassigns anything.
  - `demo reset` deletes the demo accounts with their role still on them, then the demo's own
    `sales_representative` role. The `platform_admin` role stays.

  `demo seed` now fails, naming the role, if a role a demo administrator needs does not exist,
  rather than creating the account without one.

  **Several processes can start at once on a database that does not hold the
  platform-administrator role yet.** Each process ensures the role at boot; the ones that lose the
  race now find the role the winner created instead of failing to start.

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- be758bb: `admin_users create` ended with _Sign in at the admin panel with the email + password above_, and no password is above: it is never echoed, and under `--password-stdin` it was never on the command line. The line now names the e-mail and says the password is the one you chose and is not printed.
- d919418: `npx create-endora-commerce <dir>` (`endora install`) and `endora new storefront <dir>` now write the storefront **outside a checkout of the platform repository**. The CLI's build runs the same `planStorefront` over the reference storefront and ships the finished plan in `dist/storefront-reference/`; where no checkout is above the working directory the commands write that. Inside a checkout nothing changes: the storefront is still copied from the checkout.

  What a consumer sees:
  - `--no-storefront` is no longer needed anywhere. `endora install <dir>` writes `<dir>-storefront` beside the instance and installs it; the wizard's parts checklist shows the storefront as a toggleable, pre-checked row.
  - The packaged reference leaves out the reference storefront's Playwright screenshot baselines (8.4 MB of the 10.8 MB tree) and reports that as an omission, with `pnpm exec playwright test --update-snapshots` as the way to record your own. A checkout's scaffold still copies them.
  - `--registry <url>` is applied at run time to the packaged plan, through the same code a checkout's plan goes through.
  - `pnpm pack` / `pnpm publish` of this package refuses a `dist` with no packaged reference (`prepack`). A build made without git or without the storefront tree — a container image — still succeeds and writes none.

  `endora install` also changed in four ways:
  - **Ports.** Before anything is written, it probes the host ports the development stack publishes. A default that is taken is moved to a free one (`POSTGRES_PORT=15432`, …), written into the instance's `.env`, and the derived `DATABASE_URL` / `REDIS_URL` / `MEILISEARCH_URL` / `SMTP_URL` follow it — they used to be composed from the defaults regardless, so the run died at `dev:services` or, worse, pointed at another project's Redis. A `*_PORT` you set in the target's `.env` is never moved: taken, it is a refusal with nothing written. Addresses are now derived when the target already held a `.env`, too.
  - **The administrator's password is not printed.** The `[n/N]` echo, `--dry-run` and the resumable list show `--password=<password>`, and the step no longer passes the password as an argument at all: it runs `admin:create -- … --password-stdin` and writes the password to the command's standard input (`InstallStep.stdin`). As an argument it was echoed twice by pnpm and once by the operator CLI's own log.
  - **The resumable list starts at the step that failed** (it started after it), and each line names its directory.
  - **The closing block** names the API on the instance's own `PORT` rather than `3001`, says when that port is in use, and under `--no-services` no longer promises a mail catcher. The storefront's `NEXT_PUBLIC_API_BASE_URL` and `BACKEND_BASE_URL` use the same `PORT`.

  API: `NewStorefrontResult.reference` is `StorefrontReference | null` (null when the packaged reference was written) and gains `source`; `NewStorefrontOptions` / `InstallOptions` gain `packagedReferenceDir`; `InstallOptions` gains `portInUse`; `runNewStorefront` and `storefrontDeclaredInputs` no longer throw outside a checkout when the CLI carries a reference. New exports: `resolveStorefrontSource`, `StorefrontSource`, `NoReferenceStorefrontError`, `readPackagedReference`, `ownPackagedReferenceDir`, `PackagedReference`.

  `@endora-commerce/mod-admin-users`: `admin_users create` accepts `--password-stdin` in place of `--password=<p>` and reads the password from standard input. Both at once is refused; `--password=` works as before.

  `@endora-commerce/platform`: the operator CLI no longer logs a credential. The reason it opens a command's system scope with (`tenant.escape_hatch`, `cli: <argv>`) was the raw argv, so `admin_users create --password=…` wrote the password into the log; the value of any `--flag=value` whose name contains `password`, `passphrase`, `secret`, `token`, `credential` or `api-key` is now `<redacted>`.

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.9.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.9.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.9.5

### Patch Changes

- 0261b2f: Source comments only: the mixed-case e-mail example uses an `example.com` address, and a migration comment cites its design record without a repository path. No runtime change.
- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.9.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.9.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- 6e037cd: The module declares its demo data: `manifest.demo` creates the three administrator accounts the
  quickstart signs in with — the platform administrator and two sales representatives — and
  withdraws them again.

  `endora demo seed` now reports `admin_users` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
  nothing is loaded by the processes that merely compose the platform, and the module gained no
  `exports` subpath, no `files` entry and no manifest `dependencies` entry.

  **The sign-in details come back as `DemoSeedResult.credentials`**, so the runner prints them
  once under `Sign in with:` instead of the seed logging them itself.

  **The accounts are created with no `adminRoleId`.** A row carrying an `admin_roles` id is two
  modules' rows in one statement, so the assignment is the instance composition's; the column is
  nullable, which is what makes that split available at all. A consumer that seeds these accounts
  through this body and applies no composition gets three accounts with no role.

  **The withdrawal changed, and it is a repair.** The host's demo reset cleared this table with a
  `truncate … cascade`, which took an administrator a developer had created for themselves. It now
  deletes only the three addresses `seed` assigns.

  Seeding twice creates nothing the second time, re-hashes nothing, and reports the same count and
  the same credentials.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- 73d0887: Publish `MfaEnrolmentStatePort`, and make `twoFactorEnabled` the live enrolment.

  `activeSubjectIds(subjectType: MfaSubjectType, subjectIds: readonly string[]):
Promise<string[]>` answers which of the given subjects hold an active second
  factor, on the `mfaEnrolmentStatePort` container. Batched rather than per row,
  because every caller is a list surface; the answer is plain ids, because
  `MfaEnrolment` carries the encrypted TOTP secret and no consumer has business
  holding it.

  New surface on `mfa` — nothing is removed there. A consumer resolves it with
  `lazyPort<MfaEnrolmentStatePort>(ctx, 'mfaEnrolmentStatePort')` and declares the
  edge; both consumers in this repository declare it `degrades-without`, because
  `mfa` is deactivatable and a locked consumer binding it would make the operator's
  MFA switch a dead one.

  **Two mappers gained a required parameter, and that is a breaking change to a
  call, not to a wire shape.** `toAdminUserRecord(admin, twoFactorEnabled)` and
  `toCustomerAccountRecord(account, twoFactorEnabled)` no longer derive the field
  themselves; each package also exports a batching helper
  (`toAdminUserRecords` / `toCustomerAccountRecords`, plus
  `toOneCustomerAccountRecord`) that takes the reader and does one `mfa` read per
  response. The parameter has no default deliberately: it replaces a derivation
  that was silently wrong, and a default would let the next call site reintroduce
  it. Two service constructors take the reader as a new argument —
  `CustomerAccountReadService(emFactory, twoFactorEnrolments)` and
  `AdminUserReadService(emFactory, twoFactorEnrolments)`, with the same addition on
  `CustomerAccountMemberWriteService`, `CustomerAccountLifecycleWriteService` and
  `CustomerAccountAdminSearchService`.

  `twoFactorEnabled: boolean` is unchanged on every response and on both published
  records; what changed is where the value comes from. It was
  `Boolean(x.twoFactorConfirmedAt)` — a column with no writer on either identity
  table, whose last non-null writer was the superseded customer TOTP path deleted
  on 2026-08-25 — so the field was a provably constant `false`. `/admin-users`
  reported no second factor for an administrator who had enrolled an hour earlier,
  and `GET /api/v1/me/customer` told a buyer their own account was unprotected
  while it was not.

  `two_factor_confirmed_at` is now read by nothing on either table. Dropping the
  two columns is a separate migration and is not in this change.

- e5ae42c: `mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
  new `./admin` subpath each.

  Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
  `AdminContributions` object — six routes and three sidebar entries between them. Every
  component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

  Six things a consumer has to know:
  - **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
    `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
    `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
    `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
    advertise it. All three arrays of `AdminContributions` are optional and a nav-only
    contribution is supported; a consumer rendering the registry needs both packages for the
    roles screen to be both reachable and advertised.
  - **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
    `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
    package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
    a raw key back. The text is unchanged in both languages, and the screens' own keys did not
    move.
  - **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
    directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
    A consumer that mirrored `files` by hand needs the new directory.
  - **Three packages declare `actions` for the first time**: `open-admin-users`,
    `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
    server against the effective enabled-set, and they pay three of the fifteen remaining
    entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
    neither contributes a sidebar entry, which is that debt's population.
  - **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
    and a consumer validating an icon name against the old enum keeps working. It is needed
    because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
    drew meant adding the name rather than substituting one already on the list.
  - **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
    routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
    for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
    provider in one copy against a consumer in the other is a `null` context at runtime rather
    than a type error.

- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- efa4111: Six more modules become workspace packages (feature 080, T040b batch five):
  `admin_actions`, `admin_roles`, `admin_users`, `megamenu`, `organizations` and
  `price_lists`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the fifty-three packages before them.

  **`@endora-commerce/mod-organizations` publishes a `./ports` subpath.** It is
  type-only: `tsc` emits `export {};`, and it is where a consumer names
  `PersonalOrganizationProvisionApi` and `PersonalOrganizationProvisionInput`
  instead of reaching into the owner's directory.

  ```ts
  import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
  ```

  The implementation stays behind the container name
  `personalOrganizationProvisionPort`, resolved with `lazyPort`, so the gate that
  answers 503 `MODULE_DISABLED` when `organizations` is switched off is still the
  registration and not a call anyone has to remember to write.

  **Three packages publish a runtime binding by name, beside the `entities`
  array.** D-168 keeps entity classes off `./backend`; these are not entities, and
  each is exported because a host program must hold the _same_ copy the platform
  composed rather than a second one evaluated from source (D-160.6.1):
  - `@endora-commerce/mod-admin-roles/backend` — `PermissionCatalogueService`,
    `listAssignablePermissionCodes`, and the inventory scanner
    (`ConstantResolver`, `defaultScanRoots`, `scanEnforcedPermissionCodes`,
    `scanEnforcedPermissionGates`). The acceptance instance probe and
    `check:action-route-permissions` read them.
  - `@endora-commerce/mod-price-lists/backend` — `DefaultPriceListMigrator`,
    `DEFAULT_PRICE_LIST_ID` and `PriceListService`. The development catalog seed
    runs the migrator; a second copy would `em.create` a `PriceList` class the ORM
    never registered, which fails at the first insert rather than at load.

  **Nothing about a module's behaviour changed.** No manifest `dependencies` array
  moved, so the migration order is the same function of the same inputs: the
  committed registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base over all 164
  entries.

### Patch Changes

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/platform@0.7.0
