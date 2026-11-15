import type { EntityManager } from '@mikro-orm/postgresql';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { dateOnlyMoment } from '../domain/due-moment.js';
import { TASK_AUDIT_OBJECT_TYPE } from './task-history-service.js';

/**
 * The moment a relative reminder counts back from (data-model §5): the due
 * time when the Task has one, else 09:00 of its due date in `tasks.time_zone`,
 * else none.
 */
export function dueMomentOf(due: { dueOn: string | null; dueAt: Date | null }, timeZone: string): Date | null {
  if (due.dueAt) return due.dueAt;
  return due.dueOn ? dateOnlyMoment(due.dueOn, timeZone) : null;
}

/**
 * Keep a Task's relative reminders on its due moment (`specs/165-task-management/`
 * US7 scenario 3, research R-17) — run **inside** the Command that changed the
 * due date or time, on its transaction, by the id that Command locked.
 *
 * - **A new moment** moves each relative reminder to it, less its offset. A
 *   reminder whose moment moved is a new reminder: its delivery rows go, so it
 *   fires again at the new moment (a reminder already sent for an old due date
 *   says nothing about the new one).
 * - **No moment any more** removes them, each with an audit row
 *   `tasks.reminder.removed_with_due` on the Task, which its history shows —
 *   that is how the reminder's creator is told on the Task.
 *
 * Absolute reminders are the caller's chosen moments and are never touched.
 * Answers how many relative reminders moved (none when they were removed).
 */
export async function followDueMoment(
  em: EntityManager,
  auditLog: AuditPort,
  taskId: string,
  moment: Date | null,
): Promise<number> {
  if (moment === null) {
    const removed = (await em.execute(
      `delete from "task_reminders" where "task_id" = ? and "mode" = 'relative'
       returning "id", "offset_minutes", "remind_at", "recipient_admin_user_ids", "created_by_admin_user_id"`,
      [taskId],
    )) as Array<{
      id: string;
      offset_minutes: number;
      remind_at: Date | string;
      recipient_admin_user_ids: string[];
      created_by_admin_user_id: string;
    }>;
    for (const row of removed) {
      recordAuditFromContext(auditLog, em, {
        action: 'tasks.reminder.removed_with_due',
        objectType: TASK_AUDIT_OBJECT_TYPE,
        objectId: taskId,
        stateBefore: {
          reminderId: row.id,
          mode: 'relative',
          offsetMinutes: Number(row.offset_minutes),
          remindAt: new Date(row.remind_at).toISOString(),
          recipientIds: row.recipient_admin_user_ids,
          createdById: row.created_by_admin_user_id,
        },
        stateAfter: null,
      });
    }
    return 0;
  }
  const moved = (await em.execute(
    `with "moved" as (
       update "task_reminders"
          set "remind_at" = ?::timestamptz - make_interval(mins => "offset_minutes")
        where "task_id" = ? and "mode" = 'relative'
          and "remind_at" <> ?::timestamptz - make_interval(mins => "offset_minutes")
       returning "id"
     ), "rearmed" as (
       delete from "task_reminder_deliveries" d using "moved" m where d."reminder_id" = m."id"
     )
     select count(*)::int as "moved" from "moved"`,
    [moment, taskId, moment],
  )) as Array<{ moved?: number | string }>;
  return Number(moved[0]?.moved ?? 0);
}
