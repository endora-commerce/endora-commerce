import { useMemo, type ReactNode } from 'react';
import type { OpportunityHandlingTime } from '@endora-commerce/contracts';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmAnalyticsApi, type AnalyticsFilters } from '../../analytics-api.js';
import { durationLabel } from '../../lib/analytics-format.js';
import { NO_VALUE } from '../../lib/labels.js';
import { useFigure } from '../../lib/use-figure.js';
import { FigureCard } from './FigureCard.js';

/** Average handling time: creation to closing, with won and lost apart. */
export function HandlingTimeCard({ filters }: { filters: AnalyticsFilters | null }): ReactNode {
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const load = useMemo(
    () => (filters ? (): Promise<OpportunityHandlingTime> => crmAnalyticsApi.handlingTime(filters) : null),
    [filters],
  );
  const figure = useFigure(load);
  const time = (seconds: number | null): string =>
    seconds === null ? NO_VALUE : durationLabel(seconds, language);

  return (
    <FigureCard
      title={t('analytics.handling.title')}
      description={t('analytics.handling.description')}
      figure={figure}
      isEmpty={(data): boolean => data.closedCount === 0}
      emptyMessage={t('analytics.handling.empty')}
    >
      {(data): ReactNode => (
        <>
          <div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{time(data.averageSeconds)}</p>
            <p className="text-sm text-muted-foreground">
              {t('analytics.handling.closed', { count: data.closedCount })}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('analytics.outcome.won')}</dt>
              <dd className="font-medium tabular-nums">{time(data.byOutcome.won.averageSeconds)}</dd>
              <dd className="text-muted-foreground">
                {t('analytics.count.opportunities', { count: data.byOutcome.won.closedCount })}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('analytics.outcome.lost')}</dt>
              <dd className="font-medium tabular-nums">{time(data.byOutcome.lost.averageSeconds)}</dd>
              <dd className="text-muted-foreground">
                {t('analytics.count.opportunities', { count: data.byOutcome.lost.closedCount })}
              </dd>
            </div>
          </dl>
        </>
      )}
    </FigureCard>
  );
}
