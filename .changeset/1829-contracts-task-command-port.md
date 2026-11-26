---
'@endora-commerce/contracts': minor
---

`TaskCommandPort` (container name `taskCommandPort`, owner `tasks`) is the Task aggregate's write port (issue #1829, `specs/186-aggregate-ports/`). It declares `create` (`CreateTaskBody`), `createMany`, `update` (`TaskUpdatePatch`: the admin `PATCH` body without `customFieldValues`), `setStatus` (`TaskStatusMove`: `{ to, from? }`), `setCustomFieldValues` (a `CustomFieldMerge`), `publish`, `relate` and `unrelate` (the other Task's id), `link` (answers `{ linkId }`), `unlink`, `addReminder` (answers `{ reminderId }`), `addComment` (answers `{ commentId }`), `delete` and `deleteInContext`, each ending in `AggregateCommandOptions`. `expectedVersion` is ignored: a Task has no version. `create`, `createMany`, `publish`, `relate`, `link`, `addReminder` and `addComment` need an administrator behind the call (`withSystemScopeActingFor`) and are refused `403 FORBIDDEN` without one.

`TaskRecord` gains `customFieldValues`, the stored custom-field values with every field included, always filled by `tasks`. A test double that builds a `TaskRecord` by hand adds it.

Deprecated since 0.113.0, removed in a later release. Each delegates to its replacement and writes the same audit entries as before:

- `taskWritePort.createMany({ context, tasks })` → `taskCommandPort.createMany({ context, tasks })`
- `taskWritePort.deleteInContext({ contextType, contextId })` → `taskCommandPort.deleteInContext({ contextType, contextId })`

Rename the manifest edge from `taskWritePort` to `taskCommandPort` when you move.
