---
'@endora-commerce/mod-tasks': minor
---

Changing `tasks.time_zone` now re-derives what Tasks counted in the old zone (issue #505), by any
write path — the Tasks *General settings* screen, `PUT /api/v1/admin/tasks/settings/time-zone`
or the generic settings write:

- a relative reminder on a Task with a due date alone counts from 09:00 of that date in the new
  zone; its delivery rows go, so it fires again at the new moment;
- `due_on` of a Task with a due time becomes that time's date in the new zone.

The work is a new first pass of the `tasks-reminders` tick, so it lands within a minute. Each Task
changed gets one `tasks.task.update` audit entry with `reason: 'time_zone_changed'`, its `dueOn`
before and after and `remindersMoved`. New exports: `TaskTimeZoneRederiveService`
(`services/time-zone-rederive-service.ts`), `rederiveTaskDueCommand` and
`TASKS_REDERIVE_SCOPE_REASON`. `TasksRemindersJobDeps` gains a required `rederive` pass, and
`followDueMoment` now answers how many relative reminders it moved.
