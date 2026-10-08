import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OpportunitySummary } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Badge,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmAnalyticsApi, type AnalyticsFilters, type TopOpportunitiesBasis } from '../../analytics-api.js';
import { AssigneeName } from '../../components/AssigneeName.js';
import { moneyLabel } from '../../lib/labels.js';
import { useFigure } from '../../lib/use-figure.js';
import { FigureCard } from './FigureCard.js';

/** How many Opportunities are listed per currency. */
const PER_CURRENCY = 10;

/** The answer is ordered by currency already; this keeps that order. */
function byCurrency(rows: readonly OpportunitySummary[]): Array<[string, OpportunitySummary[]]> {
  const groups = new Map<string, OpportunitySummary[]>();
  for (const row of rows) groups.set(row.currency, [...(groups.get(row.currency) ?? []), row]);
  return [...groups.entries()];
}

/**
 * The most valuable Opportunities of the range — a list per currency, because
 * 3 000 EUR and 3 000 PLN are not the same place in one ranking. A table and
 * no chart: what matters here is which Opportunities, and each is a link.
 */
export function TopOpportunitiesCard({ filters }: { filters: AnalyticsFilters | null }): ReactNode {
  const t = useTranslation('crm');
  const basisId = useId();
  const [basis, setBasis] = useState<TopOpportunitiesBasis>('created');
  const load = useMemo(
    () =>
      filters
        ? (): Promise<OpportunitySummary[]> => crmAnalyticsApi.topOpportunities(filters, basis, PER_CURRENCY)
        : null,
    [filters, basis],
  );
  const figure = useFigure(load);

  return (
    <FigureCard
      title={t('analytics.top.title')}
      description={t('analytics.top.description', { count: PER_CURRENCY })}
      figure={figure}
      isEmpty={(data): boolean => data.length === 0}
      emptyMessage={t('analytics.top.empty')}
      className="lg:col-span-2"
      action={
        <div className="w-full space-y-1 sm:w-56">
          <Label htmlFor={basisId}>{t('analytics.top.basis')}</Label>
          <Select
            id={basisId}
            className="min-h-11 sm:min-h-9"
            value={basis}
            onChange={(event): void => setBasis(event.target.value as TopOpportunitiesBasis)}
          >
            <option value="created">{t('analytics.top.basis.created')}</option>
            <option value="closed">{t('analytics.top.basis.closed')}</option>
          </Select>
        </div>
      }
    >
      {(data): ReactNode => (
        <div className="space-y-6">
          {byCurrency(data).map(([currency, rows]) => (
            <section key={currency} className="space-y-2">
              <h3 className="text-sm font-semibold">{currency}</h3>
              <div className="overflow-x-auto">
                <Table aria-label={t('analytics.top.caption', { currency })}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('analytics.top.col.opportunity')}</TableHead>
                      <TableHead>{t('analytics.top.col.organization')}</TableHead>
                      <TableHead>{t('analytics.top.col.status')}</TableHead>
                      <TableHead>{t('analytics.top.col.rep')}</TableHead>
                      <TableHead className="text-right">{t('analytics.top.col.value')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Link
                            to={`/crm/opportunities/${row.id}`}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {row.number}
                          </Link>
                          <span className="block text-muted-foreground">{row.title}</span>
                        </TableCell>
                        <TableCell>{row.organization.name}</TableCell>
                        <TableCell>
                          <Badge className="font-medium" style={statusBadgeStyle(row.status.color)}>
                            {row.status.name}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <AssigneeName assignee={row.assignee} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                          {moneyLabel(row.value, row.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
        </div>
      )}
    </FigureCard>
  );
}
