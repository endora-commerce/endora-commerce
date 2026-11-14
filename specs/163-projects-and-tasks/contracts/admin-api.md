# Contract: Admin HTTP API

All endpoints are under `/api/v1/admin`, JSON, camelCase, Zod schemas in
`packages/contracts/src/tasks.ts` and `packages/contracts/src/projects.ts` (written before any
route — Principle II). Every route is gated with `requireAdmin('<code>')` as a literal. Successful bodies are wrapped `{ data: … }`; DELETEs answer 204. Errors use
the platform envelope `{ code, message, details? }`. A Project that is out of reach or invisible
answers **404 `PROJECT_NOT_FOUND`**, identical to a non-existent one (Principle XI). While a
module is off, its routes answer 503 `MODULE_DISABLED` through the platform gate.

## 1. Tasks (`tasks`)

| Method & path | Permission | Request → Response | Notes |
| --- | --- | --- | --- |
| `GET /tasks` | `tasks:read` | `TaskListQuery` (`status[]`, `assignee` = id \| `me` \| `none`, `dueFrom`, `dueTo`, `overdue`, `contextType`, `contextId`, `q`, `cursor`, `limit ≤ 100`) → `TaskListResponse { items: TaskSummary[], nextCursor }` | hidden contexts pre-filtered (R-9) |
| `GET /tasks/mine` | `tasks:read` | → `TaskSummary[]` open Tasks of the caller, by `dueOn` nulls last | *My Tasks* |
| `POST /tasks` | `tasks:write` | `CreateTaskBody { title, description?, assignedAdminUserId?, dueOn?, context? }` → `TaskDetail` | `context` accepted only for a registered + present type whose `visibleContextIds` contains it and whose owner answers `canChangeTasks` yes (else 422 `TASK_CONTEXT_INVALID`; T147) |
| `GET /tasks/:id` | `tasks:read` | → `TaskDetail` (incl. `context: { type, id, groupId, label, href, groupLabel, canChangeTasks } \| null` — `canChangeTasks` the owner's answer for the reader, T147) | 404 `TASK_NOT_FOUND` if hidden |
| `PATCH /tasks/:id` | `tasks:write` | `UpdateTaskBody` (title, description, dueOn, assignedAdminUserId, status, context) → `TaskDetail` | assignment to another person notifies (FR-032); a `context` that leaves or enters a record needs that record owner's `canChangeTasks` (else 422 `TASK_CONTEXT_INVALID`; T144, T147) — between groups of one record it is not asked |
| `DELETE /tasks/:id` | `tasks:write` | → 204 | a Task in a context needs its owner's `canChangeTasks` (else 403 `FORBIDDEN`; T147) |
| `GET /tasks/lookups/assignees?q=` | `tasks:write` | → `{ id, name, email }[]` active admins | |
| `GET /tasks/:id/history` | `tasks:read` | → `RecordHistoryPage` | audit read, `objectType: 'task'` |

`GET /tasks` orders newest first, keyset-paged by `(createdAt, id)`; it returns no total.

`TaskSummary { id, number, title, status, dueOn, overdue, assignee: { id, name, active } | null,
context: { type, label, href, groupLabel } | null }`.

## 2. Projects (`projects`)

### 2.1 Projects

| Method & path | Permission | Request → Response |
| --- | --- | --- |
| `GET /projects` | `projects:read` | `ProjectListQuery` (`state[]`, `organizationId`, `memberId` \| `me`, `roleId`, `templateId`, `stageName`, `q` (number/title), `cursor`, `limit ≤ 100`, `sort` ∈ createdAt\|value\|deadline, `customFieldFilters` (JSON, the shape of the Orders / Quote Requests / Opportunities lists; 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming a field not offered)) → `{ items: ProjectSummary[], nextCursor, total }` |
| `GET /projects/custom-field-filters` | `projects:read` | → `{ data: CustomFieldListFilterField[] }` — the Project custom fields marked as list filters (User Story 9) |
| `POST /projects` | `projects:write` | `CreateProjectBody { title, description?, value?: { amount, currency }, startOn?, organizationIds[], templateId?, members?: { adminUserId, roleIds[] }[], visibility?, viewerIds?, customFieldValues?, stages?: ProjectStageInput[] (1–50, required without templateId) }` → `ProjectDetail` |
| `GET /projects/:id` | `projects:read` | → `ProjectDetail` (incl. stages, moves, members, organizations, links count, unread messages, `permissions: { canWrite, canConfigure }`) |
| `PATCH /projects/:id` | `projects:write` | `UpdateProjectBody` (title, description, value, startOn, visibility, viewerIds, customFieldValues, `version`) → `ProjectDetail`; `customFieldValues` is a patch (named fields only; `null` clears one), validated by `custom_fields` — 422 `CUSTOM_FIELD_VALUE_INVALID`, one issue per field, `path` = its key — and written by its own Command `projects.project.custom_fields_update`. On `POST` the definitions are always enforced, so a required field is asked for even when `customFieldValues` is absent |
| `DELETE /projects/:id` | `projects:write` | → 204; 409 `PROJECT_HAS_LINKS` while links exist |
| `PUT /projects/:id/organizations` | `projects:write` | `{ organizationIds[], configurationVersion? }`, one transaction → `ProjectDetail`, or `{ id, outOfReach: true }` when the caller's own change took the Project out of their Organization reach (made it internal — T144 F3); 409 `PROJECT_ORGANIZATION_IN_USE`; 422 `PROJECT_ORGANIZATION_OUT_OF_SCOPE` |
| `PUT /projects/:id/members` | `projects:write` | `{ members: { adminUserId, roleIds[] }[], configurationVersion? }` → `ProjectDetail` |

`ProjectSummary { id, number, title, state, currentStage: { id, name, color, deadlineOn,
overdue } | null, organizations: { id, name }[], value, projectManagers: { id, name }[],
createdAt, closedAt }`.

### 2.1a Lookups for the pickers, and the visibility setting (User Story 5)

| Method & path | Permission | Request → Response |
| --- | --- | --- |
| `GET /projects/lookups/organizations` | `projects:read` | `ProjectOrganizationLookupQuery { q?, id?, limit ≤ 50 }` → `{ data: { id, name }[] }` — only Organizations in the caller's reach; by `id` an out-of-reach one answers `[]` |
| `GET /projects/lookups/admin-users` | `projects:read` | `ProjectAdminUserLookupQuery { q?, id?, limit ≤ 50 }` → `{ data: { id, name, email }[] }` — active administrators by name or e-mail; by `id` the one administrator whatever their status (a label) |
| `GET /projects/visibility-setting` | `projects:read` | → `{ data: { setting: 'everyone' \| 'members' } }` — the module setting, so a screen can say what *Follow the module setting* means |

The kit's `OrganizationPicker(Multi)` and `AdminUserPicker` read `/organizations` and
`/admin-users` behind their owners' codes; these are the module's own (the `/crm/lookups/*`
precedent), so a role holding only `projects:*` gets working pickers. Both are `projects:read`:
the list's Organization and any-member filters are a reader's (CRM gates its filter lookups on
`crm:read`); they answer names only, Organizations only inside the caller's reach.

### 2.2 Stages and moves

Optimistic concurrency for a Project's configuration (issue #449), additive: a Stage's own
edits (`PATCH …/stages/:stageId`, `PUT …/stages/:stageId/tasks`) take an optional `version` —
the Stage's, `ProjectStage.version`; the Project's sets (`POST …/stages`, `PUT …/stages/order`,
`PUT …/moves`, and §2.1's `organizations` and `members`) take an optional `configurationVersion`
— `ProjectDetail.configurationVersion`, which `DELETE …/stages/:stageId` moves too. Sent and
stale → 409 `PROJECT_CHANGED`, nothing written. None of them moves the Project `version`.

| Method & path | Permission | Request → Response |
| --- | --- | --- |
| `POST /projects/:id/stages` | `projects:write` | `StageBody` + `configurationVersion?` → `ProjectStage` |
| `PATCH /projects/:id/stages/:stageId` | `projects:write` | `StageBody` partial (name, color, plannedDurationDays, responsibleRoleIds, alertOffsetsDays, completionGate, completionPermitted, deadlineOn \| null to recompute) + `version?` → `ProjectStage` |
| `DELETE /projects/:id/stages/:stageId` | `projects:write` | → 204; 409 `PROJECT_STAGE_CURRENT` \| `PROJECT_STAGE_HAS_TASKS` \| `PROJECT_STAGE_LAST` |
| `PUT /projects/:id/stages/order` | `projects:write` | `{ stageIds[], configurationVersion? }` |
| `PUT /projects/:id/moves` | `projects:write` | `{ moves: { fromStageId, toStageId }[], configurationVersion? }` → `{ moves, unreachableStageIds[], configurationVersion }` |
| `PUT /projects/:id/stages/:stageId/tasks` | `projects:write` | `{ tasks: StageTaskDefinition[], version? }` (Stage Task definitions, R-7) → `ProjectStage` |
| `POST /projects/:id/stages/:stageId/materialize-tasks` | `projects:write` | retry after `tasks_materialize_failed` only → `{ created }`; 409 otherwise |
| `POST /projects/:id/move` | `projects:write` | `{ toStageId, version }` → `MoveResult { project, entry, createdTaskIds[], notes[] }`; 409 `PROJECT_MOVE_NOT_PERMITTED` \| `PROJECT_STAGE_GATE_OPEN_TASKS { openTaskCount, openTasks[]? }` (`openTasks` only to a `tasks:read` holder — T144 F2) \| `PROJECT_CHANGED` \| `PROJECT_GUARD_REFUSED { reason }` |
| `POST /projects/:id/close` | `projects:write` | `{ outcome: 'completed' } \| { outcome: 'lost', lossReasonId, comment? }` + `version` → `ProjectDetail`; 409 `PROJECT_COMPLETION_NOT_PERMITTED` \| gate as above |
| `POST /projects/:id/reopen` | `projects:write` | `{ version }` → `ProjectDetail` |
| `GET /projects/:id/stage-history` | `projects:read` | → `StageEntry[]` |

### 2.3 Links and the record panel

| Method & path | Permission | Request → Response |
| --- | --- | --- |
| `GET /projects/:id/links` | `projects:read` | → `ProjectLink[] { id, kind, recordId, available, number?, status?, amount?, currency?, href? }` |
| `POST /projects/:id/links` | `projects:write` (+ owner's read permission for the kind, else 403 — CRM's linking rule) | `{ kind, recordId }` → `ProjectLink`; 404 `PROJECT_RECORD_NOT_FOUND`; 409 `PROJECT_RECORD_ALREADY_LINKED { project? }`; 422 `PROJECT_LINK_ORGANIZATION_MISMATCH`; 503 `MODULE_DISABLED` (crm / quote_requests off) |
| `DELETE /projects/:id/links/:linkId` | `projects:write` | → 204 |
| `GET /projects/records/:kind/:recordId/project` | `projects:read` (+ owner's read permission for the kind) | → `ProjectSummary` \| 404 (R-11) |
| `GET /projects/:id/tasks` | `projects:read` | → `{ tasksAvailable, stages: { stageId, tasks: TaskSummary[] }[] }` via `taskReadPort`; `tasksAvailable: false` when `tasks` is off or the reader lacks `tasks:read` |

### 2.4 Collaboration

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /projects/:id/comments?kind=` | `projects:read` | resolved references (R-14) |
| `POST /projects/:id/comments` | `projects:write` | `{ kind, body }` |
| `PATCH` / `DELETE /projects/:id/comments/:commentId` | `projects:write` | notes, author only (403 `PROJECT_NOTE_NOT_AUTHOR`) |
| `POST /projects/:id/messages/read` | `projects:read` | `{ throughMessageId }` |
| `GET /projects/:id/attachments` | `projects:read` | |
| `POST /projects/:id/attachments` | `projects:write` + `assets.read` (as CRM: an id alone must not yield a signed link to a private file) | `{ assetId }` (private, live, not active content) |
| `POST /projects/:id/attachments/upload` | `projects:write` | multipart; upload-then-attach with compensation |
| `DELETE /projects/:id/attachments/:attachmentId` | `projects:write` | |
| `GET /projects/:id/history?cursor=` | `projects:read` | `RecordHistoryPage`, cap 500. The audit entries, with the values a write changed served in place of the names its audit entry keeps (T145, #470): `valueAmount` / `valueCurrency` and `customFieldValues` of the changed keys, before and after, from `project_value_changes`; `changedFields`, `changedCustomFields` and `valueChangeId` are not served when the row is there. Custom fields (values or names) only to a `custom_fields:read` holder; no Organization out of the reader's reach (T144 F4). Shape unchanged (`before` / `after` are open objects) |
| `GET /projects/lookups/mentionable?projectId=&q=` | `projects:write` | active admins with `projects:read` who could see the Project (R-4) |
| `GET /projects/lookups/documents?projectId=&organizationIds=&q=` | `projects:write` | `@@` list → `RecordDocumentLookupResponse { groups: { kind: 'order' \| 'quote_request' \| 'task', items: { id, label, sublabel? }[] }[] }`, each group only with its read permission and present owner; the same schema CRM serves at `GET /crm/lookups/documents` (FR-044); answered **unwrapped** (no `data` envelope), as CRM's. Orders and Quote Requests are those of the Project's Organizations; before a Project exists (the create form) those of `organizationIds` (repeatable, ≤ 50), each kept only when within the caller's reach — one out of reach is dropped silently; ignored beside `projectId` |

### 2.5 Configuration

| Method & path | Permission |
| --- | --- |
| `GET /projects/roles` (`?active=true` leaves archived out; rows carry `label` in the reader's language) | `projects:read` |
| `POST`/`PATCH /projects/roles[/:id]`, `POST /projects/roles/:id/archive` \| `/restore`, `DELETE /projects/roles/:id` | `projects:configure` |
| `GET /projects/loss-reasons`; `POST`/`PATCH`/archive/restore/`DELETE` | `projects:read`; `projects:configure` |

Roles and loss reasons (User Story 4): `POST` → 201 with the row, its `code` derived from
`defaultName` (`slugify` with `_`, `_2`, `_3`… past codes already held) and never changed; `PATCH`
replaces `name` and/or `defaultName`. 404 `PROJECT_DICTIONARY_ENTRY_NOT_FOUND` for an unknown id;
409 `PROJECT_DICTIONARY_NAME_TAKEN` for a `defaultName` another row of the same dictionary has
(case-insensitive, archived rows included); `DELETE` → 204, or 409
`PROJECT_DICTIONARY_ENTRY_SYSTEM` for a seeded row and 409 `PROJECT_DICTIONARY_ENTRY_IN_USE` for
a row a Project or Template uses (Members, Template Roles, responsible Roles of Stages and Stage
Tasks; a Project lost for the reason) — archiving is how such a row stops being offered.
| `GET /projects/templates`, `GET /projects/templates/:id` | `projects:read` |
| `POST /projects/templates`, `PUT /projects/templates/:id` (whole Template graph in one body, one Command), `POST …/:id/duplicate`, `…/archive`, `…/restore` | `projects:configure` |

Settings are edited on the generic `/settings?group=projects` screen (no module route).

### 2.6 Analytics (`projects:analytics`)

`GET /projects/analytics/{summary|durations|time-in-stage|losses|value|top-open|managers}` with
`AnalyticsQuery { from, to, templateId?, organizationId?, projectManagerId? }`; every response
`{ from, to, projectCount, excluded: { noValue }, data }`. Money is `{ currency, amount }[]`.
