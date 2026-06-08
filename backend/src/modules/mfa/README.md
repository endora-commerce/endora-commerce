# MFA module (feature 042)

Two-factor authentication (TOTP + recovery codes) and federated sign-in
(Google / Microsoft) for both the Storefront (customer accounts) and the
Admin UI (admin users).

See `specs/042-mfa-authentication/` for the full spec, plan, data model, and
contracts.

## Status

Incremental implementation. **Phase 1 (Setup) + the additive parts of
Phase 2 (Foundational)** are in place: tables, entities, contracts, settings
manifest, permissions, and the pure services (`SecretCipher`, `ChallengeStore`).
The breaking two-step login refactor and the per-surface routes/services land
together with the US1 frontend changes (see `tasks.md`).

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
