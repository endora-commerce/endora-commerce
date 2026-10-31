---
title: customer_accounts
description: Customer login, password reset, two-step verification, role assignment
---

# `customer_accounts`

Per-user state for Customers: login, password management, optional two-step verification,
role within their Organization. Backed by the shared `auth` session
service; this module owns the customer-facing identity surface.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` | Email + password (+ TOTP step if two-step verification is enabled) |
| `POST /api/v1/auth/logout` | Destroy session |
| `POST /api/v1/me/password` | Change password (rejects wrong `currentPassword`). A successful change signs the account out of every other session (the one the request was made from is kept), retires its outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `POST /api/v1/auth/password-reset/request` | Begin reset flow. A new link retires every earlier unused one, so only the newest e-mail works. Repeated requests for one address are limited (see below) |
| `POST /api/v1/auth/password-reset/confirm` | Redeem reset token. A redeemed token signs the account out of **every** session, retires its other outstanding reset tokens and withdraws any sign-in it had begun and not finished. |

## Limits on repeated attempts

Repeated wrong passwords, wrong second-factor codes and repeated password-reset
requests for one customer account are answered with **429
`CUSTOMER_AUTHENTICATION_THROTTLED`**, a `Retry-After` header and the same number
of seconds in `error.details.retryAfterSeconds`, until a delay has passed. While
a delay runs even a correct password is refused without being checked. An
address that belongs to no account is limited exactly like one that does, so
the answer says nothing about which addresses have accounts.

| What is counted | Before a delay starts | Counted over |
| --- | --- | --- |
| Wrong passwords for one account, from devices it has never signed in on | 50 | 30 minutes from the first |
| Wrong second-factor codes for one account, from such devices | 20 | 30 minutes from the first |
| Password-reset requests for one address, from such devices | 5 | 1 hour from the first |
| Any of the above from one known device | 10 | 30 minutes from the first |

The first delay is one minute (fifteen for reset requests) and each further
failure doubles it, up to fifteen minutes (an hour for reset requests). A
successful sign-in clears the count.

**Known devices.** A completed sign-in — password and, where one is asked for,
the second factor — leaves the signed, `httpOnly` cookie `b2b_customer_device`
on the device for 90 days. It is not a session and grants nothing; an attempt
carrying it is counted against that device's own budget instead of the
account's, so somebody who knows a shopper's e-mail address cannot keep them out
of a device they have used before. The cookie stops being honoured when the
password changes and while the account is blocked or deleted.

**No per-address counting.** The storefront signs shoppers in from its own
server, so every attempt reaches the backend from the same address; counting by
address would let one shopper's typos hold up every other. The storefront
forwards the browser's `b2b_customer_device` cookie with the sign-in, the second
step and the reset request, and stores the one the backend sets.

When a delay starts for an existing account, one audit entry
`customer_account.authentication_throttled` is written. If Redis does not
answer within three seconds the attempt is refused with **503
`CUSTOMER_AUTHENTICATION_UNAVAILABLE`**.

## Entities

`CustomerAccount` (email, passwordHash, role), `PasswordResetToken`. Role is
enum `organization_admin | regular_user`.

## Extension points

- **Password policy** — `password-hasher.ts` wraps argon2id; tune cost
  parameters there.
- **Backup codes and second factors** — not this module's. Customer and admin
  two-step verification is the `mfa` module's, over `mfa_enrolments`, served at
  `/api/v1/account/mfa/*`; recovery codes are single-use rows there. The
  superseded scaffolding this bullet used to point at
  (`totp-enrolment-service.ts`) was deleted on 2026-08-25 — it could never
  complete a single enrolment.
