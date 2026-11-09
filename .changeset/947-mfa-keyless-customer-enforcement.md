---
'@endora-commerce/mod-mfa': minor
---

Issue #947 — the customer two-step requirements, `mfa.storefront.totp_enforced` and an organization's policy, follow #930's rules on an instance with no `MFA_SECRET_ENCRYPTION_KEY`, where no second factor can be enrolled.

- Turning `mfa.storefront.totp_enforced` on there, for every sales channel or for some, is refused with `409 MFA_ENFORCEMENT_UNAVAILABLE` (`details.reason: 'encryption_key_missing'`, `details.code: 'customer_encryption_key_missing'`), through `settings`' write-validator registry. A write of `true` is accepted only where the value was already `true` at every scope it targets; turning it off is always accepted.
- An organization's policy refuses the same off → on write in `MfaOrgPolicyService`, so `PUT /api/v1/account/organization/mfa-policy` and `POST /api/v1/admin/organizations/:organizationId/mfa-policy` refuse alike. Lifting a policy, and writing `true` over `true`, are accepted. Both routes are now registered without the key too; before, they answered 404 there, so a policy set while the key was configured could not be lifted. `MfaOrgPolicyService` takes a third constructor argument, `canEnrolSecondFactor` (default `true`); `routes.admin.ts` gains `registerMfaAdminOrgPolicyRoutes`, and `MfaAdminDeps` no longer carries `orgPolicyService`.
- `MfaPolicyResolver` applies its `canEnrolSecondFactor` argument to customers as well: without the key neither the storefront setting nor an organization's policy is applied. Sign-in already asked no second factor of anybody there (#948).
- While the setting's platform-wide value is on and the key is missing, its settings read carries `notice: { code: 'encryption_key_missing', … }`, shown as "Not in force: no encryption key" / "Nie obowiązuje: brak klucza szyfrowania". Every boot logs, at error level, the setting (with the sales channels it is on for) and the number of organizations whose policy requires a second factor.
- New sentences in EN and PL: `errors.MFA_ENFORCEMENT_UNAVAILABLE.customer_encryption_key_missing` and `settingLabels.mfa.storefront.totp_enforced.notice.encryption_key_missing`.

**Behaviour change on upgrade.** On an instance without the key, turning the storefront setting or an organization's policy on is now refused, and both organization-policy routes exist where they used to answer 404. Customers already signed in on the password there (#948), so nobody's sign-in changes. Instances that have the key are unaffected. See *Enforced two-step verification without an encryption key* in the upgrade guide.
