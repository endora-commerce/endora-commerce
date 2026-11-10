---
'@endora-commerce/mod-tasks': minor
---

Issue #470 (D-288; owner ruling O-1, 2026-11-10: a title is a value) — a task's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without regard to what the reader may see.

- `tasks.task.create`, `tasks.task.update`, `tasks.task.status_change`, `tasks.task.delete`, `tasks.task.custom_fields_change` and `tasks.attachment.add` no longer record the title, the context note, custom field values or an attachment's file name. They record `changedFields` / `changedCustomFields` and a `valueChangeId` instead. `TASKS_AUDIT_KEYS` is the snapshot's allowlist.
- The values go to a new table owned by the Tasks module, `task_value_changes` (`TaskValueChange`, `@RuleScoped` like the task, `on delete cascade`). The same Command writes it. The migration `Migration20261110T054810TasksValueChanges` creates it.
- `GET /api/v1/admin/tasks/:id/history` reads the values back by the task's own id, after `findVisibleRow`, and serves them in the shape entries had before. A context the reader may not see is still blanked, its note included.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new task entries show field names instead of values. The task's own **History** tab is unchanged. See *Task values leave the platform audit log* in the upgrade guide.
