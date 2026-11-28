# Contract: Project merge (`projects`, MR-G)

Owner: `projects` (**deactivatable**). It is the host of `project`. Everything here is absent while
`projects` is off (FR-072): routes answer 503 `MODULE_DISABLED` at the registration seam, and there is
no palette action, button or port behaviour. **Blocked by #1828** (`projectCommandPort`, which these
methods extend) and **#1829** (`taskCommandPort.moveContext` for the `tasks` participant).

## 1. Ports

`projectReadPort` (additive): `previewMerge(survivorId, { loserId })`, `resolveMerged(id)`,
`getMerge(mergeId)`. `ProjectRecord` gains `mergedIntoProjectId`, `mergedAt` and `mergeId`.

`projectCommandPort` (#1828, additive):

```ts
startMerge(survivorId: string, input: ProjectMergeStartInput, options?: AggregateCommandOptions): Promise<ProjectMergeRecord>;
resumeMerge(mergeId: string, options?: AggregateCommandOptions): Promise<ProjectMergeRecord>;
cancelMerge(mergeId: string, options?: AggregateCommandOptions): Promise<ProjectMergeRecord>;
/** Organization-merge participation (MR-D5), published for server code: */
replaceOrganization(id: string, input: { fromOrganizationId: string; toOrganizationId: string }, options?: AggregateCommandOptions): Promise<ProjectRecord>;

export interface ProjectMergeStartInput {
  loserId: string;
  fieldChoices?: Partial<Record<'title' | 'description' | 'valueAmount' | 'startOn' | 'visibility', 'survivor' | 'loser'>>;
  customFieldChoices?: Readonly<Record<string, 'survivor' | 'loser'>>;
  acknowledgeIrreversible: true;
  /** FR-090 (option C): every Organization the preview lists as gaining access, confirmed. */
  acknowledgedOrganizationIds?: readonly string[];
}
```

The preview adds `organizationsGainingAccess: { id, name }[]` — the loser's Organizations the
survivor does not have. The start Command reads them again under its lock and refuses `422
PROJECT_MERGE_ORGANIZATION_ACCESS_UNCONFIRMED` (`details.organizationIds`) for any not confirmed;
its audit entry records `organizationsGainingAccess` (ids).

`taskCommandPort` (#1829, additive):
`moveContext({ contextType, fromContextId, toContextId, clearGroup: true }, { limit, mergeId }, options?) → { moved }`.

## 2. Commands

| Action | What it does |
| --- | --- |
| `projects.project.merge.start` (hookable) | refusals (same, already merged or locked, not visible or editable to the actor → 404), `begin` |
| `projects.project.merge.cancel` / `.resume` | as for Organizations |
| `projects.project.merge.structure` | Organizations, members, viewers union (survivor's member role on conflict) |
| `projects.project.merge_reassign` | comments, attachments, links, references; read markers carried (FR-094) |
| `projects.project.merge.finalize` | chosen values through `projects.project.update` and `projects.project.custom_fields_update`; pointer; `project.merged.v1`; search |

The survivor's `state`, `currentStageId`, stages and template are never offered for choice.

## 3. Admin API

The routes mirror the Organization ones under `/api/v1/admin/projects/:id/merge-preview`,
`/api/v1/admin/projects/:id/merges` and `/api/v1/admin/project-merges/...`, with permission
`projects:merge` plus visibility and edit of both.

## 4. Admin surfaces

The flow is reached from the Project screen and the palette action `merge-projects`. The archived
project banner links to the survivor. Mentions of the loser render as the survivor through
`resolveMerged` in the record-reference renderer.

## 5. Tests

- `packages/modules/projects/src/backend/commands/merge-*.command.test.ts`;
- the `tasks` and `crm` participant conformance tests;
- `backend/test/integration/projects/project-merge.e2e.test.ts` (US6 scenarios);
- the off-state test (`check:off-state-coverage`).

## 6. As implemented (MR-G, #1907)

Owner decision (2026-11-25): Project merge ships in the #1907 PR without waiting for the aggregate
ports. What differs from the sections above:

- **Ports.** `projectReadPort.previewMerge / resolveMerged / getMerge` are published;
  `previewMerge` refuses `404 PROJECT_NOT_FOUND` unless the caller sees both Projects, and `getMerge`
  answers `null` for a merge one of whose Projects the caller does not see. `ProjectRecord` carries
  `mergedIntoProjectId`, `mergedAt`, `mergeId`. **Not published:** `projectCommandPort.startMerge /
  resumeMerge / cancelMerge` and `replaceOrganization` (follow-ups of #1828) and
  `taskCommandPort.moveContext` (follow-up of #1829); `ProjectMergeService` and
  `task.merge_move_context` are what they will call.
- **Finalize** applies the chosen values in its own Command (`projects.project.merge.finalize`)
  rather than through `projects.project.update` and `projects.project.custom_fields_update`: one
  audited entry carrying the merge id, as the Organization host does. It still validates custom
  fields through `custom_fields`, records title, value and custom-field values in the Project's own
  value store (`valueChangeId`), re-derives the description's references when the description is
  taken from the loser, and moves the survivor's `version`.
- **Structure** is a union that leaves the loser its own rows (`participant-dispositions.md` §E).
- **Admin API.** Besides `projects:merge`, every route asks the actor to hold `projects:write`
  (edit of both, FR-050). The palette gains `open-project-merges` (`/projects/merges`) beside
  `merge-projects` (`/projects/merge`); the progress view is `/projects/merges/:mergeId`.
- **Admin notifications** (`events-and-webhooks.md` §3) are the host's `onStateChanged`:
  `needs_attention` tells holders of `projects:merge` who see both Projects, completion tells the
  starter.
- **Mentions** resolve to the survivor in all three renderers of `[[project:<id>]]`: `projects`'
  own reference service (`ProjectAccess.mergedInto`), `crm`'s and `tasks`' (through
  `projectReadPort.resolveMerged`).
