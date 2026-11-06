---
'@endora-commerce/mod-forms': patch
'@endora-commerce/contracts': patch
---

`GET /api/v1/storefront/forms/:formId` answers a malformed id (one that is not a UUID) with `200 { formId, availability: 'unavailable' }`, the body an unknown id gets, instead of `400 VALIDATION_FAILED` (owner ruling of 2026-11-05, issue #781), so the read no longer tells a malformed id from a form that does not exist. `formId` echoes the requested value. To match, the `unavailable` arm of `publicFormDefinitionSchema` in `@endora-commerce/contracts` types `formId` as a non-empty string rather than a UUID; the available arm still requires a UUID. `POST /api/v1/storefront/forms/:formId/entries` still answers a malformed id `400`.
