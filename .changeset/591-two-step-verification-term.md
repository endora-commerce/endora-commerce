---
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/admin-kit': patch
'@endora-commerce/contracts': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-auth': patch
'@endora-commerce/mod-customer-accounts': patch
---

Multi-factor sign-in is now called **two-step verification** (Polish: **weryfikacja dwuetapowa**) in every user-facing string, replacing "two-factor authentication", "uwierzytelnianie dwuskładnikowe" and bare "2FA". Identifiers, permission codes (`mfa:reset`, `mfa:manage`), setting keys (`mfa.admin.totp_enforced` and its siblings), setting names and error codes are unchanged.

- `@endora-commerce/mod-mfa`: the English and Polish error sentences, permission labels, the Admin UI account-security screen, the manifest's module, setting and permission descriptions, and the federated sign-in refusal sentence. The `open-security` palette action also matches "two-step verification" / "weryfikacja dwuetapowa"; "two-factor", "2fa" and "dwuskładnikowe" still match.
- `@endora-commerce/mod-i18n`: `adminRoles.field.requires2fa`, `adminUsers.column.twoFactor` and `organizations.detail.twoFactor`.
- `@endora-commerce/mod-customers`: the reset actions on the customer list and detail screens.
- `@endora-commerce/admin-kit`: the sentence shown when an administrator's password sign-in needs a second-step setup.
- `@endora-commerce/contracts`: the validation message of the MFA disable request body.
- `@endora-commerce/mod-admin-users`, `mod-admin-roles`, `mod-auth`, `mod-customer-accounts`: module documentation pages.
