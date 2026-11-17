import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectSummary } from '@endora-commerce/contracts';
import {
  EChart,
  prefersReducedMotion,
  useChartColors,
  type ChartColors,
  type EChartProps,
  type Figure,
} from '@endora-commerce/admin-kit/components';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  DurationsFigure,
  LossesFigure,
  ManagersFigure,
  SummaryFigure,
  TimeInStageFigure,
  TopOpenFigure,
  ValueFigure,
} from '../../analytics-api.js';
import { StageDot } from '../../components/StageDot.js';
import { chartDays, daysLabel, percentLabel } from '../../lib/analytics-format.js';
import { NO_VALUE, valueLabel } from '../../lib/labels.js';
import { FigureCard } from './FigureCard.js';

/**
 * The cards of the Project analytics screen (`contracts/admin-surfaces.md` §2).
 *
 * **A chart is never the only carrier.** Each chart is hidden from assistive
 * technology and sits above a table of the same numbers. **Money is per
 * currency**, as the endpoints answer it — nothing here adds two currencies.
 */

/** A horizontal bar chart of one series, one bar per label, in the order given. */
function barOption(
  labels: readonly string[],
  values: readonly number[],
  colors: ChartColors,
  axisName: string,
  format: (value: number) => string,
): EChartProps['option'] {
  return {
    animation: !prefersReducedMotion(),
    grid: { left: 8, right: 32, top: 8, bottom: 28, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value): string => format(Number(value)) },
    xAxis: {
      type: 'value',
      name: axisName,
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: colors.muted },
      axisLabel: { color: colors.muted },
      splitLine: { lineStyle: { color: colors.line } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: [...labels],
      axisLabel: { color: colors.text },
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
    },
    series: [{ type: 'bar', barMaxWidth: 28, itemStyle: { color: colors.bar }, data: [...values] }],
  };
}

function Chart({ option, bars }: { option: EChartProps['option']; bars: number }): ReactNode {
  return (
    <div aria-hidden="true" className="min-w-0 overflow-hidden">
      <EChart option={option} className="w-full" style={{ height: Math.max(140, bars * 44 + 56) }} />
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }): ReactNode {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function SummaryCard({ figure }: { figure: Figure<SummaryFigure> }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  return (
    <FigureCard
      title={t('analytics.summary.title')}
      description={t('analytics.summary.description')}
      figure={figure}
      isEmpty={({ data }): boolean => data.opened + data.completed + data.lost === 0}
      emptyMessage={t('analytics.summary.empty')}
    >
      {({ data }): ReactNode => (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={t('analytics.summary.opened')} value={String(data.opened)} />
          <Stat label={t('analytics.summary.completed')} value={String(data.completed)} />
          <Stat label={t('analytics.summary.lost')} value={String(data.lost)} />
          <Stat
            label={t('analytics.summary.rate')}
            value={data.completionRate === null ? NO_VALUE : percentLabel(data.completionRate, language)}
            {...(data.completionRate === null ? { note: t('analytics.summary.rateNone') } : {})}
          />
        </div>
      )}
    </FigureCard>
  );
}

export function DurationsCard({ figure }: { figure: Figure<DurationsFigure> }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const days = (value: number | null): string => (value === null ? NO_VALUE : daysLabel(value, language));
  return (
    <FigureCard
      title={t('analytics.durations.title')}
      description={t('analytics.durations.description')}
      figure={figure}
      isEmpty={({ data }): boolean => data.completedCount + data.lostCount === 0}
      emptyMessage={t('analytics.durations.empty')}
    >
      {({ data }): ReactNode => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Stat
            label={t('analytics.durations.completed')}
            value={days(data.completedAverageDays)}
            note={t('analytics.count.projects', { count: data.completedCount })}
          />
          <Stat
            label={t('analytics.durations.lost')}
            value={days(data.lostAverageDays)}
            note={t('analytics.count.projects', { count: data.lostCount })}
          />
        </div>
      )}
    </FigureCard>
  );
}

export function TimeInStageCard({ figure }: { figure: Figure<TimeInStageFigure> }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const colors = useChartColors();
  return (
    <FigureCard
      title={t('analytics.stages.title')}
      description={t('analytics.stages.description')}
      figure={figure}
      isEmpty={({ data }): boolean => data.every((row) => row.sampleCount === 0)}
      emptyMessage={t('analytics.stages.empty')}
    >
      {({ data }): ReactNode => {
        const drawn = data.filter((row) => row.averageDays !== null && row.sampleCount > 0);
        return (
          <>
            <Chart
              bars={drawn.length}
              option={barOption(
                drawn.map((row) => row.stageName),
                drawn.map((row) => chartDays(row.averageDays ?? 0)),
                colors,
                t('analytics.chart.days'),
                (value) => daysLabel(value, language),
              )}
            />
            <div className="overflow-x-auto">
              <Table aria-label={t('analytics.stages.title')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('analytics.col.stage')}</TableHead>
                    <TableHead className="text-right">{t('analytics.stages.col.average')}</TableHead>
                    <TableHead className="text-right">{t('analytics.stages.col.stays')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.stageName}>
                      <TableCell className="[overflow-wrap:anywhere]">{row.stageName}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {row.averageDays === null ? NO_VALUE : daysLabel(row.averageDays, language)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.sampleCount}</TableCell>
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

export function LossStagesCard({ figure }: { figure: Figure<LossesFigure> }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const colors = useChartColors();
  return (
    <FigureCard
      title={t('analytics.lossStages.title')}
      description={t('analytics.lossStages.description')}
      figure={figure}
      isEmpty={({ data }): boolean => data.byStage.length === 0}
      emptyMessage={t('analytics.losses.empty')}
    >
      {({ data }): ReactNode => (
        <>
          <Chart
            bars={data.byStage.length}
            option={barOption(
              data.byStage.map((row) => row.stageName),
              data.byStage.map((row) => row.count),
              colors,
              t('analytics.chart.projects'),
              (value) => String(value),
            )}
          />
          <div className="overflow-x-auto">
            <Table aria-label={t('analytics.lossStages.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('analytics.col.stage')}</TableHead>
                  <TableHead className="text-right">{t('analytics.col.lost')}</TableHead>
                  <TableHead className="text-right">{t('analytics.col.share')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byStage.map((row) => (
                  <TableRow key={row.stageName}>
                    <TableCell className="[overflow-wrap:anywhere]">{row.stageName}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{percentLabel(row.share, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </FigureCard>
  );
}

export function LossReasonsCard({ figure }: { figure: Figure<LossesFigure> }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  return (
    <FigureCard
      title={t('analytics.lossReasons.title')}
      description={t('analytics.lossReasons.description')}
      figure={figure}
      isEmpty={({ data }): boolean => data.byReason.length === 0}
      emptyMessage={t('analytics.losses.empty')}
    >
      {({ data }): ReactNode => (
        <Table aria-label={t('analytics.lossReasons.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('analytics.lossReasons.col.reason')}</TableHead>
              <TableHead className="text-right">{t('analytics.col.lost')}</TableHead>
              <TableHead className="text-right">{t('analytics.col.share')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byReason.map((row) => (
              <TableRow key={row.lossReasonId}>
                <TableCell className="[overflow-wrap:anywhere]">{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                <TableCell className="text-right tabular-nums">{percentLabel(row.share, language)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FigureCard>
  );
}

export function LostValueCard({ figure }: { figure: Figure<LossesFigure> }): ReactNode {
  const t = useTranslation('projects');
  return (
    <FigureCard
      title={t('analytics.lostValue.title')}
      description={t('analytics.lostValue.description')}
      figure={figure}
      money
      isEmpty={({ data }): boolean => data.lostValue.length === 0}
      emptyMessage={t('analytics.lostValue.empty')}
    >
      {({ data }): ReactNode => (
        <Table aria-label={t('analytics.lostValue.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('analytics.col.currency')}</TableHead>
              <TableHead className="text-right">{t('analytics.lostValue.col.total')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lostValue.map((row) => (
              <TableRow key={row.currency}>
                <TableCell className="font-medium">{row.currency}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-lg font-semibold tabular-nums">
                  {valueLabel(row)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FigureCard>
  );
}

export function AverageValueCard({ figure }: { figure: Figure<ValueFigure> }): ReactNode {
  const t = useTranslation('projects');
  return (
    <FigureCard
      title={t('analytics.value.title')}
      description={t('analytics.value.description')}
      figure={figure}
      money
      isEmpty={({ data }): boolean => data.average.length === 0}
      emptyMessage={t('analytics.value.empty')}
    >
      {({ data }): ReactNode => (
        <Table aria-label={t('analytics.value.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('analytics.col.currency')}</TableHead>
              <TableHead className="text-right">{t('analytics.value.col.average')}</TableHead>
              <TableHead className="text-right">{t('analytics.col.projects')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.average.map((row) => (
              <TableRow key={row.currency}>
                <TableCell className="font-medium">{row.currency}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-lg font-semibold tabular-nums">
                  {valueLabel(row)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FigureCard>
  );
}

/** The Projects of one currency, in the order the server ranked them. */
function byCurrency(rows: readonly ProjectSummary[]): Array<[string, ProjectSummary[]]> {
  const groups = new Map<string, ProjectSummary[]>();
  for (const row of rows) {
    const currency = row.value?.currency ?? '';
    groups.set(currency, [...(groups.get(currency) ?? []), row]);
  }
  return [...groups.entries()];
}

export function TopOpenCard({ figure }: { figure: Figure<TopOpenFigure> }): ReactNode {
  const t = useTranslation('projects');
  return (
    <FigureCard
      title={t('analytics.top.title')}
      description={t('analytics.top.description')}
      figure={figure}
      money
      isEmpty={({ data }): boolean => data.length === 0}
      emptyMessage={t('analytics.top.empty')}
      className="lg:col-span-2"
    >
      {({ data }): ReactNode => (
        <div className="space-y-6">
          {byCurrency(data).map(([currency, rows]) => (
            <div key={currency} className="overflow-x-auto">
              <Table aria-label={t('analytics.top.caption', { currency })}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('analytics.top.col.project')}</TableHead>
                    <TableHead>{t('analytics.col.stage')}</TableHead>
                    <TableHead className="text-right">{t('analytics.top.col.value')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                          <Link
                            to={`/projects/${row.id}`}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {row.number}
                          </Link>
                          <span>{row.title}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.currentStage ? (
                          <span className="flex items-center gap-2">
                            <StageDot color={row.currentStage.color} />
                            <span>{row.currentStage.name}</span>
                          </span>
                        ) : (
                          NO_VALUE
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                        {valueLabel(row.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}
    </FigureCard>
  );
}

export function ManagersCard({ figure }: { figure: Figure<ManagersFigure> }): ReactNode {
  const t = useTranslation('projects');
  return (
    <FigureCard
      title={t('analytics.managers.title')}
      description={t('analytics.managers.description')}
      figure={figure}
      isEmpty={({ data }): boolean => data.length === 0}
      emptyMessage={t('analytics.managers.empty')}
    >
      {({ data }): ReactNode => (
        <Table aria-label={t('analytics.managers.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('analytics.managers.col.person')}</TableHead>
              <TableHead className="text-right">{t('analytics.managers.col.completed')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.adminUser.id}>
                <TableCell className="[overflow-wrap:anywhere]">{row.adminUser.name || NO_VALUE}</TableCell>
                <TableCell className="text-right tabular-nums">{row.completedCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FigureCard>
  );
}
