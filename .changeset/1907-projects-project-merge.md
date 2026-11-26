---
'@endora-commerce/mod-projects': minor
---

Projects can be merged (issue #1907, `specs/192-organization-merge/` US6): this module hosts the
`project` record type in the platform's merge mechanism.

- New admin routes under the new permission `projects:merge` (granted to no predefined role):
  `POST /api/v1/admin/projects/:id/merge-preview`, `POST /api/v1/admin/projects/:id/merges`,
  `GET /api/v1/admin/project-merges`, `GET /api/v1/admin/project-merges/:mergeId`, and
  `…/:mergeId/resume` and `…/:mergeId/cancel`. The actor must see both Projects and hold
  `projects:write`.
- New audited, irreversible Commands `projects.project.merge.start` (hookable), `.cancel`,
  `.resume`, `.structure` (Organizations, Members and viewers unioned, the survivor's role kept)
  and `.finalize` (chosen values, archive pointer, event), and `projects.project.merge_reassign`
  (links, comments, attachments, references and read markers move to the survivor). Every entry
  carries the merge id and no value.
- A migration adds `merged_into_project_id`, `merged_at` and `merge_id` to `projects`. A merged
  Project is kept, read-only, with its own Stage history: it leaves every list, count, search,
  picker, analytics figure and deadline-alert sweep; its detail and `projectReadPort.findById`
  answer it with the survivor's id; a write naming it is refused `409 PROJECT_MERGED`, and one
  naming a Project being merged away `409 RECORD_MERGE_IN_PROGRESS`. No Task can be added to it.
- `projectReadPort` gains `previewMerge`, `resolveMerged` and `getMerge`. A mention of a merged
  Project in a Project's text renders as its survivor.
- `project.merged.v1` is published once per merge and offered as a webhook event type
  (`contributes-to` `webhooks`).
- Admin: *Merge a duplicate…* on the Project screen and the `merge-projects` palette action (choose,
  preview, choose values, confirm), the merge's progress at `/projects/merges/:mergeId` with Resume
  and Cancel, the merges list at `/projects/merges` (`open-project-merges`), the archived Project's
  banner leading to its survivor, EN and PL.

Its `structure` phase writes the Stage map into the merge's host context first: each of the loser's
Stages → the survivor's Stage of the same name, else the survivor's current Stage.
