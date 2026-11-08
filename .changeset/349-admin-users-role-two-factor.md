---
'@endora-commerce/mod-admin-users': minor
---

Issue #349 — the role editor's "Requires two-step verification on assigned users" checkbox now changes sign-in (enforced by `mfa`), and this module hosts the writes that make it start binding somebody:

- `PUT /api/v1/admin/admin-roles/:code` refuses to turn `requiresTwoFactor` on with 409 `MFA_REQUIRED_FOR_ROLE_TWO_FACTOR` while `mfa` is off (`details.reason: 'mfa_off'`) or has no encryption key (`'encryption_key_missing'`); turning it off is always allowed. After a save that turns it on, the holders with no enrolled second factor are signed out, the acting administrator's own session excepted, and the answer carries `signedOutAdministrators`.
- Giving an administrator with no enrolled second factor a role that requires one signs them out.
- New `GET /api/v1/admin/admin-roles/:code/two-factor-impact` answers `{ unprotectedAdministrators }` (`null` while `mfa` is off), which the Roles screen shows as a confirmation before saving.
- The Roles screen disables the checkbox while `mfa` is absent, and explains the requirement when it is present (EN and PL).
- New non-binding `degrades-without` edge on `mfaAdminEnforcementPort`; the `mfaLoginPort` entry now says role requirements are not applied while `mfa` is off.
