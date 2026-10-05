import { useMemo, type ReactNode } from 'react';
import type { OpportunityCurrencyTotal, OpportunityRepEffectivenessRow } from '@endora-commerce/contracts';
import { EChart, type EChartProps } from '@endora-commerce/admin-kit/components';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmAnalyticsApi, type AnalyticsFilters } from '../../analytics-api.js';
import { monthLabel } from '../../lib/analytics-format.js';
import { NO_VALUE, moneyLabel } from '../../lib/labels.js';
import { prefersReducedMotion, useChartColors } from '../../lib/use-chart-colors.js';
import { useFigure } from '../../lib/use-figure.js';
import { FigureCard } from './FigureCard.js';

interface RepRanking {
  id: string;
  name: string;
  wonCount: number;
  wonValue: OpportunityCurrencyTotal[];
}

/** How many reps the chart draws; the table lists them all. */
const CHART_ROWS = 10;

/**
 * The reps of the whole range, most wins first: each rep's months added up.
 * Values are added **within** a currency — in cents, so no float drifts — and
 * never across.
 */
export function rankReps(rows: readonly OpportunityRepEffectivenessRow[]): RepRanking[] {
  const byRep = new Map<string, { id: string; name: string; wonCount: number; cents: Map<string, number> }>();
  for (const row of rows) {
    const rep = byRep.get(row.adminUser.id) ?? {
      id: row.adminUser.id,
      name: row.adminUser.name,
      wonCount: 0,
      cents: new Map<string, number>(),
    };
    rep.wonCount += row.wonCount;
    for (const value of row.wonValue) {
      rep.cents.set(value.currency, (rep.cents.get(value.currency) ?? 0) + Math.round(Number(value.total) * 100));
    }
    byRep.set(rep.id, rep);
  }
  return [...byRep.values()]
    .map((rep) => ({
      id: rep.id,
      name: rep.name,
      wonCount: rep.wonCount,
      wonValue: [...rep.cents.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, cents]) => ({ currency, total: (cents / 100).toFixed(2) })),
    }))
    .sort((a, b) => b.wonCount - a.wonCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function WonValue({ totals }: { totals: readonly OpportunityCurrencyTotal[] }): ReactNode {
  if (totals.length === 0) return NO_VALUE;
  return (
    <ul className="space-y-0.5">
      {totals.map((total) => (
        <li key={total.currency} className="whitespace-nowrap">
          {moneyLabel(total.total, total.currency)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The most effective Sales Reps: who won the most Opportunities in the range,
 * and month by month. The chart draws the ranking; both tables carry the
 * numbers, and the value each rep won, which the chart does not.
 */
export function RepEffectivenessCard({ filters }: { filters: AnalyticsFilters | null }): ReactNode {
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const colors = useChartColors();
  const load = useMemo(
    () =>
      filters ? (): Promise<OpportunityRepEffectivenessRow[]> => crmAnalyticsApi.repEffectiveness(filters) : null,
    [filters],
  );
  const figure = useFigure(load);
  const repName = (name: string): string => name || t('analytics.reps.unknown');

  const chart = (ranking: readonly RepRanking[]): EChartProps['option'] => {
    const drawn = ranking.slice(0, CHART_ROWS);
    return {
      animation: !prefersReducedMotion(),
      grid: { left: 8, right: 32, top: 8, bottom: 28, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'value',
        minInterval: 1,
        name: t('analytics.chart.won'),
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.line } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: drawn.map((rep) => repName(rep.name)),
        axisLabel: { color: colors.text },
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 28,
          itemStyle: { color: colors.bar },
          data: drawn.map((rep) => rep.wonCount),
        },
      ],
    };
  };

  return (
    <FigureCard
      title={t('analytics.reps.title')}
      description={t('analytics.reps.description')}
      figure={figure}
      isEmpty={(data): boolean => data.length === 0}
      emptyMessage={t('analytics.reps.empty')}
    >
      {(data): ReactNode => {
        const ranking = rankReps(data);
        return (
          <>
            <div aria-hidden="true" className="min-w-0 overflow-hidden">
              <EChart
                option={chart(ranking)}
                className="w-full"
                style={{ height: Math.max(140, Math.min(ranking.length, CHART_ROWS) * 44 + 56) }}
              />
            </div>
            <div className="overflow-x-auto">
              <Table aria-label={t('analytics.reps.rankingCaption')}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">{t('analytics.reps.col.rank')}</TableHead>
                    <TableHead>{t('analytics.reps.col.rep')}</TableHead>
                    <TableHead className="text-right">{t('analytics.reps.col.won')}</TableHead>
                    <TableHead className="text-right">{t('analytics.reps.col.value')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((rep, index) => (
                    <TableRow key={rep.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-medium">{repName(rep.name)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rep.wonCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <WonValue totals={rep.wonValue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <h3 className="pt-2 text-sm font-semibold">{t('analytics.reps.monthlyCaption')}</h3>
            <div className="overflow-x-auto">
              <Table aria-label={t('analytics.reps.monthlyCaption')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('analytics.reps.col.month')}</TableHead>
                    <TableHead>{t('analytics.reps.col.rep')}</TableHead>
                    <TableHead className="text-right">{t('analytics.reps.col.won')}</TableHead>
                    <TableHead className="text-right">{t('analytics.reps.col.value')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={`${row.month} ${row.adminUser.id}`}>
                      <TableCell className="whitespace-nowrap">{monthLabel(row.month, language)}</TableCell>
                      <TableCell>{repName(row.adminUser.name)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.wonCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <WonValue totals={row.wonValue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        );
      }}
    </FigureCard>
  );
}
