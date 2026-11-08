---
'@endora-commerce/mod-mfa': minor
---

Issue #930 — `mfa.admin.totp_enforced` no longer locks administrators out of an instance with no `MFA_SECRET_ENCRYPTION_KEY`, where no second factor can be enrolled.

- Turning the setting on there is refused with `409 MFA_ENFORCEMENT_UNAVAILABLE` (`details.reason: 'encryption_key_missing'`), through `settings`' write-validator registry, so the Settings screen and its API refuse alike. Only a change from off to on is refused: turning it off, and saving `true` again over `true`, are accepted. Sentences in EN and PL (`errors.MFA_ENFORCEMENT_UNAVAILABLE` and `.encryption_key_missing`).
- `MfaPolicyResolver` takes a fourth constructor argument, `canEnrolSecondFactor` (default `true`). When it is `false`, `mfa.admin.totp_enforced` is not applied to administrators. Storefront and organization enforcement are unchanged.
- While the setting is on and the key is missing, its settings read carries `notice: { code: 'encryption_key_missing', … }`, which the Settings screen shows as "Not in force: no encryption key" / "Nie obowiązuje: brak klucza szyfrowania". Every boot logs the same fact at error level.

**Behaviour change on upgrade.** On an instance where the setting is on and the key is not set, administrators without a second factor used to be sent to a setup step that could not be completed, so they could not sign in. They now sign in with their password. The Settings screen marks the setting as not in force, and every boot logs an error until the key is set or the setting is turned off. Instances that have the key are unaffected. See *Enforced two-step verification without an encryption key* in the upgrade guide.
