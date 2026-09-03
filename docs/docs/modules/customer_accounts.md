---
title: customer_accounts
description: Customer login, password reset, 2FA, role assignment
---

# `customer_accounts`

Per-user state for Customers: login, password management, optional 2FA,
role within their Organization. Backed by the shared `auth` session
service; this module owns the customer-facing identity surface.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` | Email + password (+ TOTP step if 2FA enabled) |
| `POST /api/v1/auth/logout` | Destroy session |
| `POST /api/v1/me/password` | Change password (rejects wrong `currentPassword`) |
| `POST /api/v1/auth/password-reset/request` | Begin reset flow |
| `POST /api/v1/auth/password-reset/confirm` | Redeem reset token |

## Entities

`CustomerAccount` (email, passwordHash, role), `PasswordResetToken`. Role is
enum `organization_admin | regular_user`.

## Extension points

- **Password policy** — `password-hasher.ts` wraps argon2id; tune cost
  parameters there.
- **Backup codes and second factors** — not this module's. Customer and admin
  2FA is the `mfa` module's, over `mfa_enrolments`, served at
  `/api/v1/account/mfa/*`; recovery codes are single-use rows there. The
  superseded scaffolding this bullet used to point at
  (`totp-enrolment-service.ts`) was deleted on 2026-08-25 — it could never
  complete a single enrolment.
- **Login throttling** — relies on Fastify `@fastify/rate-limit` at server
  level; per-account lockout would be added here.
