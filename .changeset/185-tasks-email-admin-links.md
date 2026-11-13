---
'@endora-commerce/mod-tasks': minor
---

The Task e-mails link into the admin panel (follow-up to issue #185). With `ADMIN_BASE_URL` set:

- `tasks_task_reminder` sends `task.adminUrl` (`<ADMIN_BASE_URL>/tasks/<taskId>`). The default
  template shows an **Open the task** / **Otwórz zadanie** button to it.
- `tasks_daily_digest` sends `digest.adminUrl` (`<ADMIN_BASE_URL>/tasks/mine`) and an `adminUrl`
  on each item of `digest.tasks` (`<ADMIN_BASE_URL>/tasks/<taskId>`). In the default template
  each listed task's number and title link to the task, and an **Open My tasks** /
  **Otwórz Moje zadania** button opens *My tasks*.

With `ADMIN_BASE_URL` unset none of these variables is sent. The digest lines are then plain text
and the buttons are left out. A customised template that does not name the variables renders as
before. `TaskDigestEntry` gains a required `taskId`.
