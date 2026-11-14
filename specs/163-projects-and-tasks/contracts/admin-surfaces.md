# Contract: Admin surfaces

Routes, navigation, palette actions, zones and permissions of both modules, and how each
disappears when its module is off (Principle XVII). Contributions are data in each module's
`src/admin/index.ts`; components are dynamic-import factories.

## 1. Navigation — new host section `work` (R-16)

`AdminNavSectionNameSchema += 'work'`; `AppShell.tsx` gains `{ key: 'work', labelKey:
'appShell.section.work', items: [] }` placed after `crm`; label **en** "Projects & tasks",
**pl** "Projekty i zadania" in `packages/modules/_i18n/i18n/{en,pl}.json`. The section is
hidden when no item in it is visible.

| Entry | Module | Route | Permission | Weight |
| --- | --- | --- | --- | --- |
| Projects | projects | `/projects` | `projects:read` | 100 |
| My Tasks | tasks | `/tasks/mine` | `tasks:read` | 200 |
| Tasks | tasks | `/tasks` | `tasks:read` | 210 |
| Analytics | projects | `/projects/analytics` | `projects:analytics` | 300 |
| Templates | projects | `/projects/templates` | `projects:configure` | 400 |
| Project roles | projects | `/projects/roles` | `projects:configure` | 410 |
| Loss reasons | projects | `/projects/loss-reasons` | `projects:configure` | 420 |

## 2. Routes and screens

**tasks**: `/tasks` (list with filters), `/tasks/mine`, `/tasks/new`, `/tasks/:id` (detail with
edit-in-place, status control, context card, history; mounts zone `task.detail.after`).

**projects**:

| Route | Screen |
| --- | --- |
| `/projects` | List: filters (state, Organization, member/me, Role, Template, current Stage name), search and sort kept in the address (issue #454; the Organization panel's *All projects* opens `/projects?organizationId=…`), columns number · title · Organizations · current Stage + deadline (overdue marked) · value · Project Managers |
| `/projects/new` | Create: optional Template picker first (prefills everything, editable), then title, Organizations (multi; empty = internal, with the visibility note of the spec edge case), value, start date, members + Roles, visibility, custom fields, and — without a Template — a Stage list (name, colour, planned duration; at least one, `CreateProjectBody.stages`) |
| `/projects/:id` | Detail: header (number, title, state badge, value, Organizations), **Stage bar** (Stages in order, current highlighted, deadline, permitted next moves as buttons, "Close as completed" where permitted, "Close as lost"), tabs below |
| `/projects/:id?tab=` | Tabs: **Overview** (description, members by Role, custom fields), **Stages** (editor: Stages, durations, responsible Roles, alerts, gate, completion permitted, Stage Task definitions; moves editor with `StatusTransitionGraph`; unreachable warning), **Tasks** (by Stage; absent when `tasks` off), **Linked records** (Orders · Quote Requests · Opportunities; groups for an absent owner show "unavailable"), **Notes**, **Messages** (unread badge), **Attachments**, **History** |
| `/projects/templates`, `/projects/templates/:id` | Template list; Template editor (same Stage editor component as the Project's) |
| `/projects/roles`, `/projects/loss-reasons` | Dictionary screens (name per language, archive/restore; system rows not deletable) |
| `/projects/analytics` | Filters (range, Template, Organization, Project Manager); cards: Summary, Durations, Time in Stage (bar), Losses by Stage (ranked bar), Loss reasons, Lost value per currency, Average value, Top open, Managers |

Reused from `@endora-commerce/admin-kit`: `PageHeader`, `ResponsiveTable`, `PaginationFooter`,
`RouteTabs`, `Section`, `Badge`, `MultiSelect`, `Combobox`, `ColorPicker`,
`StatusTransitionGraph`, `OrganizationPicker`, `AdminUserPicker`, `ModalDialog`, `EChart`,
`AssetUploader`/`FileDropzone`, `resolveCustomFieldLabel`, and — promoted by this feature from
CRM (R-17) — `ReferenceField`, `ReferenceText`, `CommentThread`, `CommentComposer`,
`AttachmentUploader`, `RecordHistory`, `CursorPagination`.

New in `projects` (module-local): `StageBar`, `StageEditor` (shared by Project and Template),
`MembersEditor`, `LinkedRecords`, `CloseProjectDialog`, `ProjectPanel` (zones).

## 3. Zones

| Zone | Mounted by | Contributed by | Status |
| --- | --- | --- | --- |
| `order.detail.after` | orders `OrderDetail.tsx:934` | projects → `ProjectPanel` (weight 650) | exists |
| `quote_request.detail.after` | quote_requests `RfqDetail.tsx:824` | projects → `ProjectPanel` | exists |
| `opportunity.detail.after` | **crm** `OpportunityDetail.tsx` (after the tabs card) | projects → `ProjectPanel` | **new** (`OpportunityDetailZoneProps { opportunityId }`) |
| `task.detail.after` | **tasks** `TaskDetail.tsx` | projects → `ProjectPanel` | **new** (`TaskDetailZoneProps { taskId }`) |
| `organization.detail.after` | organizations | projects → `OrganizationProjects` (list of the Organization's visible Projects) | exists |

`ProjectPanel` renders nothing on 404 (no Project, or not visible — US5 sc.5) and is filtered out
before its chunk loads when `projects` is off or the user lacks `projects:read`.
`check:admin-zones` must pass in the same change that declares each new zone.

## 4. Command palette (manifest `actions`)

| id | Label (en / pl) | Route | Permission |
| --- | --- | --- | --- |
| `projects.open` | Projects / Projekty | `/projects` | `projects:read` |
| `projects.new` | New project / Nowy projekt | `/projects/new` | `projects:write` |
| `projects.templates` | Project templates / Szablony projektów | `/projects/templates` | `projects:configure` |
| `projects.analytics` | Project analytics / Analityka projektów | `/projects/analytics` | `projects:analytics` |
| `tasks.open` | Tasks / Zadania | `/tasks` | `tasks:read` |
| `tasks.mine` | My tasks / Moje zadania | `/tasks/mine` | `tasks:read` |
| `tasks.new` | New task / Nowe zadanie | `/tasks/new` | `tasks:write` |

Icons from `KnownIconNameSchema` (`contracts/src/admin-actions.ts`): `ListChecks` (Tasks, My
tasks) and `ClipboardList` (Projects) already exist; `FolderPlus` serves "New project" and
`Plus` "New task"; `LineChart` analytics; `Layers` templates. No new icon name.

## 5. Permissions (manifest `permissions`, labels `adminRoles.permission.<code>`)

| Code | Label (en) | `requires` (advisory) |
| --- | --- | --- |
| `tasks:read` | View tasks | |
| `tasks:write` | Create and edit tasks | `tasks:read` |
| `projects:read` | View projects | |
| `projects:write` | Create, edit, move and close projects | `projects:read` |
| `projects:configure` | Configure projects (roles, templates, loss reasons) | `projects:read` |
| `projects:see_all` | See every project regardless of visibility | `projects:read` |
| `projects:analytics` | View project analytics | `projects:read` |

## 6. Global search and custom fields

- `admin_search` providers: `projects.project` (number, title, Organization names) — `search()`
  applies `ProjectAccess`; `tasks.task` (number, title) — applies R-9.
- Custom fields: *Project* offered on `/custom-fields` only while `projects` is present (R-18);
  `ProjectCustomFields` on create and Overview.

## 7. Off-state (Principle XVII)

| Module off | Absent | Kept and restored |
| --- | --- | --- |
| `projects` | routes, nav entries, palette actions, the four `ProjectPanel` contributions, `OrganizationProjects`, the *Project* custom-field type, the alert sweep's work, the `project` Task context (its Tasks vanish from Tasks lists) | every row |
| `tasks` | its routes, nav, palette, the Tasks tab and Stage Task editor in Projects, the `@@` Task group in Projects **and** CRM, gate application, Stage Task materialisation | every row; Stage Task definitions and gate flags in Projects; Task references (shown unavailable) |
| `crm` / `quote_requests` | Opportunity / Quote Request linking, the Quote Request `@@` group (in Projects **and** CRM), their panels | links and references (shown unavailable) |
