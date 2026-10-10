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
| `POST /api/v1/auth/admin/login` | Admin login (2FA challenge if Role requires it). Repeated wrong passwords are throttled: 429 `ADMIN_AUTHENTICATION_THROTTLED` with `Retry-After` — see below |
| `POST /api/v1/auth/admin/logout` | Destroy admin session |
| `PATCH /api/v1/admin/me` | The signed-in administrator edits their own first and last name and changes their own password; no permission code is needed. A new `password` must come with `currentPassword`: without it the request is refused with 400 `VALIDATION_FAILED`, with a wrong one with 403 `CURRENT_PASSWORD_INVALID`, with a new password equal to the current one with 400 `NEW_PASSWORD_UNCHANGED`, and a refused request changes nothing — not the name either. An accepted password change signs out every other session of the account (see *Sessions and password changes*). Repeated wrong current passwords are throttled like wrong passwords at sign-in (429 `ADMIN_AUTHENTICATION_THROTTLED`) |
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

## Repeated wrong passwords and codes are throttled

A password or a second-factor code for an administrator account can be tried
only a few times in a row. After that the attempt is answered **429
`ADMIN_AUTHENTICATION_THROTTLED`**, with a `Retry-After` header and the same
number of seconds in `error.details.retryAfterSeconds`, until a delay has
passed.

| Who is trying | Wrong attempts before a delay | Counted for |
| --- | --- | --- |
| One address on one account | 5 | 30 minutes from the first wrong attempt |
| One account, from all addresses that are not a known device | 20 | 30 minutes from the first wrong attempt |
| One known device on its account | 5 | 30 minutes from the first wrong attempt |

The first delay is one minute. Each further wrong attempt, made after a delay
has ended, starts one twice as long — two, four, eight minutes — up to fifteen
minutes at most. A successful attempt clears the count at once; otherwise it is
forgotten 30 minutes after the first wrong attempt. Nothing is locked
permanently.

An address is the client's IPv4 address, or its /64 network for IPv6 — every
host of one IPv6 /64 shares one budget. An IPv4 address written in IPv6 form
(`::ffff:203.0.113.9`) counts as the IPv4 address.

What this means in practice:

- **A correct password or code is refused too while a delay is running.** It is
  not checked at all, so the answer is the same whether it was right or wrong.
  Wait for the time in `Retry-After` and try again.
- **An e-mail address that belongs to no administrator is throttled the same
  way**, so the answer does not reveal which addresses have accounts.
- **Passwords and second-factor codes are counted separately.** A password is
  counted wherever it is asked for — at sign-in, as the current password when
  an administrator changes their own, and when it confirms switching two-factor
  authentication off — and so is a code: at the second sign-in step,
  when it confirms switching two-factor authentication off, and when recovery
  codes are regenerated.
- **At most five attempts from one address are checked at the same time** (20
  for one account). An attempt beyond that is answered 429 with
  `Retry-After: 1` and is not checked; sent again a second later it is. This is
  what stops a burst of parallel guesses, and it applies to correct credentials
  too: of twelve correct sign-ins sent at the same instant from one address, at
  least five succeed and the rest are told to retry in a second. Nothing is
  counted against the account for them.
- **How many guesses remain possible:** from one address, 9 in 30 minutes; for
  one account from any number of addresses, 24 in 30 minutes — about 1150 a
  day.

### Known devices

A completed sign-in — the password and, where the account has one, the second
factor — leaves a cookie on the device, `b2b_admin_device`. It is signed with
the server's cookie secret (`SESSION_COOKIE_SECRET`), `httpOnly`, and kept for
90 days from the last sign-in. It is not a session and gives no access: a
device that has it still has to present the password and the code.

Its one effect is on the throttle. An attempt from a known device is counted
against that device's own budget of five, and is neither counted in nor refused
by the budget of twenty that the account has for everybody else. So:

- **Wrong passwords sent by somebody else cannot keep an administrator out of
  a device they have signed in on before.** The account-wide count is the only
  one a stranger can fill, and a known device is not held to it.
- **A known device can still be throttled by its own wrong attempts**, five and
  then the delays above, wherever it connects from.
- **A device the account has never been signed in on is not protected.**
  Somebody who knows the administrator's e-mail address can delay sign-in there
  by sending 20 wrong passwords from four or more addresses, and keep it
  delayed with about 50 requests an hour. Use a device that has signed in
  before, or have somebody with server access run the unlock command below.
  (This is "the unprotected case" the points further down refer to.)
- **The exemption is tied to the password, and to nothing else.** The cookie
  stops being honoured when the account's password changes — by the
  administrator themselves, by a peer reset or by `admin_users create` — and
  every device then has to complete a sign-in
  again to become known. It is not honoured while the account is deactivated or
  deleted, but **reactivating the account with the same password revives the
  cookies its devices already hold**. Resetting two-factor authentication,
  enrolling in it or switching it off does not revoke them. To make every
  device of an account unknown, change its password.
- **Only a password sign-in sets the cookie.** An account that signs in only
  through Google or Microsoft never receives one, so its devices are never
  known and are always held to the account-wide count.
- **The protection covers returning devices only.** Where every administrator
  signs in from a device the account has never been used on — a public demo
  with shared credentials is the usual case — nobody holds the cookie, and
  somebody sending wrong passwords delays all of them: it is the unprotected
  case above, for everyone.
- Clearing the browser's cookies, or rotating `SESSION_COOKIE_SECRET`, makes
  the device unknown again. Nothing breaks; the next completed sign-in sets a
  new cookie.

### Unlocking an account from the command line

`admin_users unlock` forgets every count for one account — passwords and
second-factor codes, all addresses and devices — so that the next attempt from
anywhere is admitted. It needs a shell on the instance and runs against the
Redis its environment names. Its first line of output says which one — host,
port and database index — so that "nothing was throttled" from a Redis the
instance does not use cannot be mistaken for an account that was not throttled.

| Where | Command |
| --- | --- |
| An instance, on your machine (from its root) | `pnpm run cli admin_users unlock --email=<their e-mail>` |
| A production image | `node dist/cli.js admin_users unlock --email=<their e-mail>`, run in the backend container |
| A checkout of the Endora Commerce repository | `pnpm --filter backend run cli -- admin_users unlock --email=<their e-mail>` |

Sign in straight after running it: the device is then a known one. While wrong
passwords keep arriving, the account is delayed again after 20 more of them.
The command does not change the password, end a session or touch the second
factor. It writes one audit row, `admin_user.authentication_throttle_cleared`,
with no acting administrator: the command is run from a shell, not by somebody
signed in.

### Behind a reverse proxy

Set `TRUSTED_PROXY_HOPS` or `TRUSTED_PROXY_ADDRESSES`. Without it every request
appears to come from the proxy, so all clients share one address: five wrong
passwords from anyone then delay every device that is not a known one, for
every account they were tried on.

### Demo instances that publish an administrator password

The account-wide limit — 20 wrong passwords for one account from all addresses
that are not a known device — assumes that the password is a secret. A public
demo that prints an administrator's e-mail address and password on its sign-in
page breaks that assumption: every visitor is a first-time device, so anybody
can keep all of them out with twenty wrong passwords and a few more each half
hour.

For such an instance, and only for such an instance, set

```bash
ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off
```

in the backend's environment and restart it. What changes and what does not:

- **Off:** the account-wide count of wrong **passwords**. A first-time device
  is then refused only for its own address's wrong attempts.
- **Still on:** the limit of five per address on one account, the limit of five
  per known device, both limits on second-factor codes — the account-wide one
  included — and the delays themselves.
- A request that reaches the backend with no client address at all is still
  counted for the account, so that no attempt goes uncounted.

**Do not set it on an instance whose administrator passwords are not public.**
There the account-wide limit is what bounds guessing spread over many
addresses: without it, a party with a thousand addresses gets five guesses from
each of them every half hour.

It is an environment variable and not a Setting on purpose — a Setting would be
a switch in the Admin UI that the limit protects. Only the value `off` switches
the limit off; any other value leaves it on and logs a warning. While it is off
the backend logs this warning on every start:

```text
account-wide administrator attempt limit is OFF — intended for demo instances with published credentials
```

### What an operator sees

Each time a delay starts for an existing account, one audit row is written with
the action `admin_user.authentication_throttled`: the account as the object, the
client address, and in `stateAfter` the `factor` (`password` or
`second_factor`), the `scope` (`address`, `account` or `device`) and
`retryAfterSeconds`. The attempts refused during the delay write nothing, and
neither does a delay for an address that belongs to no account — that one is a
warning in the server log only. The password or code that was tried is never
recorded.

The numbers on this page are fixed in the module and are not Settings.

### When Redis is unavailable

The counts are kept in Redis. When it does not answer within three seconds, the
attempt is refused with **503 `ADMIN_AUTHENTICATION_UNAVAILABLE`** and
`Retry-After: 5`, without being checked. Nobody can sign in until Redis is
back; sessions are stored there as well.

An attempt that was admitted but whose result could not be recorded — the
verification hung, the process stopped, or Redis went away between the two
steps — is counted as a wrong attempt 30 seconds later. So a Redis outage, or a
series of short ones, can leave a few attempts counted against an account that
nobody mistyped anything for. They are forgotten like any others: by the next
successful sign-in, or 30 minutes after the first.

### For module authors

Another module that verifies an administrator credential uses the same counters
through the `adminAuthenticationThrottlePort` port
(`AdminAuthenticationThrottlePort` in `@endora-commerce/contracts`), wrapping the
comparison in one `verify(attempt, check)` call. The attempt carries the client
address and the verified value of the known-device cookie.

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
