---
title: Customer accounts
description: Customer login, password reset, two-step verification, role assignment
---

# Customer accounts (`customer_accounts`)

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

## Organization roles

Every account holds exactly one **organization role**, a role of its own
Organization: *Administrator*, *Member* or a custom role the Organization's
administrators defined (the roles themselves, their permissions and their
routes belong to the `organizations` module). The database holds the
assignment: an account cannot point at another Organization's role, and a role
that any account still holds — a blocked or removed one included — cannot be
deleted.

- **New accounts.** The person who registers a company is its *Administrator*.
  An individual (B2C) customer is the *Administrator* of their own personal
  Organization — after self-registration and after a first sign-in through an
  external identity provider alike. An invited member gets the role the
  invitation names.
- **Moving an account.** When an operator assigns a customer to another
  company, the customer becomes that company's *Administrator* if they
  administered the company they came from, and its *Member* otherwise; a custom
  role does not travel. A customer coming from their own personal Organization
  becomes a *Member*. Detaching a customer from a company makes them the
  *Administrator* of their own personal Organization again.
- **The last administrator.** An Organization keeps at least one active
  administrator: demoting or removing the last one is refused with **409
  `CANNOT_DEMOTE_LAST_ADMIN`** / **409 `CANNOT_REMOVE_LAST_ADMIN`**. A blocked
  administrator does not count. Two administrators stepping down at the same
  moment cannot both succeed.
- **The next request.** The session reads the account on every request, so a
  role change applies to the member's very next request, on every server.

Role changes are Commands, each recorded in the audit log against the
Organization:

| Action | When |
| --- | --- |
| `customer_account.change_role` | An account is moved to another role — also once per member when a role they hold is deleted and its members move to a replacement |
| `customer_account.remove_member` | A member is removed from the Organization |
| `customer_account.promote_organization_admin` | An operator restores access to an Organization left without an administrator |

A role change also announces `customer_account.organization_role_changed.v1`
once it is committed.

### Creating an account from another module

`customer_account.create` has one implementation, published two ways:

- `customerAccountMemberWritePort.create(input)` creates the account in a
  transaction of its own — the member direct-create and the invitation accept
  use it;
- `customerAccountMemberCommandPort.prepareCreate(input)` hashes the password
  and returns a builder; `.command({ organizationId, organizationRoleId })`
  is the Command, which a caller runs as a **child** of its own Command through
  `ctx.run`, so the account commits or rolls back with the caller's write.
  `organizations`' self-registration uses it. Prepare it before your own
  Command runs: the hash is slow by design and must not run inside a
  transaction.

Both refuse an address already registered with **409
`EMAIL_ALREADY_REGISTERED`**, from the pre-check and from the unique index.

### What the audit log holds

The platform audit log is read by everybody holding `audit_log:read`, whichever
organizations they may see, so an account's entries carry names and structure,
never its values:

- a profile change (`customer_account.update_profile`) names the fields that
  changed as `changedFields`, without the e-mail or the names;
- an account's creation (`customer_account.create`, `.register_standalone`,
  `.register_social`) names the fields it was created with, its role by id and
  whether its address was confirmed. `customer_account.create` is a Command:
  the first user of a business registration is created by it inside the
  registration's transaction, so its entry is written with the
  `organization.register` entry and carries the same request id;
- a move between Organizations (`customer_account.organization_assigned`,
  `.organization_unassigned`, `.attach_organization`) is recorded as
  `changedFields: ['organizationId', 'organizationRoleId']`, with the role ids
  but not the Organizations;
- a block (`customer_account.blocked`, `.unblocked`) records when, its source
  and `hasBlockReason`, never the reason;
- a custom-field change (`customer.custom_fields.update`) names the changed keys
  as `changedCustomFields`;
- a role change records the role by id and kind, never a custom role's name;
- a preferred-language change (`customer_account.set_preferred_language`)
  records `changedFields: ['preferredLanguage']` and where it came from as
  `source` (`self_service` or `sign_in`), never the language.

The account itself holds the values.

## Preferred language

Every account can record the language its owner reads, as
`CustomerAccountRecord.preferredLanguage`: one language tag, spelled as the
sales channel that captured it spells it (`pl-PL`, `en-US`), or `null` while it
is not known. It is what e-mails composed for the account outside a request are
meant to be written in. Inside a request nothing changes: the response language
still follows the request's `Accept-Language` header.

**Where it comes from.**

- **At account creation**, from the creating request: its first
  `Accept-Language` tag, resolved against the request's sales channel — the
  exact language if the channel offers it, else a channel language with the same
  base language (`en` → `en-US`), else the channel's default language. That
  covers business registration, individual (B2C) registration, accepting an
  invitation (the invitee's language, not the inviter's) and a first sign-in
  through an external identity provider (the language of the page the sign-in
  was started on). An account an operator creates on the organization panel
  records none.
- **At sign-in, only while it is unknown** — an account that predates the field,
  or that an operator created. The language is taken once the password, the
  block and the store access have been accepted, before any second factor is
  asked for; a federated sign-in to an existing account is treated the same way.
  A refused sign-in records nothing, an operator impersonating the customer
  records nothing, and a sign-in never replaces a language the account already
  has. If recording it fails, the sign-in still succeeds.
- **The customer's own choice** on the storefront account page — the only thing
  that replaces a stored language. See the `customers` module.

**Reading it.** `customerAccountReadPort` returns the field on every record. A
sender resolves it against the channel it renders for:
`scopeLanguageOf(renderChannel, preferredLanguage)` — the exact language, else
one of the same base language, else that channel's default. A language the
channel no longer offers therefore falls back rather than failing, and nothing
is migrated when a channel drops a language.

**Writing it from another module.** `customerAccountPreferencePort` has two
methods, both running the `customer_account.set_preferred_language` Command:
`setPreferredLanguage(customerAccountId, tag)` stores the tag as given (the
caller has checked it against the request's channel) and answers 404
`NOT_FOUND` for an unknown account; `captureIfUnset(customerAccountId, tag)`
writes only while the account has no language and otherwise does nothing — no
write and no audit entry.

**Personal data.** The language describes a person. It is never written into an
audit entry, never logged, and the anonymisation sweep erases it with the name
and the e-mail; an account anonymised before the field existed that still holds
one is finished by the next sweep.

## Entities

`CustomerAccount` (email, passwordHash, organizationRoleId, preferredLanguage), `PasswordResetToken`.
`organizationRoleId` names the account's organization role. The older two-value
`role` (`organization_admin | regular_user`) is still kept in step with it while
the platform moves off it, and will be removed.

## Extension points

- **Password policy** — `password-hasher.ts` wraps argon2id; tune cost
  parameters there.
- **Backup codes and second factors** — not this module's. Customer and admin
  two-step verification is the `mfa` module's, over `mfa_enrolments`, served at
  `/api/v1/account/mfa/*`; recovery codes are single-use rows there. The
  superseded scaffolding this bullet used to point at
  (`totp-enrolment-service.ts`) was deleted on 2026-08-25 — it could never
  complete a single enrolment.
