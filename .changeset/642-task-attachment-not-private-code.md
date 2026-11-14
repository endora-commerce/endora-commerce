---
'@endora-commerce/mod-tasks': minor
'@endora-commerce/contracts': patch
---

Attaching a library file that is not private to a Task is refused under the module's own
attachment code instead of `VALIDATION_FAILED`, with a sentence in English and Polish (issue #642,
part of #86). **A caller that matches on `VALIDATION_FAILED` for this refusal now sees
`TASK_ATTACHMENT_REFUSED`.** The HTTP status is unchanged. Until now it was answered with an English
sentence in every language, because the error envelope never replaces the message of
`VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/tasks/:id/attachments` | `422 VALIDATION_FAILED`, *"An attachment must be a private file. Upload it to the media library as private."* | `422 TASK_ATTACHMENT_REFUSED` | `code: 'not_private'`, `reason: 'not_private'`, `assetId`, `visibility` |

`not_private` is a new refusal token of the existing `TASK_ATTACHMENT_REFUSED`, declared in the
`tasks` manifest's `tokens`, so a caller already handling that code (`413` too large, `415` active
content) handles this one too. A file that is not in the media library, or that the caller may not
see, stays `422 VALIDATION_FAILED`, as does relating a Task to itself (`400`). The module's
documentation page names the refusal. No setting, permission or migration changes.
