# Contract: changes outside the `tasks` module

This lists every file outside `packages/modules/tasks/` that the feature changes. It is grouped by
owner and carries the reason for each change. A change not on this list needs a line here first.

## A. `packages/contracts/src/`

| File | Change | Why |
| --- | --- | --- |
| `tasks.ts` | Statuses become codes (`taskStatusCodeSchema`). `TASK_STATUSES` → `TASK_DEFAULT_STATUS_CODES`, kept for the seed and tests. `TASK_CLOSED_STATUSES` is removed in favour of `TASK_STATUS_CATEGORIES` and `closed`. Adds every §1–§5 schema of `admin-api.md`. `NewContextTask.assigneeIds` and `sourceKey`. Optional `TaskContextDescriptor.existingContexts`. Events per `data-model.md` §8. | R-1, R-2, R-19 |
| `record-references.ts` | `RECORD_REFERENCE_TYPES` and `RECORD_DOCUMENT_KINDS` gain `opportunity` and `project`. | R-5 |
| `crm.ts` | `OpportunityReadPort` gains `findByIds` and `search`. | R-5, R-16 |
| `projects.ts` | `ProjectReadPort` gains `findByIds` and `search`. The reused `TaskSummarySchema` follows the new shape. | R-5 |
| `tasks.ts` (added at T019) | `TaskRecord` also gains `statusName` (per language), `statusDefaultName`, `statusColor` and `updatedAt`. | Projects' Tasks tab builds a `TaskSummary` from a `TaskRecord`, and the summary's `status {name, color}` and `updatedAt` have no other source once the `tasks.status.*` keys leave the Projects bundle. |
| `custom-fields.ts` | `supportedEntityTypeSchema` gains `'task'`. | R-8 |
| `assets-library.ts` (added at T039) | `assetReferenceKindSchema` gains `'task_attachment'`. | R-7: the asset library's delete refusal names what holds a file, and `AssetReferenceDescriptor.findReferences` answers only a kind of that enum — Projects added `project_attachment` the same way (163 FR-027). |
| `saved-list-views.ts` | Task create and update view schemas. | R-13 |
| `admin-preferences.ts` | Key `listViewModes` (keys, patch, read, defaults). | R-14 |
| `*.test.ts` beside each | Updated for the above. | — |

Each change gets a changeset. The `tasks.ts` event and status changes are breaking; the rest
are additive (`release-intent.md`).

## B. `packages/admin-kit/`

| Path | Change |
| --- | --- |
| `src/components/tags/` (new) | `TagChips`, `TagMultiSelect` and `useTagOptions`, promoted from CRM with the options source injected (R-10). |
| `src/components/kanban/MoveToMenu.tsx` (new) | Promoted from CRM (R-11). |
| `src/components/references/` | Document groups and link targets for `opportunity` and `project`. |
| `packages/modules/_i18n/i18n/{en,pl}.json` (added at T054) | `kanban.moveTo.{action,label}`, the promoted `MoveToMenu`'s two sentences, moved from CRM's `board.moveTo.*` (wording kept). |
| `packages/modules/_i18n/i18n/{en,pl}.json` (added at T025) | The core bundle's `references.{kind,group,inserted,unavailable}.{opportunity,project}` sentences the kit's reference components compose (`admin/test/kit/kit-collaboration-bundle.test.ts` requires every member of each family). |
| `src/lib/admin-preferences/{store,use-admin-preference}.ts` | `listViewModes` and `useListViewModePreference(listId)`. |
| `src/components/comments/CommentThread.tsx` (added at T059) | `keepDeleted` and the optional `RecordComment.deletedAt`: a deleted Task comment keeps its place in the thread, marked (R-6 "soft, so the thread shows deleted"); without the prop the thread behaves as before, so CRM and Projects do not change. Its sentence is the core bundle's `comments.removedEntry` (en, pl), and `admin/test/kit/kit-comments.test.tsx` gains two cases. |
| `src/ui/multi-select.tsx`, `src/components/tags/TagPicker.tsx` (added at T092) | `ariaLabelledBy`, optional and additive: the trigger is named by a visible label's id instead of a duplicate `ariaLabel` (WCAG 2.5.3, the Tasks filters and field inputs). Without it both behave as before; `admin/test/kit/kit-tags.test.tsx` gains one case. |
| `src/components/status-transition-graph/StatusTransitionGraph.tsx` (added at T095) | The *From* / *To* options and the selected-move label show `statusLabel(status)` instead of the code; the values stay codes. The walk found Task status codes on the workflow screen; the graph's nodes and tooltips already used `statusLabel`, so every caller already supplies names. `admin/test/modules/tasks/TaskWorkflowPage.test.tsx` gains one case; the orders, returns, CRM and Projects screens' tests run unchanged. Changeset bullet. |
| `src/components/references/ReferenceField.tsx` (added at T095) | A suggestion row's label (the number the chip shows) no longer shrinks (`shrink-0`, truncating only past the row's width); the description (the title) truncates (`min-w-0 truncate`) — it was the other way round, so a long Task title squeezed the number to *TSK-…* or out of sight. `admin/test/kit/kit-references.test.tsx` gains one case. Changeset bullet. |
| `src/components/record-history/RecordHistory.tsx`, `src/components/comments/CommentThread.tsx` (added at T095) | `formatTime`, optional and additive: an entry's time in the caller's format. Tasks passes its one date format (the admin language, no seconds — the walk found four formats on the Tasks screens); without the prop both use `formatDateTime`, so every other caller is unchanged. Covered by `admin/test/modules/tasks/TaskDetail{,.comments}.test.tsx`. Changeset bullet. |
| Tests beside each | — |

## C. `packages/modules/crm/`

| Path | Change |
| --- | --- |
| `src/admin/components/{TagPicker,MoveToMenu}.tsx` | Replaced by kit imports. Callers updated, with no behaviour change. CRM's admin tests run before and after. At T054 `i18n/{en,pl}.json` lose `board.moveTo.*` (now the core bundle's `kanban.moveTo.*`), and `admin/test/modules/crm/board.test.tsx` reads the menu's name from the core bundle (shape only). |
| `src/backend/services/opportunity-read-port.ts` | `findByIds` and `search`. |
| `src/backend/entities/crm-opportunity-reference.entity.ts` (added at T025) | `CrmReferenceTargetType` gains `'opportunity'` and `'project'`, the type of the widened check. Pulled forward into Phase 2 with the migration (orchestrator ruling 2). |
| `src/backend/services/reference-service.ts`, document lookup service | Resolvers and lookup groups for `opportunity` (through its own service) and `project` (through `projectReadPort`, `degrades-without`; an edge already exists or is added with a `whenAbsent` sentence). |
| `src/migrations/<stamp>_crm_opportunity_reference_kinds.ts` (new) | Widens `crm_opportunity_references_target_type_check`. |
| `src/manifest.ts` | Edge on `projects`, if not already declared. |
| `src/backend/services/crm-projects.ts` (new, added at T034) | The one door to `projectReadPort` — `isPresent()` first, as `crm-tasks.ts` is for Tasks. |
| `src/backend/index.ts`, `src/backend/services/owner-read-permissions.ts` (added at T034) | Registers the door and an unexported `OpportunityReadPortService` instance for the resolver and the `@@` list; `projects:read` joins the owner read checks. |
| `src/admin/lib/references.ts` (added at T034) | `@@` is also offered when the Projects group (`projects:read`) could answer. |
| `i18n/{en,pl}.json` | Group labels. |
| `docs/crm.md` (added at T089) | The two new reference kinds (tokens, labels, URLs, the `@@` groups and their gates, the lookup's answer), Projects as an optional module for references, and the *Tasks* panel on an Opportunity. FR-043; T089 names the CRM docs. |

## D. `packages/modules/projects/`

| Path | Change |
| --- | --- |
| `src/backend/services/stage-task-service.ts` | Its `CLOSED` set becomes `summary.closed`. The assignee becomes `assigneeIds: [holder]`. `sourceKey = stageTaskDefinition.id`, which makes `retry()` safe (#450). |
| `src/backend/services/task-context-descriptor.ts` | `existingContexts` (#450). |
| `src/backend/services/project-access.ts` | System-mode existence query. `PROJECT_ACCESS_READERS` gains the new reader files. |
| `src/backend/services/project-read-port.ts` | `findByIds` and `search`. |
| `src/backend/services/reference-service.ts`, document lookup service | Resolvers and groups for `opportunity` and `project`. |
| `src/backend/services/linked-records.ts`, `src/backend/index.ts` (added at T034) | `searchOpportunities` on the one door to `crm` (the `@@` Opportunities group); the reference service is handed `ProjectAccess` for the Projects it resolves. |
| `src/admin/lib/references.ts` (added at T034) | `@@` is also offered when the Opportunities group (`crm:read`) could answer. |
| `backend/test/integration/projects/mentions.test.ts`, `backend/test/contract/{projects/lookups,crm/document-lookups}.contract.test.ts` (added at T034) | The `@@` answers they pin gain the Projects group (Projects) and the Opportunities group (CRM), shape only. |
| `src/migrations/<stamp>_projects_reference_kinds.ts` (new) | Widens `project_references_target_type_check`. |
| `src/admin/pages/project-detail/tabs/TasksTab.tsx` | Status chip from `status.name` and `status.color`, and assignees as a list. The `tasks.status.*` keys are removed from `i18n/{en,pl}.json`. |
| `src/backend/project-access-seam.test.ts` (added at T025) | `RULE_SCOPED_READ_LEDGER['services/project-access.ts']` 12 → 14: the two reads of `findVisibleMany` and `searchVisible`, both composing `visibleProjectSql`. |
| `src/backend/project-access-seam.test.ts` (added at T087) | `RULE_SCOPED_READ_LEDGER['services/project-access.ts']` 14 → 16: `existingWithStages`, the system-only existence query behind `existingContexts` — one statement naming `projects` and `project_stages`, counted once per table. |
| `src/backend/services/{project-service,stage-service}.ts` (added at T087) | Comments only: a Project or Stage deleted while Tasks is off is cleaned up by the Tasks maintenance pass (#450). |
| `docs/projects.md` (added at T089) | The two new reference kinds in the `@@` row and the developer section; Stage Tasks created exactly once on retry (`sourceKey`, `created`); clean-up of a Project or Stage deleted while Tasks was off; `existingContexts`. FR-043; T089 names the Projects docs. |
| `src/backend/routes/routes.stage-tasks.ts` (added at T019) | `GET /projects/:id/tasks` passes the response language to `tasksByStage`, which names each status from the record's `statusName`. |

## E. `packages/modules/custom_fields/`

`custom-field-registry.ts` (`SUPPORTED_ENTITIES.task`), `host-storage-binding.ts`,
`i18n/{en,pl}.json`, and the three tests that enumerate the types (R-8).

## E2. `packages/modules/admin_notifications/` (added at Phase 2 by orchestrator ruling 3)

| Path | Change | Why |
| --- | --- | --- |
| `src/backend/services/admin-notification-port.ts`, `admin-notification-service.ts`, and the port in `packages/contracts/src/admin-notifications.ts` | The record port gains an **additive** co-transactional `recordWithin(em, input)`: the bell row is created and persisted on the caller's EntityManager, inside its transaction, with no fork and no flush (the `AuditPort.recordWithin` shape). `record(input)` is unchanged. | SC-004 exactly-once bell for reminders: the delivery row and the bell entry commit together, so the unique delivery key makes the bell exactly-once. T001(b) measured that `record` forks its own EntityManager and autocommits. Implemented at T072 (US7), not before. |
| `backend/test/integration/admin_notifications/record-within.test.ts` (new, added at T072), `.changeset/admin-notifications-record-within.md` | The port method's tests (commits with the caller, rolls back with it, refuses what `record` refuses, `record` unchanged) and its changeset (`minor` for the module and the contracts). The port is `AdminNotificationRecordPort<EM = unknown>`: the contracts hold no `@mikro-orm` import, so the caller's `EntityManager` is a type parameter, as `ModuleInstalledEvent<EM>` is. | Constitution III; `release-intent.md`. |

## F. `packages/modules/admin_users/`

No code change. `src/backend/services/admin-preference-document.test.ts` (added at T025) gains `listViewModes: {}` in the document it expects: the contract's new key reads as its default when no row is stored. The service ignores unknown keys and merges by key, so `listViewModes` needs only the contract. If the per-list merge needs special logic, as `listPageSizes` does, `admin-preference-document.ts` gets one case.

**Premise false, measured at T053:** `AdminPreferenceService.update` writes only the three replaced keys and `listPageSizes`; a `listViewModes` patch passed validation and was silently not stored. So `src/backend/services/admin-preference-document.ts` gains `readStoredListViewModes`, `mergeListViewModes` and `assertListViewModesBound`, and `admin-preference-service.ts` writes the key through one per-list-map writer shared with `listPageSizes` (the row lock unchanged). Tests: the document unit test and `backend/test/contract/admin_users/me-preferences.test.ts` (merge per list, `null` forgets, the two maps independent). Changeset `admin-users-list-view-modes.md` (patch). `backend/test/contract/admin_users/me.test.ts` pins the whole document after a `PATCH` and gains `listViewModes: {}` (shape only) — red since Phase 1 added the key, unseen until the Phase 5 gate ran the file.

## G. Demo, tests, generated files

- **Demo:** `packages/demo-composition/src/projects.ts` writes `task_assignees`. The `tasks` module's demo step is new (R-23). The count in `backend/test/integration/demo/demo-shop.test.ts` moves.
- **Demo role (added at T095):** `packages/modules/admin_roles/src/backend/demo/rows.ts` — `SALES_REPRESENTATIVE_PERMISSIONS` gains `tasks:read` and `tasks:write` (the feature-143 `crm:*` precedent), with a case in `demo.test.ts` beside it and the changeset `admin-roles-demo-sales-rep-tasks.md`. The walk found the demo assigning Tasks to reps who could not open them, so the brief's *My Tasks* scenario was impossible in the demo.
- **Tests found by the planning sweep.** They pin `assignedAdminUserId`, the four literal statuses or `TASK_STATUSES` and are updated in the phase that changes them:
  - `backend/test/integration/tasks/{tasks-crud,write-port,migration,off-state}.test.ts`
  - `backend/test/contract/tasks/tasks.contract.test.ts`
  - `backend/test/perf/tasks/context-visibility.perf.test.ts`
  - `backend/test/integration/projects/{task-context,templates,visibility,stage-tasks,completion-gate}.test.ts`, `helpers.ts`
  - `admin/test/modules/tasks/*`, `admin/test/modules/projects/ProjectDetail.tasks-tab.test.tsx`
- **Documentation (added at T089):** the Polish materialisations and cache entries of the three pages and of the two regenerated module references — `docs/i18n/pl/docusaurus-plugin-content-docs/current/{modules/{tasks,crm,projects},module-reference/{tasks,crm}}.md` and `docs/translation-cache/pl/{packages--modules--{tasks,crm,projects}--docs--*.md,generated:module-reference--{tasks,crm}}.json` (`docs/docs/contributing/documentation-i18n.md`); and, since the page's `description` changed, the regenerated `docs/docs/modules/module-map.generated.md` with its Polish copy and cache entry (`docs--docs--modules--module-map.generated.md.json`).
- **The derived-ledger rule** (AGENTS.md *traps*): before closing each phase, grep `backend/test/**` and `admin/test/**` for every moved path, which includes the two CRM component files.
- **Generated files**, committed in the same merge request: `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` (the tasks package gains peers: `bullmq`, `ioredis`, `@endora-commerce/email-components`).
- **Ledgers that 163 also had to touch**, each in the change that needs it:
  - `packages/contracts/src/errors.ts` (`ERROR_CODES`);
  - `backend/test/fixtures/error-code-routing/reference-ledgers.ts`;
  - `backend/test/helpers/package-entities.ts`;
  - `backend/test/fixtures/openapi-baseline.json` (regenerated);
  - `packages/demo-composition/src/composition.ts` (the Tasks demo step), with the step itself in the new `packages/demo-composition/src/tasks.ts` and its unit test `tasks.test.ts` beside it (added at T088: the step names `admin_users`' and `orders`' rows, so §5.1 puts it in the composition, as the Project Tasks are; `projects.ts`' Stage Tasks gain their `source_key`, R-19).
- **`backend/scripts/ledgers/test-ownership/tasks.ts`** (new, added at T025): a **retained** entry for `backend/test/integration/tasks/migration.test.ts`, which no longer boots a server (it takes `setupMigratorTestDb`, which `check-test-ownership`'s host-composer list does not name) and so reads as a misplaced single-module test; it needs the host's migrated template and registries and cannot move. *(Retired by issue #496: `setupMigratorTestDb` is a host composer now, and the shard is deleted.)*
- **`backend/test/migrator-driving-tests.ts`** (added at T009): the extended `migration.test.ts` drives the Task management migration `down` and `up` against its own database (`setupMigratorTestDb`), and `test/unit/harness/migrator-driving-ledger.test.ts` requires every such file to be listed there.
- **Two enumerating unit tests** (added at the Phase 3 gate): `backend/test/unit/kernel/contribution-absent-owner.test.ts` supplies `assetReferenceRegistry` to the `tasks` composer (a registry of `assets_library`, a binding dependency, pushed into from the new attachment scanner's boot hook); `backend/test/unit/custom_fields/list-filter-admin-only.test.ts` allows `tasks: src/backend/index.ts` to name `customFieldListFilterPort` (the admin Tasks list).
- **`backend/scripts/check-action-route-permissions.ts`** (added at T047): an `ACTION_PERMISSION_DISAGREEMENTS` entry for `tasks:open-task-workflow` — the palette row of `admin-surfaces.md` §4 declares `tasks:configure`, the screen's gate, while the workflow it reads is `tasks:read` (the status picker and the board read it). The `projects:open-project-templates` entry is the precedent. Two more at T083, `tasks:open-task-priorities` and `tasks:open-task-tags`, on the same terms (the priority and tag lists are `tasks:read`: the pickers read them).
- **`backend/test/helpers/task-workflow.ts`** (new, added at T042): `restoreDefaultTaskWorkflow`, the seeded workflow restored before and after a file that changes it (CRM's `restoreDefaultCrmWorkflow`); used by `integration/tasks/workflow.test.ts` and `integration/projects/completion-gate.test.ts`.
- **The saved-view parity tests** (added at T049): `backend/test/integration/saved-list-views/rules-parity.test.ts` gains a `tasks` adapter row (and an optional per-adapter `uniqueIndex`, because the Tasks migration named its index `task_list_saved_views_owner_name_unique` rather than feature 147's `…_owner_name_key_uq`), and `backend/test/contract/saved-list-views/item-id-edges.test.ts` a `tasks` row — feature 147 holds every list with saved views to one rule set, and the Tasks list is now one.
- **The scheduled-work probe copy test** (`backend/test/unit/tenancy/scheduled-work-probes.test.ts`) gains the `tasks` copy. Done at T071: the `tasks` copy and **two** probes (`reminder-service.ts` and `digest-service.ts` `hasWork`, one per pass of the one worker), so the helper-copies case compares the set of modules rather than the probe list.
- **`backend/test/unit/kernel/contribution-absent-owner.test.ts`** (added at T074): the `tasks` composer also supplies `settingWriteValidatorRegistry` (the `tasks.time_zone` validator) and `emailDefaultsPort` (the two e-mails' defaults), both pushed from ungated boot hooks into registries of modules in `dependencies`.

## H. If `tasks` were deleted

What it leaves behind:
- the inert `existingContexts` method in Projects' descriptor;
- the reference kinds `opportunity` and `project`, which are platform-wide and not Tasks concepts;
- the promoted kit components, which are used by CRM.

No other module would name a Tasks table.
