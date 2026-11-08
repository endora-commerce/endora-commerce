---
'@endora-commerce/mod-mfa': minor
---

Issue #930 — `mfa.admin.totp_enforced` no longer locks administrators out of an instance with no `MFA_SECRET_ENCRYPTION_KEY`, where no second factor can be enrolled.

- The setting's write refuses to turn it on there with `409 MFA_ENFORCEMENT_UNAVAILABLE` (`details.reason: 'encryption_key_missing'`), through `settings`' write-validator registry, so the Settings screen and its API refuse alike. Turning it off is always allowed. Sentences in EN and PL (`errors.MFA_ENFORCEMENT_UNAVAILABLE`, `.encryption_key_missing`).
- `MfaPolicyResolver` takes a fourth constructor argument, `canEnrolSecondFactor` (default `true`). When it is `false`, `mfa.admin.totp_enforced` is not applied to administrators. Storefront and organization enforcement are unchanged.
- When the setting is on and the key is missing, a warning is logged at every boot.

**Behaviour change on upgrade.** On an instance where the setting is on and the key is not set, administrators without a second factor used to be sent to a setup step that could not be completed, so they could not sign in. They now sign in with their password, and every boot logs a warning until the key is set or the setting is turned off. Instances that have the key are unaffected. See *Enforced two-step verification without an encryption key* in the upgrade guide.
