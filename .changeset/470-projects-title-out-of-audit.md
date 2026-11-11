---
'@endora-commerce/mod-projects': minor
---

Issue #470 (D-288; owner ruling O-1, 2026-11-10: a title is a value) — a project's audit entries no longer carry its title.

- The Project audit snapshot drops `title`. `projects.project.create` and `projects.project.update` name a title change in `changedFields` (`['title']`, beside `'value'`). The title before and after goes to the existing `project_value_changes` store (`ProjectValueState.title`), and the entry points at it by `valueChangeId`.
- `GET /api/v1/admin/projects/:id/history` serves the title from that store, as it already does the value. No migration is needed.
- Audit entries written before the upgrade keep their title (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new project entries name a project by its number instead of its title. The project's **Change history** tab is unchanged. See *Project titles leave the platform audit log* in the upgrade guide.
