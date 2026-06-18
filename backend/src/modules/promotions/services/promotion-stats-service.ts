import type { EntityManager } from '@mikro-orm/postgresql';
import type { PromotionStatsGroupBy, PromotionUsageStats } from '@b2b/contracts';

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
    const knex = this.emFactory().getKnex();
    const base = (): ReturnType<typeof knex> => {
      const qb = knex('promotion_usages').where(column, id);
      if (q.from) qb.andWhere('created_at', '>=', new Date(q.from));
      if (q.to) qb.andWhere('created_at', '<=', new Date(q.to));
      return qb;
    };

    const totals = (await base()
      .count<{ uses: string }>('* as uses')
      .sum<{ discount: string }>('discount_amount as discount')
      .first()) as unknown as { uses: string; discount: string | null };

    const currencyRow = (await base().select('currency').first()) as { currency: string } | undefined;

    let breakdown: PromotionUsageStats['breakdown'] = [];
    if (q.groupBy) {
      const col = DIMENSION_COLUMN[q.groupBy];
      const rows = (await base()
        .select(`${col} as key`)
        .count('* as uses')
        .sum('discount_amount as discount')
        .groupBy(col)) as Array<{ key: string | null; uses: string; discount: string | null }>;
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
