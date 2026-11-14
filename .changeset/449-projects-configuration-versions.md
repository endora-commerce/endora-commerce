---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-projects': minor
---

Projects: optimistic concurrency for a Project's configuration (issue #449), additive. Two new tokens, neither of them the Project `version` that moves, closes, reopens and edits name — no write of the configuration moves that one, so a client that edits a Stage and then moves the Project with the version it read is served as before.

- **A Stage's own edits.** `ProjectStageSchema` gains `version`. `UpdateProjectStageBodySchema` (`PATCH …/stages/:stageId`) and `SetProjectStageTasksBodySchema` (`PUT …/stages/:stageId/tasks`) take an optional `version` — the Stage's; each write moves it. A body of `PATCH …/stages/:stageId` naming only `version` is still refused as having nothing to change.
- **The Project's sets.** `ProjectDetailSchema` gains `configurationVersion`. `CreateProjectStageBodySchema`, `ReorderProjectStagesBodySchema`, `SetProjectMovesBodySchema`, `SetProjectOrganizationsBodySchema` and `SetProjectMembersBodySchema` take an optional `configurationVersion`; each of those writes, and `DELETE …/stages/:stageId`, moves it. `SetProjectMovesResultSchema` gains `configurationVersion`, the value after the write.

Sent and stale, either token answers `409 PROJECT_CHANGED` and nothing is written; a body without it is served as before. Both start at 1 — a migration adds `project_stages.version` and `projects.configuration_version` with that default.

`PUT …/organizations` changes the set in one transaction: a failure part-way leaves it as it was. The audit trail still records one `projects.project.organization_add` or `projects.project.organization_remove` entry per Organization, now as child Commands of `projects.project.organizations_set`, which records no entry of its own. The Projects admin sends the Stage's version on a Stage or Stage Task edit and the Project's `configurationVersion` on adding and reordering Stages and on the workflow, and reads the Project again on a `409`.
