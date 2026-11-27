---
'@endora-commerce/mod-tasks': minor
---

`tasks` registers `taskCommandPort` (issue #1829, `specs/186-aggregate-ports/`). Another module, an overlay or an integration worker can now do what the admin can: create a Task, edit it (fields, context, parent, priority, tags, assignees, privacy), move its status, set its custom-field values, publish a draft, relate it to another Task, link and unlink records, and add a reminder or a comment. It can also delete a Task. Each method runs exactly one of the Commands its admin route runs, through the same service and the same checks (the `PATCH`'s several Commands are separate methods), so the checks, the audit trail, the assignment, mention and comment notices, the relative reminders and the module's events are the same for both. The port is gated: while Tasks is off it answers `503 MODULE_DISABLED` and writes nothing.

`taskWritePort` is deprecated and delegates to `taskCommandPort.createMany` and `.deleteInContext`. Its `createMany` called with no administrator behind it is now refused `403 FORBIDDEN` before anything is read, where it failed with a 500 inside its first Command. `taskReadPort` now answers `customFieldValues` on every record. Audit entries of a port call carry the caller's `source` code. No admin route changes.
