import type { EntityManager } from '@mikro-orm/postgresql';
import type { PromotionStatsGroupBy, PromotionUsageStats } from '@endora-commerce/contracts';

/**
 * Feature 045 (US7) — usage statistics aggregated over `promotion_usages`.
 * Totals plus an optional breakdown by customer / customer group /
 * organization / sales channel, at promotion or coupon granularity.
 */
const DIMENSION_COLUMN: Record<PromotionStatsGroupBy, string> = {
  customer: 'customer_account_id',
  customerGroup: 'customer_group_id',
  organization: 'organization_id',
  salesChannel: 'sales_channel_id',
};

export interface StatsQuery {
  from?: string;
  to?: string;
  groupBy?: PromotionStatsGroupBy;
}

export class PromotionStatsService {
  constructor(private readonly emFactory: () => EntityManager) {}

  forPromotion(promotionId: string, q: StatsQuery = {}): Promise<PromotionUsageStats> {
    return this.aggregate('promotion_id', promotionId, q);
  }

  forCoupon(couponId: string, q: StatsQuery = {}): Promise<PromotionUsageStats> {
    return this.aggregate('coupon_id', couponId, q);
  }

  private async aggregate(
    column: 'promotion_id' | 'coupon_id',
    id: string,
    q: StatsQuery,
  ): Promise<PromotionUsageStats> {
    // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
    // connection, so these totals would be read from outside a transaction the
    // caller holds open — a redemption the same transaction has just recorded
    // would not be counted (issue #207). `column` and the breakdown column are
    // both literals from a closed map, never caller input.
    const em = this.emFactory();
    const conditions = [`"${column}" = ?`];
    const params: unknown[] = [id];
    if (q.from) {
      conditions.push('"created_at" >= ?');
      params.push(new Date(q.from));
    }
    if (q.to) {
      conditions.push('"created_at" <= ?');
      params.push(new Date(q.to));
    }
    const where = conditions.join(' and ');

    const totalsRows = (await em.execute(
      `select count(*) as uses, sum("discount_amount") as discount
         from "promotion_usages" where ${where}`,
      params,
    )) as Array<{ uses: string; discount: string | null }>;
    const totals = totalsRows[0];

    const currencyRows = (await em.execute(
      `select "currency" from "promotion_usages" where ${where} limit 1`,
      params,
    )) as Array<{ currency: string }>;
    const currencyRow = currencyRows[0];

    let breakdown: PromotionUsageStats['breakdown'] = [];
    if (q.groupBy) {
      const col = DIMENSION_COLUMN[q.groupBy];
      const rows = (await em.execute(
        `select "${col}" as key, count(*) as uses, sum("discount_amount") as discount
           from "promotion_usages" where ${where} group by "${col}"`,
        params,
      )) as Array<{ key: string | null; uses: string; discount: string | null }>;
      breakdown = rows.map((r) => ({
        key: r.key ?? null,
        uses: Number(r.uses),
        discount: Number(r.discount ?? 0),
      }));
    }

    return {
      totalUses: Number(totals?.uses ?? 0),
      totalDiscount: Number(totals?.discount ?? 0),
      currency: currencyRow?.currency ?? null,
      groupBy: q.groupBy ?? null,
      breakdown,
    };
  }
}
