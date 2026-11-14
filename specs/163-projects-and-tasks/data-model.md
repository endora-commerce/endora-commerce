# Data Model: Projects, with a first version of Tasks

**Feature**: `specs/163-projects-and-tasks/` · **Date**: 2026-10-26
Decisions referenced as R-n are in [research.md](./research.md).

Conventions: tables plural snake_case with the module prefix; uuid primary keys
(`gen_random_uuid()`); `created_at`/`updated_at timestamptz not null default now()`; FKs
`<singular>_id`. Cross-module references are **by value** (uuid, no FK) with **one** exception,
`project_organizations.organization_id → organizations(id) on delete restrict` — the CRM
precedent, which keeps exactly its two FKs out of the module (`crm_init.ts:12`). Admin users and
assets are held by value and checked through their owners' ports on write. Each module ships **one** init migration (scaffolded by `migration:new`)
plus, for `projects`, the custom-field column in the same init (no later column migration).

## 1. Module `tasks`

### `tasks` — `Task` · `@RuleScoped()` (R-9)

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| number | text not null unique | `TSK-000001`, from `tasks_number_seq` (R-19) |
| title | text not null | 1–200 chars |
| description | text not null default '' | ≤ 20 000 chars; plain text with reference tokens (R-14) |
| status | text not null default 'todo' | check in (`todo`,`in_progress`,`done`,`cancelled`) |
| assigned_admin_user_id | uuid null | by value; active admin checked on write |
| due_on | date null | |
| completed_at | timestamptz null | set on → `done`, cleared on leaving `done` |
| created_by_admin_user_id | uuid not null | |
| context_type | text null | opaque; registered by a contributor (`project`) |
| context_id | uuid null | by value |
| context_group_id | uuid null | by value (a Stage) |
| context_note | text null | ≤ 200; e.g. "Responsible role: Installer" (R-8) |
| created_at, updated_at | timestamptz | |

Constraints: `check ((context_type is null) = (context_id is null))`;
`context_group_id is null or context_id is not null`.
Indexes: `(assigned_admin_user_id, status, due_on)` (My Tasks), `(context_type, context_id,
context_group_id, status)` (gate and Project tab), `(status, due_on)`.

**State transitions**: any status → any status (a free choice in this first version); `done`
sets `completed_at`; nothing else is derived.

**Audit actions** (Command Bus, `objectType: 'task'`): `tasks.task.create`, `tasks.task.update`,
`tasks.task.status_change`, `tasks.task.assign`, `tasks.task.delete`,
`tasks.task.create_many` (one audit row **per Task**, i.e. one Command per Task inside the port
call — `create_many` is the port's name, not an action).

**Events**: `tasks.task.created.v1`, `tasks.task.status_changed.v1 { taskId, from, to,
contextType, contextId, contextGroupId }`, `tasks.task.assigned.v1`, `tasks.task.deleted.v1
{ taskId, contextType, contextId }`.

Sequence: `tasks_number_seq`.

Settings: `tasks.enabled` (boolean, default true — activation).

## 2. Module `projects`

All Project-owned tables are `@RuleScoped()` and are read only through `ProjectAccess`
(R-2). Configuration tables are `@GlobalEntity()`.

### 2.1 Configuration (`@GlobalEntity()`)

**`project_roles`**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| code | text unique not null | `sales_rep`, `project_manager`, or slug of operator Roles |
| name | jsonb not null | `{ "en": …, "pl": … }`, resolved by `pickLocalized` |
| default_name | text not null | fallback |
| is_system | boolean not null default false | seeded rows: renamable, archivable, not deletable |
| archived_at | timestamptz null | archived Roles stay on Projects, not offered (US4 sc.2) |
| position | int not null | |

Seed: `sales_rep` {en: Sales Rep, pl: Handlowiec}; `project_manager` {en: Project Manager, pl:
Kierownik Projektu}.

**`project_loss_reasons`** — same shape (`code`, `name`, `default_name`, `is_system`,
`archived_at`, `position`). Seed: `price`, `competitor`, `cancelled_by_client`, `no_decision`,
`other` (en + pl).

**`project_templates`**: id, name (text, ≤ 120), description (text, default description with
reference tokens), archived_at, created_by, timestamps.

**`project_template_roles`**: template_id → templates (cascade), role_id → project_roles
(restrict), unique (template_id, role_id).

**`project_template_stages`**: id, template_id (cascade), name, color, position,
planned_duration_days (int ≥ 0), responsible_role_ids uuid[], alert_offsets_days int[]
(each 1–365, distinct), completion_gate boolean, completion_permitted boolean.

**`project_template_stage_tasks`**: id, template_stage_id (cascade), title, description,
responsible_role_id (null, → project_roles set null), due_offset_days int ≥ 0, position.
Cap: ≤ 100 per Stage (R-22).

**`project_template_stage_moves`**: template_id (cascade), from_stage_id, to_stage_id (both →
template stages cascade), unique (from, to), check from ≠ to.

### 2.2 Projects (`@RuleScoped()`)

**`projects`**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| number | text unique not null | `PRJ-000001`, `projects_number_seq` |
| title | text not null | 1–200 |
| description | text not null default '' | reference tokens |
| value_amount | numeric(18,2) null | ≥ 0, two decimals (money rulings: > 2 decimals refused) |
| value_currency | char(3) null | required iff amount set; from `currencies` codes |
| start_on | date not null default current_date | |
| state | text not null default 'open' | check in (`open`,`completed`,`lost`) |
| current_stage_id | uuid null → project_stages | not null while `open` (deferred check) |
| closed_at | timestamptz null | set iff state ≠ open |
| lost_stage_id | uuid null → project_stages | set iff lost |
| loss_reason_id | uuid null → project_loss_reasons (restrict) | set iff lost |
| loss_comment | text null | ≤ 2 000 |
| visibility | text not null default 'inherit' | check in (`inherit`,`everyone`,`members_and_listed`) |
| template_id | uuid null → project_templates on delete set null | provenance |
| custom_field_values | jsonb not null default '{}' | R-18 |
| created_by_admin_user_id | uuid not null | |
| version | int not null default 1 | optimistic concurrency for moves/closes (edge case "two users move at once") |
| configuration_version | int not null default 1 | optimistic concurrency for the Project's sets — Stages added/deleted/reordered, workflow, Organizations, Members (issue #449) |
| created_at, updated_at | | |

Checks: `(state = 'open') = (closed_at is null)`; `(state = 'lost') = (loss_reason_id is not
null)`; `(value_amount is null) = (value_currency is null)`.

**State machine** (Project outcome):

```
open ──close(completed)──▶ completed     (current Stage has completion_permitted; gate R-8)
open ──close(lost, reason)──▶ lost       (any Stage; no gate)
completed|lost ──reopen──▶ open          (back into lost_stage_id / the Stage closed in)
```

Every transition increments `version`; a stale `version` answers 409 `PROJECT_CHANGED`.

**`project_organizations`**: project_id (cascade), organization_id → organizations(id)
(restrict), PK (project_id, organization_id). Removing an Organization with a linked record of it
is refused (409 `PROJECT_ORGANIZATION_IN_USE`).

**`project_members`**: id, project_id (cascade), admin_user_id (by value), added_at,
unique (project_id, admin_user_id).
**`project_member_roles`**: member_id (cascade), role_id → project_roles (restrict), PK both.

**`project_viewers`** (listed people, R-3): project_id (cascade), admin_user_id (by value), PK.

**`project_stages`**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| project_id | uuid → projects cascade | |
| name | text not null | ≤ 80 |
| color | text not null | `#rrggbb` |
| position | int not null | unique (project_id, position) deferrable |
| planned_duration_days | int not null default 0 | ≥ 0 |
| responsible_role_ids | uuid[] not null default '{}' | |
| alert_offsets_days | int[] not null default '{}' | distinct, 1–365 |
| completion_gate | boolean not null default false | |
| completion_permitted | boolean not null default false | true on the last Stage when created |
| started_on | date null | set on entry |
| deadline_on | date null | computed or manual |
| deadline_manual | boolean not null default false | |
| tasks_materialized_at | timestamptz null | R-8, terminal |
| tasks_skipped_at | timestamptz null | R-8, terminal |
| version | int not null default 1 | optimistic concurrency for the Stage's own edits — attributes, Stage Task definitions (issue #449) |

Deleting a Stage: refused if current (409 `PROJECT_STAGE_CURRENT`), if Tasks exist in it
(`taskReadPort.countInContext`, 409 `PROJECT_STAGE_HAS_TASKS`) or if it is the only Stage.

**`project_stage_tasks`** (the Project's own Stage Task definitions, R-7): id, stage_id
(cascade), title, description, responsible_role_id, due_offset_days, position.

**`project_stage_moves`**: project_id (cascade), from_stage_id, to_stage_id (cascade), PK
(from, to). Default on creation: each Stage → next by position.

**`project_stage_entries`** (history rows for analytics, R-5)

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| project_id | uuid cascade | |
| from_stage_id | uuid null | null at creation |
| to_stage_id | uuid null | null when the row records a close |
| kind | text | `enter`, `close_completed`, `close_lost`, `reopen` |
| from_stage_name, to_stage_name | text | names **as they were** (analytics group by name) |
| notes | text[] | `gate_not_applied_tasks_off`, `stage_tasks_skipped`, `tasks_materialize_failed` |
| actor_admin_user_id | uuid null | null for system |
| at | timestamptz not null | |

Index (project_id, at).

**`project_value_changes`** (the values a write changed, T145 / issue #470 decision A — added
by the migration `projects_value_changes`): id uuid PK, project_id (cascade), before jsonb null
(`null` for a create), after jsonb, at timestamptz. Each side holds only what changed:
`valueAmount` (two places, as `numeric(18,2)` prints it — `1234.5` typed is `1234.50`) / `valueCurrency`, and `customFieldValues` of the changed keys (`null` for a key
that had or has no value). One row per Command that changed the value or a custom field
(`projects.project.create`, `.update`, `.custom_fields_update`), written in that Command; the
audit entry carries `changedFields` / `changedCustomFields` and the row's id as `valueChangeId`,
never a value (T144 F4). Read only by `GET /projects/:id/history`, keyed by the id
`ProjectAccess.loadVisible` returned. Index (project_id).

**`project_links`** (R-10): id, project_id (cascade), record_kind check in
(`order`,`quote_request`,`opportunity`), record_id uuid, organization_id uuid (the record's
Organization, read from its owner when the link is made; foreign key (project_id,
organization_id) → `project_organizations`, `no action` — added by T092's migration
`projects_link_organization`, so an Organization a record is linked under cannot leave the
Project), linked_by_admin_user_id, linked_at; **unique (record_kind, record_id)**.

**`project_comments`**: id, project_id (cascade), kind (`note`|`message`), body (≤ 20 000,
tokens), author_admin_user_id, edited_at, deleted_at (notes only), created_at.
**`project_message_reads`**: (project_id, admin_user_id) PK, last_read_at. Global read baseline:
the module's install time, stored in `project_message_read_baselines` (`@GlobalEntity`, single row id = 1) — CRM
shape.
**`project_references`**: id, project_id (cascade), source_kind (`description`|`comment`),
source_id, target_type (`admin_user`|`order`|`product`|`quote_request`|`task`), target_id.
Index (target_type, target_id).

**`project_attachments`**: id, project_id (cascade), asset_id (by value; deletion guarded by the registry),
added_by_admin_user_id, added_at, unique (project_id, asset_id). Registered with
`assetReferenceRegistry` (`ownerModuleId: 'projects'`).

**`project_stage_alert_deliveries`** (R-12): id, stage_id (cascade), offset_days, deadline_on,
claimed_at, outcome null|`bell`|`bell_email`|`email`|`no_recipient`|`undeliverable`,
recipient_count, settled_at; **unique (stage_id, offset_days, deadline_on)**.

Sequence: `projects_number_seq`.

### 2.3 Settings (`projects` settings group)

| Code | Type | Default |
| --- | --- | --- |
| `projects.enabled` | boolean | true (activation) |
| `projects.visibility` | enum `everyone` \| `members` | `members` |
| `projects.alerts_time_zone` | IANA zone string | `Europe/Warsaw` |

### 2.4 Audit actions (`objectType: 'project'`, `objectId` = Project id)

`projects.project.create`, `.update`, `.delete`, `.organization_add`, `.organization_remove`,
`.member_set` (members + roles in one Command), `.viewers_set`, `.visibility_set`,
`.stage_create`, `.stage_update`, `.stage_delete`, `.stage_reorder`, `.moves_set`,
`.stage_move`, `.close`, `.reopen`, `.link_add`, `.link_remove`, `.note_add`, `.note_update`,
`.note_delete`, `.message_add`, `.attachment_add`, `.attachment_remove`,
`.custom_fields_update`, `.stage_tasks_set`.
`PUT /organizations` runs one `.organization_add` / `.organization_remove` per Organization as
**child** Commands of `.organizations_set`, which records no entry of its own, so the set changes
in one transaction and the trail still names each (issue #449). A Stage's own edits move
`project_stages.version`; the Project's sets (Stages added, deleted or reordered, workflow,
Organizations, Members) move `projects.configuration_version`; each is held, when the request
names it, to the value read (409 `PROJECT_CHANGED`). Neither moves `projects.version`.
Configuration (`objectType` per table): `projects.role.*`, `projects.loss_reason.*`,
`projects.template.*`. Audit states never carry comment text (CRM rule: the audit trail is not
tenant-scoped) — `{ commentId, kind, length }` only. Message read markers and alert
deliveries are not Commands (`// command-coverage-ignore: <reason>`), as in CRM.

### 2.5 Events (`projects`)

`projects.project.created.v1`, `projects.stage.moved.v1 { projectId, fromStageId, toStageId,
fromStageName, toStageName }`, `projects.project.closed.v1 { projectId, outcome, stageId,
lossReasonCode? }`, `projects.project.reopened.v1`, `projects.record.linked.v1 { projectId,
recordKind, recordId }`, `projects.record.unlinked.v1`.

## 3. Classification summary (Principle XI)

| Entity | Class | Enforcement |
| --- | --- | --- |
| Task | rule | `taskContextRegistry` (R-9) + `tasks:read` |
| Project and all `project_*` rows of §2.2 | rule | `ProjectAccess` (R-2, R-3) |
| ProjectRole, ProjectLossReason, ProjectTemplate (+ children) | global | configuration; `projects:configure` to write |

## 4. Validation rules (from FRs)

- FR-001 title 1–200; value two decimals, ≥ 0, currency required with amount.
- FR-004 any number of Organizations, each in the caller's scope on write.
- FR-005 loss reason must be non-archived.
- FR-008 Member must be an active admin; ≥ 0 Roles per Member (a Member without Role is allowed).
- FR-010 alert offsets distinct, 1–365; duration 0–3 650.
- FR-011 moves only between Stages of the same Project/Template.
- FR-021 record's Organization ∈ Project's Organizations; at most one Project per record.
- FR-029 Task title 1–200; due date optional; assignee active admin.
