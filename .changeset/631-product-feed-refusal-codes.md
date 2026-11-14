---
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/contracts': patch
---

The feed form's three state refusals have error codes of their own instead of `VALIDATION_FAILED`,
and a sentence in English and Polish (issue #631, part of #86). **A caller that matches on
`VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
Until now each was answered with an English `field: message` text in every language, because the
error envelope never replaces the message of `VALIDATION_FAILED`, and the allowed currencies were
written into that text.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/product-feeds`, `PATCH /api/v1/admin/product-feeds/:id` | `400 VALIDATION_FAILED`, *"languageCode: is not an active language on this installation"* (the language exists but is switched off) | `400 PRODUCT_FEED_LANGUAGE_INACTIVE` | `field: "languageCode"`, `languageCode` |
| `POST /api/v1/admin/product-feeds`, `PATCH /api/v1/admin/product-feeds/:id` | `400 VALIDATION_FAILED`, *"currencyCode: is not offered by this sales channel (…)"* | `400 PRODUCT_FEED_CURRENCY_NOT_OFFERED` | `field: "currencyCode"`, `currencyCode`, `salesChannelId`, `allowed` (comma-joined string) |
| `POST /api/v1/admin/product-feeds`, `PATCH /api/v1/admin/product-feeds/:id`, `POST /api/v1/admin/product-feeds/:id/duplicate` | `400 VALIDATION_FAILED`, *"slug: is already used by another feed"* | `400 PRODUCT_FEED_SLUG_TAKEN` | `field: "slug"`, `slug` |

A language code that names no language at all stays `400 VALIDATION_FAILED` with
`details.field: "languageCode"`; its message is now *"languageCode: no such language"*. A refused
HTTP delivery URL also stays `VALIDATION_FAILED` with `details.reason: "delivery_target_refused"`.
The three codes are members of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the
`product_feeds` manifest, and the module's documentation page names them. No setting, permission or
migration changes.
