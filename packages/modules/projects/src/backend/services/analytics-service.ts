import type { EntityManager } from '@mikro-orm/postgresql';
import {
  pickLocalized,
  type AdminUserReadPort,
  type ProjectAnalyticsDurationsSchema,
  type ProjectAnalyticsLossesSchema,
  type ProjectAnalyticsManagersSchema,
  type ProjectAnalyticsQuery,
  type ProjectAnalyticsSummarySchema,
  type ProjectAnalyticsTimeInStageSchema,
  type ProjectAnalyticsTopOpenSchema,
  type ProjectAnalyticsValueSchema,
  type ProjectCurrencyAmount,
} from '@endora-commerce/contracts';
import { reachesNoOrganization } from '@endora-commerce/platform/tenancy';
import type { z } from 'zod';
import { analyticsRange, completionRate, secondsToDays, shareOf } from '../domain/analytics-range.js';
import { VISIBLE_PROJECT_COLUMNS, type ProjectAccess, type SqlFragment, type VisibleProjectRow } from './project-access.js';
import { personName, type ProjectReadService } from './project-read-service.js';

/** The seeded Role whose holders are a Project's Project Managers. */
const PROJECT_MANAGER_ROLE = 'project_manager';
/** How many open Projects "most valuable" ranks, per currency. */
export const TOP_OPEN_PER_CURRENCY = 5;
/** How many Project Managers the ranking names. */
export const MANAGERS_LIMIT = 10;

/**
 * Every figure's answer (FR-038): the period, the Projects it was computed
 * from, and those a money figure left out for having no value.
 */
export interface AnalyticsFigure<T> {
  from: string;
  to: string;
  /** The Projects the range and the filters select for this figure, as the reader may see them. */
  projectCount: number;
  /** Of those, the ones without a value — left out of every amount the figure shows. */
  excluded: { noValue: number };
  data: T;
}

export interface ProjectAnalyticsServiceDeps {
  emFactory: () => EntityManager;
  access: ProjectAccess;
  read: ProjectReadService;
  /** The calendar every range is counted in (`reporting-time-zone.ts`; `UTC` without `analytics`). */
  reportingTimeZone: () => Promise<string>;
  /** `admin_users`' port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

/** The range, the visibility predicate and the three filters, as ` and …` over `projects p`. */
interface Selection {
  start: Date;
  end: Date;
  where: SqlFragment;
}

const IN_RANGE = (column: string) => `p."${column}" >= ? and p."${column}" < ?`;

/**
 * Project analytics (`specs/163-projects-and-tasks/contracts/admin-api.md`
 * §2.6; research R-15; spec User Story 10, FR-037, FR-038) — seven figures over
 * a range of days, computed live.
 *
 * **Each figure is one grouped statement** over `projects` (and, for time in a
 * Stage and the Stage lost in, `project_stage_entries`), so its cost does not
 * grow with the number of Projects beyond what the database does with an
 * index. Nothing is read row by row; a Project Manager's name and a top
 * Project's card are read after, for the few rows the statement answered.
 *
 * **Every statement carries `ProjectAccess.visibleProjectSql`** for the
 * reader — Organization reach (every Organization of a Project in reach) and
 * the visibility rule — so no figure counts a Project the reader cannot see
 * (US10 sc. 5). A reader who reaches no Organization is answered with empty
 * figures and no statement runs.
 *
 * **A range is days in the reporting time zone** — the `analytics` module's
 * setting `analytics.reporting_time_zone`, `UTC` by default and `UTC` while
 * `analytics` is off — from the first day's midnight to the midnight after the
 * last, both in that zone (`domain/analytics-range.ts`).
 *
 * **Which Projects a range selects** depends on the figure and is said on each
 * method: created in it for *opened*, the average value and the most valuable
 * open; closed in it for *completed*, *lost*, durations, losses and Project
 * Managers; for time in a Stage, the stays begun in it.
 *
 * **Money is never added across currencies**; a Project without a value is
 * left out of every amount and counted in `excluded.noValue`.
 *
 * **Stages are grouped by name** (`lower(trim(name))`), as they were when
 * entered or lost in — Stages belong to one Project each, so their ids never
 * repeat (R-15). A group is shown under its most frequent spelling.
 */
export class ProjectAnalyticsService {
  constructor(private readonly deps: ProjectAnalyticsServiceDeps) {}

  /**
   * Opened (created in the range), completed and lost (closed in the range),
   * and the completion rate — completed over closed. `projectCount` is every
   * Project created or closed in the range.
   */
  async summary(query: ProjectAnalyticsQuery): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsSummarySchema>>> {
    const selection = await this.#selection(query);
    let opened = 0;
    let completed = 0;
    let lost = 0;
    let projectCount = 0;
    if (selection) {
      const [row] = await this.#rows<{ opened: number; completed: number; lost: number; total: number }>(
        `select count(*) filter (where ${IN_RANGE('created_at')})::int as "opened",
                count(*) filter (where p."state" = 'completed' and ${IN_RANGE('closed_at')})::int as "completed",
                count(*) filter (where p."state" = 'lost' and ${IN_RANGE('closed_at')})::int as "lost",
                count(*)::int as "total"
           from "projects" p
          where ((${IN_RANGE('created_at')}) or (${IN_RANGE('closed_at')}))${selection.where.sql}`,
        [...this.#range(selection, 5), ...selection.where.params],
      );
      opened = Number(row?.opened ?? 0);
      completed = Number(row?.completed ?? 0);
      lost = Number(row?.lost ?? 0);
      projectCount = Number(row?.total ?? 0);
    }
    return this.#figure(query, projectCount, 0, {
      opened,
      completed,
      lost,
      completionRate: completionRate(completed, lost),
    });
  }

  /** Creation to close, in days, averaged over the Projects closed in the range, per outcome. */
  async durations(query: ProjectAnalyticsQuery): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsDurationsSchema>>> {
    const selection = await this.#selection(query);
    const outcome = { completed: { seconds: null as number | null, count: 0 }, lost: { seconds: null as number | null, count: 0 } };
    if (selection) {
      const rows = await this.#rows<{ state: 'completed' | 'lost'; closed_count: number; average_seconds: number }>(
        `select p."state" as "state", count(*)::int as "closed_count",
                avg(extract(epoch from (p."closed_at" - p."created_at")))::float8 as "average_seconds"
           from "projects" p
          where p."state" in ('completed', 'lost') and ${IN_RANGE('closed_at')}${selection.where.sql}
          group by p."state"`,
        [...this.#range(selection, 1), ...selection.where.params],
      );
      for (const row of rows) {
        outcome[row.state] = { seconds: Number(row.average_seconds), count: Number(row.closed_count) };
      }
    }
    return this.#figure(query, outcome.completed.count + outcome.lost.count, 0, {
      completedAverageDays: secondsToDays(outcome.completed.seconds),
      completedCount: outcome.completed.count,
      lostAverageDays: secondsToDays(outcome.lost.seconds),
      lostCount: outcome.lost.count,
    });
  }

  /**
   * How long a Project stays in a Stage, per Stage name, averaged over the
   * **stays begun in the range that have ended**. A stay runs from the entry
   * into the Stage (a creation, a move or a reopening) to the Project's next
   * entry of any kind — a move on, a close; a stay not yet left is not
   * measured, so the figure does not drift by the second. In the order Stages
   * are usually walked: by their average place in a Project's history.
   */
  async timeInStage(
    query: ProjectAnalyticsQuery,
  ): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsTimeInStageSchema>>> {
    const selection = await this.#selection(query);
    if (!selection) return this.#figure(query, 0, 0, []);
    // The window runs over the whole history of each Project that has an
    // entry in the range — a stay ends at the next entry, whenever that was —
    // and the range then selects the stays by when they began.
    const rows = await this.#rows<{
      stage_name: string;
      sample_count: number;
      average_seconds: number;
      project_count: number;
    }>(
      `with "entries" as (
         select e."project_id", e."to_stage_name", e."at",
                lead(e."at") over (partition by e."project_id" order by e."at", e."id") as "left_at",
                row_number() over (partition by e."project_id" order by e."at", e."id") as "ordinal"
           from "project_stage_entries" e
           join "projects" p on p."id" = e."project_id"
          where e."project_id" in (
                  select r."project_id" from "project_stage_entries" r where r."at" >= ? and r."at" < ?
                )${selection.where.sql}
       ), "stays" as (
         select s."project_id", trim(s."to_stage_name") as "name", lower(trim(s."to_stage_name")) as "stage_key",
                extract(epoch from (s."left_at" - s."at")) as "seconds", s."ordinal"
           from "entries" s
          where s."to_stage_name" is not null and s."left_at" is not null
            and s."at" >= ? and s."at" < ?
       )
       select mode() within group (order by s."name") as "stage_name",
              count(*)::int as "sample_count",
              avg(s."seconds")::float8 as "average_seconds",
              (select count(distinct a."project_id") from "stays" a)::int as "project_count"
         from "stays" s
        group by s."stage_key"
        order by avg(s."ordinal"), s."stage_key"`,
      [...this.#range(selection, 1), ...selection.where.params, ...this.#range(selection, 1)],
    );
    return this.#figure(
      query,
      Number(rows[0]?.project_count ?? 0),
      0,
      rows.map((row) => ({
        stageName: row.stage_name,
        averageDays: secondsToDays(Number(row.average_seconds)),
        sampleCount: Number(row.sample_count),
      })),
    );
  }

  /**
   * The Projects **lost in the range**: per the Stage they were lost in
   * (ranked, the most frequent first), per loss reason, and the value lost per
   * currency. The Stage is named as it was when the Project was lost.
   */
  async losses(
    query: ProjectAnalyticsQuery,
    language: string,
  ): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsLossesSchema>>> {
    const selection = await this.#selection(query);
    if (!selection) return this.#figure(query, 0, 0, { byStage: [], byReason: [], lostValue: [] });
    const rows = await this.#rows<{
      grouping: 'stage' | 'reason' | 'value';
      group_key: string | null;
      label: string | null;
      reason_code: string | null;
      reason_name: Record<string, string> | null;
      reason_default_name: string | null;
      n: number;
      amount: string | null;
    }>(
      `with "lost" as (
         select p."id", p."loss_reason_id", p."value_amount", p."value_currency",
                trim(coalesce(
                  (select e."from_stage_name" from "project_stage_entries" e
                    where e."project_id" = p."id" and e."kind" = 'close_lost'
                    order by e."at" desc, e."id" desc limit 1),
                  (select s."name" from "project_stages" s where s."id" = p."lost_stage_id"),
                  ''
                )) as "stage_name"
           from "projects" p
          where p."state" = 'lost' and ${IN_RANGE('closed_at')}${selection.where.sql}
       )
       select 'stage' as "grouping", lower(l."stage_name") as "group_key",
              mode() within group (order by l."stage_name") as "label",
              null::text as "reason_code", null::jsonb as "reason_name", null::text as "reason_default_name",
              count(*)::int as "n", null::text as "amount"
         from "lost" l group by lower(l."stage_name")
       union all
       select 'reason', l."loss_reason_id"::text, null, r."code", r."name", r."default_name", count(*)::int, null
         from "lost" l join "project_loss_reasons" r on r."id" = l."loss_reason_id"
        group by l."loss_reason_id", r."code", r."name", r."default_name"
       union all
       select 'value', l."value_currency", null, null, null, null, count(*)::int,
              sum(l."value_amount")::numeric(18,2)::text
         from "lost" l where l."value_amount" is not null
        group by l."value_currency"`,
      [...this.#range(selection, 1), ...selection.where.params],
    );
    const stages = rows.filter((row) => row.grouping === 'stage');
    const total = stages.reduce((sum, row) => sum + Number(row.n), 0);
    const values = rows.filter((row) => row.grouping === 'value');
    const valued = values.reduce((sum, row) => sum + Number(row.n), 0);
    const byStage = stages
      .map((row) => ({ stageName: row.label ?? '', count: Number(row.n), share: shareOf(Number(row.n), total) }))
      .sort((a, b) => b.count - a.count || a.stageName.localeCompare(b.stageName));
    const byReason = rows
      .filter((row) => row.grouping === 'reason')
      .map((row) => ({
        lossReasonId: row.group_key!,
        code: row.reason_code ?? '',
        name: pickLocalized(row.reason_name ?? {}, language) || (row.reason_default_name ?? ''),
        count: Number(row.n),
        share: shareOf(Number(row.n), total),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    const lostValue: ProjectCurrencyAmount[] = values
      .map((row) => ({ currency: row.group_key ?? '', amount: row.amount ?? '0.00' }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return this.#figure(query, total, total - valued, { byStage, byReason, lostValue });
  }

  /** The average value of the Projects **created in the range**, per currency. */
  async value(query: ProjectAnalyticsQuery): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsValueSchema>>> {
    const selection = await this.#selection(query);
    if (!selection) return this.#figure(query, 0, 0, { average: [] });
    // The group without a currency is the Projects without a value (a value
    // and its currency are set together, `projects_value_check`).
    const rows = await this.#rows<{ currency: string | null; count: number; average: string | null }>(
      `select p."value_currency" as "currency", count(*)::int as "count",
              avg(p."value_amount")::numeric(18,2)::text as "average"
         from "projects" p
        where ${IN_RANGE('created_at')}${selection.where.sql}
        group by p."value_currency"
        order by p."value_currency" nulls last`,
      [...this.#range(selection, 1), ...selection.where.params],
    );
    const projectCount = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const noValue = Number(rows.find((row) => row.currency === null)?.count ?? 0);
    return this.#figure(query, projectCount, noValue, {
      average: rows
        .filter((row) => row.currency !== null)
        .map((row) => ({ currency: row.currency!, amount: row.average ?? '0.00', count: Number(row.count) })),
    });
  }

  /**
   * The most valuable Projects **still open, created in the range** —
   * {@link TOP_OPEN_PER_CURRENCY} per currency, by currency, highest first.
   */
  async topOpen(query: ProjectAnalyticsQuery): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsTopOpenSchema>>> {
    const selection = await this.#selection(query);
    if (!selection) return this.#figure(query, 0, 0, []);
    // One row at least — the counts — whatever is ranked.
    const rows = await this.#rows<VisibleProjectRow & { total: number; no_value: number }>(
      `with "candidates" as (
         select ${VISIBLE_PROJECT_COLUMNS},
                row_number() over (
                  partition by p."value_currency" order by p."value_amount" desc, p."number" asc
                ) as "position"
           from "projects" p
          where p."state" = 'open' and ${IN_RANGE('created_at')}${selection.where.sql}
       )
       select c.*, t."total", t."no_value"
         from (select count(*)::int as "total", count(*) filter (where "value_amount" is null)::int as "no_value"
                 from "candidates") t
         left join "candidates" c on c."value_amount" is not null and c."position" <= ?
        order by c."value_currency" asc, c."position" asc`,
      [...this.#range(selection, 1), ...selection.where.params, TOP_OPEN_PER_CURRENCY],
    );
    const projectCount = Number(rows[0]?.total ?? 0);
    const noValue = Number(rows[0]?.no_value ?? 0);
    const ranked = rows.filter((row) => row.id !== null);
    return this.#figure(query, projectCount, noValue, await this.deps.read.summaries(ranked));
  }

  /**
   * The Project Managers with the most Projects **completed in the range** —
   * Members holding the *Project Manager* Role on them — at most
   * {@link MANAGERS_LIMIT}, most first.
   */
  async managers(query: ProjectAnalyticsQuery): Promise<AnalyticsFigure<z.infer<typeof ProjectAnalyticsManagersSchema>>> {
    const selection = await this.#selection(query);
    if (!selection) return this.#figure(query, 0, 0, []);
    const rows = await this.#rows<{ admin_user_id: string | null; completed_count: number | null; total: number }>(
      `with "done" as (
         select p."id" from "projects" p
          where p."state" = 'completed' and ${IN_RANGE('closed_at')}${selection.where.sql}
       ), "ranked" as (
         select pm."admin_user_id", count(distinct d."id")::int as "completed_count"
           from "done" d
           join "project_members" pm on pm."project_id" = d."id"
           join "project_member_roles" pmr on pmr."member_id" = pm."id"
           join "project_roles" r on r."id" = pmr."role_id" and r."code" = ?
          group by pm."admin_user_id"
          order by count(distinct d."id") desc, pm."admin_user_id"
          limit ?
       )
       select k."admin_user_id", k."completed_count", (select count(*) from "done")::int as "total"
         from (select 1) one left join "ranked" k on true
        order by k."completed_count" desc nulls last, k."admin_user_id"`,
      [...this.#range(selection, 1), ...selection.where.params, PROJECT_MANAGER_ROLE, MANAGERS_LIMIT],
    );
    const projectCount = Number(rows[0]?.total ?? 0);
    const ranked = rows.filter((row) => row.admin_user_id !== null);
    const people = ranked.length > 0 ? await this.deps.adminUsers.findByIds(ranked.map((row) => row.admin_user_id!)) : [];
    const nameOf = new Map(people.map((person) => [person.id, personName(person)]));
    return this.#figure(
      query,
      projectCount,
      0,
      ranked
        .map((row) => ({
          adminUser: { id: row.admin_user_id!, name: nameOf.get(row.admin_user_id!) ?? '' },
          completedCount: Number(row.completed_count),
        }))
        .sort(
          (a, b) =>
            b.completedCount - a.completedCount ||
            a.adminUser.name.localeCompare(b.adminUser.name) ||
            a.adminUser.id.localeCompare(b.adminUser.id),
        ),
    );
  }

  /**
   * The range, the visibility predicate for the reader and the filters — or
   * `null` for a reader who reaches no Organization, for whom no statement runs.
   */
  async #selection(query: ProjectAnalyticsQuery): Promise<Selection | null> {
    // Days are the reporting time zone's (issue #465): `analytics`', or UTC without it.
    const { start, end } = analyticsRange(query, await this.deps.reportingTimeZone());
    const viewer = await this.deps.access.currentViewer();
    if (reachesNoOrganization(viewer.reach.constraint)) return null;
    const visible = await this.deps.access.visibleProjectSql(viewer);
    const where: SqlFragment = { sql: '', params: [] };
    if (visible) {
      where.sql += ` and ${visible.sql}`;
      where.params.push(...visible.params);
    }
    if (query.templateId) {
      where.sql += ` and p."template_id" = ?`;
      where.params.push(query.templateId);
    }
    if (query.organizationId) {
      where.sql += ` and exists (select 1 from "project_organizations" f_po
                                  where f_po."project_id" = p."id" and f_po."organization_id" = ?)`;
      where.params.push(query.organizationId);
    }
    if (query.projectManagerId) {
      where.sql += ` and exists (select 1 from "project_members" f_pm
                                   join "project_member_roles" f_pmr on f_pmr."member_id" = f_pm."id"
                                   join "project_roles" f_r on f_r."id" = f_pmr."role_id"
                                  where f_pm."project_id" = p."id" and f_pm."admin_user_id" = ? and f_r."code" = ?)`;
      where.params.push(query.projectManagerId, PROJECT_MANAGER_ROLE);
    }
    return { start, end, where };
  }

  /** `start, end` repeated `times` — one pair per range condition of a statement, in order. */
  #range(selection: Selection, times: number): Date[] {
    return Array.from({ length: times }, () => [selection.start, selection.end]).flat();
  }

  #figure<T>(query: ProjectAnalyticsQuery, projectCount: number, noValue: number, data: T): AnalyticsFigure<T> {
    return { from: query.from, to: query.to, projectCount, excluded: { noValue }, data };
  }

  async #rows<T>(sql: string, params: unknown[]): Promise<T[]> {
    return (await this.deps.emFactory().execute(sql, params)) as T[];
  }
}
