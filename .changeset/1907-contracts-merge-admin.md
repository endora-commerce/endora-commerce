---
'@endora-commerce/contracts': minor
---

Organization merge, admin stage (issue #1907, `specs/192-organization-merge/`).

- `organizationMergeViewSchema` / `OrganizationMergeView`: a merge as the admin routes answer it —
  `RecordMergeRecord` plus `survivorName`, `loserName` and `actorName` (each `string | null`).
  `organizationMergeRecordResponseSchema` and `organizationMergeListResponseSchema` now carry it;
  the fields are additive.
- `MergeHostImplementation.onStateChanged?(change)` with the new `RecordMergeStateChange`
  (`mergeId`, `hostType`, `survivorId`, `loserId`, `state`): optional; the platform's runner calls
  it after a merge stops in `needs_attention` or completes, so the host can tell people.
