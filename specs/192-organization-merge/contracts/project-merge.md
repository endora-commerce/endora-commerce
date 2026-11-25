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
}
```

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
