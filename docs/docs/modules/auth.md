---
title: auth
---

# `auth`

Shared session, password-hashing, and TOTP primitives consumed by both
`customer_accounts` and `admin_users`. One of the two singular module
folders permitted by Principle VI (alongside `example`).

## What it owns

- **Sessions** — `session-service.ts` persists session rows in Postgres
  with a Redis cache layer for hot reads; cookies signed via
  `@fastify/cookie`.
- **Password hashing** — `password-hasher.ts` wraps argon2id; defaults are
  tuned for the target hardware (see the **Hardware & system requirements**
  section of `README.md` at the repository root).
- **TOTP** — `totp-service.ts` wraps `otpauth` + a backup-code pool.
- **Fastify plugin** — `plugin.ts` parses the session cookie and attaches
  `request.actor = { kind, id, ... }`; exposes `requireCustomer`,
  `requireAdmin(permission?)`, `requireApiKey(scope)` pre-handlers.

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
