---
'@endora-commerce/contracts': minor
---

**Breaking change** (issue #1828): `ProjectRecord` gains three **required** members on a published type (owner ruling on #1983, applied to the same case).

`ProjectCommandPort` (container name `projectCommandPort`, owner `projects`) is the Project aggregate's write port (issue #1828, `specs/186-aggregate-ports/`). It declares `create` (`CreateProjectBody`), `update` (`ProjectUpdatePatch`: title, description, value, start date), `setCustomFieldValues` (a `CustomFieldMerge`), `setOrganizations`, `setMembers`, `moveToStage`, `close` (`ProjectCloseInput`), `reopen`, `link` (answers `{ linkId }`), `unlink`, `addComment` (answers `{ commentId }`) and `delete`, each ending in `AggregateCommandOptions`. `expectedVersion` names the token the operation's admin route checks — the Project's `version`, or its `configurationVersion` on `setOrganizations` and `setMembers` — and a stale one is refused `409 PROJECT_CHANGED`. `create` and `addComment` need an administrator behind the call (`withSystemScopeActingFor`) and are refused `403 FORBIDDEN` without one.

`ProjectRecord` gains three members, always filled by `projects`: `customFieldValues` (the stored custom-field values, every field included), `version` and `configurationVersion`. A test double that builds a `ProjectRecord` by hand adds them.

Nothing is deprecated: Projects published a read port only.

**Upgrading to 0.113.0:** code that reads a `ProjectRecord` needs no change. Code that builds one by hand (a test double, a fake read port) fails to type-check until it adds `customFieldValues`, `version` and `configurationVersion`. Nothing changes at run time for code that already type-checks.
