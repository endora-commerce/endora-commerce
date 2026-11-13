---
description: "Task list for Task management — growing the Tasks module"
---

# Tasks: Task management — growing the Tasks module

**Input**: Design documents from `specs/165-task-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution III is non-negotiable.
- In every phase the test tasks come first.
- Run each test and see it fail *for the stated reason* before starting the implementation task that turns it green.
- Report which tests were seen red, under the task, as 163 did.

**Organization**: by user story. Phases 3–5 (US1–US3, all P1) together are the MVP. Phase 2 carries the two shape changes every story stands on: statuses become codes and assignees become a list. It also carries the draft/private visibility predicate, because every later read must be born honouring it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: the task can run in parallel with its neighbours **inside its own phase**: it touches a different file and depends on no unfinished task of that phase.
- **[US#]**: the user story of `spec.md` the task serves. Setup, Foundational and Polish tasks carry none.

## Path conventions

- **Module:** `packages/modules/tasks/` (written `T/` below):
  - `src/manifest.ts`;
  - `src/backend/`, with all composition in the **single** `src/backend/index.ts`, one delimited section per area (`check:port-dependencies` reads only that file);
  - `src/migrations/`, `src/admin/`;
  - `i18n/` and `docs/` at the package root.
- **Other modules:** `C/` = `packages/modules/crm/`, `P/` = `packages/modules/projects/`, `K/` = `packages/admin-kit/src/`, `X/` = `packages/contracts/src/`.
- **Tests:**
  - Unit tests sit beside their subject as `*.test.ts`.
  - Backend tests: `backend/test/{contract,integration,perf}/tasks/`.
  - Admin tests: `admin/test/modules/tasks/`.
- **Targeted runs:**
  - `pnpm --filter backend exec vitest run <path>`
  - `pnpm --filter @endora-commerce/mod-tasks run test`
  - `pnpm --filter admin exec vitest run <path>`
  - `pnpm --filter @endora-commerce/admin-kit run test`
  - `pnpm --filter @endora-commerce/contracts run test`

## Standing rules for every task

1. **Read before writing.**
   - Read the routed convention for what you are about to do (`AGENTS.md` § *Where the rest of it lives*). In particular:
     - `module-migrations.md` before T009;
     - `module-activation.md` before any gate, worker or zone;
     - `module-admin-surfaces.md` before permissions and palette actions;
     - `module-i18n.md` before strings;
     - `release-intent.md` before changesets.
   - Read the prior art the task names: CRM for workflow, tags and board; Projects for comments, references, attachments, mentions and sweeps; quote_requests for saved views.
2. **Re-derive a premise marked "checked first" or "verify"** in `research.md` from the tree, at the task that names it. Record the finding under the task.
3. **Rebuild a package you edited** (`pnpm --filter <pkg> run build`) before running tests against it.
4. **Regenerate generated files, never edit them.** Run `pnpm install --lockfile-only` beside `manifests:generate`.
5. **Touch a file outside `packages/modules/tasks/` only if `contracts/foreign-module-changes.md` lists it**, or it is one of the ledgers in rule 9. Otherwise stop and report.
6. **Every read of a Task-owned table goes through `TaskVisibility` / `TaskAccess`** (R-3, R-21). The seam test (T017) enforces it.
7. **Never run `db:fresh`, `db:reset`, `setup` or `module:*`** against the development database unprefixed.
8. **Commit** in conventional style with `git commit -s` (DCO). Add no `Co-Authored-By` or AI trailer.
9. **Ledgers that 163 had to touch outside the list.** Update each in the change that needs it:
   - `X/errors.ts` `ERROR_CODES`, plus the manifest `errorCodes`, each in the change that adds a code's first raise site;
   - `backend/test/fixtures/error-code-routing/reference-ledgers.ts` (`MINTED_ERROR_CODES`);
   - `backend/test/helpers/package-entities.ts` (new entities);
   - `backend/test/fixtures/openapi-baseline.json` (regenerate it with `UPDATE_OPENAPI_BASELINE=1` and check that only Tasks routes changed);
   - `backend/scripts/check-command-coverage.ts` (only if a new command-coverage ignore needs it).
10. **Admin tests on Node 26:** if `window.localStorage` is undefined, run with `NODE_OPTIONS=--no-experimental-webstorage` (163 T012).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the contract shapes, the manifest declarations and two measured facts the design depends on. Nothing is user-visible yet.

- [X] T001 Measure the two premises the plan defers to implementation and record both answers under this task. Do not proceed past Phase 2 if (a) or (b) is answered "no" without picking the planned fallback.
  - (a) Can one Command write extra audit rows? Read `packages/platform/src/` for the `CommandBus` and the audit writer API.
  - (b) Does `adminNotificationRecordPort.record` share the caller's EntityManager or transaction? Read `packages/modules/admin_notifications/src/backend/`.
  - **(a) Measured 2026-10-28: yes.** `CommandBus.run` (`packages/platform/src/commands/command-bus.ts:46-78`) opens one `scoped.transactional(em => …)` and writes exactly **one** row itself (`:57-69`, `audit.recordWithin(em, …)`); nothing stops `run` from adding more. A Command's `run` receives that transactional em as `ctx.em` (`command.ts:39-43`). The published writer `recordAuditFromContext(auditLog, em, input)` (`commands/audit-from-context.ts:27-42`, exported from `@endora-commerce/platform/commands`, `index.ts:59`) calls `AuditPort.recordWithin(em, …)` (`kernel/ports/audit.ts:64`), whose implementation is `em.create` + `em.persist` with **no fork and no flush** (`kernel/audit/audit-log-service.ts:46-50`) — so the extra rows commit or roll back with the Command. `tasks` already has `auditLogService: AuditPort` in its cradle (`T/backend/index.ts:46`, used at `:109-116`). Precedent for a batch of rows in one unit of work: `CartAuditService` (comment at `audit-log-service.ts:39-43`). `check:command-coverage` does not inspect `recordWithin`/`recordAuditFromContext` calls (no match in `backend/scripts/check-command-coverage.ts`). Two things the reassignment Command must do itself: `recordAuditFromContext` fills only the actor, not `ipAddress`/`userAgent`/`requestId` (the bus fills those from `getRequestMeta`, `command-bus.ts:49,66-68`), and each row is a managed entity, so 5 000 rows are 5 000 entities in the identity map of one flush — inside the R-1 bound, but worth the perf test. **R-1's planned path stands; the batched-Commands fallback is not needed.**
  - **(b) Measured 2026-10-28: no.** `adminNotificationRecordPort.record(input)` takes no EntityManager (`packages/contracts/src/admin-notifications.ts:94-96`; adapter `admin_notifications/src/backend/services/admin-notification-port.ts:23-25`). `AdminNotificationService.record` calls `this.emFactory()` (`admin-notification-service.ts:108`) and `persistAndFlush` (`:121`), then `pruneStale` on another fresh fork (`:122`, `:330`). `emFactory` is `() => forkScopedEm(orm)` (`packages/platform/src/kernel/container.ts:80`), i.e. `orm.em.fork()` (`tenancy/scoped-em.ts:10-12`); MikroORM 6.6.16's `fork` copies the transaction context only under `keepTransactionContext` (`@mikro-orm/core/EntityManager.js:1436-1438`), which is not passed — so the bell row is written on its own connection in autocommit, never inside the caller's transaction. **Planned fallback chosen: delivery row first (its unique `(reminder_id, admin_user_id)` is the claim), bell after commit.** One premise of that fallback is false: `admin_notifications` has **no** de-duplication on `subjectId + kind + recipient` — the table has a plain `@Index()` only (`admin-notification.entity.ts:41`) and `record` inserts unconditionally. The fallback does not need it (the delivery row is the claim), but the consequence must be written into the spec before Phase 7: the bell becomes **at most once** too (a crash between the delivery commit and `record` loses it), which contradicts SC-004 "exactly once" for the bell and FR-035 "at least once". The only way to keep exactly-once is a co-transactional variant of the port (`recordWithin(em, …)`) in `admin_notifications`, which `contracts/foreign-module-changes.md` does not list — an owner/architect decision for Phase 7, not taken here.
  - **Decided 2026-10-28 (orchestrator ruling 3):** add the co-transactional `recordWithin(em, …)` to the `admin_notifications` record port (additive; `foreign-module-changes.md` §E2). Implemented at T072, not before.
- [X] T002 [P] Write failing schema tests in `X/tasks.test.ts`. Cover one accept case and one reject case for every request schema of `contracts/admin-api.md` §1–§5:
  - `assigneeIds` ≤ 20, unique;
  - `tagIds` ≤ 50;
  - `dueOn` and `dueAt` mutually exclusive;
  - `links` kinds;
  - status `{to, from}`;
  - reminder absolute xor relative, recipients 1–21;
  - status code snake_case;
  - colour `#rrggbb`;
  - list query `sort` and `dir`, repeatable filters normalised to arrays;
  - `NewContextTask.sourceKey` ≤ 100;
  - the `UpdateTaskBody` refusal of `status`.
  - The 163 file was rewritten on the new shape; its still-valid cases (context all-or-nothing, title bounds, list page shape, batch max) were kept. Beyond the list above it also pins the vocabulary and limits, the absence of `TASK_STATUSES` / `TASK_CLOSED_STATUSES`, the board query (`perColumn` 1–50, no cursor or sort), every §2–§5 body, the summary and board response shapes, the four event names and R-20's codes.
  - Seen red 2026-10-28: 41 of 47 failed for the stated reason — every new export was `undefined` (`Cannot read properties of undefined (reading 'safeParse')`), `TASKS_EVENTS` still had `ASSIGNED`, `TASKS_ERROR_CODES` lacked `TASK_STATUS_UNKNOWN`. The 6 that passed are 163 cases whose shape did not change. Green after T004 (47/47).
- [X] T003 [P] Write failing tests in `X/record-references.test.ts` for the grammar with `opportunity` and `project`:
  - format, extract and split;
  - `RECORD_DOCUMENT_KINDS` order: order, quote_request, task, opportunity, project;
  - an unknown type is left as text.

  Also write failing tests in `X/admin-preferences.test.ts` for `listViewModes`:
  - kebab-case list id;
  - values `list` / `board`;
  - `null` deletes the entry;
  - the tolerant read falls back to `{}`.
  - The 163 cases that used `project` or `opportunity` as the *unknown* type (extract, split, `RecordReferenceSchema`, the document-kind refusal) now use `campaign`; `[[project:42]]` (not a uuid) is still left as text.
  - Seen red 2026-10-28: 10 failed — `record-references.test.ts` 5 (`opportunity` / `project` not in the enum, not extracted or split, `RECORD_DOCUMENT_KINDS` the three of 163), `admin-preferences.test.ts` 5 (`listViewModes` absent from the keys and the defaults, refused by the strict patch, missing on read). The four `listViewModes` refusal cases passed red only because the strict patch refuses any unknown key; they stay meaningful once the key exists. Green after T005.
- [X] T004 Implement `X/tasks.ts` per `contracts/admin-api.md`, `contracts/ports-and-events.md` and `data-model.md` §8. Every later story adds no contract.
  - Status codes: `TASK_DEFAULT_STATUS_CODES`, `TASK_STATUS_CATEGORIES`, `taskStatusCodeSchema`.
  - Limits: `TASK_ASSIGNEES_MAX`, `TASK_TAGS_MAX`, `TASK_HIERARCHY_DEPTH_MAX`, `TASK_STATUS_REASSIGN_MAX`, `TASK_ATTACHMENT_MAX_BYTES`, `TASK_REMINDER_GRACE_MS`, `TASK_REMINDERS_MAX`.
  - Every request and response schema.
  - `TaskRecord` and `NewContextTask` in the new shape.
  - Optional `TaskContextDescriptor.existingContexts`.
  - The event schemas in the new shape.
  - `TASKS_ERROR_CODES`, extended with R-20's codes.
  - Remove `TASK_CLOSED_STATUSES` and `tasks.task.assigned.v1`.
  - T002 green.
  - Then run `pnpm -r run typecheck` and paste the list of consumer errors under this task: it is Phase 2's worklist, and it must match `foreign-module-changes.md` §G.
  - **Deviations from `contracts/admin-api.md`, each a judgement call Phase 2 may revisit:**
    - `GET /tasks` keeps 163's `{items, nextCursor}` (admin-api §1 writes `{data, nextCursor, prevCursor?}`); renaming `items` is a breaking change no requirement asks for. `prevCursor` is added as optional.
    - Custom-field values are `customFieldValues`, not `customFields` — the Projects precedent (`X/projects.ts:268,285,706`) and the name `CustomFieldValuesPanel` reads.
    - `TaskDetail` lists its sub-tasks as `subtaskItems`: `subtasks` is already the summary's `{closed, total}`, which the detail extends — admin-api §1 uses one name for both.
    - `TaskDetail.createdBy` keeps 163's name for admin-api's `creator`.
    - A link is `{id, kind, recordId, available, label, url}`, `id` being the link's own id that `DELETE /tasks/:id/links/:linkId` takes; admin-api's `{kind, id, …}` cannot carry both.
    - `DELETE /tasks/:id` is written as "204" **and** "reports `{subtasksDetached}`"; `TaskDeleteResponseSchema` (`{data: {subtasksDetached}}`) exists, and US5 decides between a 200 with that body and a bare 204.
    - `UpdateTaskBody` also refuses `draft` (publishing is `POST /publish`, one-way). `CreateTaskBody` refuses `private` together with a `context` in the schema as well as in the database check (FR-038). A priority may not be created with the code `none`, the filter token.
    - Bounds the contract did not name: `TASK_LINKS_MAX` 20 (from admin-api §1), `TASK_REMINDER_RECIPIENTS_MAX` 21, `TASK_REMINDER_OFFSET_MAX_MINUTES` 30 days, `TASK_MINE_MAX` 500, `TASK_BOARD_PER_COLUMN_{DEFAULT,MAX}` 25/50.
    - `NewContextTask` is now `z.input<typeof NewContextTaskSchema>` (T002 tests `sourceKey` ≤ 100, which needs a schema); it gains `contextGroupId?` per `ports-and-events.md` §2. `TaskRecord` also gains `dueAt`.
    - The R-20 codes are **not** added to `ERROR_CODES` (`X/errors.ts`): each joins it with its first raise site (standing rule 9, 163 T008 precedent).
  - **Consumer worklist, measured 2026-10-28** with `pnpm -r --no-bail run typecheck` after rebuilding every package but `mod-tasks` and `mod-projects` (both fail to build until Phase 2): **55 errors in 17 files**. Every one is the old shape — `TaskStatus` / `TASK_STATUSES` / `TASK_CLOSED_STATUSES` / `TaskAssignedEvent` / `TASKS_EVENTS.ASSIGNED` no longer exported, `assignedAdminUserId` / `assignee` gone, `status` a string where an object is expected, `toCategory` missing, `status` no longer in `UpdateTaskBody`:
    - `packages/modules/tasks/src/backend/admin-search-provider.ts`: :6 TS2724
    - `packages/modules/tasks/src/backend/entities/task.entity.ts`: :2 TS2724; :2 TS2724
    - `packages/modules/tasks/src/backend/services/task-commands.ts`: :5 TS2724; :9 TS2724; :122 TS2353; :171 TS2339; :211 TS2741
    - `packages/modules/tasks/src/backend/services/task-read-port.ts`: :50 TS2353
    - `packages/modules/tasks/src/backend/services/task-service.ts`: :5 TS2305; :17 TS2724; :87 TS7006; :205 TS2367; :207 TS2367; :387 TS2339; :421 TS2339; :431 TS2339; :432 TS2339; :433 TS2339; :435 TS2339; :482 TS2740; :614 TS2322
    - `packages/modules/tasks/src/backend/services/task-write-port.ts`: :71 TS2339
    - `packages/modules/projects/src/backend/services/stage-task-service.ts`: :4 TS2305; :258 TS2339; :263 TS2339; :268 TS2322
    - `admin/test/modules/projects/ProjectDetail.tasks-tab.test.tsx`: :79 TS2322
    - `admin/test/modules/tasks/TaskDetail.test.tsx`: :142 TS2322; :164 TS2561; :165 TS2561; :180 TS2561
    - `admin/test/modules/tasks/TasksList.test.tsx`: :44 TS2322
    - `admin/test/modules/tasks/tasks-fixtures.tsx`: :98 TS2322; :115 TS2719
    - `packages/modules/projects/src/admin/pages/project-detail/tabs/TasksTab.tsx`: :164 TS2551
    - `packages/modules/tasks/src/admin/api.ts`: :8 TS2724
    - `packages/modules/tasks/src/admin/components/StatusBadge.tsx`: :2 TS2724
    - `packages/modules/tasks/src/admin/components/task-columns.tsx`: :63 TS2551; :64 TS2551
    - `packages/modules/tasks/src/admin/pages/TaskDetail.tsx`: :6 TS2724; :10 TS2724; :148 TS2353; :151 TS2353; :219 TS2322; :223 TS7006; :272 TS2551; :274 TS2551; :275 TS2551; :282 TS2551; :401 TS2551; :414 TS2551
    - `packages/modules/tasks/src/admin/pages/TasksList.tsx`: :4 TS2724; :4 TS2724; :185 TS7006
  - **Against `foreign-module-changes.md` §G/§D:** every file outside `packages/modules/tasks/` is listed — `stage-task-service.ts` and `TasksTab.tsx` (§D), the admin tests (§G `admin/test/modules/tasks/*`, `ProjectDetail.tasks-tab.test.tsx`). **No consumer missing from the list.** The converse does not hold, and Phase 2 must not read the typecheck as the whole worklist: §G's backend tests (`backend/test/integration/tasks/*`, `contract/tasks/*`, `perf/tasks/*`, `integration/projects/*` + `helpers.ts`) and `packages/demo-composition/src/projects.ts` produce **no** type error — they pin the old shape through raw SQL and untyped JSON, so they fail only at run time.
  - Before the rebuild the same run reported 22 more errors (`useAdminPreference` not exported from `@endora-commerce/admin-kit/lib`, `AdminMe.preferences`, a missing `admin_users` migration export): stale `dist`s from #478, gone after `build:packages`, unrelated to this change.
- [X] T005 [P] Extend the reference grammar and the read ports.
  - `X/record-references.ts`: add `opportunity` and `project` to both arrays.
  - `X/crm.ts`: `OpportunityReadPort.findByIds` and `search`.
  - `X/projects.ts`: `ProjectReadPort.findByIds` and `search`.
  - `X/custom-fields.ts`: add `'task'`.
  - `X/saved-list-views.ts`: Task view create and update schemas.
  - `X/admin-preferences.ts`: `listViewModes` in keys, patch, read and defaults.
  - T003 green. Rebuild `contracts`.
  - Done 2026-10-28: the contracts suite is 71 files / 1 542 tests green, `tsc` and `eslint` clean, `contracts` rebuilt. Added beside the methods: `OpportunitySearchQuery` / `OPPORTUNITY_READ_PORT_SEARCH_MAX` and `ProjectSearchQuery` / `PROJECT_READ_PORT_SEARCH_MAX` (20); `ADMIN_LIST_VIEW_MODES`, `adminListViewModeSchema` and `ADMIN_LIST_VIEW_MODES_MAX` (128, as `listPageSizes`). The read side is `z.record(z.string(), z.string()).catch({})`, so a document stored before 165 parses.
  - **Sequencing note.** `plan.md` *Risks* says the grammar widening lands "in the same commit" as CRM's and Projects' check migrations; this task puts it in Phase 1 and the migrations in T032. Between the two, on this branch only, pasting `[[opportunity:…]]` or `[[project:…]]` into a CRM or Project text would be extracted and then refused by `crm_opportunity_references_target_type_check` / `project_references_target_type_check`. Nothing merges before Phase 10, so this was followed as written; the window closes at T032. Likewise `OpportunityReadPort` / `ProjectReadPort` gain required methods here that are implemented at T033, so the CRM and Projects read-port classes are red in typecheck until then (T008 counts them).
- [X] T006 Extend `T/manifest.ts`:
  - **Permissions:** `tasks:configure` and `tasks:see_private`, both `requires: ['tasks:read']`, with labels in `T/../i18n/{en,pl}.json` (`packages/modules/tasks/i18n/`).
  - **Settings:** `tasks.board_card_fields` (json, default from `data-model.md` §4) and `tasks.time_zone` (string, `Europe/Warsaw`).
  - **`dependencies`:** add `custom_fields`, `assets_library`, `transactional_emails`, `orders` and `catalog`.
  - **`nonBindingDependencies`:**
    - `degrades-without` on `crm` / `opportunityReadPort`, `quote_requests` / `quoteRequestReadPort` and `projects` / `projectReadPort`, with the `whenAbsent` sentences of `contracts/ports-and-events.md` §4;
    - `contributes-to` on the asset-reference registry (read `P/manifest.ts` for its exact name).
  - **`transactionalEmails`:** `tasks_task_reminder` and `tasks_daily_digest`, with variables.
  - Run `pnpm --filter backend exec vitest run test/unit/db/module-graph.test.ts` and confirm no cycle.
  - **Deviation — no `contributes-to` edge on the asset-reference registry.** The premise is false: `assetReferenceRegistry` is owned by `assets_library`, which this task also puts in `dependencies`, and `defineModuleManifest` refuses a non-binding edge on a module already in `dependencies` ("one edge, one claim", `packages/contracts/src/modules.ts:1143-1152`). `P/manifest.ts:99-103` covers the same registry by its `dependencies` entry alone, with no `contributes-to`; Tasks does the same, and the manifest comment says why.
  - Also added: `settingLabels.tasks.{board_card_fields,time_zone}.{name,description}` in both bundles (Projects' precedent; `tasks.enabled` has none, left as it is), and five cases in `T/backend/manifest.test.ts` (permissions, settings defaults, the three `degrades-without` edges with sentences, the two e-mails) — written after the manifest, not red first. 6/6 green.
  - **Cycle check, 2026-10-28:** `module-graph.test.ts` **cannot run** before Phase 2. Every backend vitest run loads `entities-registry.generated.ts`, which imports the `tasks` backend from source, and `task-service.ts:87` reads the removed `TASK_CLOSED_STATUSES` at module load (`TypeError: Cannot read properties of undefined (reading 'map')`) — so the whole backend suite is down from T004 until T016. Measured instead with the same input the test reads: a `tsx` script over `DISCOVERED_MANIFESTS` (after emitting `mod-tasks/dist` with `--noEmitOnError false`, since the package does not type-check until Phase 2) — 67 modules, `defineModuleManifest` accepted the manifest, **no cycle**. Re-run the real test at T008/T025 once the backend loads.
- [X] T007 [P] Write the changesets:
  - `.changeset/contracts-task-management.md`: breaking (event and status shapes), a minor version in `0.x` per `release-intent.md`;
  - `.changeset/tasks-task-management.md`;
  - `.changeset/admin-kit-tags-move-menu-view-modes.md`;
  - `.changeset/crm-reference-kinds.md`;
  - `.changeset/projects-reference-kinds-stage-task-keys.md`;
  - `.changeset/custom-fields-task-host.md`.

  Verify with `pnpm --filter backend exec tsx scripts/check-release-intent.ts --since origin/master`.
  - Every bump is `minor` (D-225 refuses `major` in `0.x`; `plan.md`'s "mod-tasks (major)" is written as a breaking `minor`). Each body is written for the consumer of the whole feature, old call and new call for the contracts break, so the later phases add no changeset unless they change something these do not say. `check-release-intent --since origin/master` green 2026-10-28: `changesets-added=6 violations=0`.
- [X] T008 Phase gate. Run:
  - `pnpm run build:packages`
  - `pnpm --filter backend run manifests:generate && pnpm install --lockfile-only && pnpm --filter backend run composer:generate`
  - `pnpm -r run typecheck`

  Typecheck is **expected red** in Phase 2's worklist files only (T004). Record the count.
  - Measured 2026-10-28.
    - **`build:packages`: red in five packages**, `mod-tasks`, `mod-projects` (the T004 worklist) and `admin-kit`, `mod-custom-fields`, `mod-crm` (T005's additions: the exhaustive reference-kind maps, `SUPPORTED_ENTITIES` / the storage binding without `task`, and the read-port classes without `findByIds`/`search`). With `noEmitOnError` their `dist`s stay at the last good build, so until each is fixed `admin`, `backend` and the other packages compile and run against the **old** `admin-kit`, `mod-crm` and `mod-custom-fields`.
    - `manifests:generate` changed nothing; `pnpm install --lockfile-only` changed nothing (no new peer yet — `bullmq`, `ioredis`, `@endora-commerce/email-components` arrive with their first import); `composer:generate` reordered `backend/src/composition.generated.ts` (the new `dependencies` move `tasks` later in the topological order) and regenerated `docs/docs/module-reference/tasks.md` (the new permissions, settings and e-mails). Both committed.
    - **`pnpm -r run typecheck`: 72 errors.** The 55 of T004's worklist, unchanged, plus 17 from T005, every one in a file `foreign-module-changes.md` lists: `K/components/references/{ReferenceText.tsx:35,reference-node.ts:28}` (§B; reported three times, through `admin-kit`, `admin-shell` and `page-builder-admin`), `packages/modules/custom_fields/src/backend/services/{custom-field-registry.ts:68,host-storage-binding.ts:18}` (§E; twice, also through `backend`), `C/backend/services/opportunity-read-port.ts:28` and the registration it breaks at `C/backend/index.ts:1009`, `C/backend/services/reference-service.ts:65,139` (§C), `P/backend/services/project-read-port.ts:23` and `P/backend/index.ts:428`, `P/backend/services/reference-service.ts:66` (§D). The two `index.ts` lines are the port registrations failing because the class no longer satisfies the port; they clear with T033.
    - `check:naming`, `check:language`, `check-release-intent` green. **`check:port-dependencies` red**: the three new `degrades-without` edges (`crm:opportunityReadPort`, `quote_requests:quoteRequestReadPort`, `projects:projectReadPort`) resolve nothing in `T/backend/index.ts` yet ("A declaration with no resolution under it … Delete it."). They clear when the reference/link services first resolve each port (US1, US6); kept, as T006 asks.
  - **What Phase 2 must know.** (1) The **whole backend vitest suite cannot load** until T016: global setup imports the `tasks` backend from source and `task-service.ts:87` maps the removed `TASK_CLOSED_STATUSES` at module load. (2) T025's gate (`build:packages`, `pnpm -r run typecheck`) **cannot go green within Phase 2 as tasks are ordered**: the T005 failures above belong to T033 (read ports), the CRM/Projects reference work of US1 and the custom-fields host (US1), all Phase 3. Either Phase 2 takes the minimal part of each (the two `findByIds`/`search` pairs, the two reference maps and the resolvers' `opportunity`/`project` arms answering unavailable, the `task` registry and binding rows) or T025 records them as expected red. Not decided here.

**Checkpoint**: the contracts say what the feature is, and the consumers that must change are enumerated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**:
- the whole new schema;
- statuses as codes everywhere;
- assignees as a list everywhere;
- the draft/private visibility predicate and `TaskAccess`;
- the seam test;
- generalised list sorting.

Every existing tasks, Projects and demo test must be green on the new shape before any story starts.

**⚠️ CRITICAL**: no user story starts before T030 is green.

### Tests first

- [X] T009 [P] Extend `backend/test/integration/tasks/migration.test.ts` and see it fail. It covers:
  - from a database at the 163 schema with Tasks holding each status and some assignees, `up` gives every table, column, check and index of `data-model.md` §1–§3;
  - the seeds: four statuses with categories, twelve transitions, four priorities with en and pl names;
  - `task_assignees` holds exactly the former assignees, and `assigned_admin_user_id` is gone;
  - `published_at` equals `created_at` for existing rows;
  - `down` restores the 163 shape, including the single assignee (the first by `assigned_at`).
  - Seen red 2026-10-28: 14 of 16 failed for the stated reason — no table, column, check, index or seed of 165, and `the task_management migration is not exported from ./migrations`. Green after T013/T014 (16/16, then 17/17 with the registration case below).
  - The file now takes `setupMigratorTestDb` (a database of its own) and is listed in `backend/test/migrator-driving-tests.ts` (line added to `foreign-module-changes.md` §G). It asks the migrator which migrations it executed (the task_management class is among them) and then runs the migration **class** directly for `down`/`up`/`down`: `migrator.down()` would revert every module ordered after `tasks`. Because it no longer boots a server, `check-test-ownership` read it as a misplaced single-module test: a **retained** entry in the new shard `backend/scripts/ledgers/test-ownership/tasks.ts` says why it stays (it needs the host's template and registries; §G line added at T025); the check's gap — `setupMigratorTestDb` is not in its host-composer list — is issue #496, which added it and deleted the shard).
  - The `down` maps a status outside the four seeded codes to the seeded code of its category (`todo` for an open one) before restoring the check; the 163 single assignee is the first by `assigned_at`, ties by admin id.
- [X] T010 [P] Write failing unit tests:
  - `T/backend/domain/task-status-graph.test.ts`: the R-1 rules, one per refusal, plus `allowedTargets` and `canTransition`;
  - `T/backend/domain/list-cursor.test.ts`: round-trip for every sort key, nulls last, and a tampered cursor refused;
  - `T/backend/domain/due-moment.test.ts`: overdue for `due_at` versus date-only in `Europe/Warsaw`, across a DST change.
  - Seen red 2026-10-28: all three files failed to load (`Cannot find module './task-status-graph.js'` / `list-cursor.js` / `due-moment.js`). Green after T015 (43/43).
  - DST cases: date-only overdue across 2026-10-25 (CEST→CET) and 2026-03-29 (CET→CEST) in `Europe/Warsaw`; the 09:00 base of a date-only reminder on both sides of each change.
- [X] T011 [P] Extend `T/backend/services/task-visibility.test.ts` with the draft/private conjunct of R-3:
  - the Creator sees their own draft and their own private Task;
  - another admin sees neither;
  - a `tasks:see_private` holder sees the private Task and not the draft;
  - the system actor sees everything.
  - Seen red 2026-10-28: 13 of 21 failed — the 163 SQL expectations gained the conjunct, and the new draft/private cases saw no rule. Green after T018 (21/21). Also covered: a hidden draft is refused before its context is asked; a caller with no administrator behind it sees no draft and no private Task.
- [X] T012 [P] Write failing `backend/test/integration/tasks/draft-private-baseline.test.ts`, seeded directly in the database because the UI and the writes come in US8. A private Task and a draft of admin A are absent for admin B from:
  - `GET /tasks`, `/tasks/mine` and `/tasks/:id` (404 identical to non-existent);
  - `taskReadPort.findById`, `findByIds` and `search`;
  - the global search provider.
  - Not seen red for the stated reason: before T013 the seed itself failed (no `is_draft` column), and the file was first run after T018. The predicate it exercises was seen red in T011. Green 2026-10-28 (5/5). *My Tasks* implies "no draft" for everyone (admin-api §1), so the Creator's own draft is absent from their `/mine` too — the control asserts that.

### Schema and entities

- [X] T013 Scaffold `pnpm --filter backend run migration:new -- --module tasks --name task_management` and write `up` and `down` in `T/migrations/<stamp>_tasks_task_management.ts` per `data-model.md` §1–§3.
  - **Order inside `up`:** create the tables → seed → copy assignees → drop the column → add the checks.
  - Export it from `T/migrations/index.ts`.
  - `20261028T140002_tasks_task_management.ts`, exported from `T/migrations/index.ts`; `composer:generate` registered it. Order inside `up` as written. Index names: `tasks_parent_task_id_index`, `tasks_priority_code_index`, `tasks_context_source_key_unique`, `tasks_created_by_hidden_index`, `tasks_due_at_index`. Additions the data model implied: `tasks_source_key_length_check` (≤ 100), `task_statuses_code_check` / `task_priorities_code_check` (snake_case; a priority may not be `none`), `task_list_saved_views_filters_size_check` (8 KB), an index on `task_reminders(task_id)`. Assignees copied with `assigned_at = updated_at` (163 recorded no assignment time). Seed colours: todo `#64748b`, in_progress `#f59e0b`, done `#10b981`, cancelled `#94a3b8`; priorities urgent `#dc2626`, high `#f97316`, normal `#3b82f6`, low `#94a3b8`.
- [X] T014 Create the entities in `T/backend/entities/`:
  - `@RuleScoped`: `task-assignee`, `task-tag-assignment`, `task-comment`, `task-reference`, `task-attachment`, `task-record-link`, `task-relation`, `task-reminder`, `task-reminder-delivery`;
  - `@GlobalEntity`: `task-status`, `task-status-transition`, `task-priority`, `task-tag`, `task-list-saved-view`, `task-digest-subscription`.

  Then:
  - alter `task.entity.ts` per §1 and drop `assignedAdminUserId`;
  - export all of them from `T/backend/index.ts`;
  - add them to `backend/test/helpers/package-entities.ts`;
  - run `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only`.

  T009 green. `check-entity-tenant-classification` green.
  - Fifteen classes; the join tables hold their ids by value (no ORM relation), so the create Command flushes the Task before writing its assignee rows (the unit of work cannot order them otherwise — seen as an FK violation). `check-entity-tenant-classification`: 266 entities, 266 classified. `manifests:generate` and `pnpm install --lockfile-only` changed nothing (no new peer: the time-zone setting is read with `TaskTimeZoneSchema.shape.timeZone`, not a module-local `zod` import).

### Shape changes: statuses and assignees

- [X] T015 Implement the pure domain code:
  - `T/backend/domain/task-status-graph.ts`, copied from `C/backend/domain/opportunity-status-graph.ts` with categories;
  - `T/backend/domain/list-cursor.ts`;
  - `T/backend/domain/due-moment.ts`.

  T010 green.
  - `TaskStatusGraph` rules: `exactly_one_initial`, `initial_must_be_open`, `done_status_required`, `cancelled_status_required`, `transition_unknown_status`; `isClosed` treats a code the workflow no longer holds as open. `list-cursor`: one key per sort (`due` = the date then the UTC time, a date-only Task after the timed ones of its day; `priority`/`status` = the joined weight), nulls last in both directions, cursor `{s,d,k,i}` refused (400) under another sort or direction. `due-moment`: `todayIn`, `dueOnFor`, `isOverdue`, `dateOnlyMoment`.
- [X] T016 Rework the existing services onto the new shape. No new behaviour yet.
  - `T/backend/services/task-commands.ts`:
    - status codes, with `completedAt` set on entering a `done`-category status;
    - `assignees_change` replaces `assign`;
    - the events use the new payloads.
  - `task-service.ts`:
    - the summary carries `status {code, name, color, category}`, `closed` and `assignees[]`;
    - the closed SQL uses categories;
    - `assignee[]` filter;
    - `/mine` reads through `task_assignees`.
  - `task-read-port.ts`, `task-write-port.ts` (`assigneeIds`), `task-checks.ts`, `admin-search-provider.ts`, `task-history-service.ts`.
  - **Fix the F-14 gap:** `#assigneeMaySee` requires the recipient to hold `tasks:read` (`permissionService.listPermissions`) before `canSeeAs`. Add a case to `backend/test/integration/tasks/tasks-crud.test.ts` and see it red first.
  - **Status changes** now go through the graph. The `TaskTransitionService` arrives in US2. Until then, `PATCH` with `status` is removed per the contract, and `POST /tasks/:id/status` is implemented with the graph check only. This keeps `tasks-crud.test.ts` meaningful.
  - **Unblocking first** (orchestrator ruling 1): `task-service.ts` read the removed `TASK_CLOSED_STATUSES` at load; a two-code constant replaced it in a separate commit, and the `mod-tasks` `dist` was re-emitted (`--noEmitOnError false`, as Phase 1 did) until the package type-checked again, because every package resolves at its `dist` (D-164). After that the backend suites loaded.
  - Done 2026-10-28 as written, with: summaries also carry `dueAt`, `priority`, `tags`, `parent`, visible `subtasks`, `draft`, `private`; overdue is computed per row in `tasks.time_zone` (date only) or at `due_at`; a code the workflow no longer holds is shown as itself, open. `POST /tasks/:id/status` checks: 422 `TASK_STATUS_UNKNOWN`, 409 `TASK_TRANSITION_CONFLICT` (also re-checked under the Command's lock), 409 `TASK_TRANSITION_FORBIDDEN {allowedTargets}`; a move to the current status is a no-op. Four error codes joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with their first raise site (`TASK_STATUS_UNKNOWN`, `TASK_TRANSITION_FORBIDDEN`, `TASK_TRANSITION_CONFLICT`, `TASK_PRIVATE_READ_ONLY`). The manifest gained `admin_roles` in `dependencies` (`permissionService`).
  - **F-14:** seen red 2026-10-28 with the check removed — `tells nobody who may not read Tasks at all` failed (`expected [ …(1) ] to deeply equal []`, the outsider was rung); green with it. `TaskRecord` gained `statusName`/`statusDefaultName`/`statusColor`/`updatedAt` (contract line in `foreign-module-changes.md` §A, changeset updated) so Projects can label a status; see T019.
  - **Not done here (later stories, per "no new behaviour"):** `CreateTaskBody`/`UpdateTaskBody` fields `dueAt`, `startOn`, `priorityCode`, `tagIds`, `customFieldValues`, `parentTaskId`, `links`, `draft`, `private` are accepted by the schema and **ignored** by the service until US1/US5/US6/US8; the write port ignores `sourceKey` until US10; the list ignores `customFieldFilters` until T038; `DELETE` keeps the `tasks:write` gate (the `see_private` delete is US8).
- [X] T017 Write and implement `backend/test/integration/tasks/visibility-seam.test.ts`.
  - It fails if any file under `T/backend/` other than `task-visibility.ts`, `task-access.ts` and the listed sweep services (`reminder-service`, `digest-service`, `maintenance-service`) issues SQL naming `tasks` or a `task_*` child table.
  - It reads the sources the way `project-access-seam.test.ts` does (read that test first).
  - The allow-list is a two-way ledger in the test.
  - **Deviations.** (1) Co-located as `T/backend/task-visibility-seam.test.ts`, not `backend/test/integration/tasks/visibility-seam.test.ts`: it reads module sources only, and `project-access-seam.test.ts` — the precedent the task names — is co-located (module-test-ownership contract §2). (2) The allow-list is `TASK_ACCESS_READERS` in `task-access.ts` (Projects' `PROJECT_ACCESS_READERS` shape), not the literal three files: the list's SQL, the summaries' child reads and the Commands' locked re-reads live in `task-service.ts`, `task-commands.ts` and `task-write-port.ts`, each listed with why every read composes the predicate or is keyed by an id `TaskAccess` handed out. The sweeps join it when they exist. Two-way ledger plus a per-file read count (access 2, commands 4, service 20, visibility 0, write-port 1); `task-number.ts` is the one SQL file reading no rule-scoped table.
  - Written alongside T018, so not seen red against the 163 tree; seen red 2026-10-28 by removing `task-service.ts` from the allow-list (3 cases red, naming `services/task-service.ts:207: SQL reads "tasks"` …). Green 11/11.
- [X] T018 Implement draft/private in `T/backend/services/task-visibility.ts`: the conjunct of R-3, using the caller's id and `tasks:see_private`.

  Create `T/backend/services/task-access.ts` with:
  - `loadVisible(id)`;
  - `assertMayChange(task)`: `TASK_PRIVATE_READ_ONLY`, plus 163's `canChangeTasks`;
  - `assertMayDelete(task)`.

  Route every existing read and write through them. T011, T012 and T017 green.
  - `TaskVisibility` takes `viewer()` (the caller's id and `permissionService.hasPermission(id, 'tasks:see_private')` — the capability-check shape the permission inventory reads); the conjunct is `created_by = :me or (not is_draft and not is_private)`, or `… or not is_draft` for a `see_private` holder; the system is not narrowed and not asked. `canSeeContext` serves the history's context-only question. `TaskAccess`: `findVisible`, `loadVisible`, `rowAfterWrite`, `assertMayChange` (403 `TASK_PRIVATE_READ_ONLY`), `assertMayDelete` (163's `canChangeTasks`). **Deviation:** 163's `canChangeTasks` stays asked where 163 asked it (into/out of a record, delete), not on every write — asking it on an in-place edit would be new behaviour; `TaskDetail.permissions.canChange` is `tasks:write` and not someone else's private Task. T011, T012, T017 green.
- [X] T019 Adapt Projects to the new shape (`foreign-module-changes.md` §D).
  - `P/backend/services/stage-task-service.ts`: the local `CLOSED` set becomes `summary.closed`, and it uses `assigneeIds: [holder]`.
  - `P/admin/pages/project-detail/tabs/TasksTab.tsx`: status from `status.name` and `status.color`, assignees as a list.
  - Remove `tasks.status.*` from `P/../i18n/{en,pl}.json` (`packages/modules/projects/i18n/`) after grepping that no other key reader remains.

  Run `backend/test/integration/projects/{stage-tasks,completion-gate,task-context,templates,visibility}.test.ts` and update only the assertions that pin the old shape, listing each one under this task.
  - Done 2026-10-28. `tasksByStage(projectId, language)` — the route passes `request.responseLanguage()` (`routes.stage-tasks.ts`, line added to §D) — names each status from `TaskRecord.statusName[language] || statusDefaultName` with its colour; overdue is `!closed` and past `dueAt`, or `dueOn` before today in the Projects time zone; priority/tags/parent/sub-tasks are neutral (the tab shows none). `tasks.status.*` removed from both Projects bundles (the one other reader was the admin test, updated).
  - Assertions updated, shape only (commit `1e4f0e63b` body): `helpers.setTaskStatus` (PATCH → `POST /status`), `completion-gate` (`status: 'todo'` → `{code}`), `stage-tasks` (`assignee` → `assignees`), `task-context` (`assignedAdminUserId` → `assigneeIds`; the outsider's PATCH status → `POST /status`, still 404), `templates` (column → `task_assignees` row), `visibility` (`assignedAdminUserId` → `assigneeIds`). All 46 Projects/custom-fields/demo files green.
- [X] T020 Adapt the demo.
  - `packages/demo-composition/src/projects.ts`: insert assignees into `task_assignees` and set `published_at`.
  - Run `backend/test/integration/demo/demo-shop.test.ts` and `demo-reset-after-use.test.ts` (whose `tasks` count is unchanged here).
  - Done 2026-10-28: the demo writes `published_at = created_at` and one `task_assignees` row per Task whose Role one Member holds. `demo-shop.test.ts`'s ledger gains `task_assignees: 10` (`tasks: 12` unchanged); `demo-reset-after-use` green. `check:demo-data-budget` and `check:module-boundary` clean.
- [X] T021 Update the existing tests that pin the old shape, listed in `foreign-module-changes.md` §G, one by one:
  - `backend/test/integration/tasks/{tasks-crud,write-port,off-state}.test.ts`
  - `backend/test/contract/tasks/tasks.contract.test.ts`
  - `backend/test/perf/tasks/context-visibility.perf.test.ts`
  - `admin/test/modules/tasks/*`
  - `admin/test/modules/projects/ProjectDetail.tasks-tab.test.tsx`

  Change shape, never intent. Write each changed assertion's before and after into the commit body.
  - Done 2026-10-28; each changed assertion's before/after is in the bodies of commits `4b5b4b59b` (backend) and `55738aff6` / `1e4f0e63b` (admin). `off-state.test.ts` and `context-visibility.test.ts` needed no change. Two more tests pinned Phase 1's contract changes and were red on arrival, found by the T025 gate: `packages/modules/admin_users/…/admin-preference-document.test.ts` (`listViewModes: {}` default) and `admin/test/kit/kit-collaboration-bundle.test.ts` (the core bundle lacked `references.{kind,group,inserted,unavailable}.{opportunity,project}` — added to `_i18n` en/pl); both lines added to `foreign-module-changes.md`.
- [X] T022 Rework the admin pages onto the new shape. No new controls yet.
  - `T/admin/api.ts`, `components/StatusBadge.tsx` (colour from the status), `components/task-columns.tsx` (assignee list) and `components/AssigneePicker.tsx`: multi-select over `TagMultiSelect`-like chips, or kit `MultiSelect` if one exists (grep `K/components` first).
  - `pages/TasksList.tsx`, `MyTasks.tsx`, `TaskCreate.tsx` and `TaskDetail.tsx`: the status picker shows the workflow's statuses from `GET /tasks/workflow` (served read-only from now).

  Implement `GET /tasks/workflow` in `T/backend/routes/routes.workflow.ts` (`tasks:read`).
  - Done 2026-10-28. `AssigneePicker` is multi-select on the kit's `MultiCombobox` (no `MultiSelect` fits: that one is a filter-bar checkbox panel); options are the lookup's ≤ 50 active admins, narrowed client-side, and a chosen admin the lookup no longer offers keeps their name. `StatusBadge` = the served name with the colour as a dot. TaskDetail's status control offers the current status and the workflow's moves from it (`POST /status` with `from`); TasksList's filter lists the workflow's statuses; the tasks bundles lost `status.*`. `GET /tasks/workflow` (`routes.workflow.ts`, `tasks:read`) answers statuses with the visible `inUseCount` and the moves.
- [X] T023 Implement the generalised list in `T/backend/services/task-service.ts`:
  - `sort` / `dir` with the keyset cursor (T015);
  - the filters `statusCategory[]`, `creator`, `priority[]` and `tagId[]` (AND), `parentId` / `isSubtask` / `hasSubtasks`, and `linkedKind` / `linkedId`;
  - the `subtasks {closed, total}` lateral count under the visibility predicate.

  Unknown codes and ids match nothing. Write a failing case per filter and per sort first in `backend/test/contract/tasks/tasks-list.contract.test.ts`.
  - Seen red: not run before implementation — `tasks-list.contract.test.ts` was written first but executed after `task-service.ts` was rewritten (it could not run red for its own reason earlier: the schema it seeds did not exist until T013). First run: 30/31, the one red being my own premise (a status the workflow does not hold is **open**, consistent with `isClosed` and the completion gate, not "in no category") — the test was corrected. Green 31/31: 14 sort/direction cases across pages, the cross-sort cursor refusal, every filter, the sub-task count leaving out a hidden draft. `hasSubtasks` and the counts compose the visibility predicate over the children.
- [X] T024 [P] Extend `backend/test/perf/tasks/context-visibility.perf.test.ts` to 5 000 Tasks with 2 assignees and 3 tags each:
  - list first page under 2 s for each sort;
  - *My Tasks* under 2 s.

  Record the measurements under this task.
  - Measured 2026-10-28 on the local test Postgres (`PERF_RUN=true`), 5 000 Projects × 4 Tasks plus 5 000 context-less Tasks × 2 assignees × 3 tags, members-only viewer of everything: 163's `GET /tasks` p95 282 ms (budget 500); first page p95 per sort — created asc 231 / desc 269, number 258 / 247, title 251 / 282, due 278 / 286, priority 254 / 227, status 271 / 198, updated 172 / 350 ms; `GET /tasks/mine` p95 835 ms (it returns up to 500 rows). All under SC-002's 2 s.
- [X] T025 Phase gate. Run:
  - `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`
  - `pnpm --filter backend run test:unit:fast`
  - `pnpm --filter backend exec vitest run test/integration/tasks test/contract/tasks test/integration/projects test/integration/crm test/integration/demo`
  - `pnpm --filter admin exec vitest run test/modules/tasks test/modules/projects`
  - `pnpm --filter '!backend' run test`
  - `check:off-state-coverage`, `check:naming`, `check:language`

  Regenerate the OpenAPI baseline.
  - Run 2026-10-28 on the final tree:
    - `build:packages`: **green** (all packages, `mod-tasks`, `mod-projects`, `admin-kit`, `mod-crm`, `mod-custom-fields` included).
    - `pnpm -r run typecheck`: **green** (0 errors; Phase 1 recorded 72).
    - `pnpm -r run lint`: **green** (0 errors; pre-existing warnings only).
    - `pnpm --filter backend run test:unit:fast`: 359/361 files, 7 759/7 761 tests; **two expected reds**: (1) `test/unit/scripts/moved-module-tree.test.ts › check-port-dependencies.ts reads both roots and passes` — the three `degrades-without` edges resolve nothing yet (orchestrator ruling 4: expected until US1/US6 resolve `opportunityReadPort`, `quoteRequestReadPort`, `projectReadPort`); (2) `test/contract/admin_users/permission-inventory.test.ts › every assignable code is enforced somewhere` — `tasks:configure` is grantable and gates nothing until US2's configuration routes (it was declared in T006; T008 could not run the backend suite to see it). `tasks:see_private` is enforced by `TaskVisibility`'s `hasPermission`.
    - `vitest run test/integration/tasks test/contract/tasks test/integration/projects test/integration/crm test/integration/demo`: **85 files, 1 082 passed, 1 expected fail** (pre-existing `it.fails`). The migration test and the seam test green.
    - `pnpm --filter admin exec vitest run test/modules/tasks test/modules/projects` (Node 26, `--no-experimental-webstorage`): **27 files, 220 passed**.
    - `pnpm --filter '!backend' run test`: green after fixing the two Phase-1 reds named under T021 (`mod-admin-users` 151/151; `admin` 433 files).
    - `check:off-state-coverage` (41/41), `check:naming`, `check:language`: **green**. Also green: `check:error-translations`, `check:command-coverage`, `check:bundle-pairing`, `check:module-boundary`, `check:demo-data-budget`, `check:test-ownership`, `check:port-shape`, `check:entry-presence`, `check:admin-zones`, `check:admin-surface`, `check:action-route-permissions`, `check:module-docs`, `check:shared-table-wipes`, `check:release-intent` (`--since origin/master`: 0 violations), `check-entity-tenant-classification`. **`check:port-dependencies` red**, as ruling 4 expects (same three edges).
    - OpenAPI baseline regenerated (`UPDATE_OPENAPI_BASELINE=1`): only `/api/v1/admin/tasks/{id}/status` and `/api/v1/admin/tasks/workflow` added.
    - Generated artefacts current: `composer:generate` (migration registry, `docs/docs/module-reference/tasks.md`), `manifests:generate` and `pnpm install --lockfile-only` (no change).
  - **Orchestrator rulings applied here:** (1) the minimal Phase 3 slice pulled forward so the build and typecheck are green — see the notes under T032, T033, T035, T038; (2) the CRM and Projects check-widening migrations landed in this phase (T032); (3) `recordWithin(em, …)` for `admin_notifications` recorded in `foreign-module-changes.md` §E2 and under T001/T072, not implemented; (4) `check:port-dependencies` recorded as expected red.

**Checkpoint**: 163's behaviour holds on the new shape. Drafts and private Tasks are already invisible to everyone else on every read path.

---

## Phase 3: User Story 1 — A Task as a full work item (Priority: P1) 🎯 MVP part 1

**Goal**: several assignees, due time and start date, priority, tags, custom fields, attachments, a rich description with references resolved per reader (#446), and mention notifications.

**Independent Test**: `quickstart.md` §1, US1 row.

### Tests first

- [X] T026 [P] [US1] Write failing `backend/test/integration/tasks/task-fields.test.ts`:
  - add 2 assignees: each is notified once, the actor never;
  - an assignee without `tasks:read` is refused (`TASK_ASSIGNEE_INVALID`);
  - more than 20 refused;
  - `dueAt` sets `due_on` in `tasks.time_zone`, and overdue is checked at time and at date only;
  - `startOn`;
  - `priorityCode`, with an unknown code giving 422 `TASK_PRIORITY_UNKNOWN`;
  - `tagIds` set and replace, with an unknown tag giving 422;
  - custom field values validated (422 `CUSTOM_FIELD_VALUE_INVALID`);
  - history shows each change.
  - Seen red 2026-10-28: 9 of 11 failed for the stated reason — `TASK_ASSIGNEE_INVALID` not raised for an assignee without `tasks:read` (201), `dueAt`/`startOn`/`priorityCode`/`tagIds`/`customFieldValues` ignored, `GET /tasks/priorities` and `/tasks/tags` 404. The two that passed red are Phase 2 behaviour (two assignees told once; > 20 is a schema 400). Green after T037/T038 (11/11).
  - **Deviation (FR-001, contract §1):** the 163 F-14 case in `tasks-crud.test.ts` ("an assignee without `tasks:read` is assigned and not told") now asserts the 422 refusal — the contract says each assignee must hold `tasks:read`. Only the Tasks screens refuse; the write port keeps 163's rule (a context owner assigns whom its rules name; they are told only if they may see the Task).
- [X] T027 [P] [US1] Write failing `backend/test/integration/tasks/references.test.ts` (#446):
  - a description with tokens of all seven kinds resolves per reader;
  - a reader without `orders:read` sees the Order as unavailable;
  - with `crm` off, the Opportunity is unavailable;
  - a deleted Task is unavailable;
  - a private Task of someone else is unavailable;
  - the `task_references` rows are refreshed on edit;
  - a newly mentioned admin is notified once naming `TSK-…`, not on a re-save, never the author, never someone who may not see the Task.
  - Seen red 2026-10-28: 8 of 10 failed — `references` was always `[]`, no `task_references` row, no mention bell, `/lookups/{mentionable,documents}` 404. The "never tells somebody who may not see the Task" case passed red vacuously (nobody was told at all). Green after T036 (10/10). One red at green was my premise: the harness's administrator holds `*`, so `tasks:see_private` — the private-Task case now reads as an admin without it.
  - Added beyond the list: a Project unavailable while Projects is off; the `@@` list's five groups, each only for its reader and owner.
- [X] T028 [P] [US1] Write failing tests for the reference kinds in the other modules:
  - `backend/test/integration/crm/references.test.ts`: save `[[opportunity:…]]` and `[[project:…]]` in an Opportunity's description, with no 500 and both resolved;
  - `backend/test/integration/projects/references.test.ts`: the same in a Project note;
  - the document lookups of both modules offer the two new groups only when the owner is present and the caller holds the permission.
  - Seen red 2026-10-28: the four new cases failed — the resolvers answered both kinds unavailable (pulled forward at T025) and the `@@` lists offered neither group. Green after T034. CRM's cases sit in `integration/crm/references.test.ts` (describe *Opportunities and Projects (165)*); Projects' are the new `integration/projects/references.test.ts`. No 500 on saving either kind in a CRM description or a Project note.
- [X] T029 [P] [US1] Write failing `backend/test/integration/tasks/attachments.test.ts`:
  - upload as private, listed with name, size, uploader and time;
  - an HTML file or an SVG gives 415 `TASK_ATTACHMENT_REFUSED`;
  - more than 25 MB is refused;
  - deleting the asset in the asset library is refused while it is attached, also with `tasks` off;
  - removing the attachment unprotects the asset.
  - Seen red 2026-10-28: 5 of 6 failed (every attachment route 404). The hidden-Task case passed red vacuously (404 from no route). Green after T039 (6/6), also asserting the asset delete is refused while `tasks` is deactivated.
  - **Deviation (admin-api §2):** the upload is `POST /tasks/:id/attachments/upload` (multipart) beside `POST /tasks/:id/attachments` `{assetId}` — Projects' split; one Fastify route cannot take both bodies with the multipart parser scoped to it. The by-id attach also asks for `assets.read` (CRM/Projects rule). Too large is **413** `TASK_ATTACHMENT_REFUSED` `{reason: 'too_large'}`, active content **415** `{reason: 'active_content'}`.
- [X] T030 [P] [US1] Write failing `backend/test/integration/tasks/custom-fields-host.test.ts`:
  - a `task` definition is creatable;
  - values persist;
  - a `listFilter` definition filters `GET /tasks`;
  - with `tasks` off, the `task` entity type is hidden from the custom-fields definitions API (registry `ownerModuleId`).
  - Seen red 2026-10-28: 1 of 2 failed (values dropped, filter ignored, `/custom-field-filters` 404). The off-state case passed red: the registry side was pulled forward at T025. Green after T038 (2/2).
- [X] T031 [P] [US1] Write failing admin tests:
  - `admin/test/modules/tasks/TaskDetail.fields.test.tsx`: the multi-assignee control, the due-time input, the priority and tag pickers, the custom-fields panel, rich description rendering with reference links, and the attachments section;
  - `K/components/tags/TagMultiSelect.test.tsx`: the promoted component, its options injected.
  - Seen red 2026-10-28: `TaskDetail.fields.test.tsx` 6/6 failed for the stated reason (no due-time, start, priority, tag controls; plain textarea; no attachments section, no custom-fields panel; missing bundle keys). Green after T041 (6/6).
  - **Deviation:** the kit test is `admin/test/kit/kit-tags.test.tsx`, not `K/components/tags/TagMultiSelect.test.tsx` — admin-kit has no test runner of its own; every kit test lives in `admin/test/kit/` (precedent `kit-attachments.test.tsx`). Written before the component but first run after it existed, so **not seen red**; 5/5 green.

### Implementation

- [X] T032 [US1] Run the CRM and Projects reference-kind migrations:
  - `pnpm --filter backend run migration:new -- --module crm --name opportunity_reference_kinds`
  - `… --module projects --name projects_reference_kinds`

  Write `up` and `down` per `data-model.md` §6, then run `composer:generate`.
  - **Pulled forward into Phase 2** (orchestrator ruling 2, 2026-10-28): `C/migrations/20261028T143444_crm_opportunity_reference_kinds.ts` and `P/migrations/20261028T143448_projects_reference_kinds.ts`, `up`/`down` per data-model §6 (`down` deletes the two kinds' rows, as the 163 precedent did, then restores the five), registered. `CrmReferenceTargetType` widened in `C/backend/entities/crm-opportunity-reference.entity.ts` (line added to §C). Run by every backend suite's template build; no dedicated up/down test yet — T028 or this task may add one. What remains: nothing but that test.
  - Done (Phase 2). No dedicated up/down test was added: both migrations run in every backend suite's template build, and T028 saves both kinds through each module's API, which a check without them would refuse with a 500.
- [X] T033 [US1] Add `findByIds` and `search` to the read ports.
  - `C/backend/services/opportunity-read-port.ts`: number and title, ≤ 20.
  - `P/backend/services/project-read-port.ts`: through `ProjectAccess`. Add the file to `PROJECT_ACCESS_READERS` in `P/backend/services/project-access.ts` if the method lives in a new file.
  - **Pulled forward into Phase 2** (ruling 1): both methods exist. CRM: `findByIds` (scoped `em.find`) and `search` (number/title `ilike`, newest first, ≤ 20). Projects: `ProjectAccess.findVisibleMany` and `searchVisible` (both compose `visibleProjectSql`; seam ledger `project-access.ts` 12 → 14), so no new file joined `PROJECT_ACCESS_READERS`. Not yet tested by an integration case — T028 covers them through the lookups.
  - Done (Phase 2); now exercised by T027/T028 through the resolvers and the `@@` lists (all green).
- [X] T034 [US1] Teach CRM and Projects the two new kinds.
  - Resolvers in `C/backend/services/reference-service.ts` and `P/backend/services/reference-service.ts`. Projects resolves Opportunities through its existing `linked-records.ts` owner. CRM resolves Projects through `projectReadPort`, and if `C/manifest.ts` lacks a `degrades-without` edge on `projects`, add it with a `whenAbsent` sentence.
  - The lookup groups in their document-lookup services.
  - The `owner-read-permissions.ts` entries.
  - The i18n group labels in `C/../i18n` and `P/../i18n`.

  T028 green.
  - Partly pulled forward (ruling 1): each reference service's URL map has the two arms (`/crm/opportunities/:id`, `/projects/:id`); the resolvers still answer both kinds **unavailable** (no port is asked). Resolvers, lookup groups, `owner-read-permissions` entries and i18n group labels remain here.
  - Done 2026-10-28. CRM: `crm-projects.ts` (the one door to `projectReadPort`, `isPresent()` first), a `degrades-without` edge on `projects`/`projectReadPort` with its `whenAbsent` (none existed), Opportunities resolved and searched through an unregistered `OpportunityReadPortService` instance (CRM's own), `projects:read` in `owner-read-permissions.ts`. Projects: Opportunities through `linked-records.ts` (`findMany`, plus a new `searchOpportunities`), Projects through `ProjectAccess.findVisibleMany`/`searchVisible`, `crm:read` already in its checks. `docs/docs/module-reference/crm.md` regenerated.
  - **Premise false — i18n group labels:** the `@@` group labels are the kit's core bundle (`references.group.*`, added at T025), not each module's; nothing was added to `C/../i18n` or `P/../i18n` for them.
  - **Group order and presence:** each module's own kind is always answered (CRM: Opportunities, the caller holds `crm:read`; Projects: the Projects the caller may see), as Tasks always answers Tasks. The pinned group lists in `integration/projects/mentions.test.ts`, `contract/projects/lookups.contract.test.ts` and `contract/crm/document-lookups.contract.test.ts` gained the group (shape only; lines added to `foreign-module-changes.md` §D).
  - **Admin `@@` gate:** each module's `admin/lib/references.ts` now also opens `@@` for the *other* module's code (CRM `projects:read`, Projects `crm:read`). Its own code would make `@@` unconditional and contradict the tests pinning "a role reading no document"; the gap is issue #498.
- [X] T035 [US1] Extend the admin-kit reference editor (`K/components/references/{reference-kinds,ReferenceField,ReferenceText,reference-node}.ts(x)`):
  - document groups and chip classes for `opportunity` and `project`;
  - link targets `/crm/opportunities/:id` and `/projects/:id`.

  Write its kit test first. Rebuild admin-kit.
  - Partly pulled forward (ruling 1): `ReferenceText`'s icon map (`Handshake`, `FolderKanban`) and `reference-node`'s chip classes have the two kinds, and the `_i18n` core bundle carries `references.{kind,group,inserted,unavailable}.{opportunity,project}` (en, pl; required by `kit-collaboration-bundle.test.ts`). Document groups in the editor and the kit test remain here.
  - Done 2026-10-28. The editor's document groups and `ReferenceText`'s links are generic (the lookup's `groups[].kind`, the reference's `url`), so nothing in the components changed; `kit-references.test.tsx` gained three cases (the five-group `@@` list inserting a Project token; an Opportunity and a Project linked; both unavailable). Green on arrival — the component work was pulled forward at T025.
- [X] T036 [US1] Implement the reference and mention services in Tasks:
  - `T/backend/services/owner-read-permissions.ts`, copied from Projects;
  - `reference-service.ts`: `rowsFor` and `resolveMany` across seven kinds through `orderReadPort`, `catalogProductReadPort`, `adminUserReadPort`, `quoteRequestReadPort`, `opportunityReadPort`, `projectReadPort` and `taskReadPort` (self), each gated by presence and permission;
  - `mention-service.ts`: `newlyMentioned`, the mentionable lookup per `admin-api.md` §3, and `tell` after commit, with kind `tasks.task.mention`.

  Wire them in the *References* section of `T/backend/index.ts` with `lazyPort` for each `degrades-without` owner. Make `TaskDetail.references` and the history resolve. T027 green.
  - Done 2026-10-28: `owner-read-permissions.ts` (`orders`, `catalog`, `rfqs:handle`, `crm:read`, `projects:read`), `record-owners.ts` (the one door to `quote_requests`, `crm`, `projects`: presence, labels, `@@` search — a Quote Request is offered only by its full number, the port has no search and a Task has no Organization), `reference-service.ts`, `mention-service.ts` (`newlyMentioned`, `mentionable`, `tell`; `createTaskAudience` — `tasks:read`, draft/private only for the Creator, a context's `canSeeAs` — now also decides who an assignment is told to), `document-lookup-service.ts` (`GET /tasks/lookups/documents`, `tasks:write`). `task_references` rows are rewritten by the create/update Command; mentions told after commit as `tasks.task.mention` (`notifications.mention.title`, en/pl). `check:port-dependencies`'s three `degrades-without` edges now resolve.
  - **Deviation:** the history keeps `references: []` — audit states carry no text (only `descriptionLength`), so there is nothing to resolve; comments (US4) are the first text the history could carry.
- [X] T037 [US1] Implement the remaining Task fields in `T/backend/services/task-service.ts` and `task-commands.ts`:
  - `due_at` and `start_on`;
  - `priority_code`, validated against `task_priorities`;
  - tags, set and replace (≤ 50), validated;
  - `assigneeIds`, `addAssigneeIds` and `removeAssigneeIds`;
  - `custom_field_values` through `customFieldValueService.validateAndMerge('task', …)`.

  Write each one in its Command with an audit diff. Add `GET /tasks/priorities` and `GET /tasks/tags` (`tasks:read`) and `POST /tasks/tags` (`tasks:configure`) in `T/backend/routes/routes.{priorities,tags}.ts`, backed by `priority-service.ts` and `tag-service.ts`. Model the tag service on `C/backend/services/tag-service.ts`. The rest of the configuration comes in US9.

  T026 green.
  - Done 2026-10-28. Commands `tasks.task.priority_change`, `.tags_change`, `.custom_fields_change` (changed keys only, before/after); `tasks.task.update` gains `dueAt`/`startOn`; `assignees_change` refuses more than 20 under the lock. `dueAt` sets `due_on` in `tasks.time_zone`; a date alone clears the moment; clearing the moment alone keeps the date. Assignees on the Tasks screens must hold `tasks:read` (`assertMayBeAssigned`). `priority-service.ts` (list with visible in-use counts, `assertKnown`), `tag-service.ts` (list with visible usage counts, create with 409 `TASK_TAG_NAME_TAKEN`, `assertKnown` → 422 `TASK_TAG_UNKNOWN`); routes in `routes.{priorities,tags}.ts`. Four codes joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with their first raise site: `TASK_PRIORITY_UNKNOWN`, `TASK_TAG_UNKNOWN`, `TASK_TAG_NAME_TAKEN`, `TASK_ATTACHMENT_REFUSED`. The seam ledger names `priority-service.ts` (1 read), `tag-service.ts` (2), and `task-commands.ts` 4 → 7, each composing the predicate or keyed by a Task id `TaskAccess` handed out.
- [X] T038 [US1] Make `task` a custom-field host (`foreign-module-changes.md` §E).
  - `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts`: `SUPPORTED_ENTITIES.task = {labelKey, orgOwned: false, ownerModuleId: 'tasks', listFilter: true}`.
  - `host-storage-binding.ts`.
  - The custom_fields i18n.
  - The three enumerating tests.
  - The Tasks side: the list filter through `customFieldListFilterPort.condition('task', …)` and `GET /tasks/custom-field-filters`.

  T030 green.
  - Partly pulled forward (ruling 1): `SUPPORTED_ENTITIES.task` (`orgOwned: false`, `ownerModuleId: 'tasks'`, `listFilter: true`), `host-storage-binding` (`tasks.custom_field_values`), `customFields.entity.task` (en, pl), and the four enumerating tests (`custom-field-registry.test.ts`, `value-probe-binding.test.ts`, `integration/custom_fields/{entity-owner-presence,list-filter-option}.test.ts`). The Tasks side — validation in the Commands, the list filter, `GET /tasks/custom-field-filters` — remains here.
  - Done 2026-10-28: `mergeTaskCustomFields` (`task-custom-fields.ts`, Projects' copy) in the create (always, so a required field is enforced) and update Commands; the detail projects the bag through `customFieldValueService.project`; the list filter is an id sub-select from `customFieldListFilterPort.condition('task', …)` intersected with the visibility predicate, an unoffered key answering 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`; `GET /tasks/custom-field-filters` (`tasks:read`).
- [X] T039 [US1] Implement the attachments:
  - `T/backend/services/attachment-active-content.ts` (copy);
  - `attachment-service.ts`, modelled on `P/backend/services/attachment-service.ts`;
  - `task-asset-references.ts`, registered ungated from a contribution-only boot hook;
  - the routes in `T/backend/routes/routes.collaboration.ts`.

  T029 green.
  - Done 2026-10-28: `attachment-active-content.ts` (+ its test, the code `TASK_ATTACHMENT_REFUSED`), `attachment-service.ts` (Commands `tasks.attachment.add` / `.remove` against `task`), `task-asset-references.ts` (`task_attachment`, label `Task TSK-…`) pushed from an ungated boot hook, `routes.collaboration.ts` with `@fastify/multipart` scoped to the upload (new peer; `manifests:generate` + `pnpm install --lockfile-only` run). `TaskAccess.visibleIds` added (seam ledger `task-access.ts` 2 → 3; `attachment-service.ts` 5 and `task-asset-references.ts` 2 joined `TASK_ACCESS_READERS` with their reasons).
  - **Contract line added:** `assetReferenceKindSchema` gains `'task_attachment'` (`X/assets-library.ts`) — `findReferences` answers only a kind of that enum; recorded in `foreign-module-changes.md` §A.
- [X] T040 [US1] Promote CRM's `TagChips`, `TagMultiSelect` and `useTagOptions` to `K/components/tags/`, with the options loader as a prop or hook argument. Export them from the kit's components barrel.
  - Move `C/admin/components/TagsSection.tsx` and its other callers onto the kit, then delete `C/admin/components/TagPicker.tsx`.
  - Grep `admin/test/**` and `backend/test/**` for `TagPicker` and fix the paths.
  - Run `admin/test/modules/crm` before and after, with an identical pass count.
  - Done 2026-10-28: `K/components/tags/TagPicker.tsx` (`TagChips`, `TagMultiSelect`, `useTagOptions`, `TagOption`; the loader a prop, `loadTags`), exported from the components barrel; strings `tags.picker.*` moved to the core bundle (en/pl, CRM's wording), the three CRM keys removed. CRM's five callers pass `crmApi.listTags`; `C/admin/components/TagPicker.tsx` deleted. `admin/test/modules/crm`: 32 files / 558 tests before (the baseline run also showed one known-flaky case, *More filters*, which passes alone) and 32 / 558 green after. Grep of `backend/test/**` and `admin/test/**` for the CRM path: no reference (the one `TagPicker.tsx` in `batch-sixteen-surfaces…` is blog's own).
- [X] T041 [US1] Rework the Task screens.
  - `T/admin/pages/TaskDetail.tsx` per `contracts/admin-surfaces.md` §2, US1 parts:
    - the description with `ReferenceField` and `ReferenceText` (`T/admin/lib/references.ts`, modelled on Projects');
    - assignees, due with time, start date, priority and tags;
    - `CustomFieldValuesPanel entityType="task"`;
    - the attachments section with `AttachmentUploader`;
    - the history field list extended.
  - `TaskCreate.tsx`: the same fields.
  - New strings in `packages/modules/tasks/i18n/{en,pl}.json`.

  T031 green.
  - Done 2026-10-28: `components/TaskFieldInputs.tsx` (description in `ReferenceField`, due date + optional time — sent as `dueAt` from the reader's clock —, start date, priority, kit `TagMultiSelect`), shared by `TaskCreate.tsx` and the detail's edit form; `lib/references.ts` (`useTaskReferences`, Projects' model); `components/TaskAttachments.tsx` (Projects' tab as a section, kit `AttachmentUploader`); `components/TaskCustomFields.tsx` (kit `CustomFieldValuesPanel entityType="task"`, saved through `PATCH`, shown to a holder of `custom_fields:read`; the create form embeds it). The detail lists every assignee, draws the description with `ReferenceText`, shows due time, start date, priority and tags; the history shows `dueAt`, `startOn`, `priorityCode`. `field.assignee` reads "Assignees". `admin/test/modules/tasks` + `projects` + `kit`: 62 files / 597 tests green.

**Checkpoint**: a Task carries everything US1 lists, and references work in Tasks, CRM and Projects alike.

- **Phase 3 gate**, run 2026-10-28 on the final tree (the machine shared with other worktrees' runs, load average 20–35):
  - `pnpm run build:packages`: **green**. `pnpm -r run typecheck`: **green** (0 errors; one test-typing error in `references.test.ts` fixed first). `pnpm -r run lint`: **green** (0 errors; pre-existing warnings).
  - Backend, targeted: `test/integration/{tasks,projects,crm,custom_fields,assets_library}` + `test/contract/{tasks,crm,projects}` — 137 files; 129 green on the first run and the other 8 failed **in `beforeAll` only** (`setupBackendServer` over the 30 s hook budget while packages were being rebuilt beside it); all 8 green re-run (alone, then with `--maxWorkers=2`). The four files of the pinned `@@` lists green after their shape update. Tests: 1 433 passed, 1 expected fail, 0 failed.
  - `pnpm --filter backend run test:unit:fast`: 361 files; after two fixes (`contribution-absent-owner.test.ts` supplies `assetReferenceRegistry` to the `tasks` composer; `list-filter-admin-only.test.ts` allows `tasks: src/backend/index.ts` — both lines in `foreign-module-changes.md` §G) every case green but two **30 s timeouts** of whole-tree scans: `module-package-manifest.test.ts › writes nothing in --check mode` (green re-run) and `check-module-boundary.test.ts › the tree itself` (56 s alone under that load; **green with `--testTimeout=180000`, 154/154**). **Phase 2's two expected reds are gone**: `permission-inventory` (`tasks:configure` now gates `POST /tasks/tags`) and `moved-module-tree › check-port-dependencies` (the three `degrades-without` edges resolve).
  - `pnpm --filter '!backend' --no-bail run test`: every package green but 9 cases in 5 packages, each green re-run alone — `cli` `dev-all.test.ts` (10 s spawn timeouts), `cms-components` `column-placement`/`option-parity` (10 s timeouts), `storefront` `llms-txt-base` (259 ms against a 250 ms budget), `admin` `carts/cart-approval-policy-zone`, `crm/board-card-fields`, `orders/OrderCreatePage.product-browser`, `price_lists/price-book-duplicate`, `sales_channels/product-channels-zone` (async waits) — none touches this phase's code paths beyond `crm/board-card-fields`, which also passed in the full `admin/test/modules/crm` run (558/558).
  - Admin targeted (Node 26, `--no-experimental-webstorage`): `test/modules/tasks` + `test/modules/projects` + `test/kit` — 62 files, 597 tests green; `test/modules/crm` 32 / 558 green.
  - Checks: `check:naming`, `check:language`, **`check:port-dependencies` (now green — 0 violations)**, `check:off-state-coverage` (41/41), `check:error-translations`, `check:command-coverage`, `check:bundle-pairing`, `check:module-boundary`, `check:test-ownership`, `check:port-shape`, `check:port-catches`, `check:entry-presence`, `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-docs`, `check:shared-table-wipes`, `check:subscribe-seam`, `check:container-imports`, `check:platform-surface`, `check-release-intent --since origin/master` (0 violations): **green**. **`check:docs-translations` red** with `stale-translation:generated:module-reference/{crm,tasks}` — the Polish copies of the regenerated module-reference pages (`tasks` stale since T008, `crm` since this phase's new edge); left for T089, which owns the Polish documentation and runs this check.
  - OpenAPI baseline regenerated (`UPDATE_OPENAPI_BASELINE=1`): only the eight new Tasks routes added (`/custom-field-filters`, `/lookups/{documents,mentionable}`, `/priorities`, `/tags`, `/{id}/attachments`, `/{id}/attachments/upload`, `/{id}/attachments/{attachmentId}`).
  - Generated artefacts: `manifests:generate` (the `@fastify/multipart` peer; `README.md`), `pnpm install --lockfile-only`, `composer:generate` (`docs/docs/module-reference/crm.md`) — committed.
  - Grep of `backend/test/**` and `admin/test/**` for the deleted `crm/src/admin/components/TagPicker.tsx`: no reference.
  - Deferred: issue #498 (`@@` not offered for a module's own reference kind).


---

## Phase 4: User Story 2 — Operator-defined statuses and transitions (Priority: P1) 🎯 MVP part 2

**Goal**: configure the workflow, enforce it everywhere, reassign Tasks when a status is removed, and keep the Projects gate correct.

**Independent Test**: `quickstart.md` §1, US2 row.

### Tests first

- [X] T042 [P] [US2] Write failing `backend/test/integration/tasks/workflow.test.ts`:
  - create, rename (en/pl), recolour and reorder a status;
  - each FR-013 rule refused with 422 `TASK_WORKFLOW_INVALID {rule}`;
  - add and remove transitions as a delta;
  - a forbidden move gives 409 `TASK_TRANSITION_FORBIDDEN` with `allowedTargets`;
  - a stale `from` gives 409 `TASK_TRANSITION_CONFLICT`;
  - removing a status with 3 Tasks requires `replacement` and moves the 3, each with a history row whose `reason` is `status_removed`;
  - 5 001 Tasks give 409 `TASK_STATUS_IN_USE_TOO_MANY`;
  - `tasks:write` without `tasks:configure` gives 403 on every configuration write;
  - every configuration write is audited.
  - Seen red 2026-10-28: 10 of 11 failed for the stated reason — every configuration route 404, so no status, move or removal could be set up. The case "a stale `from` is a conflict; an unknown target is 422" passed red: it is T016's interim behaviour, kept. Green after T045/T046 (11/11).
  - Added beyond the list: a taken code and a non-snake_case code refused; `completed_at` set on entering a `done` status and cleared on leaving it, `openSubtasks` answered; a new Task starts in the *current* initial status (the flag moved to a new `backlog` status and back); an unknown replacement (422 `TASK_STATUS_UNKNOWN`) and an unreachable one (409 `TASK_TRANSITION_FORBIDDEN {allowedTargets}`) refused before anything moves. The 5 001 Tasks are inserted with one `generate_series` statement and deleted in `afterAll`.
  - The workflow is platform-wide: the file restores the seeded one before and after through the new `backend/test/helpers/task-workflow.ts` (`restoreDefaultTaskWorkflow`, CRM's model; line added to `foreign-module-changes.md` §G).
- [X] T043 [P] [US2] Extend `backend/test/integration/projects/completion-gate.test.ts`:
  - with a custom `done`-category status *Accepted* and the default *Done* removed (Tasks moved to *Accepted*), the gate passes once every Task is in *Accepted* or *Cancelled*, and blocks while one is in a new open status *In review*;
  - a draft in the Stage does not block.
  - Seen red 2026-10-28: both new cases failed — `POST /tasks/statuses` 404. Green after T045/T046. The draft is set with one `update … set is_draft = true` (drafts are written by US8). Added: a Stage Task materialised through `taskWritePort.createMany` on Stage entry starts in a new initial status `backlog` (the T046 write-port half). The block restores the seeded workflow around itself.
- [X] T044 [P] [US2] Write failing `admin/test/modules/tasks/TaskWorkflowPage.test.tsx`:
  - the statuses table, the dialog with category and initial;
  - the graph's `onAdd` / `onRemove` call `PUT /tasks/transitions`;
  - the removal dialog asks for a replacement when `inUseCount > 0`;
  - the page is hidden without `tasks:configure`.
  - Seen red 2026-10-28: the file failed to load (`pages/settings/TaskWorkflowPage` did not exist). Green after T047 (12/12). The graph's remove is driven by the click handler the kit component binds, captured from the mocked `echarts` (the canvas cannot be drawn in jsdom); its add through the kit's From/To form. "Hidden without `tasks:configure`" is asserted on the contributions (route and nav gate) here and rendered in `off-state.test.tsx` (a `tasks:read`+`tasks:write` holder gets the not-found screen and no sidebar row).
  - Also changed (shape only): `off-state.test.tsx` (the route list and sidebar gain the workflow screen), `T/admin/index.test.ts` (route and nav row), and `TaskDetail.test.tsx` gained two cases for T047 — "offers only the permitted moves" passed red (Phase 2 behaviour), "shows the server's refusal and then offers only the targets it named" was seen red against the Phase 3 `TaskDetail.tsx`.

### Implementation

- [X] T045 [US2] Implement `T/backend/services/workflow-config-service.ts`, modelled on `C/backend/services/workflow-config-service.ts`:
  - `createStatus`, `updateStatus`, the initial-flag move with two flushes, and `setTransitions` with add/remove;
  - `deleteStatus(code, replacement)`, which writes per-Task audit rows by T001's finding (a) or uses the batched fallback;
  - `assertValid` at the end of each Command;
  - the in-use counts for the screen.

  Add the routes in `T/backend/routes/routes.workflow.ts` per `admin-api.md` §4. T042's configuration cases green.
  - Done 2026-10-28: `TaskWorkflowConfigService` — `createStatus`, `updateStatus`, `deleteStatus(code, replacement, language)`, `setTransitions`; every write one Command (`tasks.status.create|update|delete`, `tasks.transitions.change` against `task_status`/`task_workflow:transitions`), flushed and held to `TaskStatusGraph.assertValid()` on its own transaction (422 `TASK_WORKFLOW_INVALID {rule, code: rule}`). Routes `POST /tasks/statuses` (201), `PATCH /tasks/statuses/:code`, `DELETE /tasks/statuses/:code?replacement=`, `PUT /tasks/transitions`, all `tasks:configure`, each answering the whole workflow (the delete too — admin-api §4 "every write answers with the whole workflow", where CRM answers 204).
  - **Removal (T001 (a), no batched fallback):** the status row is locked `FOR UPDATE`, its Tasks are selected `for update … limit 5001`; above `TASK_STATUS_REASSIGN_MAX` 409 `TASK_STATUS_IN_USE_TOO_MANY {max}`. With Tasks, the replacement must exist (422 `TASK_STATUS_UNKNOWN`) and be a permitted move from the removed status (409 `TASK_TRANSITION_FORBIDDEN {allowedTargets}`); the Tasks move in one `update`, `completed_at` kept or stamped when the replacement is `done`, cleared otherwise; one `tasks.task.status_change` audit row per Task via `recordAuditFromContext` (`before {status, completedAt}`, `after {status, completedAt, reason: 'status_removed'}`) on the Command's transaction. The status takes its moves with it. The in-use counts for the screen stay `TaskService.workflow()` (visible counts, Phase 2); the removal counts platform-wide.
  - **Deviations.** (1) Refusals the contract did not name are `TASK_WORKFLOW_INVALID` rules rather than new codes, so no contract is added: `status_code_taken`, `category_in_use` (a category changes only while no Task is in the status — CRM's rule; the completion time would otherwise lie), `replacement_required` (also for `replacement` = the removed code). Each has its sentence (`errors.TASK_WORKFLOW_INVALID.<rule>`, en/pl). (2) An unknown status code on `PATCH`/`DELETE` is 404 `NOT_FOUND` (CRM). (3) A removal emits no per-Task `tasks.task.status_changed.v1`: a Command emits at most one event and nothing subscribes; the audit rows carry the history. (4) A status's `defaultName` is its English name (the body carries `{en, pl}`, both required).
  - Two codes joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with their first raise site: `TASK_WORKFLOW_INVALID`, `TASK_STATUS_IN_USE_TOO_MANY`. Seam ledger: `services/workflow-config-service.ts` joins `TASK_ACCESS_READERS` with 3 reads (the in-use count, the locked selection, the move) and its reason — platform-wide on purpose.
- [X] T046 [US2] Implement `T/backend/services/task-transition-service.ts`:
  - the graph check;
  - a pessimistic re-read and the `from` comparison;
  - `completed_at`;
  - the `openSubtasks` count.

  Route `POST /tasks/:id/status` through it, replacing T016's interim check. Make `taskWritePort.createMany` start Tasks at the *current* initial status. T042 and T043 green.
  - Done 2026-10-28: `TaskTransitionService.apply(id, {from, to}, language)` — `loadVisible` + `assertMayChange`, then one `tasks.task.status_change` Command with every check inside it: the Task locked and compared with `from` (409 `TASK_TRANSITION_CONFLICT {current}`; already in `to` is a no-op), the target status row held `FOR SHARE` (so a concurrent removal or category change of it waits, or has finished and this answers 422 `TASK_STATUS_UNKNOWN`), the graph read on that transaction (409 `TASK_TRANSITION_FORBIDDEN {allowedTargets, allowed}`), `completed_at` stamped on entering `done`, cleared otherwise, `tasks.task.status_changed.v1` on commit. The refusal names the permitted next statuses by code (`allowedTargets`) and by name in the reader's language (`allowed`, interpolated into `errors.TASK_TRANSITION_FORBIDDEN`; token `none_allowed` when there is none) — FR-015. `changeTaskStatusCommand` left `task-commands.ts` (it exports `lockedTask`, `auditSnapshot`, `envelope`), so the new file reads no rule-scoped table itself.
  - `taskWritePort.createMany` already read the current initial status (T016); now covered by T043's Stage-entry case. `POST /tasks` likewise (T042).
  - **Deviation:** the `openSubtasks` count stays in `TaskService.changeStatus` (the answer's detail and the visible sub-task counts are that service's private reads); the transition service returns `{taskId, changed}`. The board (US3) calls `apply` and builds its own answer.
- [X] T047 [US2] Build `T/admin/pages/settings/TaskWorkflowPage.tsx`:
  - a statuses table and a status dialog (localized names, category, colour, weight, initial);
  - kit `StatusTransitionGraph` with `isTerminal = category !== 'open'` and `isSystem = false`;
  - a delete dialog with a replacement select.

  Register the route `/tasks/settings/workflow` and the sidebar entry *Task settings* in `T/admin/index.ts`, gated `tasks:configure`. Make the status picker in `TaskDetail.tsx` offer only `allowedTargets` and show the server's refusal. T044 green.
  - Done 2026-10-28: `pages/settings/TaskWorkflowPage.tsx` with `components/workflow/{TaskStatusesTable,TaskStatusDialog,TaskStatusDeleteDialog}.tsx` (CRM's screen, the model); `tasksApi.{createStatus,updateStatus,deleteStatus,setTransitions}`. The delete dialog offers as replacements only the statuses the removed one may move to, asks for one when `inUseCount > 0`, and asks after all when the server answers `replacement_required` (Tasks the operator cannot see). Sidebar row *Task settings* in `work`, weight 430 (with Projects' configuration rows, 400–420), icon `Settings`. The `BoardCardFieldsEditor` named by admin-surfaces §1 is US3's (Phase 5).
  - **Palette action `open-task-workflow`** (admin-surfaces §4, `tasks:configure`) added here, with the screen. Its landing read `GET /tasks/workflow` is `tasks:read`, so `check:action-route-permissions` reports a mismatch: ledgered in `ACTION_PERMISSION_DISAGREEMENTS` (`projects:open-project-templates` precedent; line added to `foreign-module-changes.md` §G); `contract/tasks/palette-actions.test.ts` and `integration/tasks/off-state.test.ts` list it. Its Polish keywords are single words: the phrase *statusy zadań* is refused by `check-default-language-prose`.
  - `TaskDetail.tsx`: the options stay the current status plus the workflow's moves from it; after a `TASK_TRANSITION_FORBIDDEN` refusal the server's sentence (which names the permitted statuses) is shown and the options become exactly its `allowedTargets` until the Task moves. `TaskDetail` carries no `allowedTargets` of its own (admin-api §1 does not list it) — the workflow read is the source until the server says otherwise.
  - Category labels read *Open* / *Closed — finished* / *Closed — cancelled* (a status named *Cancelled* beside a category *Cancelled* was ambiguous on screen).

**Checkpoint**: statuses are the operator's, and every move honours them.

- **Phase 4 gate**, run 2026-10-28 on the final tree:
  - `pnpm run build:packages`: **green**. `pnpm -r run typecheck`: **green** (0 errors; one test-typing error in `workflow.test.ts` fixed first). `pnpm -r run lint`: **green** (0 errors; pre-existing warnings).
  - Backend, targeted: `test/integration/{tasks,projects,demo}` + `test/contract/{tasks,projects}` + `contract/kernel/openapi-baseline` + `contract/admin_users/permission-inventory` — 56 files, 690 passed, **1 failed**: `task-fields.test.ts › two assignees added are each told once` (the assignees came back in id order). Diagnosed as a Phase 3 defect, not a load flake: two assignees added in one Command shared one `assigned_at`, and the read orders by `assigned_at`, then admin id — so the case failed whenever the second random id sorted first (it had also failed once earlier in this phase and passed alone). Fixed in `task-commands.ts` (each row one millisecond after the one before); the four assignee files then green three runs in a row (32/32 each).
  - `pnpm --filter backend run test:unit:fast`: 361 files; 7 759 / 7 761 on the first run — `check-module-boundary.test.ts › the tree itself` (30 s timeout, whole-tree scan; green with `--testTimeout=180000`) and `moved-module-tree.test.ts › check-default-language-prose` (a real red: the Polish keyword phrase *statusy zadań*; fixed, green).
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/tasks` + `test/modules/projects` — 29 files, 240 tests green. `mod-tasks` co-located 12 / 128, `contracts` 71 / 1 542 green.
  - Checks: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage`, `check:error-translations`, `check:command-coverage`, `check:bundle-pairing`, `check:action-route-permissions`, `check:admin-surface`, `check:admin-zones`, `check:module-docs`, `check:test-ownership`, `check:module-boundary`, `check:port-shape`, `check:entry-presence`, `check:shared-table-wipes`, `check:platform-surface`, `check:container-imports`, `check-release-intent --since origin/master` (0 violations): **green**. **`check:docs-translations` red**, unchanged from Phase 3 (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/statuses`, `/statuses/{code}` and `/transitions` added.
  - Generated artefacts: `manifests:generate` and `pnpm install --lockfile-only` changed nothing; `composer:generate` regenerated `docs/docs/module-reference/tasks.md` (the two error codes, the palette action) — committed. The contracts changeset names the two new `ERROR_CODES`.
  - Grep of `backend/test/**`, `admin/test/**` and `packages/**` for the moved `changeTaskStatusCommand` / `StatusMove`: no reference.

---

## Phase 5: User Story 3 — List and board, filtered and saved (Priority: P1) 🎯 MVP part 3

**Goal**: one Tasks screen with a list/board toggle remembered per user, shared filters, saved views, and the same for *My Tasks*.

**Independent Test**: `quickstart.md` §1, US3 row.

### Tests first

- [X] T048 [P] [US3] Write failing `backend/test/contract/tasks/board.contract.test.ts`:
  - columns in weight order;
  - `count` equals the list total under the same filters, for every filter of US3 scenario 4 including custom fields;
  - `perColumn` and `hasMore`;
  - drafts and private Tasks are counted only for their Creator;
  - card fields carry the configured values.
  - Seen red 2026-10-28: 8/8 failed for the stated reason — `/tasks/board` and `/tasks/board/card-fields` fell to `GET /tasks/:id` (404 `TASK_NOT_FOUND`). Green after T051 (9/9 with the *My Tasks* case below). The comparison runs 32 filter queries (every US3 scenario 4 filter, custom fields included, combinations, unknown codes) and holds each column's count to the list's total for that status; the viewer is an admin **without** `tasks:see_private` (the stub admin holds `*`).
  - Added beyond the list: `perColumn` outside 1–50, a `sort` or a `cursor` are 400; the card-field routes' gates (`tasks:read` / 403 without `tasks:configure`), an unknown reference 422, seven fields 400; a card's custom value `null` when the Task has none; `GET /tasks?cardValues=true` carries the same card fields (below); *My Tasks* takes the list's filters (US3 scenario 6 — `GET /tasks/mine` ignored every filter before; written after the change, **not seen red**: the package build that would have shown it red was stale).
- [X] T049 [P] [US3] Write failing `backend/test/integration/tasks/saved-views.test.ts`:
  - create, apply (the list returns its filters), share;
  - another admin sees a shared view and cannot modify it (403);
  - a platform administrator can;
  - 409 on a duplicate name, case-insensitive;
  - filters over 8 KB give 422.
  - Seen red 2026-10-28: 7/7 failed — `/tasks/list-views` fell to `/tasks/:id` (the outsider's 403 came from that route's gate). Green after T052 (7/7).
  - **Deviation:** filters over 8 KB answer **400 `VALIDATION_FAILED`**, not 422 — the shared `savedListViewFiltersSchema` refuses them in the body schema, and feature 147 holds every list to that (orders' contract test asserts 400). The "other admin" who may not modify a shared view is a Sales Representative: for saved views every other role is a platform admin (scope `all`), and the case asserts that such a colleague **may**.
  - Added: `tasks` joins `backend/test/integration/saved-list-views/rules-parity.test.ts` (all scenarios, green) and `contract/saved-list-views/item-id-edges.test.ts`. S8 needed a per-adapter index name: the Tasks migration named its unique index `task_list_saved_views_owner_name_unique`, not feature 147's `…_owner_name_key_uq` (left as is — the migration is not edited; recorded in `foreign-module-changes.md` §G).
- [X] T050 [P] [US3] Write failing admin tests:
  - `admin/test/modules/tasks/TasksPage.test.tsx`: the toggle persists through `PATCH /me/preferences` with `listViewModes.tasks`, and filters carry over between list and board;
  - `admin/test/modules/tasks/TaskBoard.test.tsx`:
    - a drop that is allowed calls `/status`;
    - a refused drop reverts and announces;
    - `canDrop` follows the transitions;
    - the *Move to…* menu works by keyboard;
    - *Load more* fetches the list page for one status;
  - `admin/test/modules/tasks/MyTasksPage.test.tsx`: the same toggle under `tasks-mine`;
  - `K/components/kanban/MoveToMenu.test.tsx`;
  - `K/lib/admin-preferences/store.test.ts` for `listViewModes`.
  - Seen red 2026-10-28: `TasksPage`, `TaskBoard` and `MyTasksPage` failed to load (no such files); `TaskWorkflowPage`'s new card-field case failed (no section); `admin/test/kit/kit-move-to-menu.test.tsx` 3/3 failed (no kit export); the four `listViewModes` cases of `admin/test/kit/admin-preferences-store.test.tsx` failed (no hook). Green after T053–T055.
  - **Deviations:** the kit tests live in `admin/test/kit/` (no admin-kit runner — T031's precedent), not beside the kit source. `TasksPage.test.tsx` absorbs and replaces `TasksList.test.tsx`, `MyTasksPage.test.tsx` replaces `MyTasks.test.tsx` (both deleted; their cases kept). The page tests route the kit's own `apiClient.patch` to the spy: the preference store is created inside the kit and talks through the kit's client, which a module mock does not replace.

### Implementation

- [X] T051 [US3] Implement `T/backend/services/board-service.ts`:
  - visibility scope computed once per request;
  - one grouped count;
  - sequential per-column first pages, as CRM does.

  Implement `T/backend/domain/board-card-fields.ts` and `services/board-card-field-service.ts`, modelled on CRM (`builtin:number|assignees|due|priority|tags|creator|start`, `custom:<key>`, ≤ 6). Add the routes `GET /tasks/board` and `GET` / `PUT /tasks/board/card-fields` in `T/backend/routes/routes.board.ts`. T048 green.
  - Done 2026-10-28: `TaskBoardService` reads no table — `TaskService.visibilityScope()` once, `countByStatus(filters, scope)` (one grouped statement over the list's own conditions, custom fields included) and one `list(…, {scope, cardFields})` per column, sequentially; a status the `status` filter leaves out is an empty column. `domain/board-card-fields.ts` (+ unit test) and `TaskBoardCardFieldService` on the `tasks.board_card_fields` setting; routes in `routes.board.ts`; `refuseUnofferedCustomField` shared by the list, *My Tasks* and the board.
  - **Deviations.** (1) The built-in catalogue is the contract's `TASK_BOARD_BUILTIN_FIELD_KEYS` (`number`, `assignees`, `due`, `priority`, `tags`, `startOn`, `context`, `subtasks`, `createdAt`, `updatedAt`), not this task's `creator|start`. (2) The choice is written through `settings`' own audited write (`settingsAdminService.setValueForAllChannels`), CRM's precedent, not a Tasks Command `tasks.board_card_fields.change` (data-model §7 names one). (3) **Contract addition** `TaskListQuerySchema.cardValues` (CRM's `cardValues`): a lane's further cards come from `GET /tasks` and must carry the card fields the board's cards carry; changeset updated.
  - Seam: `services/saved-view-service.ts` joins `SQL_WITHOUT_RULE_SCOPED_TABLES` (advisory lock and name probe on `task_list_saved_views`); `task-service.ts` stays at 20 reads (`mine` lost its own `task_assignees` sub-select to the shared filters, `countByStatus` added one).
- [X] T052 [US3] Implement the saved views:
  - `T/backend/services/saved-view-service.ts`, modelled on `packages/modules/quote_requests/src/backend/services/quote-request-list-view-service.ts`;
  - the routes `/tasks/list-views` in `T/backend/routes/routes.views.ts`.

  T049 green.
  - Done 2026-10-28: `services/saved-view-service.ts` (`TaskListViewService`, the Quote Request service copied), `saved-view-actor.ts`, `routes/routes.views.ts` (all four `tasks:read`). `TASK_VIEW_NAME_TAKEN` joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with its first raise site; contracts changeset updated. `TaskListSavedView.sort` typed `{field, dir}`.
- [X] T053 [US3] Add `listViewModes` to the admin preferences in admin-kit.
  - `K/lib/admin-preferences/store.ts` (`KEYS` and the switch case).
  - `use-admin-preference.ts`: widen the key union, add `useListViewModePreference(listId)`.
  - If the server's per-list merge needs it, add one case in `packages/modules/admin_users/src/backend/services/admin-preference-document.ts` (read `listPageSizes` handling first).

  Its kit test green.
  - **Premise false (admin_users):** the server stored only the sidebar keys and `listPageSizes`; a `listViewModes` patch passed validation and was **silently dropped**. Seen red in `backend/test/contract/admin_users/me-preferences.test.ts` (new case: `{}` came back). Fixed in `admin-preference-document.ts` (`readStoredListViewModes`, `mergeListViewModes`, `assertListViewModesBound`, unit-tested) and `admin-preference-service.ts` (one per-list-map writer for both maps, same row lock); changeset `admin-users-list-view-modes.md` (patch); `foreign-module-changes.md` §F amended.
  - Kit: `store.ts` serves both per-list maps (dirty/in-flight lists, deltas and replay per map); `useListViewModePreference(listId, fallback = 'list')` reads the choice live and ignores a value it does not know; exported from `@endora-commerce/admin-kit/lib`. `admin/test/kit/admin-preferences-store.test.tsx` 17/17, carry-over and session-cluster green.
- [X] T054 [US3] Promote `C/admin/components/MoveToMenu.tsx` to `K/components/kanban/MoveToMenu.tsx` with generic targets `{code, name, color}`.
  - Move `C/admin/components/OpportunityBoard.tsx` onto it and delete the CRM file.
  - Grep the tests for the old path.
  - Run `admin/test/modules/crm` with an identical pass count.
  - Done 2026-10-28: `K/components/kanban/MoveToMenu.tsx` (`MoveToMenuTarget {code, name, color}`), exported from the kit's components barrel; its two sentences moved to the core bundle as `kanban.moveTo.{action,label}` (CRM's wording, en/pl) and CRM's `board.moveTo.*` removed. `OpportunityBoard.tsx` imports the kit's; `C/admin/components/MoveToMenu.tsx` deleted. `admin/test/modules/crm`: **32 files / 558 tests before and after** (`board.test.tsx` reads the menu's name from the core bundle — shape only). Grep of `backend/test/**` and `admin/test/**` for the CRM path: no reference.
- [X] T055 [US3] Build the screens.
  - `T/admin/pages/TasksPage.tsx`, replacing `TasksList.tsx`:
    - filters in the URL, shared by both views, in `components/TaskFilters.tsx`: every US3 scenario 4 filter plus `CustomFieldListFilters`;
    - kit `SavedViewsControl` on `/api/v1/admin/tasks/list-views`;
    - the list with sortable columns;
    - the board in `components/TaskBoard.tsx` + `TaskCard.tsx` over kit `KanbanBoard` and `MoveToMenu`, with lane *Load more* through the list endpoint and the open-sub-task warning from `/status`.
  - `MyTasksPage.tsx`, replacing `MyTasks.tsx`, with the same toggle.
  - The card-fields editor on `TaskWorkflowPage.tsx`.
  - Update the routes in `T/admin/index.ts`.

  Delete the replaced files and grep the tests for them. T050 green.
  - Done 2026-10-28: `pages/TasksPage.tsx` and `pages/MyTasksPage.tsx` (routes updated; `TasksList.tsx` and `MyTasks.tsx` deleted, no reference left in `admin/test/**` or `backend/test/**`); `lib/task-filters.ts` (the address is the state — API-named parameters plus the kit's `cf.*`; saved-view mapping; stale values dropped and counted), `lib/use-task-vocabulary.ts`; `components/{TaskFilters,TaskBoard,TaskCard,ViewModeToggle,BoardCardFieldsEditor}.tsx`; the *Board card* section on `TaskWorkflowPage`; priority and tag columns on both lists; strings en/pl.
  - The board: kit `KanbanBoard` + `MoveToMenu`; a move is `POST /tasks/:id/status {from, to}` (the transition service); a refusal reverts, shows the server's sentence and narrows the card's targets (menu and `canDrop`) to the refusal's `allowedTargets` until it moves; a conflict re-reads the board; closing a Task with open sub-tasks says so; *Show more* continues a lane from `GET /tasks?status=…&cardValues=true`. *My Tasks*' board asks `/tasks/board` with `assignee=me&statusCategory=open&draft=false`.
  - **Deviations (UI scope):** (1) the list sorts through a *Sort by* select (Projects' precedent) — `ResponsiveTable` has no sortable headers; (2) the assignee filter offers *anyone / me / unassigned*, and *created by* offers *anyone / me*: specific people work through the address and saved views, but there is no people picker — the assignee lookup is `tasks:write`, a reader could not use it; (3) linked record, Project and parent filters arrive in an address (US6's panels) and show as a sentence with *Show all tasks* — the record pickers come with US6's lookups; (4) *My Tasks* has no saved views (the contract names one collection, the Tasks list's).

**Checkpoint (MVP)**: US1 + US2 + US3 are a usable ClickUp-like Task module. Demo it here.

- **Phase 5 gate**, run 2026-10-28 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`: **green** (lint: 0 errors, pre-existing warnings only).
  - Backend, targeted: `test/integration/{tasks,saved-list-views,admin_users,projects,crm}` + `test/contract/{tasks,saved-list-views,admin_users,projects,crm}` + `contract/kernel/openapi-baseline` — 136 files at 4 workers: 1 613 passed, 1 expected fail, 2 failed, and 8 more files failed in `beforeAll` only. All ten re-run green serially (`BACKEND_TEST_WORKERS=1`, longer hook timeout; 118/118): eight `setupBackendServer` load flakes, one `crm/off-state` case that passed alone, and **one real red, pre-existing**: `contract/admin_users/me.test.ts › carries the stored values after a PATCH` pins the whole preferences document and had lacked `listViewModes: {}` since Phase 1 added the key — fixed (shape only; line in `foreign-module-changes.md` §F).
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 760 / 7 761 — the one red is the known 30 s timeout of `check-module-boundary.test.ts › the tree itself` (green alone with `--testTimeout=180000`, 154/154).
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,crm,projects}` + `test/kit` + `test/components` — 153 files, 1 624 tests green.
  - Packages: `contracts` 71 / 1 542, `mod-tasks` 13 / 131, `mod-admin-users` 12 / 154, `mod-crm` 34 / 425 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies` (0 violations), `check:off-state-coverage` (41/41), `check:error-translations`, `check:bundle-pairing`, `check:command-coverage`, `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-docs`, `check:test-ownership`, `check:module-boundary`, `check:platform-surface`, `check:container-imports`, `check:port-shape`, `check:entry-presence`, `check:shared-table-wipes`, `check:release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/board`, `/board/card-fields`, `/list-views` and `/list-views/{id}` added.
  - Generated artefacts: `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` changed nothing.
  - Grep of `backend/test/**` and `admin/test/**` for the deleted `TasksList`, `MyTasks.tsx` and CRM `MoveToMenu.tsx`, and for `board.moveTo`: no reference.

---

## Phase 6: User Story 4 — Comments with references (Priority: P2)

**Goal**: a comment thread with references and mentions, with notifications de-duplicated.

**Independent Test**: `quickstart.md` §1, US4 row.

- [X] T056 [P] [US4] Write failing `backend/test/integration/tasks/comments.test.ts`:
  - add, edit and delete by the author; 403 for others;
  - a soft delete shown as deleted;
  - history rows;
  - references to an Opportunity and a Project resolved;
  - assignees and the Creator notified as `tasks.task.comment`, except the author;
  - a mentioned assignee gets the mention only, once;
  - a reader who may not see the Task cannot post (404).
  - Seen red 2026-10-28: 7/7 failed for the stated reason — every comment route fell to the router's 404 `NOT_FOUND` (no route), so nothing could be posted; the hidden-Task case failed on the code (`NOT_FOUND`, not `TASK_NOT_FOUND`), the validation case on 404 for 400. Also red: `task-notifier.test.ts`'s new case (no `commented` text). Green after T058 (7/7). One red at green was my premise: the references case first wrote as an assignee holding `projects:read`, who is not a Member of the Project and so sees it unavailable (Projects' visibility) — the case now writes as the stub administrator and reads as a role without `crm:read`/`projects:read` for the unavailable half.
  - Added beyond the list: the platform administrator (holding `*`) may not edit or delete somebody else's comment either; a deleted comment is changed no more (404); `commentsCount` drops with the delete; the history entries carry no text; an edit tells nobody about a comment again; a mention in a second comment tells again (it is a new comment), never beside the comment entry; a holder of `tasks:see_private` gets 403 `TASK_PRIVATE_READ_ONLY` on someone else's private Task; a `tasks:read`-only role may comment; an empty or over-long body is 400; another Task's comment id and a malformed id are 404.
- [X] T057 [P] [US4] Write failing `admin/test/modules/tasks/TaskDetail.comments.test.tsx`: kit `CommentThread` with `kind: 'note'`, the composer with the reference triggers, and edit/delete controls shown only to the author.
  - Seen red 2026-10-28: 6/6 failed for the stated reason (no comments section; the bundle had no `detail.comments`); the two new kit cases in `admin/test/kit/kit-comments.test.tsx` (a deleted entry kept and marked) failed on the missing core key. Green after T059 (6/6; kit 13/13). One test fix at green: clearing the rich editor leaves a reference chip, so the edit case appends to a plain comment instead.
  - Added: a deleted comment shown marked, with no controls; a `tasks:read`-only reader gets the composer; someone else's private Task shows neither composer nor *Edit*; `@` asks `/tasks/lookups/mentionable?taskId=…`.
- [X] T058 [US4] Implement `T/backend/services/comment-service.ts`, modelled on `P/backend/services/comment-service.ts`, notes only:
  - references refreshed inside the Command;
  - notification de-duplication.

  Add the routes in `routes.collaboration.ts`. T056 green.
  - Done 2026-10-28: `TaskCommentService` — `list` (oldest first, a deleted comment in its place with `body: ''`, no references, `deletedAt`), `add`, `update`, `delete`; Commands `tasks.comment.add|update|delete` against `task` (the history), states without the text (`commentId`, `length`). Each write starts from `loadVisible` + `assertMayChange`; the comment's `task_references` rows (`source_kind = 'comment'`, `source_id`) are replaced inside the Command and removed by the delete. After commit: the newly mentioned through `TaskMentionService.tell` (its answer is who was addressed), then every assignee and the Creator except the author and the addressed, each asked `createTaskAudience` again (so a draft tells nobody but its Creator), as `tasks.task.comment` — `taskNotificationText.commented` / `notifications.comment.title` (en/pl), by number only. An edit tells only the newly mentioned. Routes `GET`/`POST /tasks/:id/comments`, `PATCH`/`DELETE /tasks/:id/comments/:commentId`, all `tasks:read` (admin-api §2: R + may see the Task; authorship decided by the service). Composition: its own *Collaboration: comments* section in `index.ts`. Strings `auditLog.tasks.comment.*` (en/pl).
  - **Deviations.** (1) Somebody else's comment is **403 `FORBIDDEN`** — the contract names no code, and Projects' `PROJECT_NOTE_NOT_AUTHOR` is Projects'; no `ERROR_CODES` entry added. A missing, deleted or foreign comment is 404 `NOT_FOUND` (Projects). (2) Unlike Projects, a deleted comment is listed (R-6, the contract's `deletedAt`) and its body is emptied in the row. (3) The history keeps `references: []` (its states carry no text — unchanged, as the hand-over said).
  - Seam: `services/comment-service.ts` joins `TASK_ACCESS_READERS` with 4 reads (the thread, the author's comment, its `task_references` delete, the assignees told), each keyed by the id `loadVisible` handed out. OpenAPI baseline: only `/tasks/{id}/comments` and `/tasks/{id}/comments/{commentId}` added.
- [X] T059 [US4] Add the comments section to `T/admin/pages/TaskDetail.tsx`, with its strings. T057 green.
  - Done 2026-10-28: `components/TaskComments.tsx` (kit `CommentThread kind="note" keepDeleted`, an adapter over `tasksApi.{listComments,addComment,updateComment,removeComment}`; an author since removed reads as the core *A former administrator*), mounted full width under the details, before the attachments (admin-surfaces §2 order), the history re-read on every add and delete. Whoever holds `tasks:read` may comment, except on someone else's private Task. Strings `detail.comments`, `comments.*` (en/pl).
  - **Kit change (line added to `foreign-module-changes.md` §B):** `CommentThread` gains `keepDeleted` and `RecordComment.deletedAt?` — a deleted entry keeps its place, marked by the core bundle's new `comments.removedEntry` (en/pl), with no controls; without the prop it leaves the list as before (CRM and Projects unchanged). Admin-kit changeset updated.
  - **`@` for readers:** `lib/references.ts` now offers `@` to a `tasks:read` holder (the mentionable lookup is R, admin-api §3), `@@` still only to a writer — so a reader may mention somebody in a comment.
  - **Shape only:** `TaskDetail.after-zone.test.tsx` waits for the comments too, answers their `GET`, and its markup normaliser also strips a React id a component derived another id from (the composer's `<id>-body`).

**Checkpoint**: a Task has a comment thread with references and mentions, and nobody is told twice about one comment.

- **Phase 6 gate**, run 2026-10-28 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings): **green**.
  - Backend, targeted: `test/integration/tasks` + `test/contract/tasks` + `contract/kernel/openapi-baseline` + `contract/admin_users/permission-inventory` + `integration/{crm,projects}/references.test.ts` — 21 files, 194/194 green.
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 758 / 7 761 — the three reds are **30 s timeouts** of whole-tree scans (`module-package-manifest.test.ts` × 2, `check-module-boundary.test.ts › the tree itself`); both files green re-run with `--testTimeout=180000` (259/259).
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,crm,projects}` + `test/kit` + `test/components` — 154 files, 1 631 / 1 632; the one red, `crm/board-card-fields.test.tsx › sends each filter…`, is the async flake already seen at the Phase 3 gate and is green alone (23/23).
  - Packages: `mod-tasks` 13 / 132, `mod-i18n` 1 / 6 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies` (0 violations), `check:off-state-coverage` (41/41), `check:error-translations`, `check:bundle-pairing`, `check:command-coverage`, `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-docs`, `check:test-ownership`, `check:module-boundary`, `check:platform-surface`, `check:container-imports`, `check:shared-table-wipes`, `check:port-shape`, `check:entry-presence`, `check:release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/tasks`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/{id}/comments` and `/{id}/comments/{commentId}` added.
  - Generated artefacts: `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` changed nothing.
  - Nothing moved or deleted in this phase.

---

## Phase 7: User Story 5 — Sub-tasks and related Tasks (Priority: P2)

**Goal**: a hierarchy without cycles and at most 5 deep, progress on the parent, related links on both sides.

**Independent Test**: `quickstart.md` §1, US5 row.

- [X] T060 [P] [US5] Write failing `backend/test/integration/tasks/hierarchy.test.ts`:
  - create a sub-task, and make an existing Task a child;
  - self and descendant refused (`TASK_PARENT_CYCLE`);
  - depth 6 refused (`TASK_HIERARCHY_TOO_DEEP`);
  - two concurrent re-parentings that would form a cycle: one wins and one is refused;
  - deleting a parent detaches its children, and `DELETE` reports `subtasksDetached`;
  - `subtasks {closed, total}` counts only visible children;
  - a hidden parent shows `available: false`;
  - closing a parent with open children succeeds with `openSubtasks`;
  - relate and unrelate, visible on both sides, idempotent.
  - Seen red 2026-10-28: 12/12 failed for the stated reason — `parentTaskId` ignored on create and update (no parent, no refusal, counts 0), no relation route (router 404 `NOT_FOUND`), `DELETE` 204 with no body. Green after T062 (12/12). The race case (three rounds of `a`→`b` ∥ `b`→`a`) was also seen red **with the advisory lock removed** from the parent-change Command (`[200, 500]` — the two row locks deadlock instead of one refusal), green with it.
  - Hidden Tasks are seeded with `update tasks set is_private = true` (private Tasks are written in US8); the reader without `tasks:see_private` is a seeded role, the stub administrator holds `*`.
  - Added beyond the list: a parent the caller may not see is 404 `TASK_NOT_FOUND` (create and `PATCH`); somebody else's private Task as a parent is 403 `TASK_PRIVATE_READ_ONLY`; the same parent again records nothing; detaching (`parentTaskId: null`); the `parent_change` history rows (`{parentTaskId}` before/after; `reason: 'parent_deleted'` on each former sub-task); the creation entry names `parentTaskId`; a moved sub-tree counts its own levels (a pair under level 4 refused, under level 3 allowed); the list (`?parentId=`, the row's `subtasks`) leaves a hidden child out; related Tasks hidden from the reader are not listed; relating a Task to itself is 400, to a hidden Task 404 from either side, and a `tasks:read`-only reader gets 403.
- [X] T061 [P] [US5] Write failing `admin/test/modules/tasks/TaskDetail.subtasks.test.tsx`: progress line, list, *Add sub-task* (opens create with `?parent=`), *Make sub-task of…* picker, related Tasks section, and the warning on closing.
  - Seen red 2026-10-28: 13/13 failed for the stated reason (the bundle had no `detail.subtasks`, `detail.openSubtasks`, `create.parent` … — no section existed). Green after T063 (13/13). Two test fixes at green, both mine: the picker's options are queried inside the section (the status `<select>` has options too), and the due date is matched in the reader's locale (`toLocaleDateString('en')`), not as a month name.
  - Added: an unavailable parent named without a link; *Remove from parent*; a reader gets no control; the delete dialog says the sub-tasks stay; `TaskCreate` with `?parent=` names the parent and sends `parentTaskId` (in this file, not `TaskCreate.test.tsx`, whose GET mock answers every path with `[]`); no list is requested on load.
- [X] T062 [US5] Implement:
  - `T/backend/domain/hierarchy.ts`: depth and cycle CTE builders, unit-tested beside it;
  - `services/hierarchy-service.ts`: advisory lock, Command `tasks.task.parent_change`;
  - `services/relation-service.ts`;
  - `parentTaskId` on create and update;
  - the relation routes.

  T060 green.
  - Done 2026-10-28. `domain/hierarchy.ts` `parentChangeRefusal(taskId | null, parentId, {parentChain, subtreeHeight})` (+ 7 unit cases, written with the module — not seen red). `hierarchy-service.ts`: `lockHierarchy` (`pg_advisory_xact_lock(hashtext('tasks.hierarchy'))`), `assertParentFits` (the parent's chain and the moved Task's sub-tree, two bounded recursive CTEs over **every** Task, from ids `TaskAccess` handed out), `changeTaskParentCommand`, `TaskHierarchyService` (`assertMayAdopt`: the parent visible — else 404 — and changeable — else 403; `setParent`). The create Command takes the lock and checks the parent's depth when `parentTaskId` is given (and names it in its audit `after`); `PATCH` runs the parent change **first**, so a refusal leaves the rest of the request unwritten. `relation-service.ts`: `PUT`/`DELETE /tasks/:id/relations/:otherId` (`tasks:write`, both Tasks `loadVisible` + `assertMayChange`), `insert … on conflict do nothing` / `delete … returning`, Commands `tasks.task.relate|unrelate` against the named Task plus one row on the other through `recordAuditFromContext`; nothing changed → no audit. `TaskDetail.relatedTasks` = the related Tasks the reader may see, by number.
  - **`DELETE /tasks/:id` settled: 200 `{data: {subtasksDetached}}`** (`TaskDeleteResponseSchema`, published at T004), not 204 — T060 and FR-029 ask the answer to report it; `contracts/admin-api.md` §1 amended. `subtasksDetached` counts only the former sub-tasks the **caller may see** (scenario 7: a hidden sub-task is counted in no number). The delete Command takes the hierarchy lock, reads every child id and writes a `tasks.task.parent_change` row (`reason: 'parent_deleted'`) on each through the audit port; `on delete set null` clears the parent. `deleteTaskCommand(id, auditLog)` now answers `{deleted, detachedIds}`; the write port gained `auditLog`. Shape-only test updates (204 → 200): `tasks-crud`, `tasks.contract`, `references`, `workflow`, `projects/task-context`; changeset `tasks-task-management.md` says so.
  - **Deviations.** (1) The CTEs live in `services/hierarchy-service.ts`, not `domain/`: the seam test scans `routes/`, `services/`, `workers/` only, so SQL in `domain/` would be a rule-scoped read nobody counts; `domain/hierarchy.ts` holds the decision. (2) The hierarchy rules count Tasks the caller may not see (structural integrity), so `TASK_HIERARCHY_TOO_DEEP` can be caused by a hidden descendant — the refusal names no Task. (3) Relating a Task to itself is 400 `VALIDATION_FAILED` (no code in the contract); the relation routes answer 204 both ways. (4) A parent the caller may not see is 404 `TASK_NOT_FOUND`, as everywhere a hidden Task is named.
  - Two codes joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with their first raise site: `TASK_PARENT_CYCLE`, `TASK_HIERARCHY_TOO_DEEP`; contracts changeset updated. Strings `auditLog.tasks.task.{parent_change,relate,unrelate}` (en/pl). Seam: `hierarchy-service.ts` (5 reads) and `relation-service.ts` (2) joined `TASK_ACCESS_READERS` with their reasons; `task-commands.ts` 7 → 8 (the deleted Task's child ids), `task-service.ts` 20 → 21 (the relation pairs). OpenAPI baseline: only `/tasks/{id}/relations/{otherId}` added.
- [X] T063 [US5] Build `T/admin/components/{SubtasksSection,RelatedTasksSection}.tsx` and mount them in `TaskDetail.tsx`. Make `TaskCreate.tsx` honour `?parent=`. T061 green.
  - Done 2026-10-28: `SubtasksSection` (main column, `lg:col-span-2`, above the full-width comments): the parent as a link or *a task you cannot see*, *Remove from parent*, the progress line, the visible sub-tasks (number + title link, `StatusBadge`, assignees, due), *Add sub-task* (`/tasks/new?parent=`), *Make sub-task of…*. `RelatedTasksSection` (beside it, the side column): each related Task removable, *Add related task*. Both pickers are `components/TaskPicker.tsx` (kit `Combobox`, `GET /tasks?q=&limit=20`, mounted only once an operator chose to pick — so the detail asks no new `GET` on load and `TaskDetail.after-zone.test.tsx` needed no change). Closing a Task with open sub-tasks shows `detail.openSubtasks`; the delete dialog adds `delete.subtasks` when the Task has visible sub-tasks. `TaskCreate` reads `?parent=`, names the parent (`create.parent`) and sends `parentTaskId`. `tasksApi.deleteTask` reads the new body; `relate`/`unrelate`. Strings en/pl. Shape only: `TaskDetail.test.tsx`'s delete mock answers `{data: {subtasksDetached: 0}}`.
  - The parent's history entry heading is shown; `parentTaskId` is not a field row (identifiers are never a row, as for the assignees and the context).

**Checkpoint**: a Task breaks into sub-tasks no deeper than five levels and never in a cycle; its progress counts only what its reader may see; related Tasks show on both sides.

- **Phase 7 gate**, run 2026-10-28 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings): **green**.
  - Backend, targeted: `test/integration/{tasks,projects,demo,saved-list-views}` + `test/contract/{tasks,projects}` + `integration/crm/references` + `contract/kernel/openapi-baseline` + `contract/admin_users/permission-inventory` — 63 files at 4 workers: 59 green, 4 failed **in `beforeAll` only** (`setupBackendServer` 30 s hook timeouts: `contract/projects/record-project`, `integration/projects/{audit-coverage,migration,templates}`); all 4 green re-run serially (`BACKEND_TEST_WORKERS=1`, `--hookTimeout=120000`, 51/51). Also green: `unit/_i18n/{platform-error-code-block,error-code-migration-progress}`, `unit/kernel/error-code-routing-equality`.
  - `pnpm --filter backend run test:unit:fast`: 361 files, **7 761 / 7 761 green**.
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,crm,projects}` + `test/kit` + `test/components` — 155 files, 1 645 / 1 645 green (the crm `board-card-fields` flake did not recur).
  - Packages: `contracts` 71 / 1 542, `mod-tasks` 14 / 139, `mod-i18n` 1 / 6 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage`, `check:error-translations`, `check:bundle-pairing`, `check:command-coverage`, `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-docs`, `check:test-ownership`, `check:module-boundary`, `check:platform-surface`, `check:container-imports`, `check:shared-table-wipes`, `check:port-shape`, `check:entry-presence`, `check:lock-claims`, `check:transaction-context`, `check:default-language-prose`, `check-release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/{id}/relations/{otherId}` added.
  - Generated artefacts: `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` changed nothing.
  - Nothing moved or deleted in this phase.

---

## Phase 8: User Story 6 — Links to Opportunities, Orders and Quote Requests (Priority: P2)

**Goal**: link records to Tasks, with no effect on visibility (Q2 = A), and show the Tasks from each record's screen.

**Independent Test**: `quickstart.md` §1, US6 row.

- [X] T064 [P] [US6] Write failing `backend/test/integration/tasks/record-links.test.ts`:
  - link to an Opportunity, an Order and a Quote Request;
  - a record the caller cannot read, an absent owner or an unknown id give 422 `TASK_LINK_INVALID`;
  - a duplicate is refused or idempotent (choose and assert);
  - a reader without `crm:read` still sees the Task, with the link unavailable (Q2 = A);
  - `GET /tasks?linkedKind=&linkedId=`;
  - with `crm` off, the link is unavailable and kept, and reappears when CRM is on;
  - history rows.
  - Seen red 2026-10-28: 14/14 failed for the stated reason — `links` on create was ignored (`links: []`), and `POST`/`DELETE /tasks/:id/links…`, `/lookups/records` and `/lookups/contexts` fell to the router's 404 `NOT_FOUND` (no route), so no link could be made, refused or listed. Green after T066 (14/14).
  - **Duplicate: idempotent.** Linking a record already linked answers **200** with the existing link and records nothing; a new link is 201; the same record twice in a create body is one link.
  - Added beyond the list: unlinking (204, then 404 `NOT_FOUND` for the same link again, another Task's link id and a malformed one); a link of a switched-off owner (`quote_requests`) can be removed while it is off; a refused create link creates no Task; a caller without `crm:read` may still link what they may read (an Order); a `tasks:read`-only reader gets 403 and a hidden Task 404; a `project` kind is 400; the creation entry names its links; `?linkedKind=` leaves out a private Task the reader may not see; the link picker (`/lookups/records`) per kind, per read code and owner presence, 403 for a reader; the Project/Stage picker (`/lookups/contexts`, US6 scenario 3) answers a Project with its Stages and nothing while `projects` is off, and a Task `PATCH`ed into it behaves as in 163.
  - `GET /tasks?linkedKind=&linkedId=` itself existed since Phase 5 (`tasks-list.contract.test.ts`); its cases here were red only because no link could be made.
- [X] T065 [P] [US6] Write failing `admin/test/modules/tasks/TasksPanel.test.tsx`:
  - the panel lists the linked visible Tasks;
  - *Add task* links to `/tasks/new?link=order:<id>`;
  - it is hidden without `tasks:read`.

  Extend `admin/test/modules/tasks/off-state.test.tsx` with the three zones.
  - Seen red 2026-10-28: `TasksPanel.test.tsx` 8/8 (no zone contributed; the bundle had no `panel.*`), the new `off-state.test.tsx` case (no panel on any of the three record zones), and the T067 screen file `TaskDetail.links.test.tsx` 13/14 (no linked-records section, no context picker, `?link=`/`?context=` not read — the bundle had no `detail.links`, `links.*`, `context.*`, `create.link.*`). Green after T067 (8/8, 6/6, 14/14). The one case green at red is `ignores a malformed ?link=` — nothing read the parameter yet; it pins that a malformed value stays ignored. One test fix at green: the off-state test's zone render needed `AppLanguageContext` (the shell provides it; the panel reads the language for due dates).
  - Added: `TaskDetail.links.test.tsx` — the links section (named link, unavailable record, remove — an unavailable one too —, link through the kind and record pickers, only the kinds whose module is on and whose read code is held, a reader gets no control), the context card (move into another record and Stage through `/lookups/contexts`, take out, no move where the record refuses changes, on a private Task or to a reader), and `TaskCreate` with `?link=` and `?context=`. The panel: an empty state still offers *Add task*, a reader gets none, a failed read says so in its card, and *Show in the task list* leads to `/tasks?linkedKind=&linkedId=`. `mod-tasks` `admin/index.test.ts` gains the zones (written with them, not seen red).
- [X] T066 [US6] Implement `T/backend/services/record-link-service.ts`:
  - validate through the owner ports with the owner's read permission;
  - resolve labels per reader, sharing the resolver with `reference-service.ts`;
  - the `links` field on create;
  - the routes and `GET /tasks/lookups/records`.

  T064 green.
  - Done 2026-10-28: `TaskRecordLinkService` — `assertLinkable` (distinct targets; per kind: Orders through `orderReadPort.findByIds` with `orders:read`; Opportunities and Quote Requests through `record-owners.ts`, **presence first**, then `crm:read` / `rfqs:handle`, then `labels`; any miss is 422 `TASK_LINK_INVALID`, the three alike), `linksOf` (by kind, then creation; resolved through the new `TaskReferenceService.resolveTargets` — the reference resolver itself, so a link is named exactly as a reference to the record is: unavailable to a reader without the read code, while the owner is off, or once it is gone), `link` (`loadVisible` + `assertMayChange` + validation, Command `tasks.task.link`, `insert … on conflict do nothing`, nothing inserted → `skipAudit`), `unlink` (Command `tasks.task.unlink`, `delete … where id and task_id returning`; never validated against the record), `records` (the link picker: Orders through `orderListPort`, the switchable kinds through `owners.search`; empty for a kind the caller may not link). `POST /tasks/:id/links` (201 new / 200 existing) and `DELETE /tasks/:id/links/:linkId` (204) in `routes.collaboration.ts`, `tasks:write`; `GET /tasks/lookups/records` and `/lookups/contexts` in `routes.tasks.ts`, `tasks:write` (admin-api §3). Create: `body.links` validated before the Command; `createTaskCommand` writes the rows after its flush and names them in its audit `after` (`links: [{kind, recordId}]`). `TaskDetail.links` filled in `TaskService.#detail`. Composition: its own *Record links* section in `index.ts`.
  - **`GET /tasks/lookups/contexts`** (needed by T067's picker, listed in admin-api §3 but in no task): `services/context-lookup.ts` asks each present descriptor — `allVisibleContextIds`, `describe` in batches of 200, the label matched in memory (diacritics folded), sorted by label, then `canChangeTasks` a page at a time — at most 20, each with its groups. The descriptor publishes no search, so the cost is linear in the caller's visible contexts: issue #504.
  - **Deviations.** (1) A link id the Task does not have (another Task's, removed, malformed) is 404 `NOT_FOUND` — the contract names no code (the comments' precedent). (2) Audit states: `{link: {kind, recordId}}` / `{link: null}` — the record by id, never its number. (3) A kind the caller may not link answers the picker `[]`, not 403 (a switchable owner's code cannot gate a route, D-173).
  - `TASK_LINK_INVALID` joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with its first raise site; contracts changeset updated. Strings `auditLog.tasks.task.{link,unlink}` (en/pl). Seam: `record-link-service.ts` joined `TASK_ACCESS_READERS` with 3 reads (the Task's links, the insert, the delete), each keyed by a `loadVisible` id. OpenAPI baseline: only `/tasks/{id}/links`, `/tasks/{id}/links/{linkId}`, `/tasks/lookups/records` and `/tasks/lookups/contexts` added.
- [X] T067 [US6] Build the UI.
  - `T/admin/components/LinkedRecordsSection.tsx` in `TaskDetail.tsx`, and the context card's Project/Stage picker over `GET /tasks/lookups/contexts`.
  - `T/admin/zones/{TasksPanel,OrderTasksPanel,QuoteRequestTasksPanel,OpportunityTasksPanel}.tsx`, contributed through `zoneComponent(...)` in `T/admin/index.ts` (weight 660, `tasks:read`).
  - `TaskCreate.tsx` honours `?link=` and `?context=`.

  T065 green.
  - Done 2026-10-28. `components/LinkedRecordsSection.tsx` reads `task.links` (no new `GET` on load, so the four `TaskDetail*.test.tsx` mocks needed no change): each link by kind, a link to its record or *Unavailable record* (with a hint), removable by a writer — an unavailable one too —, and *Link a record*: a kind `Select` offering only the kinds whose module is present and whose read code the writer holds (`crm`/`crm:read`, `orders`/`orders:read`, `quote_requests`/`rfqs:handle`), then the record through `components/LookupPicker.tsx` (a generic server-side `Combobox`, `TaskPicker`'s model) over `/lookups/records`. The context card became `components/ContextSection.tsx` (its markup unchanged) with *Place in a record* / *Move* (picker over `/lookups/contexts`, then the group `Select` defaulting to the first Stage, *No stage* allowed) and *Remove from the record*, offered only to a writer, never on a private Task, and only where `canChangeTasks` (or no context). Layout: the side column of the first row now stacks the context card and the linked records beside the details; the other rows are unchanged.
  - `zones/TasksPanel.tsx` + `OrderTasksPanel`, `QuoteRequestTasksPanel`, `OpportunityTasksPanel`, contributed through `zoneComponent(...)` (weight 660, `tasks:read`). The panel reads `GET /tasks?linkedKind=&linkedId=&limit=20`: number + title (link), status, assignees, due date with *Overdue*; *Add task* (`tasks:write`) → `/tasks/new?link=<kind>:<id>`; *Show in the task list* → `/tasks?linkedKind=&linkedId=` (the list's URL already honours both). Unlike Projects' panel it renders its card at once with a loading line: there is always something to offer (*Add task*), and under Q2 = A there is no "not linked to you" answer to hide.
  - `TaskCreate`: `?link=<kind>:<id>` sends `links: [{kind, id}]`, `?context=<type>:<id>[:<group>]` sends `context`; each is named by a sentence (`create.link.<kind>`, `create.context`) — the record's number is not known to the form; a malformed value is ignored.
  - Strings `detail.links`, `links.*`, `context.*`, `panel.*`, `create.link.*`, `create.context` (en/pl).

**Checkpoint**: a Task links to Opportunities, Orders and Quote Requests without changing who sees it; each record shows its visible Tasks and starts a linked one; a link of a module that is off is kept, shown unavailable, and named again when the module is back.

- **Phase 8 gate**, run 2026-10-29 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings only): **green**.
  - Backend, targeted (on the backend commit; the admin commit changed no backend source): `test/integration/tasks` + `test/contract/tasks` + `contract/kernel/openapi-baseline` + `contract/admin_users/permission-inventory` + `integration/projects/task-context` + `unit/_i18n/{platform-error-code-block,error-code-migration-progress}` + `unit/kernel/error-code-routing-equality` — 25 files, 322/322 green.
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 760 / 7 761 — the one red is the known **whole-tree scan timeout** (`check-module-boundary.test.ts › the tree itself`, 38 s against 30 s); green re-run with `--testTimeout=180000` (154/154).
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,crm,projects,orders,quote_requests}` + `test/kit` + `test/components` — 206 files, 2 085 / 2 085 green.
  - Packages: `contracts` 71 / 1 542, `mod-tasks` 14 / 140, `mod-i18n` 1 / 6 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies` (0 violations), `check:off-state-coverage` (41/41), `check:error-translations`, `check:bundle-pairing`, `check:command-coverage`, `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-docs`, `check:test-ownership`, `check:module-boundary`, `check:platform-surface`, `check:container-imports`, `check:shared-table-wipes`, `check:port-shape`, `check:port-catches`, `check:entry-presence`, `check:lock-claims`, `check:transaction-context`, `check:default-language-prose`, `check-release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/{id}/links`, `/{id}/links/{linkId}`, `/lookups/records` and `/lookups/contexts` added.
  - Generated artefacts: `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` changed nothing.
  - Nothing moved or deleted in this phase (the context card's markup moved into `components/ContextSection.tsx`, unchanged).
  - Issue opened: #504 (the Project/Stage picker describes every visible Project on each search).

---

## Phase 9: User Story 7 — Reminders and the daily digest (Priority: P2)

**Goal**: reminders (bell exactly once, e-mail at most once, 24 h grace) and an opt-in daily digest. One worker runs both, and the US10 pass joins it later.

**Independent Test**: `quickstart.md` §1, US7 rows.

- [X] T068 [P] [US7] Write failing `backend/test/integration/tasks/reminders.test.ts`. It is clock-controlled and calls the pass function directly, as Projects' stage-alert tests do (read them first). It covers:
  - absolute and relative reminders;
  - recipients limited to the caller and the assignees;
  - more than 10 refused;
  - changing the due moment moves a relative reminder;
  - removing the due date deletes it, with a history row;
  - a due reminder gives one bell per recipient and an e-mail through a fake sender;
  - two concurrent passes give still one bell (unique delivery);
  - a recipient who lost visibility, a closed Task or a draft gets a `skipped` row;
  - a reminder overdue by 25 h gets `expired` and nothing is sent;
  - one overdue by 2 h is delivered;
  - with `tasks` off nothing is sent, and on return only the < 24 h ones go;
  - a tick with nothing due enters no system scope (no `tenant.escape_hatch` row).
  - Seen red 2026-10-29 for the stated reason, at file level: the file failed to load (`Cannot find module …/workers/tasks-reminders-worker.js`) — no route, service or worker existed. Green after T072/T074 (14/14).
  - Added beyond the list: the time zone route (read on `tasks:read`, 403 for a writer, 422 for `Mars/Olympus_Mons`); a reader sees only their own reminders and those naming them, on the list and on `TaskDetail.reminders`; a `tasks:read`-only reader may not add one (403) nor remove someone else's (403), the creator may, a second removal is 404; `tasks.reminder.add` / `.remove` / `.removed_with_due` in the history; a delivered relative reminder whose due moment moves fires again at the new moment; a deactivated recipient is `skipped`; the bell names the Task by number only and links to it; the e-mail's message id is `tasks_task_reminder:<deliveryId>`; three concurrent passes. "Lost visibility" is seeded as `update tasks set is_private = true` (private Tasks are written in US8): the Creator is still told, the other recipient is `skipped`. The idle-tick case attaches the production escape-hatch writer (`idle-worker-ticks-audit.test.ts`' model) and counts rows for `TASKS_REMINDERS_SCOPE_REASON`.
- [X] T069 [P] [US7] Write failing `backend/test/integration/tasks/digest.test.ts`:
  - subscribe at hour 8;
  - passes at 07:55, 08:05 and 08:20 local time send exactly one;
  - the next day, one more;
  - across the 2026-10-25 and 2027-03-28 DST changes in `Europe/Warsaw`, one per day;
  - an empty day sends nothing and does not consume the claim wrongly (assert the chosen semantics);
  - Tasks with a context the recipient cannot see are excluded;
  - drafts are excluded;
  - an unsubscribe stops it.
  - Seen red 2026-10-29 for the stated reason: `beforeAll` failed on `PUT /tasks/settings/time-zone` (404 `NOT_FOUND`, no route), so every case failed. Green after T073/T074 (7/7). One red at green was my own timeline: the DST walk started the evening before its first day and counted that day's digest too (4 for 3) — the walk now starts just after local midnight.
  - **Chosen semantics, asserted:** an empty day **closes the day** — the pass at the subscriber's hour claims the day (`last_sent_on = today`), finds nothing, sends nothing; a Task falling due later that day goes into the next day's digest (as overdue), never into a second digest the same day; the next day's claim is untouched.
  - Added: off by default (`GET` → `null`), the caller's own, `hour: 24` → 400, the subscribe Command audited against `task_digest_subscription`; the bell is `tasks.digest.daily` with `{count}` and links to `/tasks/mine`; Tasks excluded besides drafts and a hidden context: due tomorrow, closed, someone else's private Task the subscriber is assigned to, not assigned to them; with `tasks` off the composed job sends nothing and does not catch up the next day. The hidden context is a probe descriptor (`digest_probe`, owner `crm`, `canSeeAs` false), `context-visibility.test.ts`' model.
- [X] T070 [P] [US7] Write failing admin tests:
  - `admin/test/modules/tasks/TaskDetail.reminders.test.tsx`: add absolute and relative reminders, pick recipients, remove;
  - `admin/test/modules/tasks/DigestControl.test.tsx`: on/off and hour.
  - Seen red 2026-10-29: `TaskDetail.reminders.test.tsx` 8/8 for the stated reason (the bundle had no `detail.reminders` — no section); `DigestControl.test.tsx` and the added `TaskGeneralSettingsPage.test.tsx` failed to load (no component). Green after T075/T071 (8/8, 4/4, 4/4).
  - Added: the reminders come with the Task and the section asks no request of its own (the four `TaskDetail*.test.tsx` mocks unchanged); the save button stays disabled without a moment or a recipient; a Task without a due date offers no relative reminder and says why; the server's refusal is shown in its words and the form kept; a reader gets no add control and a remove control only on a reminder they set. Digest: a stored hour shown, off, an unreadable digest says so and offers no control. Settings: the route's gate, save, the server's 422, an unreadable setting.
  - Shape only: `MyTasksPage.test.tsx` answers `GET /tasks/me/digest` (`null`), the control now on that screen; `off-state.test.tsx` and `T/admin/index.test.ts` list the new route (`/tasks/settings/general`, `tasks:configure`), and a writer without `tasks:configure` gets the not-found screen there too.
- [X] T071 [US7] Copy the shared helpers:
  - `T/backend/services/scheduled-work-probe.ts`;
  - `time-zone-validator.ts`.

  Add the Tasks copy to `backend/test/unit/tenancy/scheduled-work-probes.test.ts`. Add `GET` / `PUT /tasks/settings/time-zone` (`tasks:configure`), and build `T/admin/pages/settings/TaskGeneralSettingsPage.tsx`.
  - Done 2026-10-29. `services/scheduled-work-probe.ts` is Projects' byte for byte; `services/time-zone-validator.ts` (`createTaskTimeZoneValidator`, `TASK_TIME_ZONE_SETTING`, + its unit test, seen red: no module) is Projects' validator for `tasks.time_zone`, registered from an ungated contribution boot hook into `settingWriteValidatorRegistry`. The probe test lists **two** Tasks probes (`reminder-service.ts` and `digest-service.ts` `hasWork`, one per pass of the one worker), so its helper-copies case now compares the set of modules (line in `foreign-module-changes.md` §G). `services/task-settings-service.ts` + `routes/routes.settings.ts`: `GET` on `tasks:read` (the screens need it; admin-api §4 "R / C"), `PUT` on `tasks:configure`, written through `settings`' own audited write (`setValueForAllChannels`, whose validator registry answers 422) — the board card fields' precedent, not a `tasks.time_zone.change` Command (data-model §7 names one). The screen (`pages/settings/TaskGeneralSettingsPage.tsx`): a select of `Intl.supportedValuesOf('timeZone')` plus UTC, saved on demand; reached from a *General settings* link on the workflow screen's header and back — no sidebar row, no palette action (admin-surfaces §4 names none).
- [X] T072 [US7] Implement the reminders in `T/backend/services/reminder-service.ts`:
  - CRUD, with relative recomputation called from the due-change paths of `task-commands.ts`;
  - the pass, per R-17: claim, visibility check, delivery row plus bell, then e-mail after commit.

  Write the bell and the delivery row in one transaction if T001 (b) said yes. Otherwise use the plan's fallback, de-duplicating on `kind` + `subjectId` + recipient. The e-mail goes through `T/backend/services/task-email.ts`, modelled on `P/backend/services/stage-alert-email.ts`, with `T/backend/email-templates/reminder-defaults.ts`.
  - **Orchestrator ruling 3 (2026-10-28):** the bell is written co-transactionally through a new, additive `adminNotificationRecordPort.recordWithin(em, input)` in `admin_notifications` (`foreign-module-changes.md` §E2), so the delivery row and the bell commit together and the bell is exactly once (SC-004). Implement that port method in this task (test first), and use it instead of the fallback above.
  - **`recordWithin`, done 2026-10-29 (commit `ed85493ae`).** `backend/test/integration/admin_notifications/record-within.test.ts` seen red: 3 of 4 (`port(...).recordWithin is not a function`); the fourth — `record` still commits on its own whatever the caller does — passed red, as it pins the unchanged half. `AdminNotificationService.recordWithin(em, input)` creates and persists on the caller's EntityManager, no fork, no flush; both writers share the checks (`#create`). **Deviations:** (1) the port is `AdminNotificationRecordPort<EM = unknown>` — `packages/contracts` holds no `@mikro-orm` import (the `ModuleInstalledEvent<EM>` precedent); the provider is still `providePort<AdminNotificationRecordPort>`, Tasks resolves it as `<EntityManager>`. (2) `recordWithin` prunes nothing: pruning is a statement of its own, and the recipient's next `record` prunes. Changeset `admin-notifications-record-within.md` (`minor` for the module and the contracts).
  - **Reminders, done 2026-10-29.** `services/reminder-service.ts` (`TaskReminderService`): `list` / `forReader` (the reader's own and those naming them; `done` = every recipient has a delivery row), `add` (Command `tasks.reminder.add` on the Task: recipients ⊆ caller ∪ assignees, relative needs a due moment, at most `TASK_REMINDERS_MAX` counted under the Task's lock), `remove` (Command `tasks.reminder.remove`; the creator or a holder of `tasks:write`, else 403 `FORBIDDEN`; a reminder the Task does not have is 404 `NOT_FOUND`). Both start from `loadVisible` + `assertMayChange`. Relative reminders: `services/reminder-schedule.ts` `followDueMoment`, called by `updateTaskCommand` (now `(id, changes, {timeZone, auditLog})`) whenever `dueOn`/`dueAt` changes: a new moment moves each relative reminder and **deletes its delivery rows** (a moved reminder fires again); no moment removes them, each with a `tasks.reminder.removed_with_due` audit row on the Task. The pass: up to 200 due (reminder, recipient) pairs; more than `TASK_REMINDER_GRACE_MS` late → `expired`; a closed Task, a draft, an inactive recipient or one `createTaskAudience` refuses (`tasks:read`, draft/private, the context's `canSeeAs`) → `skipped`; otherwise one Command inserts the `delivered` row `on conflict do nothing` and, only when it inserted and `admin_notifications` is present, writes the bell through `recordWithin` on the same transaction — then the e-mail after commit (`services/task-email.ts`, Projects' model; `email-templates/reminder-defaults.ts`). Bookkeeping Commands `tasks.reminder.deliver|expire|skip` are `skipAudit` (CRM's precedent; no `command-coverage-ignore` needed — they go through the Command Bus).
  - `TASK_REMINDER_INVALID` joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts` with its first raise site; the refusal carries `details: [{path: 'reminder', issue: 'recipients' | 'too_many' | 'no_due_moment'}]` under one sentence. `TaskDetail.reminders` is filled in `#detail` through `forReader` (read off the cradle). Bell `tasks.task.reminder` — `notifications.reminder.title` *Reminder: Task {number}* (en/pl); history strings `auditLog.tasks.reminder.*` (en/pl). Seam: `reminder-service.ts` (12 reads), `reminder-schedule.ts` (3) joined `TASK_ACCESS_READERS` with their reasons; `scheduled-work-probe.ts` joined `SQL_WITHOUT_RULE_SCOPED_TABLES`.
  - **Judgement calls:** a reminder may be set on a draft (it is `skipped` when due — "no reminder fires", FR-037); an absolute moment in the past is accepted (it goes on the next tick within 24 h, else expires).
- [X] T073 [US7] Implement the digest:
  - `T/backend/services/digest-service.ts`: the claim `update … returning` under `skip locked`, the per-recipient list, the bell and the e-mail;
  - `email-templates/digest-defaults.ts`;
  - first check whether the template engine supports a repeated block, and record the finding; otherwise use the preformatted `taskList` variable;
  - the routes `/tasks/me/digest`.
  - **Template finding (checked first):** the directive engine of `@endora-commerce/email-components` **does** support a repeated block, `{{for alias in path}} … {{/for}}`, with `{{if}}` nested (`directives/directive-engine.ts`). A preformatted variable would not do for the HTML part — a `{{var}}` is escaped after the component's newlines became `<br />`, so its own newlines render as one line. So the default body loops over `digest.tasks` (`{number, title, due, overdue, today}`), and the words around each Task (*overdue since*, *due today*) are the template's, per language — no sentence in code (`check:default-language-prose` refused the first draft, which built the line in code). `digest.taskList` (number, title and due date per line) is sent too: it is the variable the manifest declares, and the manifest's variable catalogue (`sampleValue` a string) cannot describe a list.
  - Done 2026-10-29. `services/digest-service.ts` (`TaskDigestService`): `mine` / `subscribe` / `unsubscribe` (Commands `tasks.digest.subscribe` / `.unsubscribe` against `task_digest_subscription` and the administrator's id; a change of hour keeps today's claim); `pass(now)`: one Command claims up to 100 subscriptions (`update … set last_sent_on = :today from (select … where hour <= :hour and (last_sent_on is null or last_sent_on < :today) … for update skip locked)`), commits, then for each active person lists up to 200 open, published Tasks assigned to them with `due_on <= today` (a due time's date is its day in `tasks.time_zone`), each asked `createTaskAudience`, and when the list is not empty sends one bell (`tasks.digest.daily`, `notifications.digest.title` with `{count}`, link `/tasks/mine`, through the notifier — after the claim's commit, so at most once) and one e-mail (`tasks_daily_digest:<adminUserId>:<date>`). `routes/routes.reminders.ts` serves the reminders and `GET`/`PUT`/`DELETE /tasks/me/digest` (`tasks:read`, the caller's own). Seam: `digest-service.ts` (2 reads) joined `TASK_ACCESS_READERS`. OpenAPI baseline: only `/tasks/me/digest`, `/tasks/settings/time-zone`, `/tasks/{id}/reminders` and `/tasks/{id}/reminders/{reminderId}` added.
- [X] T074 [US7] Implement `T/backend/workers/tasks-reminders-worker.ts`, modelled on `P/backend/workers/stage-alert-worker.ts`:
  - Job Scheduler `tasks-reminders` every 60 s, `concurrency: 1`;
  - for each pass, presence, then the probe, then `enterSystemScope`;
  - digest cadence at most every 15 min;
  - started from `T/backend/index.ts` only where `processRunsWorkers && moduleQueueRedis`, attached with `ctx.worker`, closed `onClose`;
  - register the e-mail defaults in an ungated `ctx.onBoot`.

  Run `manifests:generate` (new peers `bullmq`, `ioredis`, `@endora-commerce/email-components`) and `pnpm install --lockfile-only`. Run `check:subscribe-seam`. T068 and T069 green.
  - Done 2026-10-29. `workers/tasks-reminders-worker.ts` (+ unit test, seen red: no module; 9/9): `createTasksRemindersJob({isPresent, reminders, digest, log})` builds the job (its deps and the digest cadence) and `runTasksRemindersJob(job, now)` runs one tick — per tick, presence, then each pass's probe outside any scope (a probe that throws counts as work), then `enterSystemScope` (`tasks: deliver due reminders` / `tasks: send the daily digests`); the digest pass when ≥ 15 min passed since its last run in this process (an in-memory stamp; a clock that went back runs it at once); a failed pass is logged, a module switched off is rethrown. `startTasksReminders` builds the queue and a `concurrency: 1` worker only where `processRunsWorkers && moduleQueueRedis`, through `ctx.worker`, the queue closed `onClose`, the scheduler `tasks-reminders` every 60 s. The job is registered as `tasksRemindersJob` so a test drives what the consumer runs. The consumer's processor is `() => runTasksRemindersJob(input.job)` — a function **of the same file** that calls `enterSystemScope`: `check-entry-scope` follows one same-file hop and read the first draft (`() => input.job()`, a closure) as an unscoped worker, which the gate's `test:unit:fast` (`moved-module-tree.test.ts`) caught. The two e-mail defaults are pushed into `emailDefaultsPort` from an ungated boot hook. `manifests:generate` added the three peers, `pnpm install --lockfile-only` the lockfile entries (committed). `check:subscribe-seam`, `check:off-state-coverage` (41/41), `check:port-dependencies`, `check:command-coverage` green. `contribution-absent-owner.test.ts`' `tasks` composer supplies `settingWriteValidatorRegistry` and `emailDefaultsPort` (§G line added). T068 and T069 green.
- [X] T075 [US7] Build `T/admin/components/{RemindersSection,DigestControl}.tsx`, mounted in `TaskDetail.tsx` and `MyTasksPage.tsx`. T070 green.
  - Done 2026-10-29. `components/RemindersSection.tsx` in the side stack, after the linked records (admin-surfaces §2): each reminder's moment (relative: *1 hour before the due date · <moment>*), recipients and a *Sent* badge; *Add reminder* (writer) opens a form — *At a date and time* (`datetime-local`, sent as the reader's instant) or *Before the due date* (15 min, 1 h, 1 day, 2 days, 1 week; disabled with a sentence on a Task with no due date) — and the recipients as checkboxes, the reader first and checked, then the assignees; removal for the reminder's creator or a writer; every change reads the Task again and refreshes the history. `components/DigestControl.tsx` above the filters on *My Tasks*: a checkbox (on at 08:00), the hour (00:00–23:00) once on, each change saved at once and said in a polite live region. `lib/settings-paths.ts` holds the two settings paths. Strings `detail.reminders`, `reminders.*`, `digest.*`, `settings.*` (en/pl). T070 green.

**Checkpoint**: a Task reminds whom it should, once, at its moment or within 24 h after downtime, and never someone who may no longer see it; a subscriber gets one digest a day, and none on a day with nothing due.

- **Phase 9 gate**, run 2026-10-29 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings only): **green**.
  - Backend, targeted: `test/integration/{tasks,admin_notifications}` + `test/contract/{tasks,admin_notifications}` + `contract/_lifecycle/admin-notifications-dead-switch` + `integration/projects/{task-context,completion-gate,stage-alerts}` + `integration/crm/{mentions,review-regressions}` + `integration/tenancy/idle-worker-ticks-audit` + `contract/kernel/openapi-baseline` + `contract/admin_users/permission-inventory` + `unit/_i18n/{platform-error-code-block,error-code-migration-progress}` + `unit/kernel/{error-code-routing-equality,contribution-absent-owner}` + `unit/tenancy` + `unit/db/module-graph` — 43 files, 579 passed, 1 expected fail; `reminders`, `digest` and `contribution-absent-owner` re-run green after the worker change below (45/45).
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 768 / 7 772 — three **whole-tree scan timeouts** (`module-package-manifest.test.ts` × 2, `check-module-boundary.test.ts › the tree itself`; green re-run with `--testTimeout=180000`) and **one real red**, `moved-module-tree.test.ts › check-entry-scope.ts reads both roots and passes`: the worker's processor delegated to a closure the check cannot follow — fixed (T074 note), the three files then 388/388 and `check-entry-scope` 0 unscoped.
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,projects,orders,crm}` + `test/kit` — 129 files, 1 407 / 1 410; the three reds are async-wait timeouts under the parallel `test:unit:fast` load (`crm/board-card-fields › sends each filter…`, issue #503; `orders/OrderCreatePage.{groups,product-browser}`, seen at the Phase 3 gate), green re-run alone (42/42). `test/modules/{tasks,projects}` alone: 37 files, 313 / 313.
  - Packages: `contracts` 71 / 1 542, `mod-tasks` 17 / 159 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage` (41/41), `check:subscribe-seam`, `check:command-coverage`, `check:port-shape`, `check:port-catches`, `check:entry-presence`, `check-entry-scope`, `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-docs`, `check:test-ownership`, `check:module-boundary`, `check:platform-surface`, `check:container-imports`, `check:shared-table-wipes`, `check:lock-claims`, `check:transaction-context`, `check:default-language-prose`, `check:error-translations`, `check:bundle-pairing`, `check-release-intent --since origin/master` (0 violations; changesets `contracts-task-management.md` and `tasks-task-management.md` updated, `admin-notifications-record-within.md` added). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/me/digest`, `/settings/time-zone`, `/{id}/reminders` and `/{id}/reminders/{reminderId}` added.
  - Generated artefacts: `manifests:generate` added the peers `bullmq`, `ioredis`, `@endora-commerce/email-components` (`package.json`, `README.md`), `pnpm install --lockfile-only` the lockfile entries — committed; `composer:generate` changed nothing.
  - Nothing moved or deleted in this phase.
  - Issue opened: #505 (changing `tasks.time_zone` moves no date-only relative reminder and re-derives no `due_on`).

---

## Phase 10: User Story 8 — Drafts and private Tasks (Priority: P3)

**Goal**: the write paths and the UI on top of the Phase 2 predicate, and `tasks:see_private`.

**Independent Test**: `quickstart.md` §1, US8 row.

- [X] T076 [P] [US8] Write failing `backend/test/integration/tasks/draft-private.test.ts`, extending T012 with the write side and every surface added since:
  - **Drafts:**
    - create as a draft: no notification, no reminder fires, the completion gate ignores it;
    - publish by the Creator notifies assignees and mentions, emits `tasks.task.created.v1`, sets `published_at`;
    - publish by another admin gives 403;
    - re-drafting is impossible.
  - **Private Tasks:**
    - with an assignee other than the Creator, 422 `TASK_PRIVATE_ASSIGNEE`;
    - placing one in a Project is refused (check constraint mapped to 422);
    - a holder of `tasks:see_private` may read and delete one, and gets 403 `TASK_PRIVATE_READ_ONLY` on every other write route (loop over the route table);
    - it is absent for others from the board, saved-view results, `TasksPanel` lists, `@@` lookups (tasks, CRM, Projects), reference resolution in CRM and Projects, comment and attachment routes, and the digest.
  - Seen red 2026-10-29 for the stated reason: 18 of 18 failed — `draft` and `private` ignored on create (a "draft" was published, a "private" Task assigned to Ben, everybody saw both), `POST /tasks/:id/publish` 404 `NOT_FOUND` (no route; the route table had 14 write routes against 15 listed), `TASK_PRIVATE_ASSIGNEE` / `TASK_ALREADY_PUBLISHED` not raised, `DELETE` refused to a `tasks:read` + `tasks:see_private` holder by the route gate, the draft's reminder `delivered`, the draft counted by `listOpenInContext`. Green after T078 (18/18).
  - **The route loop is the route table.** The test reads `/api/v1/_openapi.json`, takes every `POST`/`PUT`/`PATCH`/`DELETE` under `/tasks/{id}` but `DELETE /{id}`, and holds its own table equal to it before looping, so a write route added later fails here until it is listed. Every one answers a `tasks:see_private` + `tasks:write` holder 403 `TASK_PRIVATE_READ_ONLY` (the multipart upload included, sent as multipart so the body check does not answer first); so do relating a Task *to* it, putting a Task under it on `PATCH`, and creating a sub-task of it.
  - **Deviation — another admin publishing a draft is 404, not 403.** T076 and admin-api §1 wrote "403 `TASK_DRAFT_ONLY_CREATOR`", but a draft is visible to its Creator only (FR-037; R-3 "even to holders of `tasks:see_private`"), so nobody else can reach a draft without the 403 revealing that it exists — against SC-005 ("no draft revealed through any … address"). The test asserts the 404 body equal to a missing Task's, for a writer and for a `tasks:see_private` holder. `TASK_DRAFT_ONLY_CREATOR` could never be raised, so it left `TASKS_ERROR_CODES`; the 409 the contract named without a code is `TASK_ALREADY_PUBLISHED`. admin-api §1 and research R-20 updated.
  - Surfaces covered: the list (also `draft=true`, `private=true`, `creator`+`overdue` — the filters a saved view stores; a view's results are the list's answer, there is no server-side "apply"), the board, *My Tasks*, the address (404 identical to missing), a record's Tasks panel (`linkedKind`/`linkedId`, the link row seeded), comments/attachments/reminders/history/mention list (404), the `@@` lists of Tasks, CRM and Projects, references in a CRM Opportunity and a Project (unavailable for Ben, available for the platform administrator), the read port. **The digest is not repeated here**: `digest.test.ts` (T069) already holds "someone else's private Task the subscriber is assigned to" out, and drafts.
  - Added beyond the list: a draft emits no `tasks.task.*` event while it is one (created, assignees changed, status changed); publishing emits `tasks.task.created.v1` with the assignees it has then and tells the assignees and the description's mentions once, never the publisher; `tasks.task.publish` / `tasks.task.privacy_change` in the history; making a Task private with somebody else assigned is 422 unless they leave in the same `PATCH`; a non-Creator setting `private` is 403 `FORBIDDEN`; a private Task's assignee lookup offers only its Creator; `tasks:read` + `tasks:see_private` deletes a private Task and gets 403 `FORBIDDEN` on a public one.
- [X] T077 [P] [US8] Write failing `admin/test/modules/tasks/TaskCreate.draft-private.test.tsx`:
  - *Save as draft* and the *Private* switch, which limits the assignee picker to self and hides the context picker;
  - the detail's *Draft* badge with *Publish*;
  - the read-only rendering for a `tasks:see_private` reader.
  - Seen red 2026-10-29: 7 of 7 failed for the stated reason — the shipped bundle had none of `create.saveDraft`, `create.private`, `detail.draftBadge`, `detail.publish`, `detail.privateBadge`, `detail.privateReadOnly` (no control existed). Green after T079 (7/7).
  - **Reading of "hides the context picker".** The create form has no context picker — a Task is placed in a record only by arriving with `?context=` — so a Task started inside a record offers **no Private switch**, and on a Task's screen the context card offers no *Choose a record* for a private Task (`ContextSection` already refused it). Both asserted. Added: the Creator turns a Task without a record private or public again on its screen; no *Publish* for somebody who is not the draft's Creator; the read-only reader keeps *Delete*.
- [X] T078 [US8] Implement the write paths in `T/backend/services/task-service.ts` and `task-commands.ts`:
  - `draft` and `private` on create;
  - `private` on update (Creator only);
  - the `publish` Command and route;
  - delete allowed for `tasks:see_private` on a private Task;
  - suppress notifications for drafts in the notifier, mention and comment services;
  - map the check constraints to 422s.

  T076 green.
  - Done 2026-10-29. `createTaskCommand` writes `is_draft`/`is_private` and `published_at` only for a published Task; new `publishTaskCommand` (`tasks.task.publish`: re-checks `is_draft` under the lock, so a second publish is 409 `TASK_ALREADY_PUBLISHED`; emits `tasks.task.created.v1` with the assignees it has then) and `changeTaskPrivacyCommand` (`tasks.task.privacy_change`). `TaskService.create` refuses `private` with a context (the schema already does) and an assignee other than the caller (422 `TASK_PRIVATE_ASSIGNEE`); `update` takes `private` from the Creator only (403 `FORBIDDEN`), refuses a private Task in a context (422 `TASK_CONTEXT_INVALID`, `details.reason: 'private'`) and any assignee but the Creator **as the Task will be after the write** (so `{private: true, assigneeIds: []}` or `{private: true, context: null}` succeed), runs the privacy Command first when going public and last when going private; `publish` (`POST /tasks/:id/publish`, `tasks:write`): `loadVisible` → `assertMayChange` → not a draft 409 → (unreachable) not the Creator 404. `delete`: the route gate is now `tasks:read`, and the service asks for `tasks:write`, or `tasks:see_private` on a private Task, answering the route gate's 403 `FORBIDDEN` before loading anything when neither is held. The assignee lookup takes `taskId` (a private Task: its Creator alone). `mapDraftPrivateViolation` turns `tasks_private_context_check` into the same 422 and `tasks_draft_source_check` into 422 `TASK_CONTEXT_INVALID`, on the create, update and privacy Commands.
  - **Notifications for drafts.** The notifier, mention and comment services already refuse a draft through `createTaskAudience` (Phase 3/6: nobody but the Creator, and the Creator is the actor); `TaskService` now also skips telling at all for a draft on create and update, and tells at publication. Comment mentions written while it was a draft are not told at publication — "as for a new Task" is the description's.
  - **Judgement call — a draft emits no event at all.** R-3 says that for other modules a draft does not exist until published, so `tasks.task.assignees_changed.v1`, `tasks.task.status_changed.v1` and `tasks.task.deleted.v1` are not emitted for a draft either (nothing subscribes today, `ports-and-events.md` §6); the audit rows are written as for any Task. The changeset says so.
  - Ledgers: `TASK_PRIVATE_ASSIGNEE`, `TASK_ALREADY_PUBLISHED` joined `ERROR_CODES`, the manifest, both bundles and `reference-ledgers.ts`; history labels `auditLog.tasks.task.{publish,privacy_change}` (en/pl). No new SQL, so the seam ledger is unchanged. OpenAPI baseline: only `/api/v1/admin/tasks/{id}/publish` added. Changesets `contracts-task-management.md` and `tasks-task-management.md` updated.
  - **Phase 2's *My Tasks* decision checked against the spec and kept.** US3 scenario 6 says *My Tasks* "shows the user's open Tasks — as an assignee" and says nothing of drafts; admin-api §1 says "no draft" is implied. FR-037 makes a draft its Creator's private workspace, not yet a piece of assigned work, and the Creator finds their drafts through the list's *Drafts* filter (`draft=true`). No change; the baseline's control case stays.
- [X] T079 [US8] Build the UI in `T/admin/pages/{TaskCreate,TaskDetail}.tsx` and its strings. T077 green.
  - Done 2026-10-29. `TaskCreate`: *Save as draft* (outline, beside *Create task*, with a sentence saying who sees a draft) and a *Private* switch (the kit `Checkbox` with `role="switch"`, described by its hint), absent for a Task started with `?context=`; while on, the assignee picker is replaced by "A private task can be assigned only to you." and *Assign to me* stays, and switching it on drops everyone else already chosen. `TaskDetail`: *Draft* and *Private* badges beside the status in the header; a draft's notice with *Publish* (`permissions.canPublish`); the Creator's *Private* switch on a Task without a record (a `PATCH {private}`, the server's refusal shown in its words); the edit form offers no picker of other people on a private Task; someone else's private Task says whose it is and that it can be viewed or deleted, and *Delete* shows on `permissions.canDelete` for a writer or a `tasks:see_private` holder of a private Task. `api.ts` `publishTask`. Strings `create.{saveDraft,draftHint,private,privateHint,privateAssignee}`, `detail.{draftBadge,privateBadge,draftHint,publish,published,private,privateHint,privateReadOnly}` (en/pl). `admin/test/modules/{tasks,projects}` 38 files / 320 green.

**Checkpoint**: a Task can be saved as a draft and published once by its Creator, or kept private; neither is revealed to anyone else on any surface, and a holder of *See private tasks* reads and deletes private Tasks and changes nothing else.

- **Phase 10 gate**, run 2026-10-29 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings only): **green**.
  - Backend, targeted: `test/integration/tasks` + `test/contract/tasks` + `integration/projects/{completion-gate,references}` + `integration/crm/references` + `contract/admin_users/permission-inventory` + `unit/kernel/error-code-routing-equality` + `unit/_i18n` + `contract/kernel/openapi-baseline` — 39 files, 486 / 486.
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 771 / 7 772 — the one red the known whole-tree scan timeout (`module-package-manifest.test.ts › reports the tree as up to date`), green alone with `--testTimeout=180000` (105/105).
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,projects}` — 38 files, 320 / 320.
  - Packages: `contracts` 1 542, `mod-tasks` 17 files / 159 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage` (41/41), `check:error-translations`, `check:bundle-pairing`, `check:default-language-prose`, `check:command-coverage`, `check:action-route-permissions`, `check:admin-surface`, `check:test-ownership`, `check:module-boundary`, `check:port-shape`, `check:entry-presence`, `check-release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated: only `/api/v1/admin/tasks/{id}/publish` added. `composer:generate`, `manifests:generate`: no change.
  - Nothing moved or deleted. `TASK_DRAFT_ONLY_CREATOR` left `TASKS_ERROR_CODES`; no file under `backend/test/**` or `admin/test/**` named it.
  - Issue opened: #506 (assigning a Task in a Project does not ask the Project's `canSeeAs`; the assignee lookup does not narrow by it — spec edge case and admin-api §3 against 163's pinned behaviour).

---

## Phase 11: User Story 9 — Tags and Priorities configured by the operator (Priority: P3)

**Goal**: the two configuration screens, and priority removal with replacement.

**Independent Test**: `quickstart.md` §1, US9 row.

- [X] T080 [P] [US9] Write failing `backend/test/integration/tasks/tags-priorities.test.ts`:
  - **Tags:**
    - rename and recolour;
    - a duplicate name ignoring case gives 409 `TASK_TAG_NAME_TAKEN`;
    - delete cascades from Tasks, with `usageCount` in the audit row;
    - `tasks:write` cannot create, rename or delete (403).
  - **Priorities:**
    - create, rename en/pl, reorder;
    - sorting by priority follows the new order;
    - remove with replacement `high` moves Tasks with history rows;
    - remove with `none` clears them.
  - Seen red 2026-10-29: 12 of 13 failed for the stated reason — every write route 404 (`PATCH`/`DELETE /tasks/tags/:id`, `POST`/`PATCH`/`DELETE /tasks/priorities…`). The case "a missing tag is 404 on rename and delete" passed red (an unregistered route is also 404 `NOT_FOUND`); kept, it pins the answer. Green after T082 (13/13).
  - **Both lists are platform-wide**, so the file adds its own priorities and tags (suffixed) and never touches the seeded four: a file running beside it (`task-fields.test.ts` sets `high`) sees them throughout. Hence "reorder" moves the file's own priority between `high` and `normal`, and the sort case moves its own `first_…` above `urgent`.
  - **Every Task, whoever may see it** (Phase 10 hand-over): the tag's audit `usageCount` is 2 with one of the two Tasks the writer's draft (invisible to the administrator deleting the tag, whose list says 1); the priority removal moves the writer's draft too, with its history row, while the list's `inUseCount` says 2 of 3.
  - Added beyond the list: a rename to a name taken in another case 409, a tag's own name re-cased accepted; no per-Task `tasks.task.tags_change` row on a tag deletion (R-10); a writer still assigns an existing tag; a taken priority code; 404 for a missing priority or tag on `PATCH`/`DELETE`; `replacement` missing or equal to the removed code, and an unknown replacement (422 `TASK_PRIORITY_UNKNOWN`), refused before anything moves; a priority nobody holds removed without a replacement; 5 001 Tasks holding a priority give 409 `TASK_STATUS_IN_USE_TOO_MANY` and nothing moves (one `generate_series` insert, deleted in the case); `tasks:write` refused every priority write.
- [X] T081 [P] [US9] Write failing `admin/test/modules/tasks/TaskTagsPage.test.tsx` and `TaskPrioritiesPage.test.tsx`: tables, dialogs, the delete confirmation showing the usage count, and the replacement select.
  - Seen red 2026-10-29: both files failed to load (`pages/settings/TaskTagsPage` / `TaskPrioritiesPage` did not exist). Green after T083 (tags 9/9, priorities 10/10).
  - Each file also asserts its route on `tasks:configure` and its palette action in the manifest (`open-task-tags`, `open-task-priorities`). The priorities table is asserted in weight order from a deliberately unordered answer; the replacement select offers *No priority* (`none`) and every other priority; a `priority_replacement_required` refusal of a priority that looked unused opens the select (the status dialog's behaviour). A tag nobody carries is deleted without a sentence about Tasks.
  - Also changed (shape only): `admin/test/modules/tasks/off-state.test.tsx` (the route list gains the two screens; a writer gets the not-found screen on both), `T/admin/index.test.ts` (the two routes).
- [X] T082 [US9] Complete the configuration services:
  - `T/backend/services/tag-service.ts`: update and delete;
  - `priority-service.ts`: create, update, reorder, and delete with replacement, sharing the reassignment helper with T045.

  Add the routes per `admin-api.md` §4. T080 green.
  - Done 2026-10-29. **The shared reassignment helper** is the new `services/task-reassignment.ts`: `holdTasksFor(em, 'status' | 'priority_code', code, tooMany)` locks every Task holding the value `FOR UPDATE … limit 5001` and answers 409 `TASK_STATUS_IN_USE_TOO_MANY {max, …}` above the bound; `recordReassignments` writes one audit row per Task through `recordAuditFromContext` on the Command's transaction. `workflow-config-service.ts`'s removal now calls both (behaviour unchanged; `workflow.test.ts` green). It is configuration, not a write on a Task: no `loadVisible`, no `assertMayChange` — drafts and private Tasks move too.
  - `TaskPriorityService`: `create` (`tasks.priority.create`; a taken code 422 `TASK_WORKFLOW_INVALID {rule: 'priority_code_taken'}`), `update` (names, colour, weight — "reorder" is the weight, as for statuses), `delete(code, replacement)` (`tasks.priority.delete`, the row locked; in use without `replacement`, or with the removed code, 422 `TASK_WORKFLOW_INVALID {rule: 'priority_replacement_required'}`; an unknown replacement 422 `TASK_PRIORITY_UNKNOWN`, the replacement row locked; `none` clears; one `update`, one `tasks.task.priority_change` row per Task with `after {priorityCode, reason: 'priority_removed'}`; the priority's own `before` carries `replacement` and `moved`). An unknown code on `PATCH`/`DELETE` is 404 `NOT_FOUND`. Every write answers the whole list (the workflow's shape).
  - `TaskTagService`: `update` (`tasks.tag.update`; a name taken by another tag in any case 409 `TASK_TAG_NAME_TAKEN`, the unique index's race mapped the same), `delete` (`tasks.tag.delete`, the row locked; `usageCount` from `task_tag_assignments` platform-wide in the tag's one audit row; the foreign key cascades). A missing or malformed id is 404 `NOT_FOUND`. `PATCH /tasks/tags/:id` answers the tag with its visible usage, `DELETE` 204.
  - **Deviation — no new error codes.** The priority list is "the same shape as statuses" (admin-api §4), so its two refusals are new `rule`s of `TASK_WORKFLOW_INVALID`, and its bound is `TASK_STATUS_IN_USE_TOO_MANY` (which `TASK_STATUS_REASSIGN_MAX`'s own doc already named for priorities) with `details.code: 'priority'` keying the sentence `errors.TASK_STATUS_IN_USE_TOO_MANY.priority`. Three sentences en/pl; admin-api §4 rows updated; the `reference-ledgers.ts` reasons and the two `ERROR_CODES` doc comments widened.
  - **Seam ledger (Phase 10 hand-over):** the `TASK_ACCESS_READERS` reasons for `priority-service.ts` and `tag-service.ts` now name their platform-wide reads; `task-reassignment.ts` joins with its reason. `RULE_SCOPED_READ_LEDGER`: `priority-service.ts` 1 → 2 (the move), `tag-service.ts` 2 → 3 (the delete count), `task-reassignment.ts` 1 (new), `workflow-config-service.ts` 3 → 2 (its locked selection moved to the helper).
  - Audit labels `auditLog.tasks.tag.{update,delete}`, `auditLog.tasks.priority.{create,update,delete}` (en/pl). OpenAPI baseline: only `/tasks/priorities` (`post`), `/tasks/priorities/{code}` and `/tasks/tags/{id}` added. The `tasks` changeset names the removal with replacement and the tag deletion's one audit row.
  - **Not done, judged out of scope:** a Task's own priority write (`changeTaskPriorityCommand`, create) checks the code before its Command and takes no share lock on the priority row, unlike T046's status move — a Task given a priority at the instant it is removed keeps the dangling code, shown as no priority and sorted last. Deferred: issue #507.
  - **Issue #507, fixed 2026-10-29 (in Phase 12).** `createTaskCommand` and `changeTaskPriorityCommand` hold the priority row `FOR SHARE` (`holdPriority` in `task-commands.ts`) and answer 422 `TASK_PRIORITY_UNKNOWN` when it is gone; the priority change holds it **before** locking the Task — the removal's own order (priority, then its Tasks) — so a removal naming it as the replacement cannot deadlock with it. `assertKnown` before the Command stays, as the cheap early refusal. Test: `integration/tasks/tags-priorities.test.ts` › *a priority removed while a Task is being given it*, two cases (PATCH and POST): a second connection locks the priority row `FOR UPDATE`, waits by observation (`pg_stat_activity`) until the write blocks on it or has finished, deletes the row and commits. Seen red first: both answered 201/200 and the Task kept the removed code; green after (15/15).
- [X] T083 [US9] Build `T/admin/pages/settings/{TaskTagsPage,TaskPrioritiesPage}.tsx` and their routes. Add the palette actions `open-task-workflow`, `open-task-tags` and `open-task-priorities` to `T/manifest.ts` with en/pl labels, then run `backend/test/contract/tasks/palette-actions.test.ts`, extended first. T081 green.
  - Done 2026-10-29. `open-task-workflow` already existed (T047 — Phase 4's report was right); `open-task-priorities` and `open-task-tags` added (`tasks:configure`, icon `Settings`, weights 334/335, single-word Polish keywords — `check-default-language-prose` refuses phrases). `palette-actions.test.ts` extended first and **seen red** with the manifest change stashed and the package rebuilt: 3 of 4 failed (not declared, the ledger expectation, the labels). Their landing reads `GET /tasks/priorities` and `/tasks/tags` are `tasks:read` (the pickers read them), so two `ACTION_PERMISSION_DISAGREEMENTS` entries joined `open-task-workflow`'s in `check-action-route-permissions.ts` (its line in `foreign-module-changes.md` §G extended); `integration/tasks/off-state.test.ts` lists both actions.
  - Screens: `pages/settings/TaskTagsPage.tsx` (table, `components/tags/{TaskTagDialog,TaskTagDeleteDialog}.tsx`; the list re-read after every write so the usage counts are the server's; the delete confirmation says the tag leaves every Task and, when there are any, how many Tasks *the operator can see* carry it) and `pages/settings/TaskPrioritiesPage.tsx` (table in weight order, `components/priorities/{TaskPriorityDialog,TaskPriorityDeleteDialog}.tsx`; the code on create only, `none` refused on screen; the delete dialog's select offers *No priority* and every other priority). Routes `/tasks/settings/{priorities,tags}` on `tasks:configure`; no sidebar rows (admin-surfaces §1 names only *Task settings*). **Reached** from ⌘K and from the workflow screen's header, which now carries a small `nav` of links — *Priorities*, *Tags*, *General settings*; each of the three has a back link to the workflow. `tasksApi.{createPriority,updatePriority,deletePriority,createTag,updateTag,deleteTag}`; `lib/settings-paths.ts` gains the two paths. Strings `tags.*`, `priorities.*`, `settings.{nav,priorities.link,tags.link}`, `actions.openTask{Priorities,Tags}.*` (en/pl). `composer:generate` regenerated `docs/docs/module-reference/tasks.md` (the two actions) — committed.

**Checkpoint**: an operator keeps the tag and priority lists; a removed tag leaves every Task with one audit row on the tag, a removed priority hands its Tasks to another or to none with a history row each, and only *Configure tasks* changes either list.

- **Phase 11 gate**, run 2026-10-29 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings only): **green**.
  - Backend, targeted: `test/integration/tasks` + `test/contract/tasks` + `integration/projects/{completion-gate,stage-tasks}` + `contract/admin_users/permission-inventory` + `unit/kernel/error-code-routing-equality` + `unit/_i18n` + `contract/kernel/openapi-baseline` — 39 files, 490 / 490.
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 771 / 7 772 — the one red the known whole-tree scan timeout (`check-module-boundary.test.ts › the tree itself`, 30 s), green alone with `--testTimeout=180000` (154/154).
  - Admin (Node 26, `--no-experimental-webstorage`): `test/modules/{tasks,projects,crm}` — 72 files, 896 / 896.
  - Packages: `mod-tasks` 17 files / 159, `contracts` 71 / 1 542 — green.
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage` (41/41), `check:error-translations`, `check:bundle-pairing`, `check:default-language-prose`, `check:command-coverage`, `check:action-route-permissions` (ledgered 6, stale 0), `check:admin-surface`, `check:admin-zones`, `check:test-ownership`, `check:module-boundary`, `check:port-shape`, `check:entry-presence`, `check:module-docs`, `check:platform-surface`, `check:container-imports`, `check:shared-table-wipes`, `check-release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - OpenAPI baseline regenerated (the three paths above). `composer:generate` regenerated `module-reference/tasks.md`; `manifests:generate` and `pnpm install --lockfile-only`: no change.
  - Nothing moved or deleted: the status removal's lock-and-record code moved *within* the module into `task-reassignment.ts`; no file under `backend/test/**` or `admin/test/**` names `#reassign` or the old selection.
  - Issue opened: #507 (a priority set on a Task while it is being removed survives as a dangling code — the Task's priority write takes no share lock on the priority row).

---

## Phase 12: User Story 10 — Stage Tasks stay consistent (Priority: P3) — issue #450

**Goal**: idempotent Stage Task creation, and a sweep that removes Tasks orphaned while Tasks was off.

**Independent Test**: `quickstart.md` §1, US10 row.

- [X] T084 [P] [US10] Extend `backend/test/integration/projects/stage-tasks.test.ts`. Force `taskWritePort.createMany` to fail after 2 of 5 Tasks: inject a failing Command on the third via the test seam the existing failure test uses (read it first). Then call `POST …/materialize-tasks` three times, including two concurrently. Assert exactly 5 Tasks, each with a distinct `source_key`.
  - The existing failure test spies `createMany` whole; a failure *part way* needs the Commands, so the case spies the shared `commandBus.run` (the port holds the container's instance) and throws on the n-th `tasks.task.create`. Timeline: the move fails on the 3rd (2 exist); the first retry fails on its 2nd create (3 exist, not 200, the Stage still says failed); then two retries at once — one 200, one 409 `PROJECT_STAGE_TASKS_NOT_RETRYABLE` (the claim). Asserts 5 rows whose `source_key`s are exactly the five definition ids, the five titles, and the failure flag cleared.
  - Seen red 2026-10-29 for the stated reason: `expected [ …(8) ] to have a length of 5 but got 8` — the port dropped `sourceKey`, so the first retry re-created from the start. Green after T086.
  - Added at the port (`integration/tasks/write-port.test.ts`, *a source key makes creation idempotent*): a key the context holds is skipped and its id answered in input order, the Task left as it was (title, one audit row); a key repeated in one call is created once; a key is per context; two `createMany` at once with the same five keys create five and answer the same ids; and the **unique-violation path made deterministic** — a second connection holds an uncommitted Task with the key, the call waits on the unique index (observed in `pg_stat_activity`), and after that commit answers the other Task's id. All three red first (`expected '63f1…' to be 'adba…'`, and the concurrent cases); the two race cases also red with only the `catch` disabled, so the concurrent case does exercise the race.
- [X] T085 [P] [US10] Write failing `backend/test/integration/tasks/maintenance.test.ts`:
  - with Tasks off, delete a Project with 3 Tasks and a Stage with 2 Tasks of another Project;
  - with Tasks on, run the maintenance pass: the 3 Tasks are deleted (audit `reason: context_gone`) and the 2 lose `context_group_id`;
  - with Projects **off**, a pass deletes nothing;
  - a contributor without `existingContexts` is never cleaned;
  - a pass with nothing to do enters no scope.
  - Seen red 2026-10-29 for the stated reason: 4 of 5 failed — no pass existed (the deleted Project's Tasks still there, `expected true to be false`; the idle-scope case `expected 0 to be greater than 0`). The fifth, *a contributor without `existingContexts` is never cleaned*, passed red: it pins what must not happen, and holds once the pass exists. Green after T087 (5/5).
  - Each pass is the composed `tasksRemindersJob`'s deps run through `runTasksRemindersJob` with a **fresh cadence** (`createTasksRemindersJob(composed.deps)`), so what is proved is the worker's third pass, not the service alone. Tasks are seeded directly (the pass reads the table). Asserted beyond the list: the delete rows are by the system (`actorAdminUserId` empty), `before` names the gone context; the ungroup rows are `tasks.task.update` with `{contextGroupId: null, reason: 'context_group_gone'}`; a Task on a kept Stage and one with no Stage are untouched and unaudited; a second pass changes nothing; Projects off on **both** axes (`deactivated`, `platform-unavailable`) deletes nothing and the next pass with Projects back does; with **Tasks** off a pass does nothing and the next one with Tasks on does; the idle case counts `tenant.escape_hatch` rows for `TASKS_MAINTENANCE_SCOPE_REASON` (none for three passes with Projects off; more once there is work).
- [X] T086 [US10] Implement the source key.
  - `T/backend/services/task-write-port.ts`: skip a `sourceKey` that already exists, return its existing id in order, and treat a unique violation as "already created".
  - `P/backend/services/stage-task-service.ts`: pass `sourceKey = definition.id`. Simplify `retry()` only where the docblock explains why the guard is no longer needed. Otherwise keep it.

  T084 green.
  - Done 2026-10-29. `TaskWritePortService.createMany` reads the keys the context already holds (one `in (…)` lookup, `#heldKeys`), answers their ids in place, remembers keys it creates within the call, and passes `sourceKey` into `createTaskCommand` (`NewTaskFields.sourceKey`, written to `tasks.source_key`). A `UniqueConstraintViolationException` on a keyed entry re-reads that key and answers the winner's id (the loser's Command rolled back whole — no audit row, no event); any other error, or no winner found, is rethrown. Seam: `task-write-port.ts` reason widened in `TASK_ACCESS_READERS`, `RULE_SCOPED_READ_LEDGER` 1 → 2.
  - Projects: `#newTasks` selects the definition's `id` and passes it as `sourceKey`. **`retry()` kept as it is**: its claim (the stamp under the Project's lock) is what answers a concurrent second retry with 409 instead of a redundant pass; the docblock now says the source key makes a pass that does run harmless. `created` in the retry's answer counts the Stage's Tasks after it ran, earlier attempts' included (`createMany` answers their ids) — documented on the method; no contract change.
  - T084 green (stage-tasks 7/7, write-port 10/10).
- [X] T087 [US10] Implement the clean-up.
  - `P/backend/services/task-context-descriptor.ts`: `existingContexts`.
  - `P/backend/services/project-access.ts`: a system-mode existence query. Update the ledger.
  - `T/backend/services/maintenance-service.ts`: the batched pass of R-19.
  - Add it as the third pass of `tasks-reminders-worker.ts`.
  - Add the service to the allow-list of T017's seam test.

  T085 green.
  - Done 2026-10-29.
    - **Projects:** `ProjectAccess.existingWithStages(ids)` — one statement over `projects` left-joined to `project_stages`, keyed by the ids asked, answered **only to the system actor** (anybody else gets an `Error`: it would be an existence oracle past both rules); a non-uuid id is answered as existing (absence deletes Tasks). The `project` descriptor's `existingContexts` delegates to it. Seam: `RULE_SCOPED_READ_LEDGER['services/project-access.ts']` 14 → 16 (one statement, both tables counted); the descriptor's `PROJECT_ACCESS_READERS` reason names it. Comments in `project-service.ts` / `stage-service.ts` / `stage-task-service.ts` that said the orphaned Tasks stay now name the pass (lines added to `foreign-module-changes.md` §D).
    - **Tasks:** `services/maintenance-service.ts` (`TaskMaintenanceService`): `hasWork()` — no present owner with `existingContexts` → `false` without a statement; else `anyRowExists` over `tasks` of those context types. `pass()` — per such owner, distinct `context_id`s in id order, `MAINTENANCE_BATCH` = 500 at a time (keyset); the owner's answer splits them: each Task of a gone context goes through `deleteTaskCommand(id, auditLog, {reason: 'context_gone', onlyIn: context})` (the Task re-read `FOR UPDATE`, left if it moved; `after: {reason}`; sub-tasks detached as on any delete; `tasks.task.deleted.v1` emitted), each Task of an existing context whose group the owner did not name goes through the new `ungroupTaskCommand` (`tasks.task.update`, re-checked under the lock, `before {contextGroupId}`, `after {contextGroupId: null, reason: 'context_group_gone'}`). **Deviation:** one Command per Task rather than `recordReassignments` inside one Command — the deletes need `deleteTaskCommand`'s sub-task handling and event anyway, and per-Task Commands keep each re-check under its own lock; the volume is the orphans only.
    - **Worker:** `TasksRemindersJobDeps.maintenance` (third `TaskSweepPass`), `TASKS_MAINTENANCE_EVERY_MS` = 15 min with its own in-memory stamp (`cadence.maintenanceRanAt`), `TASKS_MAINTENANCE_SCOPE_REASON` = `tasks: clean up Tasks whose context is gone`; the processor is unchanged (`runTasksRemindersJob`, same file, `check-entry-scope` sees one hop). Unit test extended first-hand: the maintenance cadence 0/15/30 in the system scope, nothing while Tasks is off, no run when its probe says no; every existing case gives an idle maintenance pass.
    - **Ledgers:** `TASK_ACCESS_READERS` gains `maintenance-service.ts` with its reason; `RULE_SCOPED_READ_LEDGER` `maintenance-service.ts` 4 (probe, ids, gone Tasks, grouped Tasks), `task-commands.ts` 8 → 9 (the ungroup's locked read). `backend/test/unit/tenancy/scheduled-work-probes.test.ts` lists the third Tasks probe. No new composer or registry (no `contribution-absent-owner.test.ts` change), no route, no palette action, no error code.
    - Changeset `tasks-task-management.md` names the pass; `projects-reference-kinds-stage-task-keys.md` already described both halves.
  - T085 green (5/5).

**Checkpoint**: retrying a Stage's Task creation, however often and however concurrently, leaves each Stage Task exactly once; Tasks of a Project or Stage deleted while Tasks was off are deleted or ungrouped within fifteen minutes of Tasks being on, and nothing is taken for gone while its owner is off.

- **Phase 12 gate**, run 2026-10-29 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors, pre-existing warnings only): **green**.
  - Backend, targeted: `test/integration/{tasks,projects}` + `test/contract/{tasks,projects}` + `test/unit/tenancy` + `integration/tenancy/idle-worker-ticks-audit` + `unit/kernel/contribution-absent-owner` — 64 files, 810 / 810; the four files this phase touched re-run on the final tree (`write-port`, `stage-tasks`, `maintenance`, `tags-priorities`) 37 / 37.
  - `pnpm --filter backend run test:unit:fast`: first run 7 772 / 7 773 — **one real red**, `moved-module-tree.test.ts › check-port-catches.ts reads both roots and passes`: the write port's new `catch` around `commandBus.run` swallowed `ModuleDisabledError`; fixed with `rethrowIfModuleDisabled(error)` first in the catch. Re-run: 361 files, 7 773 / 7 773.
  - Packages: `contracts` 71 / 1 542, `mod-tasks` 17 / 160, `mod-projects` 19 / 251 (one red on the first run: the Projects seam ledger counts `existingWithStages`' one statement once per table, 16 not 15 — corrected, notes above updated).
  - Checks green: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage`, `check:command-coverage`, `check:port-catches` (0 violations), `check:entry-presence`, `check:transaction-context`, `check:lock-claims`, `check:shared-table-wipes`, `check:module-boundary`, `check:test-ownership`, `check:platform-surface`, `check:default-language-prose`, `check:subscribe-seam`, `check:port-shape`, `check:container-imports`, `check:module-docs`, `check:error-translations`, `check-entry-scope` (through `moved-module-tree.test.ts`), `check:release-intent --since origin/master` (0 violations). **`check:docs-translations` red**, unchanged (`stale-translation:generated:module-reference/{crm,tasks}`), left for T089.
  - No route, no admin change: OpenAPI baseline and admin tests not affected. `composer:generate` and `manifests:generate`: no change.
  - Nothing moved or deleted.
  - Issue fixed in this phase: #507 (see T082's note).

---

## Phase 13: Polish & Cross-Cutting Concerns

- [X] T088 [P] Add the demo data.
  - Create `T/backend/demo/{rows,seed,reset}.ts` with 10 Tasks per R-23. Set `manifest.demo` per the demo convention: read `P/backend/demo/` and the composition step registration in `packages/demo-composition/src/composition.ts` first.
  - Update the `tasks` counts in `backend/test/integration/demo/{demo-shop,demo-reset-after-use}.test.ts`.
  - Done 2026-10-29. **Premise re-derived:** there is no `P/backend/demo/` — the demo Projects and their Tasks are composition steps (`packages/demo-composition/src/projects.ts`), because they name other modules' rows (§5.1 of feature 113's demo contract), and `projects` says `demo: false`. A standalone Task names `admin_users`' rows (creator, assignees, mentions) and, for the link, `orders`', so it is the same kind of thing: **a new step `demoTasksStep` in `packages/demo-composition/src/tasks.ts`** (modules `tasks`, `admin_users`, `orders`), registered after `demoProjectTasksStep`; `tasks` keeps `demo: false`, its comment now says why. Line added to `foreign-module-changes.md`.
  - The ten (fixed ids `0c2a0165-…`): *Review the Q4 price list* (high, tag *Pricing*, two assignees, start and due, a description mentioning Anna) with three sub-tasks; *Call back about the delayed delivery* (urgent, tag *Customer care*, links the demo organisation's newest Order **where one exists** — no module seeds an Order, the Projects' precedent; so the demo shop has no link row); normal, low and no-priority Tasks in each status category; one private Task and one draft (unpublished, `published_at` null) of the demo administrator's. Two comments on the parent refer to Tasks and to Tomasz. An operator-deleted priority is left off, a missing person reads as words. Rows, not Commands (no history, no events), as every demo step. Withdrawn by id with the two tags.
  - **R-19 for the Stage Tasks:** `demoProjectTasksStep` writes each Task's `source_key` = the Stage's own `project_stage_tasks.id` at the definition's position, as `stage-task-service` does.
  - Tests: `packages/demo-composition/src/tasks.test.ts` (8, red first: the module did not exist), and `demo-shop.test.ts` — `tasks` 12 → 22, `task_assignees` 10 → 19, new `task_tags` 2, `task_tag_assignments` 3, `task_comments` 2, `task_references` 4; plus *keys every Stage Task by its definition* and *seeds ten Tasks of no Project*. `demo-reset-after-use.test.ts` holds no Task count (it adds rows of its own and checks the withdrawal), so nothing there moved; it stays green. `test/integration/demo` 6 files, 115 / 115. `check:demo-data-budget` 0 findings. Changeset `demo-composition-standalone-tasks.md` (minor).
- [X] T089 [P] Write the documentation.
  - `packages/modules/tasks/docs/tasks.md` (users and developers): every story, the new permissions and settings, the descriptor's `existingContexts` contract, the events' new shape, and the upgrade note (statuses are now configurable; existing assignees are kept).
  - Its Polish copy.
  - CRM and Projects docs: the two new reference kinds.

  Run `check:module-docs` and `check:docs-translations`.
  - Done 2026-10-29. **`packages/modules/tasks/docs/tasks.md` rewritten** for 165 (users and developers): statuses and categories, due time and the time zone, drafts and private Tasks (`tasks:see_private` read and delete only, never drafts), list/board/filters/saved views/view mode, *My Tasks* without drafts, the create form and the detail layout, the *Tasks* panels on Opportunities, Orders and Quote Requests, the palette, every story's rules (descriptions and references, assignees, who is told, transitions, priorities and tags, custom fields, attachments, comments, sub-tasks and related, links, reminders with the 24 h grace, the digest), configuration screens, the settings table, off-state (no catch-up; the 15-minute clean-up), the four permissions, an **upgrade note** (configurable statuses with the default workflow, assignees kept, the API's breaking changes), and for developers: the full route table, the descriptor contract with **`existingContexts`** (system actor only; regardless of visibility; an absent id deletes Tasks, so an id the owner cannot vouch for is answered as existing; a group missing ungroups; a contributor without it is never cleaned), the **maintenance pass** (third pass, ≤ 15 min, 500 contexts a batch, `deleteTaskCommand(id, auditLog, {reason, onlyIn})` / `context_gone`, ungroup / `context_group_gone`, one Command per Task, owners that are off not asked), **`sourceKey`** idempotency in `createMany` (existing ids in input order, repeats and races), notifications with **`recordWithin`** (bell exactly once, e-mail at most once, `expired`/`skipped`), the worker, and the **events** (`assignees_changed.v1` replacing `assigned.v1`, codes and `toCategory`, **drafts emit nothing until publication**). Facts checked against the code while writing (default card fields, at most six; the hierarchy and tag codes; notification kinds; e-mail codes) — the first draft's "assignees must see the Project" was removed: that is issue #506, not behaviour.
  - **CRM** (`docs/crm.md`): references to Opportunities and Projects (tokens, labels, URLs, unavailable cases, the five `@@` groups and their gates — Opportunities answered always, the admin `@@` gate on the four other codes, issue #498 — and the lookup's answer), Projects optional for references, the *Tasks* panel. **Projects** (`docs/projects.md`): the `@@` row's two new groups, Stage Tasks exactly once on retry, the clean-up of a Project or Stage deleted while Tasks was off (within 15 minutes, never while Projects is off), `sourceKey`, `existingContexts` / `existingWithStages`, the references' ports. Lines added to `foreign-module-changes.md` (§C, §D, §G).
  - **Polish** (manual, `documentation-i18n.md`): the three pages' Polish copies updated or rewritten (UI labels taken from `i18n/pl.json`), and the two stale **module references** (`generated:module-reference/{crm,tasks}`, red since T008) re-translated from the regenerated English — CRM's new `projects` edge row; Tasks' new dependencies, permissions, palette actions and settings. Cache entries written with `hashSourceBody` of the English source and materialised (a scratch script around `backend/scripts/lib/docs-translation-cache.ts`).
  - `check:docs-translations`: **green** (172 sources, 0 findings — was 2). `check:module-docs` 0 findings, `check:doc-snippets` green, `check:language` green, `pnpm --filter docs run build` green in both locales (`onBrokenLinks: 'throw'`).
- [X] T090 [P] Extend the off-state coverage in `backend/test/integration/tasks/off-state.test.ts`:
  - every new route answers 503;
  - the worker probe stays idle;
  - the asset protection still holds;
  - the `task` custom-field type is hidden;
  - the Opportunity, Order and Quote Request detail APIs are unaffected.

  Run `check:off-state-coverage`.
  - Done 2026-10-29. **Routes:** the hand list (13 probes, the 163 core and US2's) is replaced by the module's every path and method **read off `openapi-baseline.json`** — 55, 54 probed (`DELETE /me/digest` answers an empty 204 once restored and the harness parses every restored answer as JSON; its `GET`/`PUT` siblings share the gate) — with a per-story sanity list so a baseline that lost the paths fails rather than probing nothing. `settingWrite` now probes `tasks.time_zone` (the module has ordinary settings since US3/US7; the docblock that said it had none is corrected). **New, each on both axes** (`deactivated`, `platform-unavailable`): the composed `tasks-reminders` tick asks none of its three probes while off and all three once back (passes wrapped to count `hasWork`); a library file a Task uses answers 409 `ASSET_REFERENCED` to deletion while off and is let go once detached; the `task` custom-field entity type is hidden while off and back after; the Opportunity, Order and Quote Request admin detail APIs, each linked from a Task, answer **byte-identical JSON** before, while off and after.
  - Coverage tests of existing behaviour: they passed on first run; the positive halves (three probes asked once back, `task` listed, 409 while on) show each case measures something. 12 / 12. `check:off-state-coverage`: switchable 41, proven 41, findings 0.
- [X] T091 Run the performance tests: the T024 suite plus the board under 2 s with 5 000 Tasks (SC-002). Record the figures under this task.
  - Done 2026-10-29. Added *SC-002 (165 T091): the board over every Task, and filtered to one tag* to `backend/test/perf/tasks/context-visibility.perf.test.ts` (the T024 data: 5 000 Projects × 4 Tasks plus 5 000 context-less Tasks × 2 assignees × 3 tags; members-only viewer of all 25 000). Measured on the local test Postgres, `PERF_RUN=true`, on the final tree: `GET /tasks` p95 138 ms (budget 500); first page p95 per sort — created asc 108 / desc 142, number 106 / 112, title 95 / 124, due 104 / 104, priority 98 / 100, status 137 / 120, updated 101 / 120 ms; `GET /tasks/mine` p95 267 ms; **`GET /tasks/board` p95 305 ms over every Task, 273 ms filtered to one tag**. All under SC-002's 2 s; 3 / 3. (Faster than T024's figures: the machine was less loaded.)
- [X] T092 Have `endora-commerce-designer` review `TasksPage` (board and list), `TaskDetail` and the three settings pages against `.claude/skills/ux-laws/SKILL.md`. Fix every finding marked must, and record the others as follow-up issues.
  - Done 2026-10-29, **with a deviation: the review was made by the implementing agent applying the skill**, not by the `endora-commerce-designer` subagent — the Phase 13 run had no means to start another agent. The owner may still have the designer re-run it; nothing here depends on that.
  - Reviewed (code and the admin tests' rendered states): `TasksPage` (list, board via `TaskBoard`/`TaskCard`, filters, saved views, sort, paging), `MyTasksPage`, `TaskDetail` and its sections, `TaskCreate`, `TaskWorkflowPage` (with `BoardCardFieldsEditor`), `TaskTagsPage`, `TaskPrioritiesPage`, `TaskGeneralSettingsPage` and their dialogs. Held: one filled primary action per view; icon-only controls labelled (`aria-label` with the row's name); 44 px targets on mobile (`min-h-11 min-w-11 sm:…`); loading, empty, error-with-retry and read-only states on every screen; status, priority and tag shown with text, colour never alone; form errors linked (`aria-invalid` + `aria-describedby`); the board's keyboard move and its announcements; live regions mounted before their text — **but one**.
  - **Must, fixed:** the saved-view notice on `TasksPage` (*values … were left out*) was a `role="status"` paragraph rendered only once it had text — not reliably announced (WCAG 4.1.3, `ux-laws` §4). Now mounted empty (`sr-only`) and filled in place. `admin/test/modules/tasks/TasksPage.test.tsx` › *drops a saved value…* extended first: **seen red** (`expected undefined to be 'status'` — no region before the notice), green after (13/13).
  - **Should, filed as #508:** Polish terminology (*Tagi*/*Etykiety*, *szkice*/*Wersja robocza*), bare-sentence empty states on the Tags and Priorities screens, *Delete task* beside *Edit* on a Task's screen.
  - **Follow-up fixes, 2026-10-29** (a second UX/accessibility pass; each test seen red first, then green — tasks admin + kit suites 54 files / 552 tests): (1) focus follows the inline editors (WCAG 2.4.3) — `lib/use-editor-focus.ts` focuses an editor's first control on open and returns focus to its opener on close, on `TaskDetail` (*Edit*), the sub-task, related-Task, linked-record, context and reminder sections; a removal focuses the section heading or the remaining opener; `BoardCardFieldsEditor` keeps focus on the moved row (the other direction at an end), the row that took a removed one's place, or the next offered field; (2) WCAG 3.2.2 — the Task's status is the kit's `MoveToMenu`, as on the board, keeping the refusal's `allowedTargets`, with focus back on its trigger after a move; the digest hour is staged and saved with *Save the hour*; (3) `TaskBoard` is `aria-busy` while it reads and shows `board.loading` instead of an empty board until the workflow arrives; (4) *My Tasks* is `aria-busy` with a mounted sr-only status on reload, and its empty state offers *New task* to a writer; (5) list rows and board cards carry the *Draft* / *Private* badges and a plain-text *Sub-task of N* line (`components/TaskMarkers.tsx`); (6) a refused change of the moves is shown inside the transitions card; (7) the reminder's remove control names its time, an unavailable link's reason is visible text and the remove control's description, the description hint is the field's `aria-describedby`, and the priority/tag pickers are named by `aria-labelledby` — through a new additive kit prop `ariaLabelledBy` on `MultiSelect`/`TagMultiSelect` (ledger row in `contracts/foreign-module-changes.md` §B, changeset bullet); (8) the Tasks panel's error offers *Retry*. New keys, EN and PL: `board.loading`, `list.subtaskOf`, `list.subtaskOfHidden`, `digest.saveHour`; `reminders.remove` takes `{when}`. The same focus fix for CRM's card-field editor is #512, with the rest of the findings.
- [X] T093 Have an independent reviewer go over the visibility path:
  - every file reading a Task-owned table;
  - the seam test's allow-list;
  - the `tasks:see_private` write refusals;
  - the sweeps' recipient checks.

  Record the result in the PR description.
  - **Not done as specified — open for the owner.** It asks for an *independent* reviewer, and the implementing agent is not one; there is no PR yet to record it in. What the implementing agent checked, 2026-10-29, as input for that reviewer: (1) no file outside `packages/modules/tasks/` reads a Task-owned table except the demo composition (`packages/demo-composition/src/{projects,tasks,demo-usage}.ts`, seeding and withdrawing by id); (2) inside the module every reader is in `TASK_ACCESS_READERS` with its reason (19 files) and the seam test (`T/backend/task-visibility-seam.test.ts`, 11/11) holds the list and the per-file statement counts; (3) every write service calls `assertMayChange` after `loadVisible`, and `draft-private.test.ts` loops over the served write routes for the `TASK_PRIVATE_READ_ONLY` refusal; (4) every notification path — assignment, mention, comment, reminder pass, digest pass — asks `createTaskAudience` (`tasks:read`, the draft/private rule, the context's `canSeeAs`, an absent owner vouching for nobody) per recipient before telling; the maintenance pass tells nobody. No finding.
  - **Independent review done, 2026-10-29** (a read-only reviewer). Findings:
    - **F3 — fixed** (`519e440fd`, `f14b144a5`). `GET /tasks/:id/history` passed every non-context key through. Now a Task-id key (`relatedTaskId`, `parentTaskId` — the only ones the audit writers record) naming a Task the reader may not see is served as `null`, the same as a Task that does not exist, asked in one `TaskAccess.visibleIds` read per page; a deleted parent therefore reads `null` too, while the audit log keeps its id. A `tasks.reminder.*` entry is shown only to whoever set the reminder and to those it names, as `GET /tasks/:id/reminders` shows it (admin-api §1); for anyone else the entry is **left out**, not redacted, since a blank entry would still say a reminder exists — and a page counts only the entries shown (the history now reads its whole reach, 500 entries, before paging). Reminder add/remove entries now record `createdById`, as `removed_with_due` already did. Red first: two new cases in `draft-private.test.ts` (Ben saw the private neighbour's id; Ben saw Ann's own reminder, set and removed) → green; `hierarchy.test.ts`'s deleted-parent case now expects `null` in the history and the id in the audit log. No new table reader: the seam ledger is unchanged.
    - **F1 — attachments readable through the asset library** — filed as #513 for an owner decision (shared with Projects).
    - **F2 — a hidden parent's id on a visible sub-task** — left as R-15 decided ("a hidden parent shows as unavailable").
    - **F4 — configuration refusals reveal that hidden Tasks exist** — accepted by R-1.
    - Audit-log snapshots carrying private Task titles (served under `audit_log:read`) are the platform-wide audit trade-off, not a Tasks defect.
- [X] T094 Run the full verification set of `quickstart.md` §3.
  - Regenerate `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only` and the OpenAPI baseline.
  - Grep `backend/test/**` and `admin/test/**` for `TagPicker`, `MoveToMenu` (the CRM path), `TasksList`, `MyTasks.tsx`, `assignedAdminUserId` (task) and `TASK_STATUSES`.
  - Run `check:naming`, `check:language`, `check:command-coverage -- --strict --module tasks` and `check:port-dependencies`.
  - Done 2026-10-29 on the final tree (results also in the Phase 13 gate below). Regenerated: `composer:generate` changed only `docs/docs/modules/module-map.generated.md` (the Tasks page's new description — committed with its Polish copy), `manifests:generate` and `pnpm install --lockfile-only` nothing, the OpenAPI baseline (`UPDATE_OPENAPI_BASELINE=1`) nothing. Greps over `backend/test/**` and `admin/test/**`: no `crm/src/admin/components/{TagPicker,MoveToMenu}`, `TasksList`, `MyTasks.tsx`, `TASK_STATUSES`, `TASK_CLOSED_STATUSES` or `TASK_DRAFT_ONLY_CREATOR`; the one `components/TagPicker` hit is the blog module's own file, and every `assignedAdminUserId` hit is CRM's Opportunity field. `check:command-coverage -- --strict --module tasks` 0 blocking; `check:naming`, `check:language`, `check:port-dependencies` green. Derived ledgers: nothing moved or deleted in this phase; `module-removal.test.ts` green with the new demo file.
- [X] T095 Do the manual browser walk of `quickstart.md` §2 on the demo shop. Record any deviation as a defect under the task that owns it.
  - Done 2026-10-29 by the orchestrator, on a separate database `b2b_walk165` (never the development database), with Claude in Chrome. **Steps 1–10 passed.**
  - **Not walkable, and what was verified instead:** the Order and Quote Request panels (the demo has no Orders or Quote Requests — the admin tests and `off-state.test.ts` cover them), and real drag-and-drop on the board (synthetic pointer events do not drive `@dnd-kit`); instead the *Move to…* menu and the server's 409 on a refused move were verified.
  - **Defects found, fixed** (each test seen red first, then green):
    1. The demo `sales_representative` role had no `tasks:*`, so a rep's *My Tasks* was impossible in the demo and the demo's Tasks were assigned to reps who could not open them — `tasks:read` and `tasks:write` added (feature-143 precedent), `demo.test.ts` case, changeset `admin-roles-demo-sales-rep-tasks.md` (`8f61649a4`).
    2. `GET /tasks/lookups/assignees` offered admins without `tasks:read`, whom the save refused with 422 — now asks what `mentionable` asks: `tasks:read` with no Task, the Task's audience for an existing one (a draft as if published); `integration/tasks/references.test.ts` case (`adc84d0dd`).
    3. The workflow screen's *From* / *To* options and *Selected transition* label showed status codes — the kit's `StatusTransitionGraph` now uses `statusLabel` there as on its nodes, values unchanged (`b7a62d502`).
    4. The `@@` popup squeezed the Task number to *TSK-…* (or out of sight) for a long title — the kit's `ReferenceField` row keeps the label's width and truncates the description (`afc611de1`).
    5. Four date formats on the Tasks screens (`10/30/2026`, `30.10.2026, 10:00:00`, `Oct 30, 2026, 9:00 AM`) and *Due* beside *Due date* in a history entry — one format from `lib/labels.ts` keyed to the admin language (medium date; medium date + short time, no seconds) on the list, board, detail, sub-tasks, reminders, attachments and the Tasks panel; the history hides a due date that is the day of a due moment in the same entry (`fc5a26b9f`); the history and comment times use it too, through a new optional kit prop `formatTime` on `RecordHistory` / `CommentThread` (`d8febd391`).
    6. *193 byte* — under a kilobyte the unit is spelled out with its plural (*193 bytes*, *193 bajty*); the kit has no file-size formatter (`714276af9`).
    7. The history was not read again after a file was added or removed — `TaskAttachments` tells the detail through `onChange` (`8dc8d6c10`).
    8. The number column wrapped to *TSK-* / *000023* in the list and *My Tasks* — `whitespace-nowrap` (`973a2f123`).
    9. *Private* was offered on a Task with other assignees, where turning it on can only fail — disabled, with the reason as its description; the hint now says what turning it on does, and a private Task's hint what it is (EN, PL) (`b943a99b6`).
    10. *Type @ to mention someone* was shown to a reader with no comment form — a read-only hint without it (`cdc32d957`).
  - **Not fixed — owner-level blocker:** 11. the digest e-mail's *Open My tasks in the admin panel* has no link, nor has the reminder. No template builds an admin link: `ADMIN_BASE_URL` is an environment input owned by `mfa`, whose ledger entry (`backend/scripts/ledgers/module-environment-inputs/mfa.ts`) says a second reader moves it to the platform rather than declaring it again — the reason CRM's reminder has no link either (143 OP-2, accepted by the owner 2026-10-08, tracked as **#185**). Tasks' two e-mails were added to #185.
  - **Filed, not this feature's:** #518 (the bell needs `admin:read`), #519 (native `window.confirm` on the platform modules screen), #520 (an empty *Unsubscribe* href in the e-mail footer).
  - **Gate after the fixes**, 2026-10-29: `build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors; warnings only, none in a touched file) green. Backend: `integration/tasks` + `contract/tasks` + `contract/admin_users/permission-inventory` + `contract/inventory/permission-authority` 26 files / 286; `integration/demo` 6 / 115; the `tasks` and `admin_roles` package suites 17 / 160 and 7 / 72. `test:unit:fast` 361 files: 7 762 passed, 7 failed in 4 whole-tree files under load (`module-package-manifest`, `migration-order-boot-warning`, `check-block-names-absent`, `check-shared-table-wipes`) — green alone, 4 / 130. Admin (`tasks`, `kit`, `orders`, `returns`, `projects`, `crm`, `unit`): 143 files, 1 502 passed, 3 load timeouts (`kit-product-browser`, two `OrderCreatePage`) green alone, 3 / 44. `check:naming`, `check:language`, `check:off-state-coverage` (41 / 41), `check:port-dependencies`, `check:release-intent --since origin/master` green.
- [X] T096 Apply the planning amendments to `spec.md`: SC-004, US7 scenarios 2 and 6, the time zone, FR-011 and FR-005, per `plan.md` *Amendments from planning*, each marked as a planning amendment. Update issue #480's checklist.
  - Done 2026-10-29 (the spec and research edits landed in commit `075bb49cc` with the docs). **`spec.md`:** each amendment marked *(Planning amendment)* where it applies — SC-004 (the notification exactly once, the e-mail at most once, after downtime under 24 h), US7 scenario 2 and scenario 6 (the 24 h grace reconciles them), US7 scenario 5 and the *Assumptions* (the Tasks time zone setting, default *Europe/Warsaw*, replaces "the platform's time zone"), FR-011 (a tag deletion is one audit entry on the tag; a status or priority removal is one per Task), FR-005 (the two kinds in CRM's and Projects' texts too). The user-visible implementation rulings marked *(Implementation ruling)* — US3 scenario 6 (*My Tasks* has no drafts; the drafts filter), US8 scenario 2 (somebody else's draft is not found, publishing included; a published Task's publish refused; other modules learn of a draft at publication). A closing *Amendments* section lists both kinds; the status line says implemented.
  - **`research.md`:** R-23 settled (a composition step; no Order link in the demo; keyed Stage Tasks) and a new *Implementation rulings* table — 404 on publishing somebody else's draft and `TASK_ALREADY_PUBLISHED` replacing `TASK_DRAFT_ONLY_CREATOR`; no events for drafts; *My Tasks* without drafts; `DELETE` → 200 `{subtasksDetached}`; the retry's `created`; #507's priority check inside the Command; one maintenance Command per Task; priorities reusing the status codes with `rule`/`details.code`; card fields and time zone through the settings module's audited write; `recordWithin`; and the `assigned_at` stamp. `admin-api.md` and `data-model.md` already carried theirs (T062, T078, T082).
  - **The Phase 4 `assigned_at` shortcut, revisited and kept:** every reader orders by `assigned_at`, then `admin_user_id` (the Command, `task-service.ts`, `comment-service.ts`), so the order is deterministic without the stamp — but it would then be the ids' order, not the order the user chose; a position column is a schema change for a display order; the stamps are ≤ 20 ms apart and nothing reads `assigned_at` as a time. Recorded in research.md.
  - **Checklist** (`checklists/requirements.md`) still holds: the spec's amendments are written in user terms; codes, Commands and ports stay in research.md. Issue #480's body gained the amendments and rulings as a ticked checklist and a progress list (updated after the T094 run).

- **Post-walk rulings**, 2026-10-29 (owner rulings on issues opened during the phase; each test seen red first, then green):
  - **#506, option A — an assignee must see the Task's record.** `POST` / `PATCH /tasks` refuse with 422 `TASK_ASSIGNEE_INVALID`, `details {code: 'context_hidden', name, adminUserId}`, naming the first assignee the context's `canSeeAs` refuses (`task-checks.ts` `assertAssigneesSeeContext`; the sentence `errors.TASK_ASSIGNEE_INVALID.context_hidden`, EN and PL — an existing code, so no ledger row). Asked of those named; on a move to another record, also of those the Task keeps; an assignee kept within one record is not asked again. `GET /tasks/lookups/assignees` already narrowed by the Task's audience for `taskId` (`adc84d0dd`, which asks `canSeeAs`) — but the picker never sent `taskId`: `AssigneePicker` now sends it on a Task's screen, and `contextType`/`contextId` on the create form's `?context=` (new optional query fields, both or neither; a record the caller may not see is 422 `TASK_CONTEXT_INVALID`). **`taskWritePort.createMany` stays lenient**, recorded in `task-checks.ts`, `admin-api.md` and the docs: its caller owns the context and names the assignees — a Stage Task goes to the Member holding its Role, who need not hold `projects:read` — and one refusal would fail the whole batch, leaving Stage entry with `tasks_materialize_failed`. Tests: `integration/projects/task-context.test.ts` — two new cases (create/`PATCH` set/add/move refused naming the person; the lookup by `taskId` and by context, 422 for a hidden record, 400 for half a context); its setup and the T144 F1 case assigned an outsider through `POST /tasks` (201 before) and now write that assignee row directly, as the assignee who lost sight of the Project. `integration/projects/visibility.test.ts` — the bell case expected `POST` with an outsider to be 201 and silent; it now expects 422 and no bell, and a hand-on to an outsider 422. Admin: `TaskCreate.draft-private.test.tsx` — three cases on which lookup the picker asks. Docs: the *Assignees* paragraph and the `taskWritePort` row (EN, PL); `spec.md` *Edge Cases* marked as an implementation ruling (163 accepted the assignment); `data-model.md` §5; changesets (`mod-tasks`, `contracts`).
  - **#508, item 1 — Polish terms.** *Etykieta* for a tag (as CRM, whose bundle shares the tag components) and *Szkic* for a draft (as the catalog), with their inflection (*każda wybrana*, *jedna z tych etykiet*, *dopóki go nie opublikujesz*), in `packages/modules/tasks/i18n/pl.json` — eleven strings: the `tasks:configure` label, `errors.TASK_TAG_*`, `errors.TASK_ALREADY_PUBLISHED`, `list.col.tags`, `filter.tags`, `board.field.tags`, `create.saveDraft`, `create.draftHint`, `detail.draftBadge`, `detail.draftHint` — and the Polish module page (its cache entry with it; the tags were already *etykiety* there). No other module's bundle touched; the palette keeps `tagi` as a search keyword. Red first: `src/admin/i18n-terms.test.ts` (new; no *tag* or *wersja robocza* in the Polish bundle) listed the eleven, then green. Items 2 (the Tags/Priorities empty states) and 3 (*Delete task* beside *Edit*) of #508 were not part of the ruling and are not done.
  - **Gate after the rulings**, 2026-10-29: `build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint` (0 errors) green. Backend `integration/tasks` + `contract/tasks` + `integration/projects` 50 files: one real red (`visibility.test.ts`'s bell case, rewritten above) and five `setupBackendServer` load timeouts, all six green alone (117 / 117). `mod-tasks` package 18 files, `contracts` 71 / 1 542. Admin `test/modules/tasks` + `test/modules/projects` 41 files / 365. `test:unit:fast` 361 files: 7 768 passed, 6 whole-tree scans timed out under load (`product-audience-provenance`, `container-import-check`, `module-package-manifest`, `check-fixture-substitution`, `check-harness-teardown`, `check-module-boundary`) — green alone, 6 / 327. `check:naming`, `check:language`, `check:docs-translations` (172 sources, 0 findings) green; the OpenAPI baseline records no query parameters, so it does not move.

- **Phase 13 gate**, run 2026-10-29 on the final tree:
  - `pnpm run build:packages`, `pnpm -r run typecheck` (0 errors), `pnpm -r run lint` (0 errors; warnings only, all in modules this phase did not touch): **green**.
  - **Full backend suite** (`TEST_DATABASE_URL=…:5441/b2b_test pnpm --filter backend run test`, 6 workers, 4 016 s): 1 763 files, 16 202 passed, 1 expected fail, 64 skipped, **2 failed**: (1) `unit/scripts/check-module-boundary.test.ts › the tree itself` — the known whole-tree scan timeout (30 s), green alone with `--testTimeout=180000` (154/154); (2) `integration/catalog/viewer-priced-listing.test.ts › leaves the anonymous answer exactly as it was` — `+ "summary": "One product, three viewers, three prices."` in the anonymous listing entry. **Not this feature's**: the branch touches no catalog code, and the same case is red at the merge base `4e4cf7f83` and on `origin/master` `f261ed3a4` (both reproduced in a scratch worktree, since removed). Filed as **#509**.
  - `pnpm --filter backend run test:unit:fast`: 361 files, 7 774 / 7 774.
  - `pnpm --filter '!backend' run test` (`--no-bail`, `--workspace-concurrency=2`, `NODE_OPTIONS=--no-experimental-webstorage`): the first bailing run stopped on a load timeout in `cms-components/option-parity.test.ts` (green alone, 136/136). The full run: 28 suites; admin 4 418 tests, **4 red** — three load flakes green alone (`crm/board-card-fields` — #503; `price_lists/price-book-duplicate`; `quote_requests/pdf-dialog`), and **one real**: `admin/test/unit/nested-async-utilities.test.ts` refused `TaskDetail.comments.test.tsx:169` (Phase 6) — a `waitFor` around an awaited `findBy` query. Fixed (a synchronous query inside the `waitFor`); `test/modules/tasks` + the guard 20 files, 161 / 161. Every other package suite green.
  - **Every `check:*` script** (41 of `backend`, plus `check:naming`, `check:language`, `check:pdfmake-footprint`): green, 0 findings or violations — including **`check:docs-translations` (172 sources, 0 findings; red since T008, fixed at T089)**, `check:off-state-coverage` 41/41, `check:release-intent --since origin/master` 0 violations, `check:demo-data-budget`, `check:module-docs`. `pnpm --filter docs run build` green in both locales.
  - Generated artefacts: no drift after `composer:generate` (module map committed), `manifests:generate`, `pnpm install --lockfile-only`, OpenAPI baseline.
  - Read sizes: no check refused a band; nothing re-recorded (`check-estate.md`).
  - Issues opened in this phase: #508 (non-blocking UX findings), #509 (catalog listing recording, red on master). Issue #480's body updated with the amendments, rulings and progress.
  - **Left open for the owner:** nothing. T093 was done afterwards by an independent read-only reviewer — see its entry (F3 fixed; F1 filed as #513); T095, the browser walk, afterwards by the orchestrator on `b2b_walk165` — see its entry (ten defects fixed; the e-mail link waits on #185).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1):** T001 first. Its findings steer T045 and T072.
- **Foundational (Phase 2):** needs Phase 1 and blocks every story. T013 → T014 → (T015, T016) → T017 → T018 → (T019, T020, T021, T022, T023) → T024 → T025.
- **US1 (Phase 3):** needs Phase 2. Its reference work (T032–T036) is needed by US4 and US6.
- **US2 (Phase 4):** needs Phase 2. It must precede US3, because the board's columns are the workflow.
- **US3 (Phase 5):** needs US2, and US1's tag and priority reads (for filters and cards).
- **US4 (Phase 6):** needs US1 (T036).
- **US5 (Phase 7):** needs Phase 2 only.
- **US6 (Phase 8):** needs US1 (T033, T036).
- **US7 (Phase 9):** needs Phase 2 and US1's due time (T037).
- **US8 (Phase 10):** needs Phase 2. Its matrix (T076) also covers surfaces from US3, US4 and US6, so run it after those.
- **US9 (Phase 11):** needs US1 (T037, T040) and US2 (T045's reassignment helper).
- **US10 (Phase 12):** needs Phase 2. T087 needs T074 (the worker).
- **Polish (Phase 13):** needs every story it documents or measures.

### Parallel opportunities

These assume separate worktrees per `AGENTS.md`, branched off this feature branch after T025.
- **Track A:** US1 → US4 → US6.
- **Track B:** US2 → US3.
- **Track C:** US5, then US10's T084/T086.
- **Track D:** US7 after T037 lands, then T087.
- **Inside a phase:** every task marked [P] (tests, separate files) runs in parallel.
- **Hot files** are rebased by adding lines: `T/backend/index.ts`, `T/manifest.ts`, `T/admin/index.ts`, `T/admin/api.ts`, `T/admin/pages/TaskDetail.tsx`, the i18n bundles and `X/tasks.ts` (frozen after T004).

### Parallel example: User Story 1

```text
Together, red first:
  T026 task-fields.test.ts · T027 references.test.ts · T028 crm/projects references
  T029 attachments.test.ts · T030 custom-fields-host.test.ts · T031 admin + kit tests
Then: T032 → T033 → T034 ∥ T035 → T036; T037 ∥ T038 ∥ T039 ∥ T040 → T041
```

---

## Implementation Strategy

1. **MVP = Phases 1–5:** the Foundational shape, US1, US2 and US3. At that point a team can plan, track and board Tasks with their own workflow. Ship it to the demo for the owner's look before the P2 stories.
2. **Then the P2 stories:** US4, US5, US6 and US7, each merged when its tests are green.
3. **Then the P3 stories:** US8, US9 and US10, followed by Polish.
4. **One merge request** delivers the feature, from `165-task-management` to `master`. If the owner wants the MVP earlier, split at the Phase 5 checkpoint. Every phase is green on its own, and the migration is single.

---

## Requirement traceability

| Requirement | Tasks |
| --- | --- |
| FR-001 assignees | T016, T026, T037 |
| FR-002 due/start | T015, T026, T037 |
| FR-003 rich description | T041 |
| FR-004 references (#446) | T027, T036 |
| FR-005 reference kinds | T003, T005, T028, T032–T036 |
| FR-006 mentions | T027, T036 |
| FR-007 custom fields | T030, T038 |
| FR-008 attachments | T029, T039 |
| FR-009 / FR-024 priorities | T026, T037, T080, T082 |
| FR-010 / FR-023 tags | T026, T037, T040, T080, T082 |
| FR-011 history | T016, T026, T041 |
| FR-012–FR-016 workflow | T042, T045–T047 |
| FR-017 closed = category | T016, T019, T043 |
| FR-018 list/board remembered | T050, T053, T055 |
| FR-019 board | T048, T051, T054, T055 |
| FR-020 filters/sorts | T023, T048 |
| FR-021 saved filters | T049, T052 |
| FR-022 card fields | T051, T055 |
| FR-025 / FR-026 comments | T056, T058 |
| FR-027–FR-030 hierarchy/relations | T060, T062 |
| FR-031–FR-033 links/panels | T064–T067 |
| FR-034 / FR-035 reminders | T068, T072, T074 |
| FR-036 digest | T069, T073 |
| FR-037 / FR-038 draft/private | T011, T012, T018, T076, T078 |
| FR-039 / FR-040 #450 | T084–T087 |
| FR-041 permissions | T006, T042, T076, T080 |
| FR-042 palette/off-state | T083, T090 |
| FR-043 i18n/docs | T041, T089 |
| FR-044 no storefront | T090 (no storefront route registered) |
| FR-045 ports unchanged in behaviour | T019, T021, T043 |
| SC-002 performance | T024, T091 |
| SC-005 no leak | T012, T076, T093 |
| SC-006 #450 | T084, T085 |
| SC-008 upgrade identical | T009, T019, T021 |
