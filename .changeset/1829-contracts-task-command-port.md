---
'@endora-commerce/contracts': minor
---

**Breaking change** (issue #1829): `TaskRecord` gains a **required** member on a published type (owner ruling on #1983, applied to the same case).

`TaskCommandPort` (container name `taskCommandPort`, owner `tasks`) is the Task aggregate's write port (issue #1829, `specs/186-aggregate-ports/`). It declares `create` (`CreateTaskBody`), `createMany`, `update` (`TaskUpdatePatch`: title, description, due date and time, start date, context), `setParent`, `setPriority`, `setTags`, `setAssignees` (`TaskAssigneesChange`: `{ set }` or `{ add, remove }`), `setPrivate`, `setStatus` (`TaskStatusMove`: `{ to, from? }`), `setCustomFieldValues` (a `CustomFieldMerge`), `publish`, `relate` and `unrelate` (the other Task's id), `link` (answers `{ linkId }`), `unlink`, `addReminder` (answers `{ reminderId }`), `addComment` (answers `{ commentId }`), `delete` and `deleteInContext`, each ending in `AggregateCommandOptions` and each running exactly one Command (`createMany` and `deleteInContext`: one per Task). `expectedVersion` is ignored: a Task has no version. `create`, `createMany`, `publish`, `relate`, `link`, `addReminder` and `addComment` need an administrator (and `setPrivate` the Task's Creator) behind the call (`withSystemScopeActingFor`) and are refused `403 FORBIDDEN` without one.

`TaskRecord` gains `customFieldValues`, the stored custom-field values with every field included, always filled by `tasks`. A test double that builds a `TaskRecord` by hand adds it.

Deprecated since 0.113.0, removed in a later release. Each delegates to its replacement and writes the same audit entries as before:

- `taskWritePort.createMany({ context, tasks })` → `taskCommandPort.createMany({ context, tasks })`
- `taskWritePort.deleteInContext({ contextType, contextId })` → `taskCommandPort.deleteInContext({ contextType, contextId })`

Rename the manifest edge from `taskWritePort` to `taskCommandPort` when you move.

**Upgrading to 0.113.0:** code that reads a `TaskRecord` needs no change. Code that builds one by hand (a test double, a fake read port) fails to type-check until it adds `customFieldValues`. Nothing changes at run time for code that already type-checks.
