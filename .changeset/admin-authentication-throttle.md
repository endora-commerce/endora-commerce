---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-mfa': patch
---

Repeated wrong passwords and wrong second-factor codes for an administrator account are now
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
