---
'@endora-commerce/mod-organizations': minor
---

Organizations can be merged (issue #1907, `specs/192-organization-merge/`): this module hosts the
`organization` record type in the platform's merge mechanism.

- New admin routes under the new permission `organizations:merge` (not granted to the predefined
  sales-representative role): `POST /api/v1/admin/organizations/:id/merge-preview`,
  `POST /api/v1/admin/organizations/:id/merges`, `GET /api/v1/admin/organization-merges`,
  `GET /api/v1/admin/organization-merges/:mergeId`, and `…/:mergeId/resume` and `…/:mergeId/cancel`.
  The actor must reach both Organizations.
- New audited, irreversible Commands `organization.merge.start` (hookable), `.cancel`, `.resume`,
  `.structure` and `.finalize`; every entry carries the merge id, and field choices are recorded as
  codes only.
- `organizationDetailsPort` gains `previewMerge`, `resolveMerged` and `getMerge`.
- A merged Organization is archived (soft-deleted, with `merged_into_organization_id`, `merged_at`
  and `merge_id`); its detail still answers with the survivor's id, and a write naming it is
  refused with `409 ORGANIZATION_MERGED`. A migration adds the columns and relaxes the company
  tax-ID presence check for merged rows only.
- `organization.merged.v1` is published once per merge and offered as a webhook event type.
- An Organization merged into the loser earlier is re-pointed to the survivor at finalize, so a
  pointer is never more than one hop. The conversion to a company asks the freeze before it writes
  its roles.
- Until every module holding an Organization reference declares its participation, a start is
  refused with `409 RECORD_MERGE_PARTICIPATION_INCOMPLETE`; the preview works.
