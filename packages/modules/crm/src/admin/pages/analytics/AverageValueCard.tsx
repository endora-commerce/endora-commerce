import { useMemo, type ReactNode } from 'react';
import type { OpportunityAverageValueRow } from '@endora-commerce/contracts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmAnalyticsApi, type AnalyticsAnswer, type AnalyticsFilters } from '../../analytics-api.js';
import { moneyLabel } from '../../lib/labels.js';
import { useReportedTimeZone } from '../../lib/reporting-time-zone.js';
import { useFigure } from '../../lib/use-figure.js';
import { FigureCard } from './FigureCard.js';

/**
 * Average Opportunity value — one line per currency. There is no figure for
 * all of them together: amounts in two currencies are not added.
 */
export function AverageValueCard({ filters }: { filters: AnalyticsFilters | null }): ReactNode {
  const t = useTranslation('crm');
  const load = useMemo(
    () => (filters ? (): Promise<AnalyticsAnswer<OpportunityAverageValueRow[]>> => crmAnalyticsApi.averageValue(filters) : null),
    [filters],
  );
  const figure = useFigure(useReportedTimeZone(load));

  return (
    <FigureCard
      title={t('analytics.value.title')}
      description={t('analytics.value.description')}
      figure={figure}
      isEmpty={(data): boolean => data.length === 0}
      emptyMessage={t('analytics.value.empty')}
    >
      {(data): ReactNode => (
        <Table aria-label={t('analytics.value.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('analytics.col.currency')}</TableHead>
              <TableHead className="text-right">{t('analytics.value.col.average')}</TableHead>
              <TableHead className="text-right">{t('analytics.col.opportunities')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.currency}>
                <TableCell className="font-medium">{row.currency}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-lg font-semibold tabular-nums">
                  {moneyLabel(row.average, row.currency)}
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
