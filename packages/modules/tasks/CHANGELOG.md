# @endora-commerce/mod-tasks

## 0.109.0

### Minor Changes

- 4bc5c7f: Task attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Tasks a reader may not see — private, draft, or of a context record hidden from them — by the rule the Tasks screens use, including `tasks:read`. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/tasks/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the private-file and active-content refusals.
- 87af080: `422 TASK_PRIORITY_UNKNOWN` now carries the unknown priority code as `details.priorityCode`; `details.code` no longer carries it, and the error has no `details.code` at all. The envelope read that value as a refusal token, looked up a sentence that could not exist and answered the thrower's English in every language. The message is now the translated sentence naming the code — `The priority "whenever" does not exist.` / `Priorytet „whenever” nie istnieje.` A client that read the code from `details.code` reads `details.priorityCode` instead.
- 11b0eb8: A new module package, `@endora-commerce/mod-tasks` (module id `tasks`): Tasks for
  administrators — a number (`TSK-…`), a title, a description, an assignee, a due date and one of
  four statuses — standing on their own or belonging to a record another module owns.

  - **Activation.** `tasks.enabled` (on by default, switchable on `/platform/modules`). Off is
    non-destructive: every route answers `503` `MODULE_DISABLED`, every screen, palette action and
    search hit is gone, other modules can neither read nor create Tasks, and everything is back as
    it was when it is switched on again.
  - **Migration.** `tasks_init` — the `tasks` table and its number sequence.
  - **Permissions.** `tasks:read`, and `tasks:write`, which requires it.
  - **Admin API** under `/api/v1/admin/tasks`: the list (status, assignee, due dates, overdue,
    context, search), _My tasks_, a Task's create, read, update and delete, its change history, and
    the assignee lookup. A Task whose context the caller may not see answers exactly as a missing
    one.
  - **Admin UI.** _My tasks_ (`/tasks/mine`), the Tasks list, _New task_ and a Task's screen, in the
    sidebar's _Projects & tasks_ section; three palette actions (`open-tasks`, `open-my-tasks`,
    `new-task`); Tasks in admin global search, by number or title. A Task's screen mounts the
    `task.detail.after` zone for other modules' panels. English and Polish.
  - **Assignment.** Assigning a Task to somebody else notifies them through the bell
    (`admin_notifications`, optional) — and only when they may see the Task's context.
  - **For other modules.** `taskContextRegistry`, an ungated contribution seam through which a
    module owns a Task context type and decides who sees its Tasks (fail-closed: a context nobody
    present owns hides its Tasks) and who may put a Task into one of its records, take one out or
    delete one (`canChangeTasks`; a refused delete is `403` `FORBIDDEN`, and a Task's detail carries
    the answer as `context.canChangeTasks`, so its screen offers no Delete it would refuse); `taskReadPort` and `taskWritePort`, gated; the events
    `tasks.task.created.v1`, `tasks.task.status_changed.v1`, `tasks.task.assigned.v1` and
    `tasks.task.deleted.v1`; and `nextTaskNumber(em)` on `./backend`, the door to the `TSK-…`
    number sequence.
  - **Dependencies.** Binding on `_i18n`, `admin_users`, `audit_logs`, `auth` and `settings`;
    degrades without `admin_notifications`.

  Its contract — the API schemas, `TaskReadPort`, `TaskWritePort` and `TaskContextRegistryPort` —
  is in `@endora-commerce/contracts` (see that package's entry).

- 55864a1: Tasks grows into a work-management module (`specs/165-task-management/`): several assignees, a configurable status workflow with permitted transitions, priorities, tags, a rich-text description with references, comments with mentions, attachments, custom fields, sub-tasks and related Tasks, links to Opportunities, Orders and Quote Requests with a Tasks panel on each, a board beside the list (the choice remembered per user), saved filters, reminders and an opt-in daily digest, drafts and private Tasks.

  **Upgrading.** One migration, `tasks_task_management`, keeps every existing Task: its status stays as a seeded code (`todo`, `in_progress`, `done`, `cancelled`, every transition permitted) and its single assignee becomes the first of its assignees. Its `down` restores the previous shape with the first assignee.

  - New permissions `tasks:configure` (the workflow, tags, priorities, board card and time zone) and `tasks:see_private` (reading and deleting other people's private Tasks); grant them to the roles that need them.
  - New palette actions on `tasks:configure`, one per settings screen: `open-task-workflow`, `open-task-priorities`, `open-task-tags` and `open-task-general-settings` (the time zone).
  - New settings `tasks.board_card_fields` and `tasks.time_zone` (default `Europe/Warsaw`), and two transactional e-mails, `tasks_task_reminder` and `tasks_daily_digest`.
  - New dependencies, all non-deactivatable: `custom_fields`, `assets_library`, `transactional_emails`, `orders`, `catalog`. The module stays operator-toggleable and degrades without `crm`, `quote_requests` and `projects`.
  - A worker on the queue `tasks-reminders` runs where workers run: a Job Scheduler every 60 s delivers due reminders (the bell exactly once, the e-mail at most once; a reminder more than 24 h late — after downtime or while Tasks was off — is recorded as expired and not sent) and, at most every 15 minutes, the daily digests and a maintenance pass (#450): the Tasks of a context whose record was deleted while Tasks was off — a Project — are deleted as the system (`tasks.task.delete`, `reason: context_gone`), and those of a deleted group — a Stage — lose it (`tasks.task.update`, `reason: context_group_gone`). Only a context owner that is on and answers the new optional `TaskContextDescriptor.existingContexts` is asked, so nothing is taken for gone while its owner is off. The package gains the peers `bullmq`, `ioredis` and `@endora-commerce/email-components`.
  - `taskReadPort` now also hides drafts and other people's private Tasks; `taskWritePort.createMany` honours `sourceKey`, so a retried batch creates only what is missing (#450).
  - Removing a priority in use takes `?replacement=<code>` or `?replacement=none`, and moves every Task holding it — drafts and private Tasks included — each change in that Task's history (`reason: priority_removed`). Deleting a tag takes it off every Task and writes one audit row on the tag with how many Tasks carried it.
  - A draft is published with `POST /api/v1/admin/tasks/:id/publish`, by its Creator, once: only then is `tasks.task.created.v1` emitted and are its assignees and mentioned people told. While it is a draft no `tasks.task.*` event is emitted for it at all — for other modules it does not exist yet.
  - `DELETE /api/v1/admin/tasks/:id` answers **200** with `{data: {subtasksDetached}}` instead of 204, and its gate is `tasks:read` (the service asks for `tasks:write`, or `tasks:see_private` on a private Task, and answers the same 403 otherwise): deleting a parent makes its sub-tasks top-level, and the answer says how many of them the caller may see. A client that checked for 204 checks for a 2xx.
  - **Assigning a Task of a record is refused for somebody who may not see the record** (#506): `POST` and `PATCH /api/v1/admin/tasks` answer 422 `TASK_ASSIGNEE_INVALID` with `details: {code: 'context_hidden', name, adminUserId}`, naming the person, for an assignee the context's `canSeeAs` refuses — and when a Task moves to another record, for the assignees it keeps. Before, such an assignment was accepted and the person was simply not told. `GET /api/v1/admin/tasks/lookups/assignees` takes `contextType` and `contextId` (the create form inside a record) and, like `taskId`, offers only who may see it. `taskWritePort.createMany` does not ask this: the context owner names its assignees (a Project's Stage holder).

### Patch Changes

- ffb2aec: Every signed-in administrator can now read and acknowledge their own notifications on the Admin UI's bell, whatever their role. Before, the bell and its API needed `admin:read`, so a narrow role such as a sales representative had Task and CRM notifications recorded for them that they could never open.

  - `@endora-commerce/mod-admin-notifications`: `GET /api/v1/admin/notifications`, `POST /api/v1/admin/notifications/:id/read` and `POST /api/v1/admin/notifications/mark-all-read` are gated on an administrator session with no permission code. `admin:read` now decides only whether the `all_admins` broadcasts are listed, counted and acknowledgeable; for an administrator without it, a broadcast's id answers `404` like any notification that is not theirs. `AdminNotificationService.listForAdmin`, `markRead`, `markAllRead` and `countUnreadForAdmin` take a required `includeBroadcasts` flag. The module now depends on `admin_roles`, whose permission service answers that question. The permission's label is now _View notifications sent to all admins_.
  - `@endora-commerce/admin-shell`: the header shows the notification bell to every administrator while the Admin notifications module is on.
  - `@endora-commerce/mod-i18n`: the English and Polish labels of `admin:read` follow the new meaning.
  - `@endora-commerce/mod-tasks`: the module page says that every administrator reads their own notifications without a permission.

- 8eb0fcb: The command-palette actions of the work-management modules (`crm`, `projects`, `tasks`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- df95f59: The manifests now declare the refusal tokens of every error code they raise with a computed `details.code`. `mod-tasks` declares `TASK_WORKFLOW_INVALID`'s ten rule tokens and `TASK_STATUS_IN_USE_TOO_MANY`'s `priority`; `mod-custom-fields` (`CUSTOM_FIELD_OPTION_IN_USE`, `CUSTOM_FIELD_STORED_VALUES_EXIST`, `CUSTOM_FIELD_VALUE_TYPE_LOCKED`), `mod-document-templates` (`DOCUMENT_TEMPLATE_INVALID`) and `mod-projects` (`PROJECT_MOVE_NOT_PERMITTED`) declare `tokens: []`, stating that those raises never carry a token. Every token already had its sentence in English and Polish, so no rendered message changes.
- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/email-components@0.109.0
