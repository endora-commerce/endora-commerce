---
'@endora-commerce/mod-projects': minor
---

Issue #1226 (D-288; owner rulings O-1 and O-4) — a project's audit entries no longer carry the free text of its stages, stage tasks and attachments.

- `projects.project.stage_move`, `close` and `reopen` drop `stageName`; `projects.project.create` records `stageIds` in place of `stages` (the list of stage names); `stage_create`, `stage_update` and `stage_delete` drop `name`; each task under `tasks` of `stage_tasks_set` drops `title` and is named by `position`; `attachment_add` drops `fileName`.
- A stage's name, a stage's task titles and an attachment's file name go to the existing `project_value_changes` store (`ProjectValueState.name`, `.taskTitles`, `.fileName`), written in the same Command. The entry names them in `changedFields` (`['name']`, `['taskTitles']`, `['fileName']`) and points at the row by `valueChangeId`; a deleted stage's entry carries both on its state before. No migration is needed.
- `GET /api/v1/admin/projects/:id/history` serves those names from the store in the shape older entries carried: `name` on a stage's entries, `title` on each task under `tasks`, `fileName` on `attachment_add`.
- An internal `PROJECTS_AUDIT_KEYS` allowlist (not exported from the package) lists every key a `projects.project.*` audit state may carry, held by sentinel tests (`specs/conventions/audit-state.md` §6).
- Audit entries written before the upgrade keep their names (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new project entries name a stage by id, a stage task by position and a file by id. The project's **Change history** tab still names them; a stage task whose title a change did not touch is named by its place. See *Stage names, task titles and file names leave the project audit entries* in the upgrade guide.
