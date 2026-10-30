---
'@endora-commerce/mod-organizations': patch
---

The customer-safe moderation sentences are answered in the request's language.
`GET /api/v1/me`'s `organization.moderationMessage` and the 423 `reason` of
`POST /api/v1/storefront/checkout/preflight` were Polish whatever the request; they are now
written in the language the response is answered in (`request.responseLanguage()`: the
`Accept-Language` the storefront sends, else the sales channel's default language) from the
module's bundle, English when the bundle cannot answer. A Polish request receives the same
sentences as before. New bundle keys: `moderation.account.*`, `moderation.checkout.*`.
`organizationsModule()` takes an optional `translate`.
