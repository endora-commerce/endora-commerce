import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ADMIN_PERMISSION_WILDCARD,
  ERROR_CODES,
  TASK_REMINDER_GRACE_MS,
  TASK_REMINDERS_MAX,
  type AdminNotificationRecordPort,
  type AdminUserReadPort,
  type AdminUserRecord,
  type CreateTaskReminderBody,
  type PermissionReadPort,
  type TaskReminder,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { randomUUID } from 'crypto';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { lockedTask } from './task-commands.js';
import type { TaskAudience } from './mention-service.js';
import { dueMomentOf } from './reminder-schedule.js';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';
import { actingAdminUserId, isUuid, requireActingAdmin, type TaskAccess, type TaskRow } from './task-access.js';
import type { TaskEmail } from './task-email.js';
import { TASK_AUDIT_OBJECT_TYPE } from './task-history-service.js';
import { taskLinkPath, taskNotificationText } from './task-notifier.js';

/** The most (reminder, recipient) pairs one pass handles. The next tick — a minute later — takes the rest. */
export const TASK_REMINDER_BATCH_SIZE = 200;

const TASKS_WRITE_PERMISSION = 'tasks:write';

function reminderInvalid(reason: 'recipients' | 'too_many' | 'no_due_moment', message: string): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_REMINDER_INVALID, message, [{ path: 'reminder', issue: reason }]);
}

function personName(person: Pick<AdminUserRecord, 'firstName' | 'lastName' | 'email'>): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

function isActive(person: AdminUserRecord): boolean {
  return person.status === 'active' && person.deletedAt === null;
}

/** One `task_reminders` row as it is read for a reader. */
interface ReminderRow {
  id: string;
  task_id: string;
  created_by_admin_user_id: string;
  mode: 'absolute' | 'relative';
  remind_at: Date | string;
  offset_minutes: number | null;
  recipient_admin_user_ids: string[];
  created_at: Date | string;
  done: boolean;
}

const REMINDER_COLUMNS = `r."id", r."task_id", r."created_by_admin_user_id", r."mode", r."remind_at", r."offset_minutes",
  r."recipient_admin_user_ids", r."created_at",
  not exists (select 1 from unnest(r."recipient_admin_user_ids") as u("admin_user_id")
               where not exists (select 1 from "task_reminder_deliveries" d
                                  where d."reminder_id" = r."id" and d."admin_user_id" = u."admin_user_id")) as "done"`;

/**
 * The (reminder, recipient) pairs due at `now` that nobody has handled yet —
 * **the one statement of it**, read by the pass to act and by the probe to ask
 * whether there is anything to act on, so the two cannot drift.
 */
function duePairs(now: Date): WorkRows {
  return {
    from: `from "task_reminders" r
             join "tasks" t on t."id" = r."task_id"
             cross join lateral unnest(r."recipient_admin_user_ids") as u("admin_user_id")
            where r."remind_at" <= ?
              and not exists (select 1 from "task_reminder_deliveries" d
                               where d."reminder_id" = r."id" and d."admin_user_id" = u."admin_user_id")`,
    params: [now],
  };
}

/** A due pair, with what deciding and telling need. */
interface DuePairRow {
  reminder_id: string;
  admin_user_id: string;
  remind_at: Date | string;
  task_id: string;
  number: string;
  title: string;
  due_on: string | null;
  due_at: Date | string | null;
  is_draft: boolean;
  is_private: boolean;
  closed: boolean;
  created_by_admin_user_id: string;
  context_type: string | null;
  context_id: string | null;
}

export interface TaskReminderSweepSummary {
  /** Bell and e-mail sent (or the bell alone while the e-mail could not go). */
  delivered: number;
  /** Recorded and not sent: the Task closed or a draft, or the recipient may not see it. */
  skipped: number;
  /** Recorded and not sent: more than `TASK_REMINDER_GRACE_MS` late. */
  expired: number;
  /** Another pass claimed it first. */
  lost: number;
}

export interface TaskReminderServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange'>;
  /** Whether another administrator may see a Task — `tasks:read`, draft/private, the context's say. */
  audience: TaskAudience;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  permissions: PermissionReadPort;
  /** `admin_notifications`' record port: the bell entry, written on the delivery's own transaction. */
  bell: AdminNotificationRecordPort<EntityManager>;
  /** Whether `admin_notifications` is present — asked before the bell, never caught behind it. */
  bellPresent: () => boolean;
  email: TaskEmail;
  /** `tasks.time_zone`, read per call. */
  timeZone: () => Promise<string>;
  log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * Reminders on a Task (`specs/165-task-management/` User Story 7, FR-034,
 * FR-035, SC-004; research R-17).
 *
 * **Setting them.** A writer adds a reminder at a moment or some minutes
 * before the due moment (09:00 of a date-only due date in `tasks.time_zone`),
 * for recipients among themselves and the Task's assignees, at most ten per
 * Task; the reminder's creator or any writer removes it. Each is a Command on
 * the Task, so its history shows it. A relative reminder follows the due
 * moment inside the Command that moves it (`reminder-schedule.ts`).
 *
 * **Delivering them — exactly once to the bell, at most once by e-mail.** A
 * pass reads the (reminder, recipient) pairs due and not yet handled, and for
 * each writes one `task_reminder_deliveries` row, whose unique key is the
 * claim:
 *
 *  - more than {@link TASK_REMINDER_GRACE_MS} late — after downtime, or while
 *    Tasks was off — it is `expired` and nothing is sent, so nothing piles up
 *    to be sent later (US7 scenario 6);
 *  - a closed Task, a draft, or a recipient who is no longer active, may not
 *    read Tasks or may not see this one (its context, a private Task) — it is
 *    `skipped` (scenario 4);
 *  - otherwise it is `delivered`: the row and the bell entry are written in
 *    **one** transaction, through `admin_notifications`' co-transactional
 *    `recordWithin`, so a concurrent pass that finds the row taken writes no
 *    bell — the bell is exactly once; the e-mail is sent after the commit, with
 *    the delivery row as its message id — a crash between the two loses the
 *    e-mail, never doubles it.
 *
 * The pass runs in the system scope the worker enters; every statement over a
 * Task-owned table here reads by ids the pass found or `TaskAccess` handed out
 * (`TASK_ACCESS_READERS` names this file). Delivery rows are bookkeeping, not
 * a change to a Task: Commands with no audit entry, as CRM's and Projects'
 * sweeps are.
 */
export class TaskReminderService {
  constructor(private readonly deps: TaskReminderServiceDeps) {}

  // --- Setting reminders --------------------------------------------------------

  /** `GET /tasks/:id/reminders` — the caller's own reminders and those that name the caller. */
  async list(taskId: string): Promise<TaskReminder[]> {
    const task = await this.deps.access.loadVisible(taskId);
    return this.forReader(task.id);
  }

  /** The reminders of a Task the caller has already loaded that the caller may be shown (admin-api §1). */
  async forReader(taskId: string): Promise<TaskReminder[]> {
    const me = actingAdminUserId();
    if (me === null) return [];
    const rows = (await this.deps.emFactory().execute(
      `select ${REMINDER_COLUMNS} from "task_reminders" r
        where r."task_id" = ? and (r."created_by_admin_user_id" = ? or ? = any(r."recipient_admin_user_ids"))
        order by r."remind_at", r."created_at", r."id"`,
      [taskId, me, me],
    )) as ReminderRow[];
    return this.#shape(rows);
  }

  /** `POST /tasks/:id/reminders`. */
  async add(taskId: string, body: CreateTaskReminderBody, caller: CallerOptions = {}): Promise<TaskReminder> {
    // `created_by_admin_user_id` is not null: with nobody behind the call (a
    // worker under the bare system scope) it is 403 before anything is read
    // (`specs/186-aggregate-ports/` R-23.2).
    const me = requireActingAdmin('A reminder is set by an administrator.');
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);

    const assignees = await this.#assigneesOf(task.id);
    const allowed = new Set([me, ...assignees]);
    if (body.recipientIds.some((id) => !allowed.has(id))) {
      throw reminderInvalid('recipients', 'A reminder goes to you or to the task’s assignees, and to nobody else.');
    }
    let remindAt: Date;
    if (body.offsetMinutes !== undefined) {
      const moment = dueMomentOf(
        { dueOn: task.due_on, dueAt: task.due_at === null ? null : new Date(task.due_at) },
        await this.deps.timeZone(),
      );
      if (moment === null) {
        throw reminderInvalid('no_due_moment', 'A reminder before the due date needs a task with a due date.');
      }
      remindAt = new Date(moment.getTime() - body.offsetMinutes * 60_000);
    } else {
      remindAt = new Date(body.remindAt!);
    }
    const id = randomUUID();
    const mode = body.offsetMinutes !== undefined ? 'relative' : 'absolute';
    const offsetMinutes = body.offsetMinutes ?? null;

    await this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.reminder.add',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        // Under the Task's lock, so two adds at once cannot both be the tenth.
        await lockedTask(tx, task.id);
        const [{ count }] = (await tx.execute(
          `select count(*)::int as "count" from "task_reminders" where "task_id" = ?`,
          [task.id],
        )) as [{ count: number }];
        if (count >= TASK_REMINDERS_MAX) {
          throw reminderInvalid('too_many', `A task has at most ${TASK_REMINDERS_MAX} reminders.`);
        }
        await tx.execute(
          `insert into "task_reminders" ("id", "task_id", "created_by_admin_user_id", "mode", "remind_at",
                                         "offset_minutes", "recipient_admin_user_ids", "created_at")
           values (?, ?, ?, ?, ?, ?, ?::uuid[], now())`,
          [id, task.id, me, mode, remindAt, offsetMinutes, `{${body.recipientIds.join(',')}}`],
        );
        return {
          result: undefined,
          before: null,
          after: {
            reminderId: id,
            mode,
            remindAt: remindAt.toISOString(),
            offsetMinutes,
            recipientIds: [...body.recipientIds],
            createdById: me,
          },
        };
      },
    }, caller));
    const [created] = await this.#byIds(task.id, [id]);
    return created!;
  }

  /** `DELETE /tasks/:id/reminders/:reminderId` — the reminder's creator, or a writer. */
  async remove(taskId: string, reminderId: string): Promise<void> {
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    const me = actingAdminUserId();
    const [reminder] = isUuid(reminderId) ? await this.#byIds(task.id, [reminderId]) : [];
    if (!reminder) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'This task has no such reminder.');
    if (reminder.createdBy?.id !== me && !(await this.#mayWrite(me))) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only the person who set this reminder, or a task editor, may remove it.');
    }
    await this.deps.commandBus.run({
      action: 'tasks.reminder.remove',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em }) => {
        const deleted = (await (em as EntityManager).execute(
          `delete from "task_reminders" where "id" = ? and "task_id" = ? returning "id"`,
          [reminder.id, task.id],
        )) as unknown[];
        if (deleted.length === 0) return { result: undefined, skipAudit: true };
        return {
          result: undefined,
          before: {
            reminderId: reminder.id,
            mode: reminder.mode,
            remindAt: reminder.remindAt,
            offsetMinutes: reminder.offsetMinutes,
            recipientIds: reminder.recipients.map((r) => r.id),
            createdById: reminder.createdBy?.id ?? null,
          },
          after: null,
        };
      },
    });
  }

  // --- Delivering them ------------------------------------------------------------

  /**
   * Whether a {@link sweep} at `now` would handle anything — **yes or no, and
   * nothing else** (issue #120): asked before the worker opens its system
   * scope, outside any tenant context, over the pass's own row source.
   */
  async hasWork(now: Date = new Date()): Promise<boolean> {
    return anyRowExists(this.deps.emFactory(), [duePairs(now)]);
  }

  /** One pass. `now` is the clock, handed in so that a test needs no sleep. */
  async sweep(now: Date = new Date()): Promise<TaskReminderSweepSummary> {
    const summary: TaskReminderSweepSummary = { delivered: 0, skipped: 0, expired: 0, lost: 0 };
    const due = duePairs(now);
    const pairs = (await this.deps.emFactory().execute(
      `select r."id" as "reminder_id", u."admin_user_id", r."remind_at", t."id" as "task_id", t."number", t."title",
              to_char(t."due_on", 'YYYY-MM-DD') as "due_on", t."due_at", t."is_draft", t."is_private",
              t."created_by_admin_user_id", t."context_type", t."context_id",
              exists (select 1 from "task_statuses" cs
                       where cs."code" = t."status" and cs."category" in ('done', 'cancelled')) as "closed"
         ${due.from}
        order by r."remind_at", r."id", u."admin_user_id"
        limit ?`,
      [...due.params, TASK_REMINDER_BATCH_SIZE],
    )) as DuePairRow[];
    if (pairs.length === 0) return summary;

    const graceStart = now.getTime() - TASK_REMINDER_GRACE_MS;
    const expired = pairs.filter((pair) => new Date(pair.remind_at).getTime() < graceStart);
    const current = pairs.filter((pair) => new Date(pair.remind_at).getTime() >= graceStart);
    summary.expired += await this.#record(expired, 'expired');

    const people = new Map(
      (await this.deps.adminUsers.findByIds([...new Set(current.map((pair) => pair.admin_user_id))])).map((person) => [
        person.id,
        person,
      ]),
    );
    const skipped: DuePairRow[] = [];
    const deliverable: Array<{ pair: DuePairRow; person: AdminUserRecord }> = [];
    for (const pair of current) {
      const person = people.get(pair.admin_user_id);
      if (!person || !isActive(person) || pair.closed || pair.is_draft || !(await this.#maySee(pair))) {
        skipped.push(pair);
      } else {
        deliverable.push({ pair, person });
      }
    }
    summary.skipped += await this.#record(skipped, 'skipped');

    const timeZone = deliverable.length > 0 ? await this.deps.timeZone() : null;
    for (const { pair, person } of deliverable) {
      try {
        const deliveryId = await this.#deliver(pair);
        if (deliveryId === null) {
          summary.lost += 1;
          continue;
        }
        summary.delivered += 1;
        await this.deps.email.reminder({
          deliveryId,
          taskId: pair.task_id,
          adminUserId: person.id,
          to: person.email,
          preferredLanguage: person.preferredLanguage ?? null,
          number: pair.number,
          title: pair.title,
          dueOn: pair.due_on,
          dueAt: pair.due_at === null ? null : new Date(pair.due_at),
          timeZone: timeZone!,
        });
      } catch (error) {
        // A module switched off under a delivery is never absorbed; anything
        // else costs this pair alone — its row was not written, so the next
        // tick takes it again.
        rethrowIfModuleDisabled(error);
        this.deps.log('tasks: delivering a reminder raised', {
          reminderId: pair.reminder_id,
          adminUserId: pair.admin_user_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return summary;
  }

  /**
   * One delivery: the row — the claim — and the bell entry on one transaction.
   * `null` when the row was there already: another pass delivered it, and this
   * one writes no bell and sends no e-mail.
   */
  async #deliver(pair: DuePairRow): Promise<string | null> {
    const bell = this.deps.bellPresent();
    return this.deps.commandBus.run({
      action: 'tasks.reminder.deliver',
      objectType: 'task_reminder',
      objectId: pair.reminder_id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const inserted = (await tx.execute(
          `insert into "task_reminder_deliveries" ("id", "reminder_id", "admin_user_id", "outcome", "recorded_at")
           values (?, ?, ?, 'delivered', now())
           on conflict ("reminder_id", "admin_user_id") do nothing
           returning "id"`,
          [randomUUID(), pair.reminder_id, pair.admin_user_id],
        )) as Array<{ id: string }>;
        const deliveryId = inserted[0]?.id ?? null;
        if (deliveryId !== null && bell) {
          const text = taskNotificationText.reminder(pair.number);
          this.deps.bell.recordWithin(tx, {
            audience: 'admin_user',
            targetAdminUserId: pair.admin_user_id,
            kind: 'tasks.task.reminder',
            subjectType: 'task',
            subjectId: pair.task_id,
            title: text.title,
            titleMessage: text.titleMessage,
            linkPath: taskLinkPath(pair.task_id),
          });
        }
        return { result: deliveryId, skipAudit: true };
      },
    });
  }

  /** Record `pairs` as handled with `outcome` and nothing sent. Answers how many rows this pass wrote. */
  async #record(pairs: readonly DuePairRow[], outcome: 'expired' | 'skipped'): Promise<number> {
    if (pairs.length === 0) return 0;
    return this.deps.commandBus.run({
      action: `tasks.reminder.${outcome === 'expired' ? 'expire' : 'skip'}`,
      objectType: 'task_reminder',
      objectId: 'sweep',
      run: async ({ em }) => {
        const values = pairs.map(() => `(?::uuid, ?::uuid, ?::uuid, ?, now())`).join(', ');
        const inserted = (await (em as EntityManager).execute(
          `insert into "task_reminder_deliveries" ("id", "reminder_id", "admin_user_id", "outcome", "recorded_at")
           values ${values}
           on conflict ("reminder_id", "admin_user_id") do nothing
           returning "id"`,
          pairs.flatMap((pair) => [randomUUID(), pair.reminder_id, pair.admin_user_id, outcome]),
        )) as unknown[];
        return { result: inserted.length, skipAudit: true };
      },
    });
  }

  /** Whether the recipient may see the Task now: `tasks:read`, the draft/private rule, the context's say. */
  async #maySee(pair: DuePairRow): Promise<boolean> {
    return this.deps.audience(pair.admin_user_id, {
      created_by_admin_user_id: pair.created_by_admin_user_id,
      is_draft: pair.is_draft,
      is_private: pair.is_private,
      context_type: pair.context_type,
      context_id: pair.context_id,
    } satisfies Pick<TaskRow, 'created_by_admin_user_id' | 'is_draft' | 'is_private' | 'context_type' | 'context_id'>);
  }

  // --- Reads --------------------------------------------------------------------

  async #assigneesOf(taskId: string): Promise<string[]> {
    const rows = (await this.deps.emFactory().execute(
      `select "admin_user_id" from "task_assignees" where "task_id" = ?`,
      [taskId],
    )) as Array<{ admin_user_id: string }>;
    return rows.map((row) => row.admin_user_id);
  }

  async #byIds(taskId: string, ids: readonly string[]): Promise<TaskReminder[]> {
    const rows = (await this.deps.emFactory().execute(
      `select ${REMINDER_COLUMNS} from "task_reminders" r where r."task_id" = ? and r."id" = any(?::uuid[])`,
      [taskId, `{${ids.join(',')}}`],
    )) as ReminderRow[];
    return this.#shape(rows);
  }

  async #mayWrite(adminUserId: string | null): Promise<boolean> {
    if (adminUserId === null) return false;
    const held = await this.deps.permissions.listPermissions(adminUserId);
    return held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(TASKS_WRITE_PERMISSION);
  }

  async #shape(rows: readonly ReminderRow[]): Promise<TaskReminder[]> {
    const ids = [...new Set(rows.flatMap((row) => [row.created_by_admin_user_id, ...row.recipient_admin_user_ids]))];
    const people = new Map(
      (ids.length > 0 ? await this.deps.adminUsers.findByIds(ids) : []).map((person) => [person.id, person]),
    );
    return rows.map((row) => {
      const creator = people.get(row.created_by_admin_user_id);
      return {
        id: row.id,
        mode: row.mode,
        remindAt: new Date(row.remind_at).toISOString(),
        offsetMinutes: row.offset_minutes === null ? null : Number(row.offset_minutes),
        recipients: row.recipient_admin_user_ids.map((id) => {
          const person = people.get(id);
          return { id, name: person ? personName(person) : '', active: person ? isActive(person) : false };
        }),
        createdBy: creator ? { id: creator.id, name: personName(creator) } : null,
        done: Boolean(row.done),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }
}
