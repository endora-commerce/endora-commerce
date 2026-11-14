---
'@endora-commerce/mod-projects': minor
'@endora-commerce/contracts': patch
---

Three `projects` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #634, part of #86). **A caller that matches on
`VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
Until now each was answered with an English sentence in every language, because the error envelope
never replaces the message of `VALIDATION_FAILED`, and the stage maximum was written into that text.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/projects/:id/stages` | `422 VALIDATION_FAILED`, *"A project has at most 50 stages."* | `422 PROJECT_STAGE_LIMIT` | `projectId`, `maximum` |
| `POST /api/v1/admin/projects/:id/attachments` | `422 VALIDATION_FAILED`, *"An attachment must be a private file. Upload it to the media library as private."* | `422 PROJECT_ATTACHMENT_NOT_PRIVATE` | `assetId`, `visibility` |
| `POST /api/v1/admin/projects/templates`, `PUT /api/v1/admin/projects/templates/:id` | `422 VALIDATION_FAILED`, *"An archived project role is not added to a template."* | `422 PROJECT_TEMPLATE_ROLE_ARCHIVED` | `roleId` |

A project created with no stages, a file that is not in the media library and a template role that
is not a project role stay `422 VALIDATION_FAILED`. The three codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `projects` manifest, and the module's documentation
page names them. No setting, permission or migration changes.
