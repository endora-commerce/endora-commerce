# Contract: `projectCommandPort` (Project, #1828)

Owner `projects` (**deactivatable**). Declared in `packages/contracts/src/projects.ts`, with its
`Container name:` marker added in the change that registers it (the file's own rule, the comment
above `ProjectRecord`).

## Operations

Readiness codes: research R-2, **as measured by the T006 inventory** (2026-11-26, `origin/master` at
`d936722d5`). "Route" is the admin route for the operation (`/api/v1/admin/projects…`); "Side effects"
is everything the route, or the service it calls, does outside the write itself, which the port call
must reach too (FR-013). File references are relative to `packages/modules/projects/src/backend/`.

Every operation is a Command today and records its action inline in the service the route calls:
`services/project-service.ts` (`ProjectService`), `services/move-service.ts` (`MoveService`),
`services/link-service.ts` (`LinkService`), `services/comment-service.ts` (`ProjectCommentService`).
No write of the module records an audit entry by hand, so **nothing is converted**. Every write starts
from `ProjectAccess.loadVisible` and locks the Project in its Command (`lockProject`), so a port call
sees exactly the Projects its ambient caller may see — every one under `withSystemScope`, the acting
administrator's under `withSystemScopeActingFor`.

| Method | Command action (kept) | Route | Readiness | Side effects outside the write | Work |
| --- | --- | --- | --- | --- | --- |
| `create(input, options?)` → `ProjectRecord` | `projects.project.create` (hookable) | `POST /` | C (`ProjectService.create`) | the first Stage's Stage Tasks created after the commit (`stageTasks.materializeAfterCommit`), the description's newly mentioned people told after the commit; `projects.project.created.v1` on commit | port only; **needs an administrator** (finding 1) |
| `update(id, patch, options?)` → `ProjectRecord` | `projects.project.update` (hookable) | `PATCH /:id` (title, description, value, start date) | C (`ProjectService.update`, the first of up to four Commands) | the description's newly mentioned people told after the commit | port only; visibility and listed people not offered (finding 3) |
| `setCustomFieldValues(id, merge, options?)` → `ProjectRecord` | `projects.project.custom_fields_update` (hookable) | `PATCH /:id` (`customFieldValues`) | C (`ProjectService.update`, the second Command; validated and merged before it, held to `version`) | none | the Command takes a merge run under the lock; the route passes a merge answering the bag it validated (finding 4) |
| `setOrganizations(id, { organizationIds }, options?)` → `ProjectRecord \| null` | `projects.project.organizations_set` (parent, records nothing) → `.organization_add` / `.organization_remove` (hookable), one per change | `PUT /:id/organizations` | C (`ProjectService.setOrganizations`) | none; the answer is "out of reach" when the caller's own change took the Project out of their reach | port only; `extensions` and `source` go to the children (finding 5) |
| `setMembers(id, { members }, options?)` → `ProjectRecord` | `projects.project.member_set` | `PUT /:id/members` | C (`ProjectService.setMembers`) | none | port only |
| `moveToStage(id, { toStageId }, options?)` → `ProjectRecord` | `projects.project.stage_move` (hookable) | `POST /:id/move` (`routes/routes.stages.ts`) | C (`MoveService.move`) | before the Command: the workflow check, the completion gate (`stageTasks.gate`) and the registered **stage guards** (`projectStageGuardRegistry`, 409 `PROJECT_GUARD_REFUSED`); after the commit: the entered Stage's Stage Tasks (`materializeAfterCommit`); `projects.stage.moved.v1` on commit | port only |
| `close(id, input, options?)` → `ProjectRecord` | `projects.project.close` (hookable) | `POST /:id/close` | C (`MoveService.close`) | before: the completion permission, the loss reason, the gate (completing only) and the stage guards; `projects.project.closed.v1` on commit | port only |
| `reopen(id, options?)` → `ProjectRecord` | `projects.project.reopen` (hookable) | `POST /:id/reopen` | C (`MoveService.reopen`) | before: the stage guards; `projects.project.reopened.v1` on commit | port only |
| `link(id, { kind, recordId }, options?)` → `{ linkId }` | `projects.project.link_add` | `POST /:id/links` (`routes/routes.links.ts`) | C (`LinkService.add`) | before: the record's owner present (503) and the record read under the caller (`orders:read` / `rfqs:handle` / `crm:read`; the system actor is not narrowed), the Organization match, "already linked"; `projects.record.linked.v1` on commit | port only |
| `unlink(id, linkId, options?)` → `void` | `projects.project.link_remove` | `DELETE /:id/links/:linkId` | C (`LinkService.remove`) | `projects.record.unlinked.v1` on commit | port only |
| `addComment(id, { kind, body }, options?)` → `{ commentId }` | `projects.project.note_add` / `.message_add` | `POST /:id/comments` (`routes/routes.comments.ts`) | C (`ProjectCommentService.add`) | after the commit: newly mentioned people told; for a message, every other Member who may see the Project told on the bell | port only; **needs an administrator** (finding 1) |
| `delete(id, options?)` → `void` | `projects.project.delete` | `DELETE /:id` (`routes/routes.projects.ts`) | C (`ProjectService.delete`) | after the commit, while Tasks is on: the Project's Tasks deleted through `taskWritePort.deleteInContext` | port only |

Each method parses its input with the admin route's schema (a refusal is `422 VALIDATION_FAILED`) and
runs the route's own service method, which builds the Command, so the before-checks and the
after-commit effects above are reached by both paths without being moved (research R-22.1).

Stage guards (`projectStageGuardRegistry`) run on `moveToStage`, `close` and `reopen` exactly as on the
admin routes.

**Not offered**: `archive` / `restore` — #1828 lists them, but the module has no such operation (no
Command, no route); inventing one is a product change, not a port (R-9). The project's visibility
and listed people (`projects.project.visibility_set`, `.viewers_set`, the other two Commands of the
admin `PATCH`), Stages and the workflow, Stage Task definitions, templates, roles, loss reasons,
alerts, attachments, editing or deleting a note — configuration, maintenance, or an author's own act.

## Options

- `source` — recorded as `source` in each Command's `stateAfter`; `PROJECTS_AUDIT_KEYS` gains the key.
- `expectedVersion` — the token the route checks: the Project's `version` on `update`,
  `setCustomFieldValues`, `moveToStage`, `close` and `reopen`; its `configurationVersion` on
  `setOrganizations` and `setMembers`; ignored by `link`, `unlink`, `addComment` and `delete`, whose
  routes check none. A stale token is the route's `409 PROJECT_CHANGED`. Absent, the Command writes
  over the version it reads, under the Project's row lock (R-22.3).
- `extensions` — handed to the Command(s) the method runs; the bus refuses a key no present hook module
  claims on that action, so every key is refused on `setMembers`, `link`, `unlink`, `addComment` and
  `delete`, none of whose actions is hookable (R-22.5).

## Record

`ProjectRecord` gains `customFieldValues: Record<string, unknown>` (FR-015), the stored bag, filled by
`projectReadPort.findById` / `findByIds` / `findByRecord` / `search` from the row's
`custom_field_values`; and `version` and `configurationVersion`, the two tokens `expectedVersion`
names (R-22.3).

## The investor case (#1828)

A deployment stores the investor in its own side table keyed by the project
(`specs/187-side-table-extensions/`), learns about changes from the hookable actions of #1845
(`projects.project.organization_add` / `.organization_remove` name the Organization), and calls
`relatedPayerWritePort.addPayer` for the project's Organizations — it reads them from
`ProjectRecord.organizationIds` — and never needs a core change for the investor itself. When the
investor is a custom field instead, it reads it from `ProjectRecord.customFieldValues` and writes it
through `projectCommandPort.setCustomFieldValues`.

## Owner off

Fails closed: resolving the port while `projects` is off throws `ModuleDisabledError`, which answers
503 `MODULE_DISABLED`; nothing is written.

## Deprecated by this port

None (read port only today).

## Inventory findings (T006)

1. **Two operations need an administrator.** A Project's `created_by_admin_user_id` and a comment's
   `author_admin_user_id` are `not null`, and the create Command refused a call with no administrator
   with a plain `Error` (a 500) inside its transaction. Under `withSystemScope` there is none, so
   `create` and `addComment` are refused `403 FORBIDDEN` before anything is read — the comment
   route's own refusal — and run under `withSystemScopeActingFor(adminUserId, reason)` (R-22.2).
2. **No hand audit, nothing to convert.** 38 `commandBus.run` sites, no `recordAuditFromContext`,
   `auditLog.record` or `recordWithin` in the module's services (R-2 confirmed).
3. **The admin `PATCH` is up to four Commands.** `projects.project.update` (the four fields),
   `.custom_fields_update`, `.visibility_set`, `.viewers_set`, each only when it changes something. The
   port's `update` is the first; custom fields are `setCustomFieldValues`; the other two are not
   offered (R-22.4).
4. **Custom fields are merged before the Command.** The route validates the patch against the bag it
   read and the Command holds the Project to the `version` that read carried. The port's merge runs
   inside the Command, on the bag read under the row lock, as `organizationCommandPort`'s does; a merge
   that changes nothing writes and records nothing (R-22.7).
5. **`setOrganizations` is a parent and its children.** The parent `organizations_set` is not hookable
   and records nothing; the per-Organization `organization_add` / `organization_remove` are. The
   caller's `extensions` and `source` go to the children (R-22.5).
6. **The routes answer details, not records.** Each service method ends with
   `ProjectReadService.afterWrite(id, language)`, a reader-language detail with the caller's
   permissions. The port answers the published record, read after the write under the Organization
   rule alone (`ProjectAccess.rowAfterWrite`), so a write that took the Project out of the caller's own
   visibility still answers it; only `setOrganizations` can take it out of reach, and answers `null`
   then, as the route answers `{ outOfReach: true }` (R-22.6).
7. **The record carries no version.** `ProjectRecord` had neither token, so a caller could not pass
   back what it read (R-22.3).
8. **#1950 (open) writes the same services.** Its merge refusal sits in `lockProject`, which every
   Command above calls, so a port call on a merged Project is refused as the route's is; its
   `ProjectRecord` additions (`mergedIntoProjectId`, …) sit beside the ones here, not over them.

## Tests

`backend/test/contract/projects/project-command-port.test.ts` (parity per method; the stage-guard veto
on `moveToStage`; `source`, extensions, `expectedVersion`; off-state),
`backend/test/contract/projects/project-read-port.custom-fields.test.ts` (the record carries the
values), `backend/test/integration/projects/project-command-port.worker.test.ts` (a worker under
`withSystemScope`, and `create` / `addComment` under `withSystemScopeActingFor`).
