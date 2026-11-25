# Contract: Organization merge (`organizations`)

Owner: `organizations` (non-deactivatable). The host of `organization` in the merge mechanism.

## 1. Ports

### 1.1 `organizationDetailsPort` (read, existing): additive

```ts
/** Aggregated preview (host refusals, field diff, every present participant). No write. */
previewMerge(survivorId: string, input: { loserId: string }): Promise<OrganizationMergePreview>;
/** The survivor's id when `id` was merged, else `id`. One hop by construction (a loser is never merged again). */
resolveMerged(id: string): Promise<string>;
getMerge(mergeId: string): Promise<OrganizationMergeRecord | null>;
```

`findById` keeps returning an archived loser, with `mergedIntoOrganizationId`, `mergedAt` and
`mergeId` added to `OrganizationRecord` (additive).

### 1.2 `organizationCommandPort` (aggregate port, #1821): additive

```ts
startMerge(survivorId: string, input: OrganizationMergeStartInput, options?: AggregateCommandOptions): Promise<OrganizationMergeRecord>;
resumeMerge(mergeId: string, options?: AggregateCommandOptions): Promise<OrganizationMergeRecord>;
cancelMerge(mergeId: string, options?: AggregateCommandOptions): Promise<OrganizationMergeRecord>;

export interface OrganizationMergeStartInput {
  loserId: string;
  fieldChoices?: Partial<Record<OrganizationMergeFieldCode, 'survivor' | 'loser'>>;
  customFieldChoices?: Readonly<Record<string, 'survivor' | 'loser'>>;
  acknowledgeIrreversible: true;
}
export type OrganizationMergeFieldCode =
  | 'name' | 'legalName' | 'taxId' | 'vatStatus' | 'registeredAddress'
  | 'customerGroupId' | 'creditInheritanceMode' | 'fulfilmentStrategy';
// `fulfilmentStrategy` carries the strategy and its warehouse order together (one choice).
// orderConfirmationEmails: always the union; status, moderation stamps, parent: never offered (FR-032).
```

These methods carry no permission check and need a caller gate (186 convention item 6).
`options.expectedVersion` applies to resume and cancel (the merge's `version`). The off-state
sentence is that of `organizationCommandPort`. **Blocked by #1821**, because it widens the same
interface. The Commands and routes below do not wait for it.

## 2. Commands

| Action | Hookable | What it does |
| --- | --- | --- |
| `organization.merge.start` | **yes** (`beforeCommit` veto, `afterCommit` outbox; hook data `{ survivorId, loserId, mergeId, source }`) | re-runs the preview, refuses on any refusal, and calls `recordMergeService.begin` (locks, freeze, steps, enqueue). Audit: field-choice codes, counts per participant |
| `organization.merge.cancel` | no | allowed while every participant step is pending (`RECORD_MERGE_NOT_CANCELLABLE`) |
| `organization.merge.resume` | no | `needs_attention` → `running` |
| `organization.merge.structure` | no | the host's structure batches: role map → `host_context` (custom roles the survivor lacks copied first), invitations, sales-rep union, sales-channel union, children. Children move by the tree service's own rules (cycle, depth, subtree tax-ID locks, 177's one-tree rule) **inside this Command**, not as a child `organization.move`, so the move is recorded in an entry that carries the merge id (FR-060) |
| `organization.merge.finalize` | no | the chosen values, the e-mail union and the custom-field values (validated through `customFieldValueService.validateAndMerge`, as `organization.set_custom_field_values` validates) written **inside this Command**, so one entry with the merge id names every changed field; tax-ID take-over (R-14a); loser `deleted_at` + pointer; `organization.merged.v1`. Idempotent: a loser already merged into this survivor writes, audits and emits nothing. Admin search is a live query that already excludes soft-deleted rows, so there is no index to remove from |

All are `reversible: false` and audit with `mergeId` (R-12).

## 3. Refusals in the preview (host part)

In order, each with nothing written:

1. survivor = loser → `RECORD_MERGE_SAME_RECORD`;
2. not reachable by the actor (175) → `404 NOT_FOUND`;
3. either deleted or merged, or the survivor rejected → `RECORD_MERGE_RECORD_UNAVAILABLE`;
4. either personal → `ORGANIZATION_MERGE_PERSONAL` (D-299);
5. the loser is an ancestor of the survivor → `ORGANIZATION_MERGE_TREE_INVALID` `ancestor`; non-roots
   with different roots → `different_trees` (D-299);
6. a lock exists → `RECORD_MERGE_ALREADY_RUNNING`;
7. participant refusals (for example `RECORD_MERGE_BUSY` from `orders`) and
   `RECORD_MERGE_PARTICIPATION_INCOMPLETE`.

## 4. Admin API (`routes.merge.ts`, schemas in `packages/contracts/src/organizations.merge.ts`)

| Method and path | Permission | Body / answer |
| --- | --- | --- |
| `POST /api/v1/admin/organizations/:id/merge-preview` | `organizations:merge` | `{ loserId }` → `OrganizationMergePreview` (200, even with refusals) |
| `POST /api/v1/admin/organizations/:id/merges` | `organizations:merge` | `OrganizationMergeStartInput` → `202 OrganizationMergeRecord` |
| `GET /api/v1/admin/organization-merges` | `organizations:merge` | `?state=&organizationId=` → list (reach-filtered) |
| `GET /api/v1/admin/organization-merges/:mergeId` | `customers:read` (there is no `organizations:read` code; the Organization screens read under `customers:read`) + reach to both | the record with its steps |
| `POST /api/v1/admin/organization-merges/:mergeId/resume` | `organizations:merge` | `{ expectedVersion }` |
| `POST /api/v1/admin/organization-merges/:mergeId/cancel` | `organizations:merge` | `{ expectedVersion }` |
| `GET /api/v1/admin/organizations/:id` (existing) | unchanged | an archived loser answers 200 with `mergedIntoOrganizationId` |

`check:action-route-permissions` covers every new route.

As implemented (MR-F): every route that answers a merge answers an `OrganizationMergeView` —
the `RecordMergeRecord` with `survivorName`, `loserName` and `actorName` (`string | null`)
beside the ids — so the progress view, the attention list and the archived banner read no
Organization or administrator per row. The port's `getMerge` keeps answering the bare record.

## 5. Admin surfaces (MR-F)

- On the Organization screen, the action *Merge a duplicate into this organization* opens a dialog
  flow: a picker (name or tax ID, reach-filtered, personal Organizations excluded), the preview, the
  value choices, an acknowledgement, and the start.
- **Progress view** at `/organizations/merges/:mergeId`, with steps, counts and states.
- **Attention list** at `/organizations/merges?state=needs_attention`, with resume.
- **Archived banner** on a loser: *Merged into {name} on {date} by {actor}*, linking to the survivor.
  On the survivor, the history shows *Merged from …*. As implemented: the Organization screen has
  no history tab of its own, so the survivor's completed merges are listed as *Merged from …*
  in a *Merged organizations* section of its Overview tab, each linking to the merge; the audit
  log keeps the entries. A running merge shows a notice on both organizations' screens. Both
  read the merges list, so they are shown to holders of `organizations:merge`; the archived
  banner reads the merge under `customers:read`.
- **Routes**: `/organizations/merge` (the palette's flow, choosing the survivor first),
  `/organizations/merges` and `/organizations/merges/:mergeId`. The flow is also opened from
  the Organization screen's "More" menu.
- **Permission manifest**: `organizations:merge` (en + pl label and description). It is not in the
  predefined sales-representative role.
- **Palette**: `merge-organizations` (opens the picker for a survivor, then the flow) and
  `open-record-merges`, both under `organizations:merge`.
- **i18n**: every label, refusal message (`check:error-translations`), banner and step name, in en
  and pl.

## 6. Tests

- `packages/modules/organizations/src/backend/commands/merge-*.command.test.ts`: each Command, the
  audit sentinel, the hook veto.
- `packages/modules/organizations/src/backend/services/organization-merge-preview.test.ts`: each
  refusal, under both tax-ID scopes.
- `backend/test/contract/organizations/organization-merge.routes.test.ts`: permissions, reach `404`,
  `202`.
- `backend/test/integration/organizations/organization-merge.e2e.test.ts`: every participant seeded,
  SC-001 query, SC-003 fault injection.
- `backend/test/contract/organizations/organization-command-port.merge.test.ts`: port against route
  parity (after #1821).
