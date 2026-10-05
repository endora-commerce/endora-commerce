import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type OpportunityAnalyticsQuery,
  type OpportunityAverageValueRow,
  type OpportunityCurrencyTotal,
  type OpportunityHandlingTime,
  type OpportunityRepEffectivenessRow,
  type OpportunitySummary,
  type OpportunityTimeInStatusQuery,
  type OpportunityTimeInStatusRow,
  type TopOpportunitiesQuery,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor, type OrgConstraint } from '@endora-commerce/platform/tenancy';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import type { WorkflowReadService } from './workflow-read-service.js';

export interface AnalyticsServiceDeps {
  emFactory: () => EntityManager;
  workflowRead: WorkflowReadService;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  /**
   * The list's own rendering of Opportunities already read through the scoped
   * EntityManager, so a row of "most valuable" is the card the list shows.
   */
  summarize: (rows: readonly CrmOpportunity[]) => Promise<OpportunitySummary[]>;
}

/** One SQL fragment and the values of its placeholders, in order. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/**
 * The effective value of a row — the manual figure or the computed one, by
 * mode (`data-model.md` § `crm_opportunities`). The same expression the list
 * sorts by and the board totals.
 */
const EFFECTIVE_VALUE =
  `case when o."value_mode" = 'manual' then o."manual_value" else o."computed_value" end`;

/**
 * The tenant predicate over `crm_opportunities o`, or `null` for a reader who
 * reaches no Organization.
 *
 * These are aggregates handed to the connection as SQL, which the entity
 * filter never sees — so the predicate is written here, from the constraint
 * the ambient context implies (`orgConstraintFor`), and from nothing else: a
 * reader who reaches every Organization gets none, a reader confined to a set
 * gets `in (…)` over it, and for a reader who reaches none no statement runs.
 */
export function analyticsScopePredicate(scope: OrgConstraint): SqlFragment | null {
  if (scope.kind === 'all') return { sql: '', params: [] };
  const allowed =
    scope.kind === 'single'
      ? scope.organizationId === null
        ? []
        : [scope.organizationId]
      : [...scope.organizationIds];
  if (allowed.length === 0) return null;
  return {
    sql: ` and o."organization_id" in (${allowed.map(() => '?').join(', ')})`,
    params: allowed,
  };
}

/**
 * A range of whole days, UTC, `to` included: `[from 00:00, the day after to 00:00)`.
 * 422 for a range that ends before it begins.
 */
export function analyticsRange(query: { from: string; to: string }): { start: Date; end: Date } {
  const start = new Date(`${query.from}T00:00:00.000Z`);
  const end = new Date(`${query.to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The range must be two calendar dates, the first not after the second.',
    );
  }
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

interface Selection {
  /** ` and …` conditions over `o`: the tenant predicate and the two filters. */
  where: SqlFragment;
  start: Date;
  end: Date;
}

const average = (totalSeconds: number, count: number): number | null => (count > 0 ? totalSeconds / count : null);

/**
 * CRM analytics (`specs/143-crm-sales-opportunities/contracts/admin-api.md`
 * §12; research R-18, N-F2): five figures over a range of days, computed live.
 *
 * **Each figure is one grouped statement** over `crm_opportunities` — and, for
 * the time spent in a status, over `crm_opportunity_status_history` — so its
 * cost does not grow with the number of Opportunities beyond what the database
 * does with an index. Nothing is read row by row.
 *
 * **Tenant scope is in every statement**, as {@link analyticsScopePredicate}
 * builds it: a manager confined to some Organizations gets figures over those
 * and nothing else. The status history carries no Organization of its own and
 * is only ever read joined to its Opportunity.
 *
 * **Money is never added across currencies.** Every figure about value is per
 * currency; there is no rate to convert with, and a sum of PLN and EUR is not
 * a number.
 *
 * **Which Opportunities a range selects** depends on the figure, and is said
 * on each method: closed in the range for handling time and for the ranking of
 * Sales Reps, created in it for the average value, either for the most
 * valuable, and — for time in a status — the stays that began in it.
 *
 * Days and months are UTC, as the list's `createdFrom` / `createdTo` are.
 */
export class AnalyticsService {
  constructor(private readonly deps: AnalyticsServiceDeps) {}

  /**
   * Creation to closing, averaged over the Opportunities **closed in the
   * range** — and still closed: reopening clears the closing date, so a
   * reopened Opportunity is not counted until it closes again.
   */
  async handlingTime(query: OpportunityAnalyticsQuery): Promise<OpportunityHandlingTime> {
    const selection = this.#selection(query);
    const outcome = { won: { total: 0, count: 0 }, lost: { total: 0, count: 0 } };
    if (selection) {
      const rows = await this.#rows<{ closed_kind: 'won' | 'lost'; closed_count: number; total_seconds: number }>(
        `select o."closed_kind" as closed_kind,
                count(*)::int as closed_count,
                sum(extract(epoch from (o."closed_at" - o."created_at")))::float8 as total_seconds
           from "crm_opportunities" o
          where o."closed_kind" is not null
            and o."closed_at" >= ? and o."closed_at" < ?${selection.where.sql}
          group by o."closed_kind"`,
        [selection.start, selection.end, ...selection.where.params],
      );
      for (const row of rows) {
        const bucket = outcome[row.closed_kind];
        if (!bucket) continue;
        bucket.total += Number(row.total_seconds);
        bucket.count += Number(row.closed_count);
      }
    }
    const closedCount = outcome.won.count + outcome.lost.count;
    return {
      averageSeconds: average(outcome.won.total + outcome.lost.total, closedCount),
      closedCount,
      byOutcome: {
        won: { averageSeconds: average(outcome.won.total, outcome.won.count), closedCount: outcome.won.count },
        lost: { averageSeconds: average(outcome.lost.total, outcome.lost.count), closedCount: outcome.lost.count },
      },
    };
  }

  /**
   * How long an Opportunity stays in a status, averaged over the **stays that
   * began in the range**. A stay runs from the status change that entered the
   * status to the next change of the same Opportunity; one that has not ended
   * is measured up to now.
   *
   * One row per selected status, in the order asked — a status nobody entered
   * answers `null` over zero stays. With none selected: every status of the
   * workflow, in the workflow's order.
   */
  async timeInStatus(query: OpportunityTimeInStatusQuery): Promise<OpportunityTimeInStatusRow[]> {
    const selection = this.#selection(query);
    const em = this.deps.emFactory();
    const selected =
      query.statusCode && query.statusCode.length > 0
        ? [...new Set(query.statusCode)]
        : [...(await this.deps.workflowRead.loadGraph(em)).statuses]
            .sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code))
            .map((status) => status.code);
    if (selected.length === 0) return [];

    const measured = new Map<string, { averageSeconds: number; sampleCount: number }>();
    if (selection) {
      // The window runs over the whole history of each Opportunity that has a
      // change in the range — a stay ends at the next change, whenever that
      // was — and the range then selects the stays by when they began.
      const rows = await this.#rows<{ status_code: string; sample_count: number; average_seconds: number }>(
        `with stays as (
           select h."to_status_code" as status_code,
                  h."changed_at" as entered_at,
                  lead(h."changed_at") over (
                    partition by h."opportunity_id" order by h."changed_at", h."id"
                  ) as left_at
             from "crm_opportunity_status_history" h
             join "crm_opportunities" o on o."id" = h."opportunity_id"
            where h."opportunity_id" in (
                    select r."opportunity_id" from "crm_opportunity_status_history" r
                     where r."changed_at" >= ? and r."changed_at" < ?
                  )${selection.where.sql}
         )
         select s.status_code as status_code,
                count(*)::int as sample_count,
                avg(extract(epoch from (coalesce(s.left_at, now()) - s.entered_at)))::float8 as average_seconds
           from stays s
          where s.entered_at >= ? and s.entered_at < ?
            and s.status_code in (${selected.map(() => '?').join(', ')})
          group by s.status_code`,
        [selection.start, selection.end, ...selection.where.params, selection.start, selection.end, ...selected],
      );
      for (const row of rows) {
        measured.set(row.status_code, {
          averageSeconds: Number(row.average_seconds),
          sampleCount: Number(row.sample_count),
        });
      }
    }
    return selected.map((statusCode) => ({
      statusCode,
      averageSeconds: measured.get(statusCode)?.averageSeconds ?? null,
      sampleCount: measured.get(statusCode)?.sampleCount ?? 0,
    }));
  }

  /**
   * Opportunities **closed as won in the range**, per calendar month and per
   * the person they are assigned to, with what they were worth per currency.
   * Month by month, most wins first. An Opportunity won while assigned to
   * nobody is in no row.
   */
  async repEffectiveness(query: OpportunityAnalyticsQuery): Promise<OpportunityRepEffectivenessRow[]> {
    const selection = this.#selection(query);
    if (!selection) return [];
    const rows = await this.#rows<{
      month: string;
      admin_user_id: string;
      currency: string;
      won_count: number;
      total: string;
    }>(
      `select to_char(o."closed_at" at time zone 'UTC', 'YYYY-MM') as month,
              o."assigned_admin_user_id" as admin_user_id,
              o."currency" as currency,
              count(*)::int as won_count,
              coalesce(sum(${EFFECTIVE_VALUE}), 0)::numeric(16,2)::text as total
         from "crm_opportunities" o
        where o."closed_kind" = 'won'
          and o."assigned_admin_user_id" is not null
          and o."closed_at" >= ? and o."closed_at" < ?${selection.where.sql}
        group by 1, 2, 3
        order by 1, 2, 3`,
      [selection.start, selection.end, ...selection.where.params],
    );
    if (rows.length === 0) return [];

    const admins = await this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.admin_user_id))]);
    const names = new Map(
      admins.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    const byRep = new Map<string, OpportunityRepEffectivenessRow>();
    for (const row of rows) {
      const key = `${row.month} ${row.admin_user_id}`;
      const entry = byRep.get(key) ?? {
        month: row.month,
        adminUser: { id: row.admin_user_id, name: names.get(row.admin_user_id) ?? '' },
        wonCount: 0,
        wonValue: [] as OpportunityCurrencyTotal[],
      };
      entry.wonCount += Number(row.won_count);
      // A currency whose won Opportunities carry no value has nothing to total.
      if (Number(row.total) !== 0) entry.wonValue.push({ currency: row.currency, total: row.total });
      byRep.set(key, entry);
    }
    return [...byRep.values()].sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        b.wonCount - a.wonCount ||
        a.adminUser.name.localeCompare(b.adminUser.name) ||
        a.adminUser.id.localeCompare(b.adminUser.id),
    );
  }

  /**
   * The Opportunities with the highest effective value among those created —
   * or closed, by `basis` — in the range. **Ranked within each currency**:
   * `limit` is how many per currency, and the answer is ordered by currency,
   * then highest first. An Opportunity nobody has valued is not ranked.
   */
  async topOpportunities(query: TopOpportunitiesQuery): Promise<OpportunitySummary[]> {
    const selection = this.#selection(query);
    if (!selection) return [];
    const dated = query.basis === 'closed' ? 'o."closed_at"' : 'o."created_at"';
    const ranked = await this.#rows<{ id: string }>(
      `select ranked.id as id
         from (
           select o."id" as id,
                  o."currency" as currency,
                  row_number() over (
                    partition by o."currency" order by ${EFFECTIVE_VALUE} desc, o."number" asc
                  ) as position
             from "crm_opportunities" o
            where ${EFFECTIVE_VALUE} is not null
              and ${dated} >= ? and ${dated} < ?${selection.where.sql}
         ) ranked
        where ranked.position <= ?
        order by ranked.currency asc, ranked.position asc`,
      [selection.start, selection.end, ...selection.where.params, query.limit],
    );
    if (ranked.length === 0) return [];
    const ids = ranked.map((row) => row.id);
    // Read again through the scoped EntityManager: the ranking chose the ids,
    // the entity filter decides what the caller is shown.
    const rows = await this.deps.emFactory().find(CrmOpportunity, { id: { $in: ids } });
    const summaries = new Map((await this.deps.summarize(rows)).map((summary) => [summary.id, summary]));
    return ids.flatMap((id) => summaries.get(id) ?? []);
  }

  /**
   * The average effective value of the Opportunities **created in the range**,
   * per currency. An Opportunity nobody has valued is not averaged in.
   */
  async averageValue(query: OpportunityAnalyticsQuery): Promise<OpportunityAverageValueRow[]> {
    const selection = this.#selection(query);
    if (!selection) return [];
    const rows = await this.#rows<{ currency: string; count: number; average: string }>(
      `select o."currency" as currency,
              count(*)::int as count,
              avg(${EFFECTIVE_VALUE})::numeric(16,2)::text as average
         from "crm_opportunities" o
        where ${EFFECTIVE_VALUE} is not null
          and o."created_at" >= ? and o."created_at" < ?${selection.where.sql}
        group by o."currency"
        order by o."currency"`,
      [selection.start, selection.end, ...selection.where.params],
    );
    return rows.map((row) => ({ currency: row.currency, average: row.average, count: Number(row.count) }));
  }

  /** The range, the tenant predicate and the two filters — or `null` for a reader who reaches nothing. */
  #selection(query: OpportunityAnalyticsQuery): Selection | null {
    const { start, end } = analyticsRange(query);
    const scope = analyticsScopePredicate(orgConstraintFor());
    if (scope === null) return null;
    const where: SqlFragment = { sql: scope.sql, params: [...scope.params] };
    if (query.salesChannelId) {
      where.sql += ' and o."sales_channel_id" = ?';
      where.params.push(query.salesChannelId);
    }
    if (query.assignedAdminUserId) {
      where.sql += ' and o."assigned_admin_user_id" = ?';
      where.params.push(query.assignedAdminUserId);
    }
    return { where, start, end };
  }

  async #rows<T>(sql: string, params: unknown[]): Promise<T[]> {
    return (await this.deps.emFactory().getConnection().execute(sql, params)) as T[];
  }
}
