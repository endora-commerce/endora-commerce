import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';
import { rederiveTaskDueCommand } from './task-commands.js';

/**
 * The time-zone pass — what Tasks counted in `tasks.time_zone` follows a
 * change of it (issue #505; `specs/165-task-management/` data-model §5,
 * research R-17).
 *
 * Two things are derived in the zone when a due date or time is written, and
 * are re-derived here once the zone has changed:
 *
 * - `due_on` of a Task with a due time — that time's date in the zone;
 * - `remind_at` of a relative reminder on a date-only Task — 09:00 of its due
 *   date in the zone, less the offset.
 *
 * **A pass of the `tasks-reminders` tick, not an event handler** (Constitution
 * X, the module's own rule that BullMQ is the clock and the tables are the
 * schedule): the probe asks whether anything is out of step with the zone as
 * it is now, so a change by any path — the Tasks screen, the generic settings
 * write — is caught, and so is one made while Tasks was off, or a Task written
 * with the old zone in the instant the setting changed. It runs first on every
 * tick, so a reminder the zone moved is not sent at its old moment.
 *
 * **The zone arithmetic of the pass is Postgres's**, as the overdue filter's
 * is (`task-service.ts`), so the probe and the pass answer the same question
 * and a pass leaves nothing for the next probe to find.
 *
 * Tasks are walked by id, {@link REDERIVE_BATCH} at a time; each is one
 * `tasks.task.update` Command, as the system, `reason: 'time_zone_changed'`,
 * which re-reads the Task under its lock and leaves one that moved meanwhile.
 */

/** Tasks re-derived per read. */
export const REDERIVE_BATCH = 500;

export interface TaskTimeZoneRederiveServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** The kernel's audit port — handed to {@link rederiveTaskDueCommand} with the reminders. */
  auditLog: AuditPort;
  /** `tasks.time_zone`, read per pass. */
  timeZone: () => Promise<string>;
}

export interface TaskTimeZoneRederivePassSummary {
  rederived: number;
}

/** 09:00 of `t."due_on"` in the zone (the zone is the parameter). */
const DATE_ONLY_MOMENT = `(("t"."due_on" + time '09:00') at time zone ?)`;
/** `t."due_at"`'s date in the zone (the zone is the parameter). */
const DUE_ON_OF_MOMENT = `("t"."due_at" at time zone ?)::date`;

/** A Task with a due time whose `due_on` is not that time's date in `timeZone`. */
function driftedDueOn(timeZone: string): WorkRows {
  return {
    from: `from "tasks" "t" where "t"."due_at" is not null and "t"."due_on" is distinct from ${DUE_ON_OF_MOMENT}`,
    params: [timeZone],
  };
}

/** A relative reminder on a date-only Task that does not count from 09:00 of its due date in `timeZone`. */
function driftedReminders(timeZone: string): WorkRows {
  return {
    from: `from "task_reminders" "r" join "tasks" "t" on "t"."id" = "r"."task_id"
      where "r"."mode" = 'relative' and "t"."due_at" is null and "t"."due_on" is not null
        and "r"."remind_at" <> ${DATE_ONLY_MOMENT} - make_interval(mins => "r"."offset_minutes")`,
    params: [timeZone],
  };
}

interface DriftedRow {
  id: string;
  due_on: string | null;
  due_at: Date | string | null;
  derived_due_on: string | null;
  moment: Date | string | null;
}

export class TaskTimeZoneRederiveService {
  constructor(private readonly deps: TaskTimeZoneRederiveServiceDeps) {}

  /**
   * Whether a pass would have anything to do — yes or no, outside any scope
   * (issue #120): a Task or a relative reminder out of step with the zone.
   */
  async hasWork(): Promise<boolean> {
    const timeZone = await this.deps.timeZone();
    return anyRowExists(this.deps.emFactory(), [driftedDueOn(timeZone), driftedReminders(timeZone)]);
  }

  /** One pass, in the system scope. */
  async pass(): Promise<TaskTimeZoneRederivePassSummary> {
    const timeZone = await this.deps.timeZone();
    const summary: TaskTimeZoneRederivePassSummary = { rederived: 0 };
    let after: string | null = null;
    for (;;) {
      const rows = await this.#drifted(timeZone, after);
      if (rows.length === 0) break;
      after = rows[rows.length - 1]!.id;
      for (const row of rows) {
        const changed = await this.deps.commandBus.run(
          rederiveTaskDueCommand(
            row.id,
            {
              seen: { dueOn: row.due_on, dueAt: row.due_at === null ? null : new Date(row.due_at).toISOString() },
              dueOn: row.derived_due_on,
              moment: row.moment === null ? null : new Date(row.moment),
            },
            this.deps.auditLog,
          ),
        );
        if (changed) summary.rederived += 1;
      }
      if (rows.length < REDERIVE_BATCH) break;
    }
    return summary;
  }

  /** The next batch of Tasks out of step with `timeZone`, in id order, after `after`, with what the zone makes of them. */
  async #drifted(timeZone: string, after: string | null): Promise<DriftedRow[]> {
    return (await this.deps.emFactory().execute(
      `select "t"."id", to_char("t"."due_on", 'YYYY-MM-DD') as "due_on", "t"."due_at",
              case when "t"."due_at" is not null then to_char(${DUE_ON_OF_MOMENT}, 'YYYY-MM-DD') end as "derived_due_on",
              case when "t"."due_at" is null and "t"."due_on" is not null then ${DATE_ONLY_MOMENT} end as "moment"
         from "tasks" "t"
        where (("t"."due_at" is not null and "t"."due_on" is distinct from ${DUE_ON_OF_MOMENT})
           or ("t"."due_at" is null and "t"."due_on" is not null and exists (
                 select 1 from "task_reminders" "r"
                  where "r"."task_id" = "t"."id" and "r"."mode" = 'relative'
                    and "r"."remind_at" <> ${DATE_ONLY_MOMENT} - make_interval(mins => "r"."offset_minutes"))))
          ${after === null ? '' : 'and "t"."id" > ?'}
        order by "t"."id" limit ?`,
      [timeZone, timeZone, timeZone, timeZone, ...(after === null ? [] : [after]), REDERIVE_BATCH],
    )) as DriftedRow[];
  }
}
