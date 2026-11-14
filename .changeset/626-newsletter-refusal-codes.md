---
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/contracts': patch
---

The newsletter admin refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #626, part of #86). **A caller that matches on
`VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
Until now each was answered with an English sentence in every language, because the error
envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `PUT /api/v1/admin/newsletter/automations/:id` (automation active) | `422 VALIDATION_FAILED`, *"Pause the automation before editing."* | `422 NEWSLETTER_AUTOMATION_ACTIVE` | `automationId`, `status` |
| `PUT /api/v1/admin/newsletter/campaigns/:id` (not draft or scheduled) | `422 VALIDATION_FAILED`, *"Only draft/scheduled campaigns can be edited."* | `422 NEWSLETTER_CAMPAIGN_NOT_EDITABLE` | `campaignId`, `status` |
| `POST /api/v1/admin/newsletter/campaigns/:id/send` (no sending provider) | `422 VALIDATION_FAILED`, *"No sending provider configured."*, `details.code: "provider_not_configured"` | `422 NEWSLETTER_PROVIDER_NOT_CONFIGURED` | none |
| `POST /api/v1/admin/newsletter/campaigns/:id/cancel` (not draft or scheduled) | `422 VALIDATION_FAILED`, *"Only draft/scheduled campaigns can be cancelled."* | `422 NEWSLETTER_CAMPAIGN_NOT_CANCELLABLE` | `campaignId`, `status` |
| `POST /api/v1/admin/newsletter/custom-fields` (key exists) | `409 VALIDATION_FAILED`, *"Field key already exists."* | `409 NEWSLETTER_CUSTOM_FIELD_KEY_TAKEN` | `key` |
| `POST /api/v1/admin/newsletter/blocks` (code exists) | `409 VALIDATION_FAILED`, *"Block code already exists."* | `409 NEWSLETTER_EMAIL_BLOCK_CODE_TAKEN` | `blockCode` |
| `DELETE /api/v1/admin/newsletter/blocks/:id` (system block) | `422 VALIDATION_FAILED`, *"System blocks cannot be deleted."* | `422 NEWSLETTER_EMAIL_BLOCK_SYSTEM` | `blockId`, `blockCode` |
| `POST /api/v1/admin/newsletter/tags` (code exists) | `409 VALIDATION_FAILED`, *"Tag code already exists."* | `409 NEWSLETTER_TAG_CODE_TAKEN` | `tagCode` |
| `DELETE /api/v1/admin/newsletter/tags/:id` (used by a campaign or automation) | `409 VALIDATION_FAILED`, *"Tag is used by a campaign or automation."*, `details.code: "tag_in_use"` | `409 NEWSLETTER_TAG_IN_USE` | `tagId`, `tagCode` |

The `provider_not_configured` and `tag_in_use` tokens are gone: each was the only reason under its
code. A block's or a tag's own code travels as `blockCode` or `tagCode`, because the envelope reads
`details.code` as a refusal token. The nine codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `newsletter` manifest, and the module's documentation
page lists them. An automation with invalid steps (`automation_invalid`) and a sign-up naming an
unknown sales channel stay `VALIDATION_FAILED`. No setting, permission or migration changes.
