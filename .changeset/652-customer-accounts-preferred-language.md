---
'@endora-commerce/mod-customer-accounts': minor
---

A customer account records the language its owner reads (issue #652). New column `customer_accounts.preferred_language` (`varchar(35)`, nullable, not backfilled); run your migrations.

- **Captured at creation** from the creating request's `Accept-Language` header, resolved against the request's sales channel by `requestScopeLanguage` (q-weighted) — business and individual registration, invitation accept and a first federated sign-in. An operator's direct create records none.
- **Filled at sign-in while unknown.** A password sign-in stores the request's language once the password, the block and the store access have been accepted, before any second factor; it never replaces a language the account already has, and a failed capture is logged without failing the sign-in. A refused sign-in and an impersonation store nothing.
- **New port `customerAccountPreferencePort`** (`CustomerAccountPreferencePort`): `setPreferredLanguage` for the account holder's own choice and `captureIfUnset` for a sign-in. Both run the new `customer_account.set_preferred_language` Command, whose audit entry is `{ changedFields: ['preferredLanguage'], source }` and never contains the language. A write that changes nothing writes no audit entry.
- `customerSocialLoginPort.autoCreate` accepts `context.preferredLanguage`.
- The anonymisation sweep erases the language. An account anonymised earlier that still holds one is listed as due and finished by the next sweep, without a second announcement.
