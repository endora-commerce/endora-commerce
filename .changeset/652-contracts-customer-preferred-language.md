---
'@endora-commerce/contracts': minor
---

Customer accounts now carry the language their owner reads (issue #652). Additive.

- `CustomerAccountRecord.preferredLanguage: string | null` — one language tag, spelled as the sales channel that captured it spells it (`pl-PL`, `en-US`); `null` while unknown. Resolve it against the channel a message is rendered for with `scopeLanguageOf(renderChannel, record.preferredLanguage)`: the exact language, else one of the same base language, else that channel's default. A code that builds a `CustomerAccountRecord` by hand (a test fake, an adapter) must now set the field.
- `CustomerAccountCreateInput.preferredLanguage?` and `CustomerAccountStandaloneCreateInput.preferredLanguage?` — the language a new account records; absent or `null` stores none. `CustomerLoginInput.language?` — the sign-in request's language, stored only on an account that has none yet.
- New port contract `CustomerAccountPreferencePort` (container name `customerAccountPreferencePort`, owner `customer_accounts`): `setPreferredLanguage(customerAccountId, tag)` stores the account holder's choice and returns the record; `captureIfUnset(customerAccountId, tag)` writes only while the account has no language. `CustomerPreferredLanguageSource` names the two sources (`'self_service' | 'sign_in'`).
- `customerSelfProfileSchema` and `adminCustomerDetailSchema` gain a required, nullable `preferredLanguage`; `customerAccountSchema` gains an optional, nullable one (answered by `GET /api/v1/me`).
- New request and response schemas `patchCustomerPreferredLanguageBodySchema` (`{ preferredLanguage }`: a trimmed language tag of at most `CUSTOMER_PREFERRED_LANGUAGE_MAX_LENGTH` = 35 characters, not nullable) and `patchCustomerPreferredLanguageResponseSchema`, for `PATCH /api/v1/me/customer/preferred-language`.
- New error code `ERROR_CODES.PREFERRED_LANGUAGE_NOT_OFFERED` (422), owned by `customers`.
