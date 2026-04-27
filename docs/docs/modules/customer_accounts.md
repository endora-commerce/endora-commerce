---
title: customer_accounts
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
| `POST /api/v1/me/2fa/enable` | Enroll TOTP, returns OTP secret + backup codes |
| `POST /api/v1/me/2fa/confirm` | Activate after first valid TOTP |
| `DELETE /api/v1/me/2fa` | Disable 2FA |

## Entities

`CustomerAccount` (email, passwordHash, role, twoFactorState),
`PasswordResetToken`. Role is enum `organization_admin | regular_user`.

## Extension points

- **Password policy** — `password-hasher.ts` wraps argon2id; tune cost
  parameters there.
- **Backup codes** — `totp-service.ts` generates one-time backup codes at
  enrollment; add rotation/regeneration here.
- **Login throttling** — relies on Fastify `@fastify/rate-limit` at server
  level; per-account lockout would be added here.
