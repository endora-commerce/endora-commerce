---
title: auth
description: Customer + admin sessions, password hashing, TOTP
---

# `auth`

Shared session, password-hashing, and TOTP primitives consumed by both
`customer_accounts` and `admin_users`. One of the two singular module
folders permitted by the naming conventions (alongside `example`).

## What it owns

- **Sessions** — `session-service.ts` persists session rows in Postgres
  with a Redis cache layer for hot reads; cookies signed via
  `@fastify/cookie`.
- **Password hashing** — `password-hasher.ts` wraps argon2id; defaults are
  tuned for the target hardware (see the **Hardware & system requirements**
  section of `README.md` at the repository root).
- **TOTP** — the platform's `kernel/crypto/totp` wraps `otpauth` + a backup-code pool.
- **Fastify plugin** — `plugin.ts` parses the session cookie and attaches
  `request.actor = { kind, id, ... }` plus `request.adminActor`.
- **Route guards** — `requireAdmin(permission?)`, `requireAdminAny(codes)` and
  `requireCustomer`, provided as ports from `backend.ts` and resolved by every
  module that gates a route. They were Fastify decorators on the plugin once;
  they were turned into ports so production and the test harness run the same
  implementation instead of one each.

## Last seen

Every session row carries `last_seen_at`: when a request last arrived with
that session's cookie. It is stamped for **customer** sessions and, since the
CRM's event reminders needed it, for **administrator** sessions too — until
then an administrator's row held the sign-in time and nothing after.

- **Throttled.** `SessionService.touchLastSeen` writes at most once a minute
  per session: every authenticated request costs one Redis `SET NX EX 60`, and
  only the first in each minute updates the row. The write is fire-and-forget,
  so it never delays or fails a request.
- **Read through a port**, `AuthSessionReadPort` (container name
  `authSessionReadPort`): `lastSeenByCustomerAccount(ids, since)` and
  `lastSeenByAdminUser(ids, since)` each answer the newest `lastSeenAt` per
  person among sessions seen at or after `since`. A person with no such
  session is absent from the answer.
- **An impersonation is the customer's presence.** A session in which an
  administrator acts as a customer counts for that customer and not for the
  administrator.
- **What it measures.** An open Admin UI asks for notifications every 30
  seconds, so "seen in the last few minutes" means *has the Admin UI open in a
  browser*. It does not say that anybody is looking at it.

## No HTTP routes of its own

`auth` is a primitive module — login/logout/2FA endpoints belong to the
customer-facing `customer_accounts` and admin-facing `admin_users`
modules.

## Extension points

- **Session storage** — `session-service` is constructed with `(em, redis)`;
  alternative caches plug in here.
- **Custom actor kinds** — extend the `request.actor` discriminated union
  and update the `requireX` pre-handlers; existing callers keep working
  because the routes only use the `requireX` factory they already
  consume.
