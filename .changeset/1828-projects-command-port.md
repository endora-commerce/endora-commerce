---
'@endora-commerce/mod-projects': minor
---

`projects` registers `projectCommandPort` (issue #1828, `specs/186-aggregate-ports/`): another module, an overlay or an integration worker can create a Project, edit it, set its custom-field values, Organizations and Members, move it between Stages, close and reopen it, link and unlink records, add a note or a message and delete it. Each method runs the service and the Command its admin route runs, so the audit trail, the command hooks (#1845), the stage guards, the Stage Tasks of an entered Stage, mention and message notices and the module's events are the same for both. The port is gated: while Projects is off it answers `503 MODULE_DISABLED` and writes nothing.

`projectReadPort` now answers `customFieldValues`, `version` and `configurationVersion` on every record. Audit entries of a port call carry the caller's `source` code. Creating a Project with no administrator behind the call is refused `403 FORBIDDEN` before anything is read, where it failed with a 500 inside its transaction. No admin route changes.
