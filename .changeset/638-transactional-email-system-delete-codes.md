---
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/contracts': patch
---

Deleting a system email block or a system email template is refused with an error code of its own
instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #638, part of #86). **A
caller that matches on `VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP
status is unchanged. Until now each was answered with an English sentence in every language,
because the error envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `DELETE /api/v1/admin/transactional-emails/blocks/:id` | `409 VALIDATION_FAILED`, *"System blocks cannot be deleted."* | `409 TRANSACTIONAL_EMAIL_SYSTEM_BLOCK` | `blockId`, `blockCode` |
| `DELETE /api/v1/admin/transactional-emails/templates/:id` | `409 VALIDATION_FAILED`, *"System templates cannot be deleted."* | `409 TRANSACTIONAL_EMAIL_SYSTEM_TEMPLATE` | `templateId`, `templateCode` |

The row's own code travels as `blockCode` / `templateCode` rather than `code`, because the error
envelope reads `details.code` as a refusal token. Both codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `transactional_emails` manifest, and the module's
documentation page names them. No setting, permission or migration changes.
