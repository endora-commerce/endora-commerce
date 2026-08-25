# MFA module (feature 042)

Two-factor authentication (TOTP + recovery codes) and federated sign-in
(Google / Microsoft) for both the Storefront (customer accounts) and the
Admin UI (admin users).

See `specs/042-mfa-authentication/` for the full spec, plan, data model, and
contracts.

## Status

Complete (US1–US6). Capabilities:

- **TOTP 2FA** (enrol / activate / disable / regenerate / status) on both
  surfaces, with single-use recovery codes and a replay-guarded second step.
- **Two-step login** — credential step returns `authenticated` |
  `mfaRequired` | `mfaSetupRequired`; a separate verify step issues the session.
- **Enforcement** — per-scope settings (admin global; storefront global/channel)
  and per-organization policy (org-admin + platform-admin); enforced-but-
  unenrolled accounts enrol via a setup ticket at login.
- **Federated sign-in** — Google / Microsoft (OIDC via `openid-client`);
  storefront auto-creates a standalone account, admin matches existing only.
- **Admin reset** — single account + organization-wide.

Self-service setup is gated on the per-scope "2FA enabled" setting (FR-001).

## Routes (by file)

- `routes.public.ts` — second-step verify + setup-ticket begin/complete (both surfaces)
- `routes.self-service.ts` — `/{account,admin/account}/mfa/*` (setup/activate/disable/regenerate/status)
- `routes.oauth.ts` — `/auth/{customer,admin}/oauth/:provider/{start,callback}`
- `routes.org.ts` — storefront org-admin enforcement
- `routes.admin.ts` — platform-admin reset (single/bulk) + org enforcement

## Notable decisions

- **TOTP**: reuses the existing `otpauth` dependency (no new dep). New
  dependency `openid-client` is for Google/Microsoft OIDC (research §R2).
- **Secret at rest**: AES-256-GCM (`SecretCipher`), key from
  `MFA_SECRET_ENCRYPTION_KEY` (base64, 32 bytes). Recovery codes are stored as
  SHA-256 hashes only.
- **Ephemeral login state**: Redis (`ChallengeStore`) — pending-login
  challenge, setup ticket, OAuth transaction — all TTL-bounded.
- **Module name `mfa`**: a singular acronym; a documented Principle VI
  carve-out (see plan Complexity Tracking).
- **Removability** (Principle I): login services consult MFA through an
  injected port; absent ⇒ password-only fallback. The legacy
  `*.two_factor_secret` columns are superseded by `mfa_enrolments` and left
  dormant (research §R8) — dropping them is tracked tech-debt.

## Environment

| Var | Purpose |
|---|---|
| `MFA_SECRET_ENCRYPTION_KEY` | base64-encoded 32-byte AES key for TOTP secrets |
| `MFA_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | Google OIDC client |
| `MFA_OAUTH_MICROSOFT_CLIENT_ID` / `_SECRET` | Microsoft Entra OIDC client |
| `MFA_OAUTH_*_REDIRECT_URI` | per-surface callback URLs |
