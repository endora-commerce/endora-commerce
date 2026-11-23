# Contract: `taskCommandPort` (Task, #1829)

Owner `tasks` (**deactivatable**). Declared in `packages/contracts/src/tasks.ts`. Operations are Commands
today (`tasks`: 38 `commandBus.run` sites); the 8 hand-written audit calls in the module are not on
these operations (T009 confirms).

## Operations

Routes are written relative to the module's task routes (`/api/v1/admin/tasks…`, built from a prefix in the routes file; T009 records the literal paths).

| Method | Command action (kept) | Route |
| --- | --- | --- |
| `create(input, options?)` | `tasks.task.create` | `POST /tasks` |
| `createMany({ context, tasks }, options?)` | one `tasks.task.create` per task (T009 confirms; today's `taskWritePort.createMany`) | — |
| `update(id, patch, options?)` | `tasks.task.update` | `PATCH /tasks/:id` |
| `setStatus(id, { status }, options?)` | `tasks.task.status_change` | `/tasks/:id/status` |
| `setCustomFieldValues(id, merge, options?)` | `tasks.task.custom_fields_change` | `PATCH /tasks/:id` (values) |
| `publish(id, options?)` | `tasks.task.publish` | `/tasks/:id/publish` |
| `relate(id, input, options?)` | `tasks.task.relate` | `/tasks/:id/relations` |
| `unrelate(id, relationId, options?)` | `tasks.task.unrelate` | `/tasks/:id/relations/:relationId` |
| `link(id, input, options?)` | `tasks.task.link` | `/tasks/:id/links` |
| `unlink(id, linkId, options?)` | `tasks.task.unlink` | `/tasks/:id/links/:linkId` |
| `addReminder(id, input, options?)` | `tasks.reminder.add` | `/tasks/:id/reminders` |
| `addComment(id, input, options?)` | `tasks.comment.add` | `/tasks/:id/comments` |
| `delete(id, options?)` | `tasks.task.delete` | `DELETE /tasks/:id` |
| `deleteInContext({ contextType, contextId }, options?)` | one `tasks.task.delete` per task (as today) | — |

Assignees, priority, privacy, parent and tags changes ride on `update` where the admin `PATCH` carries
them; where they are separate Commands (`assignees_change`, `priority_change`, `privacy_change`,
`parent_change`, `tags_change`), `update` runs them as children in one transaction, as the route does
(T009 confirms).

**Not offered**: attachments (upload flow), reminder delivery, digests, status/priority/tag
configuration.

## Record

`TaskRecord` gains `customFieldValues: Record<string, unknown>` (FR-015).

## Owner off

Fails closed (503 `MODULE_DISABLED`). `projects` already calls `taskWritePort` for stage tasks; it moves
to `taskCommandPort` with the same `nonBindingDependencies` declaration it has today.

## Deprecated by this port

`taskWritePort.createMany`, `taskWritePort.deleteInContext`.

## Tests

`backend/test/contract/tasks/task-command-port.test.ts` (parity),
`backend/test/integration/tasks/task-command-port.worker.test.ts` (publish from a worker notifies
assignees), off-state test, delegation test, and the `projects` stage-task regression.
