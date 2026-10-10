# @endora-commerce/mod-admin-roles

## 0.105.0

### Minor Changes

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

### Patch Changes

- fcab32c: The demo `sales_representative` role can be saved from the role editor again. The demo data seeded
  it with `organizations:read.assigned`, a permission code that no module declares and no route
  checks, so every save of that role — a rename, one more permission ticked — answered
  `400 Unknown permission(s): organizations:read.assigned`, and the editor offered no checkbox to
  remove it. The code granted nothing and is no longer seeded.

  An instance seeded before this release still holds the code. Running `demo seed` again withdraws
  it from the existing role and changes nothing else on it; `demo reset` followed by `demo seed`
  does the same by recreating the role.

  No API, setting or permission changes.

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

- 44d35a6: The demo's `sales_representative` role also holds `crm:read` and `crm:write`. A demo Sales Rep
  can now open and move the Sales Opportunities assigned to them, and is offered when a colleague
  assigns an Opportunity or mentions a person with `@`. Only the demo data changes: roles on an
  instance that selling for real has are untouched.
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

- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

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

- 6e037cd: The module declares its demo data: `manifest.demo` creates the `platform_admin` and
  `sales_representative` roles the demo signs in with, and withdraws them again.

  `endora demo seed` now reports `admin_roles` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
  nothing is loaded by the processes that merely compose the platform, and the module gained no
  `exports` subpath, no `files` entry and no manifest `dependencies` entry.

  **`SALES_REPRESENTATIVE_PERMISSIONS` is published on `./backend`.** It was
  `backend/src/seeds/seeded-role-permissions.ts` in the application tree, and it is a constant
  rather than four lines inside a seed because six `permission-authority` contract tests assert
  what the seeded representative may reach and have to read the list the seed _writes_ — a copy
  agrees with the seed on the day it is written and never again. Since the seed that writes it is
  now this package's, so is the list.

  **The withdrawal changed, and it is a repair.** The host's demo reset cleared this table with a
  `truncate … cascade`, and this table is shared: `blog` and `cms` seed a role apiece from their
  own boot hooks, an operator's own role is indistinguishable from a demo one by every other
  column, and the cascade reached `admin_users`. The reset now deletes only the two codes `seed`
  assigns.

  **Which administrator holds which role is not this module's.** An `admin_users` row carrying an
  `admin_roles` id is two modules' rows in one statement, so the assignment stays with the
  instance composition.

  Seeding twice creates nothing the second time and reports the same count.

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

- 958fe88: Error-code ownership: `admin_roles` declares the three codes it owns and ships its first i18n
  bundle.

  `ADMIN_ROLE_CODE_TAKEN`, `ADMIN_ROLE_IN_USE` and `ADMIN_ROLE_PROTECTED` move from
  `@endora-commerce/mod-i18n`'s manifest to `@endora-commerce/mod-admin-roles`'. For a consumer the
  observable difference is **which bundle answers for them**: the sentences are no longer served from
  the platform bundle and are now in this module's own `i18n/{en,pl}.json`, so a deployment that
  ships `@endora-commerce/mod-admin-roles` gets them and one that does not gets the raising code's own
  English.

  Two of the three arrive with prose written for the first time — they carried a machine-shaped
  restatement of their own code (`"Admin Role Code Taken."`), which is deleted rather than moved.

  **`protectedRoleRefusal(code)` is a new export** of `@endora-commerce/mod-admin-roles/backend`, beside
  the existing `roleInUseRefusal`. It is the refusal `AdminRoleService.remove` now throws for a
  module-seeded role, extracted for the same reason its neighbour was: the translated sentence names
  the role through a `{role}` placeholder, and only a test that renders a real refusal can see that
  the placeholder has something to fill it.

  **The 409 `ADMIN_ROLE_PROTECTED` response now carries `details: { role: '<role code>' }`.** It
  carried no `details` before. This is additive — the member is `role` and never `code`, which is the
  refusal token the error envelope keys `errors.<CODE>.<token>` on.

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
