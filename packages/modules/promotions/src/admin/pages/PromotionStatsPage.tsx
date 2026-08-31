import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { EChart } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import type { PromotionStatsGroupBy, PromotionUsageStats } from '@endora-commerce/contracts';
import { promotionsClient } from '../api/promotions-client.js';

/**
 * Feature 045 (US7) — promotion usage statistics: totals + a breakdown chart
 * by the chosen dimension, rendered with the shared ECharts wrapper.
 */
export const PromotionStatsPage = (): ReactNode => {
  const t = useTranslation('core');
  const { id } = useParams<{ id: string }>();
  const [groupBy, setGroupBy] = useState<PromotionStatsGroupBy>('organization');
  const [data, setData] = useState<PromotionUsageStats | null>(null);

  useEffect(() => {
    if (!id) return;
    void promotionsClient.stats(id, groupBy).then(setData).catch(() => setData(null));
  }, [id, groupBy]);

  const option = {
    tooltip: {},
    grid: { left: 40, right: 16, top: 16, bottom: 40 },
    xAxis: { type: 'category' as const, data: (data?.breakdown ?? []).map((b) => b.key ?? '—') },
    yAxis: { type: 'value' as const },
    series: [
      {
        type: 'bar' as const,
        name: t('promotionStats.discount'),
        data: (data?.breakdown ?? []).map((b) => b.discount),
      },
    ],
  };

  return (
    <>
      <PageHeader title={t('promotionStats.title')} description={t('promotionStats.description')} />
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('promotionStats.totalUses')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{data?.totalUses ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('promotionStats.totalDiscount')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatMoney(data?.totalDiscount ?? 0, data?.currency ?? 'PLN')}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('promotionStats.breakdown')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>{t('promotionStats.groupBy')}</Label>
            <Select
              className="w-56"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as PromotionStatsGroupBy)}
            >
              <option value="customer">customer</option>
              <option value="customerGroup">customer group</option>
              <option value="organization">organization</option>
              <option value="salesChannel">sales channel</option>
            </Select>
          </div>
          <EChart option={option} className="h-80 w-full" />
        </CardContent>
      </Card>
    </>
  );
};

/**
 * The default export the route declaration's dynamic-import factory takes
 * (`contracts/admin-contribution.md` R6). The named export is kept because the
 * screen is also the subject of this module's own admin tests.
 */
export default PromotionStatsPage;
