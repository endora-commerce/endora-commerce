import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AnalyticsEventType,
  AnalyticsSummaryQuery,
  AnalyticsSummaryResponse,
} from '@endora-commerce/contracts';
import { orgConstraintFor, type OrgConstraint } from '@endora-commerce/platform/tenancy';

/**
 * AnalyticsQueryService (T237 / FR-111).
 *
 * Two reads serve the admin dashboard:
 *   - `totalsByType`  — events per type in the requested window
 *   - `daily`         — per-day, per-type counts for a stacked-area chart
 *
 * Both are bounded by the time window the caller passes; the dashboard
 * never asks for "all time" so the queries always hit the
 * `(occurred_at)` / `(type, occurred_at)` indexes.
 *
 * ## Both are confined to the reader's organizations, in the statement
 *
 * `analytics_events` is organization-scoped, but these are aggregates written
 * as SQL, and the entity filter that confines an `em.find` never sees a
 * statement handed to the connection. So the tenant predicate is built here
 * from the ambient context (`orgConstraintFor`) and appended to **every**
 * statement through the one `where` they share — a reader who reaches every
 * organization gets no predicate, a reader confined to a set gets `in (…)`
 * over it, and a reader who reaches none is answered without a query.
 *
 * **An event with no organization is not visible to a confined reader.** The
 * ingest endpoint is public and most storefront traffic is anonymous, so those
 * rows carry a null organization; they belong to no organization, which puts
 * them outside an authority that is a set of organizations and inside a
 * platform administrator's. SQL `in` never matches NULL, so the predicate
 * says exactly that without a clause of its own.
 */
export class AnalyticsQueryService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * @param scope the organizations the reader reaches. Defaults to the ambient
   *   tenant context, which is what a request has; a parameter so the rule can
   *   be asserted without one.
   */
  async summary(
    query: AnalyticsSummaryQuery,
    scope: OrgConstraint = orgConstraintFor(),
  ): Promise<AnalyticsSummaryResponse> {
    const allowed = allowedOrganizationIds(scope);
    if (allowed !== 'all' && allowed.length === 0) return { totalsByType: [], daily: [] };

    const em = this.emFactory();
    const conn = em.getConnection();

    const params: Array<string | undefined> = [query.from, query.to];
    // One suffix for every statement below. A statement that does not end its
    // `where` with it reads across organizations.
    let channelClause = '';
    if (query.salesChannelId) {
      channelClause = ' and sales_channel_id = ?';
      params.push(query.salesChannelId);
    }
    if (allowed !== 'all') {
      channelClause += ` and organization_id in (${allowed.map(() => '?').join(', ')})`;
      params.push(...allowed);
    }

    const totalsRows = await conn.execute<Array<{ type: string; count: string }>>(
      `select type, count(*)::text as count
         from analytics_events
        where occurred_at >= ? and occurred_at < ?${channelClause}
        group by type
        order by type asc`,
      params,
    );

    const dailyRows = await conn.execute<
      Array<{ day: string; type: string; count: string }>
    >(
      `select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
              type,
              count(*)::text as count
         from analytics_events
        where occurred_at >= ? and occurred_at < ?${channelClause}
        group by 1, 2
        order by 1 asc, 2 asc`,
      params,
    );

    return {
      totalsByType: totalsRows.map((r) => ({
        type: r.type as AnalyticsEventType,
        count: Number(r.count),
      })),
      daily: dailyRows.map((r) => ({
        day: r.day,
        type: r.type as AnalyticsEventType,
        count: Number(r.count),
      })),
    };
  }
}

/**
 * The organizations a constraint names, or `'all'` when it names no limit.
 *
 * A single-organization reader with a null organization reaches nothing — the
 * same answer `carts`' admin list gives, and for the same reason: it must not
 * turn into "the rows that belong to nobody".
 */
function allowedOrganizationIds(scope: OrgConstraint): 'all' | string[] {
  switch (scope.kind) {
    case 'all':
      return 'all';
    case 'single':
      return scope.organizationId === null ? [] : [scope.organizationId];
    case 'set':
      return [...scope.organizationIds];
  }
}
