# Contract: `projectCommandPort` (Project, #1828)

Owner `projects` (**deactivatable**). Declared in `packages/contracts/src/projects.ts`. Every operation
is a Command today (`projects`: 38 `commandBus.run` sites, no hand-written audit). Per the file's own
rule (line 1132), the `Container name:` marker is added in the change that registers the port.

## Operations

| Method | Command action (kept) | Admin route (`/api/v1/admin/projects…`) |
| --- | --- | --- |
| `create(input, options?)` | `projects.project.create` | `POST` |
| `update(id, patch, options?)` | `projects.project.update` | `PATCH /:id` |
| `setCustomFieldValues(id, merge, options?)` | `projects.project.custom_fields_update` | `PATCH /:id` (values) |
| `setOrganizations(id, { organizationIds }, options?)` | `projects.project.organizations_set` | `PUT /:id/organizations` |
| `setMembers(id, input, options?)` | `projects.project.member_set` | `PUT /:id/members` |
| `moveToStage(id, { stageId, reason }, options?)` | `projects.project.stage_move` | stage move route in `routes/routes.stages.ts` (T006 confirms path) |
| `close(id, input, options?)` | `projects.project.close` | `/:id/close` |
| `reopen(id, options?)` | `projects.project.reopen` | `/:id/reopen` |
| `link(id, input, options?)` | `projects.project.link_add` | `/:id/links` |
| `unlink(id, linkId, options?)` | `projects.project.link_remove` | `/:id/links/:linkId` |
| `addComment(id, input, options?)` | `projects.project.note_add` | `/:id/comments` |
| `delete(id, options?)` | `projects.project.delete` | `DELETE /:id` (`routes/routes.projects.ts`) |

**Not offered**: `archive` / `restore` — #1828 lists them, but the module has no such operation (no
Command, no route); inventing one is a product change, not a port. Stages, templates,
visibility, viewers, stage-task configuration and alerts — configuration and maintenance.

Stage guards (`projectStageGuardRegistry`) run on `moveToStage` exactly as on the admin move.

## Record

`ProjectRecord` gains `customFieldValues: Record<string, unknown>` (FR-015), filled by
`projectReadPort.findById` / `findByIds` / `findByRecord` / `search` from the row's
`custom_field_values`.

## The investor case (#1828), for the contract's example

A deployment stores the investor in its own side table keyed by the project
(`specs/187-side-table-extensions/`), learns about changes from the hookable actions of #1845, and calls
`relatedPayerWritePort.addPayer` for the project's Organizations — it reads them from `ProjectRecord`
and never needs a core change for the investor itself.

## Owner off

Fails closed (503 `MODULE_DISABLED`).

## Deprecated by this port

None (read port only today).

## Tests

`backend/test/contract/projects/project-command-port.test.ts` (parity; stage guard veto),
`backend/test/integration/projects/project-command-port.worker.test.ts`, a record test that the read
port carries `customFieldValues`, off-state test.
