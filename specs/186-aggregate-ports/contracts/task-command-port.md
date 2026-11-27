# Contract: `taskCommandPort` (Task, #1829)

Owner `tasks` (**deactivatable**). Declared in `packages/contracts/src/tasks.ts`. Every operation is
a Command today; nothing converts (T009, below). The admin routes are in
`packages/modules/tasks/src/backend/routes/`, all under `/api/v1/admin/tasks` (the `API` constant of
each routes file).

## Operations (T009 inventory, measured on `origin/master` `dfd043bbd`, 2026-11-26)

Readiness: C = Command; H-in / H-post / N as research R-2. "Around" is what the route's service does
outside the Command, before it (refusals) and after its commit (side effects).

| Method | Command action(s) | Ready | Route (file) | Around the Command |
| --- | --- | --- | --- | --- |
| `create(input, options?)` | `tasks.task.create` | C | `POST /tasks` (`routes.tasks.ts`, `TaskService.create`) | before: the context's owner and the caller's sight of it, `canChangeTasks`, private rules, assignees (active, `tasks:read`, may see the record), priority, tags, custom-field merge, parent, links, due moment; after: added assignees told (bell), newly mentioned people told — neither for a draft |
| `createMany({ context, tasks }, options?)` | one `tasks.task.create` per entry | C | none (`taskWritePort.createMany`, `task-write-port.ts`) | before: batch size, entry shape, the context type's owner present, assignees active only (#506 ruling); source-key idempotence (R-19, #450); no bell |
| `update(id, patch, options?)` | `tasks.task.update` | C | `PATCH /tasks/:id` with the title, description, due date and time, start date or context (`TaskService.updateFields`) | before: visibility, `assertMayChange`, take-out / put-in checks, the kept assignees seeing a new record, a private Task in no record; inside: relative reminders follow a changed due moment (`followDueMoment`); after: newly mentioned people told, not for a draft |
| `setParent(id, { parentTaskId }, options?)` | `tasks.task.parent_change` | C | `PATCH /tasks/:id` with `parentTaskId` (`hierarchy-service.ts`) | before: visibility, `assertMayChange`, the parent may be adopted; inside: cycle and depth under the hierarchy lock |
| `setPriority(id, { priorityCode }, options?)` | `tasks.task.priority_change` | C | `PATCH /tasks/:id` with `priorityCode` | before: the priority is on the list; inside: held shared |
| `setTags(id, { tagIds }, options?)` | `tasks.task.tags_change` | C | `PATCH /tasks/:id` with `tagIds` | before: every tag exists |
| `setAssignees(id, { set } \| { add, remove }, options?)` | `tasks.task.assignees_change` | C | `PATCH /tasks/:id` with `assigneeIds`, or `addAssigneeIds` / `removeAssigneeIds` | before: active, `tasks:read`, may see the record; a private Task's only assignee is its Creator; after: the people added told, not for a draft |
| `setPrivate(id, { private }, options?)` | `tasks.task.privacy_change` | C | `PATCH /tasks/:id` with `private` | before, against the Task as it stands: the Creator only, no context, no assignee but the Creator |
| `setStatus(id, { to, from? }, options?)` | `tasks.task.status_change` | C | `POST /tasks/:id/status` (`TaskTransitionService.apply`) | every check inside the Command (target held, `from` still current, workflow move) |
| `setCustomFieldValues(id, merge, options?)` | `tasks.task.custom_fields_change` | C | `PATCH /tasks/:id` with `customFieldValues` | before: visibility, `assertMayChange`; the route merges before the Command, the port's merge runs under the row lock |
| `publish(id, options?)` | `tasks.task.publish` | C | `POST /tasks/:id/publish` (`TaskService.publish`) | before: the caller is the draft's Creator; after: assignees and mentioned people told |
| `relate(id, otherId, options?)` | `tasks.task.relate` | C | `PUT /tasks/:id/relations/:otherId` (`relation-service.ts`) | before: both Tasks visible and changeable; inside: a second entry on the other Task (hand-recorded on the Command's `em`) |
| `unrelate(id, otherId, options?)` | `tasks.task.unrelate` | C | `DELETE /tasks/:id/relations/:otherId` | as `relate` |
| `link(id, target, options?)` | `tasks.task.link` | C | `POST /tasks/:id/links` (`record-link-service.ts`) | before: the record's owner present, the caller's read code for it, the record found |
| `unlink(id, linkId, options?)` | `tasks.task.unlink` | C | `DELETE /tasks/:id/links/:linkId` | never validated against the record |
| `addReminder(id, input, options?)` | `tasks.reminder.add` | C | `POST /tasks/:id/reminders` (`routes.reminders.ts`, `TaskReminderService.add`) | before: recipients are the caller or assignees, a due moment for a relative one; inside: at most ten, under the Task's lock |
| `addComment(id, input, options?)` | `tasks.comment.add` | C | `POST /tasks/:id/comments` (`TaskCommentService.add`) | after: mentioned people told, then the assignees and Creator told of the comment |
| `delete(id, options?)` | `tasks.task.delete` | C | `DELETE /tasks/:id` (`TaskService.delete`) | before: `tasks:write`, or `tasks:see_private` on a private Task; the context owner's `canChangeTasks`; inside: one `tasks.task.parent_change` entry per former sub-task (hand-recorded on the Command's `em`) |
| `deleteInContext({ contextType, contextId }, options?)` | one `tasks.task.delete` per Task | C | none (`taskWritePort.deleteInContext`) | the context's owner deleting its own record; no visibility |

**Not offered**: attachments (an upload flow, and `assets_library`'s read code on the route), editing
or deleting a comment (its author's own act), removing a reminder (its creator's or a writer's call),
reminder delivery, the digest, saved views, and the workflow, priority, tag and board configuration.

## Inventory findings (T009)

1. **Nothing converts.** The module has 38 `commandBus.run` sites. The draft's "8 hand-written audit
   calls" are four `recordAuditFromContext` sites today, every one **inside** a Command's `run`, on
   its `em`, recording a second object's entry: the former sub-tasks of a deleted Task
   (`task-commands.ts`), the other Task of a relation (`relation-service.ts`), the relative reminders
   a cleared due date removes (`reminder-schedule.ts`), and the Tasks a status or priority removal
   moves (`task-reassignment.ts`, configuration, not on the port). The other hits are the
   `command-coverage-ignore` markers of saved views (personal UI) and of the value store
   (`task-audit-state.ts`, which runs inside a Command). R-23.6.
2. **`update` is several Commands, not one, and not one transaction.** The draft said the route runs
   them "as children in one transaction". In fact it runs them one after another, each committed on
   its own. The parent goes first because it is the one refused inside its Command. R-23.1, ruled
   *changed*: the port's `update` runs `tasks.task.update` alone, and each other Command of the
   `PATCH` is its own method (`setParent`, `setPriority`, `setTags`, `setAssignees`, `setPrivate`,
   `setCustomFieldValues`), over the same factories and the same checks, which `TaskService` shares
   with the route's `updateTask`. The route's sequence is unchanged.
3. **Seven methods need an administrator behind the call.** `tasks.created_by_admin_user_id`,
   `task_relations.created_by_admin_user_id`, `task_record_links.linked_by_admin_user_id`,
   `task_reminders.created_by_admin_user_id` and `task_comments.author_admin_user_id` are `not null`.
   With no administrator, `create`, `createMany`, `relate`, `link` and `addReminder` throw a plain
   `Error` (a 500), `publish` answers 404 (a draft is its Creator's), and `addComment` answers 403.
   R-23.2.
4. **A private Task is read-only to the system.** `assertMayChange` treats everybody but the Creator
   as "someone else", the bare system scope included, so every write but a delete answers
   `403 TASK_PRIVATE_READ_ONLY`. R-23.3.
5. **The status move carries `from`.** The route's body is `{ from, to }`, and `from` is the
   optimistic check (a moved Task is `409 TASK_TRANSITION_CONFLICT`). There is no `version` column.
   R-23.4.
6. **Relations are addressed by the other Task**, `PUT|DELETE /tasks/:id/relations/:otherId`. There is
   no relation id. The draft's `unrelate(id, relationId)` was a slip. R-23.5.
7. **`createMany` is not `create` in a loop.** It skips the `tasks:read` and record-sight checks on
   assignees (the #506 ruling for a Stage's holders), honours source keys, and tells nobody. R-23.7.
8. **No Task action is hookable** (the manifest declares none). The bus therefore refuses every
   `extensions` key with `422 COMMAND_EXTENSION_UNCLAIMED` on the first Command a method runs,
   before anything is written.

## Record

`TaskRecord` gains `customFieldValues: Record<string, unknown>` (FR-015), every key the bag holds.

## Owner off

Fails closed (503 `MODULE_DISABLED`). `projects` already calls `taskWritePort` for Stage Tasks. It
moves to `taskCommandPort`, keeping its `degrades-without` declaration under the new name.

## Deprecated by this port

`taskWritePort.createMany` and `taskWritePort.deleteInContext`, both of which delegate.

## Tests

- `backend/test/contract/tasks/task-command-port.test.ts`: parity per method (each of R-23.1's
  one-Command methods asserting exactly one audit row), the refusals of R-23.2–R-23.4,
  `source`, extensions, the off state and the delegation.
- `backend/test/integration/tasks/task-command-port.worker.test.ts`: a worker publishes a draft and
  its assignees are told.
- The `projects` Stage-Task regression, `backend/test/integration/projects/stage-tasks.test.ts`.
