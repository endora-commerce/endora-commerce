import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AnalyticsEventType,
  AnalyticsSummaryQuery,
  AnalyticsSummaryResponse,
} from '@b2b/contracts';

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
 */
export class AnalyticsQueryService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async summary(query: AnalyticsSummaryQuery): Promise<AnalyticsSummaryResponse> {
    const em = this.emFactory();
    const conn = em.getConnection();

    const params: Array<string | undefined> = [query.from, query.to];
    let channelClause = '';
    if (query.salesChannelId) {
      channelClause = ' and sales_channel_id = ?';
      params.push(query.salesChannelId);
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
