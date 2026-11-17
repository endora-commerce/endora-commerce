import type { ReactNode } from 'react';
import { FigureCard as KitFigureCard, type Figure } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { FigureEnvelope } from '../../analytics-api.js';
import { calendarDateLabel } from '../../lib/labels.js';

export interface FigureCardProps<T extends FigureEnvelope> {
  title: string;
  /** One sentence under the title: which Projects the figure is computed over. */
  description: string;
  figure: Figure<T>;
  /** Whether an answer holds nothing to show. */
  isEmpty: (data: T) => boolean;
  /** What is said instead of the figure when it holds nothing. */
  emptyMessage: string;
  /** Whether the figure shows amounts, so Projects without a value were left out of it. */
  money?: boolean;
  className?: string;
  children: (data: T) => ReactNode;
}

/**
 * The kit's figure frame (`@endora-commerce/admin-kit/components`, issue #464)
 * with what FR-038 asks every Projects figure to say under it: the period, how
 * many Projects it counted, and how many it left out of its amounts for having
 * no value. That envelope is this module's answer shape, so it stays here.
 */
export function FigureCard<T extends FigureEnvelope>(props: FigureCardProps<T>): ReactNode {
  const { money = false, ...frame } = props;
  const t = useTranslation('projects');
  const { language } = useAppLanguage();

  return (
    <KitFigureCard
      {...frame}
      errorFallback={t('analytics.error.load')}
      footer={(data): ReactNode => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            {t('analytics.basis', {
              from: calendarDateLabel(data.from, language),
              to: calendarDateLabel(data.to, language),
              count: data.projectCount,
            })}
          </p>
          {money && data.excluded.noValue > 0 ? <p>{t('analytics.excluded', { count: data.excluded.noValue })}</p> : null}
        </div>
      )}
    />
  );
}
