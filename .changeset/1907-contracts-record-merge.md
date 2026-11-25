---
'@endora-commerce/contracts': minor
---

Record merge vocabulary and the Organization merge shapes (issue #1907, `specs/192-organization-merge/`).

- New `record-merge.ts`: the host types, phases, merge and step states, dispositions
  (`MERGE_DISPOSITIONS`, `mergeDispositionMoves`), `RECORD_MERGE_ERROR_CODES`, the queue and channel
  names, `recordMergeScopeReason` / `mergeIdOfScopeReason`, the manifest `merge` schema
  (`moduleMergeDeclarationSchema`), the participant contract (`MergeParticipant`, `MergeStepInput`,
  `MergeParticipantPreview`, `MergeHostImplementation`, `HostMergePreview`), the served shapes
  (`recordMergePreviewSchema`, `recordMergeRecordSchema`), and the coverage analysis
  `analyseMergeCoverage` with its population rule `isHostReferenceProperty`.
- `ModuleManifest` gains an optional `merge` block (`hosts`, `participates`). Existing manifests are
  unaffected.
- New `organizations.merge.ts`: `ORGANIZATION_MERGE_FIELD_CODES`, the admin bodies and responses
  (`organizationMergePreviewBodySchema`, `organizationMergeStartBodySchema`,
  `organizationMergeVersionBodySchema`, `organizationMergeListQuerySchema`, …),
  `OrganizationMergeStartInput`, `OrganizationMergeHostContext` / `organizationMergeRoleMap`, the
  event `ORGANIZATION_MERGE_EVENTS.MERGED` (`organization.merged.v1`, `OrganizationMergedEventV1`) and
  `ORGANIZATION_WEBHOOK_EVENT_TYPES`.
- `OrganizationDetailsPort` gains `previewMerge`, `resolveMerged` and `getMerge`. A consumer that
  implements the interface itself (a test double) adds the three methods.
- `OrganizationRecord` and `adminOrganizationSchema` gain optional `mergedIntoOrganizationId`,
  `mergedAt` and `mergeId`.
- `ORGANIZATION_HOOKABLE_ACTIONS.mergeStart` (`organization.merge.start`, both phases) with
  `OrganizationMergeStartHookData` / `OrganizationMergeStartOutbox`.
- `MERGE_CONFLICT_UNRESOLVABLE` — the conflict `resolution` that refuses a start (FR-026).
- `ERROR_CODES` gains the ten `RECORD_MERGE_*` codes and `ORGANIZATION_MERGE_PERSONAL`,
  `ORGANIZATION_MERGE_TREE_INVALID` and `ORGANIZATION_MERGED`.
