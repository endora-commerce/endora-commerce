import { useId, type ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Button } from '../../ui/button.js';
import { Card } from '../../ui/card.js';
import { ApiError } from '../../lib/api-client.js';
import { cn } from '../../lib/utils.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import type { Figure } from './use-figure.js';

export interface FigureCardProps<T> {
  title: string;
  /** One sentence under the title: what the figure is computed over. */
  description: string;
  figure: Figure<T>;
  /** Whether an answer holds nothing to show. */
  isEmpty: (data: T) => boolean;
  /** What is said instead of the figure when it holds nothing. */
  emptyMessage: string;
  /** What is said when a read failed without the server's own words for it. */
  errorFallback: string;
  /** A control that belongs to this figure alone, beside its title. */
  action?: ReactNode;
  /**
   * What is said under every answer, the empty one included — the basis a
   * module states its figures on (its period, what it counted). Not drawn
   * while there is no answer.
   */
  footer?: (data: T) => ReactNode;
  className?: string;
  children: (data: T) => ReactNode;
}

/**
 * The frame of one analytics figure, with the four states every one of them
 * has: on its way, failed (in the server's words, with a way to ask again),
 * nothing in the range, and the figure itself.
 *
 * A region named by its heading, so each figure is a landmark a screen reader
 * can jump to. The status line is mounted before it has text — a live region
 * that arrives already carrying its message is not reliably announced.
 *
 * Promoted from CRM's and Projects' `pages/analytics/FigureCard.tsx` (issue
 * #464): the module's sentences are props, so the frame names no module.
 */
export function FigureCard<T>(props: FigureCardProps<T>): ReactNode {
  const { title, description, figure, isEmpty, emptyMessage, errorFallback, action, footer, className, children } = props;
  const tCore = useTranslation('core');
  const headingId = useId();
  const { data, loading, error, reload } = figure;
  const failed = error !== null;

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      aria-busy={loading}
      // A grid item is at least as wide as its widest content unless told
      // otherwise; a table or a chart would push the card past a phone's screen.
      className={cn('min-w-0', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-0 sm:p-6 sm:pb-0">
        <div className="space-y-1">
          <h2 id={headingId} className="text-base font-semibold leading-tight tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action ?? null}
      </div>
      <div className="min-w-0 space-y-4 p-4 sm:p-6">
        <p role="status" className={loading ? 'text-sm text-muted-foreground' : 'sr-only'}>
          {loading ? tCore('common.state.loading') : ''}
        </p>
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error instanceof ApiError ? error.envelope.error.message : errorFallback}</span>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={reload}>
                {tCore('common.action.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : data === null ? null : (
          <>
            {isEmpty(data) ? (
              <div className="flex items-start gap-3 py-2 text-sm text-muted-foreground">
                <BarChart3 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <p>{emptyMessage}</p>
              </div>
            ) : (
              children(data)
            )}
            {footer ? footer(data) : null}
          </>
        )}
      </div>
    </Card>
  );
}
