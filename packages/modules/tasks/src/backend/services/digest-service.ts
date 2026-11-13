import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort, AdminUserRecord, TaskDigestSubscription } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { todayIn } from '../domain/due-moment.js';
import type { TaskAudience } from './mention-service.js';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';
import { actingAdminUserId, type TaskRow } from './task-access.js';
import type { TaskDigestEntry, TaskEmail } from './task-email.js';
import type { TaskNotifier } from './task-notifier.js';

/** The most subscriptions one pass claims. The next pass — fifteen minutes later — takes the rest. */
export const TASK_DIGEST_BATCH_SIZE = 100;

/** The most Tasks one digest lists; a person with more is told the count of those listed. */
export const TASK_DIGEST_TASKS_MAX = 200;

/** The audit object a subscription is recorded under: one per administrator. */
export const TASK_DIGEST_AUDIT_OBJECT_TYPE = 'task_digest_subscription';

/** "Today" in `tasks.time_zone`, and the hour it is there. */
export interface TaskDigestClock {
  /** `YYYY-MM-DD`. */
  today: string;
  /** 0–23. */
  hour: number;
}

/** The digest clock at `now` in `timeZone`. Throws `RangeError` for a zone that is not one. */
export function digestClock(timeZone: string, now: Date): TaskDigestClock {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .find((part) => part.type === 'hour')?.value,
  );
  return { today: todayIn(timeZone, now), hour };
}

/**
 * The subscriptions due at `clock`: their hour has come today and today's
 * digest is not claimed — **the one statement of it**, read by the claim and by
 * the probe. `hour <= :hour`, never `=`, so a pass that falls on a skipped
 * hour (the spring change), a late tick or a restart still sends the day's
 * digest; `last_sent_on < :today` makes it once a day, across the autumn
 * change's repeated hour too.
 */
function dueSubscriptions(clock: TaskDigestClock): WorkRows {
  return {
    from: `from "task_digest_subscriptions" s
            where s."hour" <= ? and (s."last_sent_on" is null or s."last_sent_on" < ?::date)`,
    params: [clock.hour, clock.today],
  };
}

interface DigestTaskRow {
  id: string;
  number: string;
  title: string;
  due_on: string;
  due_at: Date | string | null;
  is_draft: boolean;
  is_private: boolean;
  created_by_admin_user_id: string;
  context_type: string | null;
  context_id: string | null;
}

export interface TaskDigestPassSummary {
  /** Subscriptions this pass claimed for today. */
  claimed: number;
  /** Digests sent: a bell entry, an e-mail, or both. */
  sent: number;
  /** Claimed and sent nothing: no Task due, or a recipient who is no longer active. */
  empty: number;
}

export interface TaskDigestServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** Whether another administrator may see a Task — `tasks:read`, draft/private, the context's say. */
  audience: TaskAudience;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  notifier: Pick<TaskNotifier, 'digest'>;
  email: TaskEmail;
  /** `tasks.time_zone`, read per pass. */
  timeZone: () => Promise<string>;
  log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * The daily digest (`specs/165-task-management/` User Story 7 scenario 5,
 * FR-036, SC-007; research R-18).
 *
 * **Off by default, per person.** No row is off (Q3 = A); `PUT /tasks/me/digest`
 * turns it on at an hour of `tasks.time_zone`, `DELETE` turns it off — each a
 * Command recorded against the administrator.
 *
 * **Once a day, by claiming first.** A pass — at most every fifteen minutes —
 * claims the subscriptions whose hour has come and whose day is not claimed,
 * setting `last_sent_on` to today under `skip locked`, **and commits**; then,
 * for each, lists the person's open, published Tasks assigned to them, due
 * today or before, that they may see, and sends one bell entry and one e-mail.
 *
 * **An empty day closes the day.** The pass looks once, at the person's hour:
 * with nothing due nothing is sent and the day stays claimed, so a Task that
 * falls due later that day is in the next day's digest (as overdue), never in
 * a second one today. Only the current day is ever sent — there is no catch-up
 * after downtime or while Tasks was off.
 *
 * Runs in the system scope the worker enters. The Tasks are read by the
 * claimed person's assignments and each is asked the audience question
 * (`TASK_ACCESS_READERS` names this file). The claim is bookkeeping: a Command
 * with no audit entry, as CRM's sweeps are.
 */
export class TaskDigestService {
  constructor(private readonly deps: TaskDigestServiceDeps) {}

  // --- The caller's own subscription --------------------------------------------

  /** `GET /tasks/me/digest` — `null` when it is off. */
  async mine(): Promise<TaskDigestSubscription> {
    const me = this.#me();
    const rows = (await this.deps.emFactory().execute(
      `select "hour" from "task_digest_subscriptions" where "admin_user_id" = ?`,
      [me],
    )) as Array<{ hour: number }>;
    return rows[0] ? { hour: Number(rows[0].hour) } : null;
  }

  /**
   * `PUT /tasks/me/digest` — on, at `hour`. A change of hour keeps today's
   * claim, so moving the hour never sends a second digest the same day.
   */
  async subscribe(hour: number): Promise<TaskDigestSubscription> {
    const me = this.#me();
    await this.deps.commandBus.run({
      action: 'tasks.digest.subscribe',
      objectType: TASK_DIGEST_AUDIT_OBJECT_TYPE,
      objectId: me,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const before = (await tx.execute(
          `select "hour" from "task_digest_subscriptions" where "admin_user_id" = ? for update`,
          [me],
        )) as Array<{ hour: number }>;
        const previous = before[0] ? Number(before[0].hour) : null;
        if (previous === hour) return { result: undefined, skipAudit: true };
        await tx.execute(
          `insert into "task_digest_subscriptions" ("admin_user_id", "hour", "updated_at") values (?, ?, now())
           on conflict ("admin_user_id") do update set "hour" = excluded."hour", "updated_at" = now()`,
          [me, hour],
        );
        return { result: undefined, before: previous === null ? null : { hour: previous }, after: { hour } };
      },
    });
    return { hour };
  }

  /** `DELETE /tasks/me/digest` — off. */
  async unsubscribe(): Promise<void> {
    const me = this.#me();
    await this.deps.commandBus.run({
      action: 'tasks.digest.unsubscribe',
      objectType: TASK_DIGEST_AUDIT_OBJECT_TYPE,
      objectId: me,
      run: async ({ em }) => {
        const deleted = (await (em as EntityManager).execute(
          `delete from "task_digest_subscriptions" where "admin_user_id" = ? returning "hour"`,
          [me],
        )) as Array<{ hour: number }>;
        if (deleted.length === 0) return { result: undefined, skipAudit: true };
        return { result: undefined, before: { hour: Number(deleted[0]!.hour) }, after: null };
      },
    });
  }

  // --- The pass --------------------------------------------------------------------

  /** The digest clock at `now`, in the zone the setting names. */
  async clock(now: Date = new Date()): Promise<TaskDigestClock> {
    return digestClock(await this.deps.timeZone(), now);
  }

  /** Whether a {@link pass} at `now` would claim anything — yes or no (issue #120). */
  async hasWork(now: Date = new Date()): Promise<boolean> {
    return anyRowExists(this.deps.emFactory(), [dueSubscriptions(await this.clock(now))]);
  }

  /** One pass. `now` is the clock, handed in so that a test needs no sleep. */
  async pass(now: Date = new Date()): Promise<TaskDigestPassSummary> {
    const summary: TaskDigestPassSummary = { claimed: 0, sent: 0, empty: 0 };
    const timeZone = await this.deps.timeZone();
    const clock = digestClock(timeZone, now);
    const claimed = await this.#claim(clock);
    summary.claimed = claimed.length;
    if (claimed.length === 0) return summary;

    const people = new Map((await this.deps.adminUsers.findByIds(claimed)).map((person) => [person.id, person]));
    for (const adminUserId of claimed) {
      try {
        const person = people.get(adminUserId);
        const tasks = person && isActive(person) ? await this.#dueFor(adminUserId, clock.today) : [];
        if (tasks.length === 0 || !person) {
          summary.empty += 1;
          continue;
        }
        await this.deps.notifier.digest({ targetAdminUserId: adminUserId, count: tasks.length });
        await this.deps.email.digest({
          adminUserId,
          to: person.email,
          preferredLanguage: person.preferredLanguage ?? null,
          date: clock.today,
          timeZone,
          tasks,
        });
        summary.sent += 1;
      } catch (error) {
        // The day is claimed and is not sent twice; a module switched off is never absorbed.
        rethrowIfModuleDisabled(error);
        this.deps.log('tasks: sending a daily digest raised', {
          adminUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return summary;
  }

  /** Claim today's digest of the subscriptions due, and commit before anything is sent. */
  async #claim(clock: TaskDigestClock): Promise<string[]> {
    const due = dueSubscriptions(clock);
    return this.deps.commandBus.run({
      action: 'tasks.digest.claim',
      objectType: TASK_DIGEST_AUDIT_OBJECT_TYPE,
      objectId: 'sweep',
      run: async ({ em }) => {
        const rows = (await (em as EntityManager).execute(
          `update "task_digest_subscriptions" c set "last_sent_on" = ?::date
             from (select s."admin_user_id" ${due.from}
                    order by s."admin_user_id" limit ? for update skip locked) d
            where c."admin_user_id" = d."admin_user_id"
        returning c."admin_user_id"`,
          [clock.today, ...due.params, TASK_DIGEST_BATCH_SIZE],
        )) as Array<{ admin_user_id: string }>;
        return { result: rows.map((row) => row.admin_user_id), skipAudit: true };
      },
    });
  }

  /**
   * The person's open, published Tasks assigned to them, due `today` or before
   * (a due time's date is its day in `tasks.time_zone`), each one they may see.
   */
  async #dueFor(adminUserId: string, today: string): Promise<TaskDigestEntry[]> {
    const rows = (await this.deps.emFactory().execute(
      `select t."id", t."number", t."title", to_char(t."due_on", 'YYYY-MM-DD') as "due_on", t."due_at",
              t."is_draft", t."is_private", t."created_by_admin_user_id", t."context_type", t."context_id"
         from "tasks" t
         join "task_assignees" a on a."task_id" = t."id" and a."admin_user_id" = ?
        where not t."is_draft" and t."due_on" <= ?::date
          and not exists (select 1 from "task_statuses" cs
                           where cs."code" = t."status" and cs."category" in ('done', 'cancelled'))
        order by t."due_on", t."due_at" nulls last, t."number"
        limit ?`,
      [adminUserId, today, TASK_DIGEST_TASKS_MAX],
    )) as DigestTaskRow[];
    const visible: TaskDigestEntry[] = [];
    for (const row of rows) {
      const facts: Pick<TaskRow, 'created_by_admin_user_id' | 'is_draft' | 'is_private' | 'context_type' | 'context_id'> = row;
      if (!(await this.deps.audience(adminUserId, facts))) continue;
      visible.push({
        taskId: row.id,
        number: row.number,
        title: row.title,
        dueOn: row.due_on,
        dueAt: row.due_at === null ? null : new Date(row.due_at),
      });
    }
    return visible;
  }

  #me(): string {
    const me = actingAdminUserId();
    if (me === null) throw new Error('tasks: a digest belongs to an administrator; the ambient actor is none.');
    return me;
  }
}

function isActive(person: AdminUserRecord): boolean {
  return person.status === 'active' && person.deletedAt === null;
}
