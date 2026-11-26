---
'@endora-commerce/contracts': minor
---

The Project merge's shapes (issue #1907, `specs/192-organization-merge/` US6):

- New `projects.merge.ts`, exported from the barrel: `PROJECT_MERGE_ERROR_CODES`,
  `PROJECT_MERGE_FIELD_CODES`, the admin bodies and responses (`projectMergePreviewBodySchema`,
  `projectMergeStartBodySchema`, `projectMergeVersionBodySchema`, `projectMergeListQuerySchema`,
  `projectMergeViewSchema`, …), `ProjectMergeStartInput`, `PROJECT_MERGE_EVENTS` with
  `project.merged.v1` (`ProjectMergedEventV1`) and `PROJECT_WEBHOOK_EVENT_TYPES`.
- `ERROR_CODES.PROJECT_MERGED` and `PROJECTS_ERROR_CODES` gain `PROJECT_MERGED`.
- `ProjectReadPort` gains `previewMerge`, `resolveMerged` and `getMerge`; `ProjectRecord` gains
  `mergedIntoProjectId`, `mergedAt` and `mergeId` (`null` on a live Project). A type implementing
  the port or building a record must add them.
- `ProjectDetailSchema` gains the optional `mergedIntoProjectId`, `mergedAt` and `mergeId`.
- `PROJECT_HOOKABLE_ACTIONS.mergeStart` (`projects.project.merge.start`, both phases) with
  `ProjectMergeStartHookData` / `ProjectMergeStartOutbox`.
- `ProjectMergeHostContext` and `projectMergeStageMap`: the loser's Stage → survivor's Stage map the
  Project host writes in its `structure` phase, read by the `tasks` participant.
