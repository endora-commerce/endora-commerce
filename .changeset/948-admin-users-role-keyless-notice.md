---
'@endora-commerce/mod-admin-users': minor
---

Issue #948 (owner ruling Q6) — without `mfa`'s encryption key a role's **Requires two-step verification** is not applied, and the Roles screen now says so. `GET /api/v1/admin/admin-roles` and the role write's response carry `twoFactorNotice: { code: 'encryption_key_missing', message }` on a role that sets the flag. The screen shows it under the checkbox as "Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY)." / "Nie obowiązuje: brak klucza szyfrowania (MFA_SECRET_ENCRYPTION_KEY).", like the Settings screen does for `mfa.admin.totp_enforced`. Ticking the box without the key is still refused (`409 MFA_REQUIRED_FOR_ROLE_TWO_FACTOR`, `details.reason: 'encryption_key_missing'`).
