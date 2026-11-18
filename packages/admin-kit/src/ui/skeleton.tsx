import { type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from '../i18n/useTranslation.js';
import { cn } from '../lib/utils.js';

/**
 * Issue #1447 (UX audit DS-14) — the placeholder a screen shows while it has
 * nothing yet, shaped like what will replace it so nothing shifts when it does.
 *
 * It is for a **first load only**. Once a record is on screen a refresh keeps it
 * there and marks it `aria-busy` (`useDetailResource`); replacing it with a
 * skeleton again would lose the tab, the scroll position and the focus.
 *
 * A block is decoration, hidden from assistive technology: the region around it
 * says what is loading. The pulse is `motion-safe:` only, so under
 * `prefers-reduced-motion` the shape stays and the motion goes — the shape alone
 * still reads as "not here yet", and the region's text says it outright.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('rounded-md bg-muted motion-safe:animate-pulse', className)}
      {...props}
    />
  );
}

export interface DetailSkeletonProps {
  /** What a screen reader hears; defaults to `common.state.loading`. */
  label?: string;
  /** Number of field rows in the body card. */
  rows?: number;
  /** Draw the tab strip at the top of the card; `false` for an editor with no tabs. */
  tabs?: boolean;
  className?: string;
}

/**
 * A detail screen's first load: the page header (back link, title, actions),
 * a tab strip (`tabs={false}` drops it) and a card of label/value rows — the layout every record screen
 * built on `PageHeader` and one tabbed `Card` settles into.
 *
 * It is a `role="status"` region with `aria-busy`, carrying its label as
 * visually hidden text.
 */
export function DetailSkeleton({ label, rows = 6, tabs = true, className }: DetailSkeletonProps): ReactNode {
  const t = useTranslation('core');
  return (
    <div
      role="status"
      aria-busy="true"
      data-slot="detail-skeleton"
      className={cn('space-y-4', className)}
    >
      <span className="sr-only">{label ?? t('common.state.loading')}</span>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-7 w-64 max-w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        {tabs ? (
          <div className="mb-6 flex gap-4 border-b pb-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-full max-w-xs" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
