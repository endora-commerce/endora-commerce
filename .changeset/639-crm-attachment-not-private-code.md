---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': patch
---

Attaching a library file that is not private to an Opportunity has an error code of its own instead
of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #639, part of #86). **A caller
that matches on `VALIDATION_FAILED` for this refusal now sees `CRM_ATTACHMENT_NOT_PRIVATE`.** The
HTTP status is unchanged. Until now it was answered with an English sentence in every language,
because the error envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/attachments` | `422 VALIDATION_FAILED`, *"An attachment must be a private file. Upload it to the media library as private."* | `422 CRM_ATTACHMENT_NOT_PRIVATE` | `assetId`, `visibility` |

The code is named in parallel with `projects`' `PROJECT_ATTACHMENT_NOT_PRIVATE` (issue #634), as
`CRM_ATTACHMENT_TOO_LARGE` and `PROJECT_ATTACHMENT_TOO_LARGE` are. A file that is not in the media
library, or that the caller may not see, stays `422 VALIDATION_FAILED`, and so does an Event reminder
set in the past (`details.rule: 'reminder_in_past'`), which the event form words from its rule. The
code is a member of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `crm` manifest, and
the module's documentation page names it. No setting, permission or migration changes.
