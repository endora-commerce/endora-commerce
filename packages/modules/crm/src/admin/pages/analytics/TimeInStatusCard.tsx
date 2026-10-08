import { useMemo, useState, type ReactNode } from 'react';
import type { OpportunityTimeInStatusRow, OpportunityWorkflowStatus } from '@endora-commerce/contracts';
import { EChart, type EChartProps } from '@endora-commerce/admin-kit/components';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Badge,
  MultiSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmAnalyticsApi, type AnalyticsFilters } from '../../analytics-api.js';
import { daysOf, durationLabel } from '../../lib/analytics-format.js';
import { workflowStatusLabel } from '../../lib/labels.js';
import { prefersReducedMotion, useChartColors } from '../../lib/use-chart-colors.js';
import { useFigure } from '../../lib/use-figure.js';
import { FigureCard } from './FigureCard.js';

export interface TimeInStatusCardProps {
  filters: AnalyticsFilters | null;
  /** The workflow's statuses, for their names and colours; `null` when they could not be read. */
  statuses: readonly OpportunityWorkflowStatus[] | null;
}

const NEUTRAL = '#64748b';

/**
 * Average time in each selected status. The chart and the table say the same
 * thing; the table is what a screen reader is given, and it also carries what a
 * bar cannot — how many stays the average is over, and a status nobody entered.
 */
export function TimeInStatusCard({ filters, statuses }: TimeInStatusCardProps): ReactNode {
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const colors = useChartColors();
  const [selected, setSelected] = useState<string[]>([]);

  const load = useMemo(
    () =>
      filters
        ? (): Promise<OpportunityTimeInStatusRow[]> => crmAnalyticsApi.timeInStatus(filters, selected)
        : null,
    [filters, selected],
  );
  const figure = useFigure(load);

  const byCode = useMemo(
    () => new Map((statuses ?? []).map((status) => [status.code, status])),
    [statuses],
  );
  const nameOf = (code: string): string => {
    const status = byCode.get(code);
    return status ? workflowStatusLabel(status, language) : code;
  };
  const options = useMemo(
    () => (statuses ?? []).map((status) => ({ value: status.code, label: workflowStatusLabel(status, language) })),
    [statuses, language],
  );

  const chart = (rows: readonly OpportunityTimeInStatusRow[]): EChartProps['option'] => {
    const drawn = rows.filter((row) => row.sampleCount > 0 && row.averageSeconds !== null);
    return {
      animation: !prefersReducedMotion(),
      grid: { left: 8, right: 32, top: 8, bottom: 28, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value): string => durationLabel(Number(value) * 86_400, language),
      },
      xAxis: {
        type: 'value',
        name: t('analytics.chart.days'),
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.line } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: drawn.map((row) => nameOf(row.statusCode)),
        axisLabel: { color: colors.text },
        axisLine: { lineStyle: { color: colors.line } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 28,
          data: drawn.map((row) => ({
            value: daysOf(row.averageSeconds ?? 0),
            itemStyle: { color: byCode.get(row.statusCode)?.color ?? NEUTRAL },
          })),
        },
      ],
    };
  };

  return (
    <FigureCard
      title={t('analytics.status.title')}
      description={t('analytics.status.description')}
      figure={figure}
      isEmpty={(data): boolean => data.every((row) => row.sampleCount === 0)}
      emptyMessage={t('analytics.status.empty')}
      action={
        options.length > 0 ? (
          <MultiSelect
            className="w-full sm:w-56"
            ariaLabel={t('analytics.status.select')}
            placeholder={t('analytics.status.all')}
            options={options}
            selected={selected}
            onChange={setSelected}
          />
        ) : null
      }
    >
      {(data): ReactNode => (
        <>
          <div aria-hidden="true" className="min-w-0 overflow-hidden">
            <EChart
              option={chart(data)}
              className="w-full"
              style={{ height: Math.max(140, data.filter((row) => row.sampleCount > 0).length * 44 + 56) }}
            />
          </div>
          <div className="overflow-x-auto">
            <Table aria-label={t('analytics.status.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('analytics.status.col.status')}</TableHead>
                  <TableHead className="text-right">{t('analytics.status.col.average')}</TableHead>
                  <TableHead className="text-right">{t('analytics.status.col.stays')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.statusCode}>
                    <TableCell>
                      <Badge
                        className="font-medium"
                        style={statusBadgeStyle(byCode.get(row.statusCode)?.color ?? NEUTRAL)}
                      >
                        {nameOf(row.statusCode)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {row.averageSeconds === null || row.sampleCount === 0 ? (
                        <span className="text-muted-foreground">{t('analytics.status.noStays')}</span>
                      ) : (
                        durationLabel(row.averageSeconds, language)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.sampleCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{t('analytics.status.note')}</p>
        </>
      )}
    </FigureCard>
  );
}
