import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Skeleton } from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';

export interface PageBuilderLoadingSkeletonProps {
  /** What a screen reader hears; defaults to the kit's `common.state.loading`. */
  label?: string;
  /** Sizing from the host — the canvas height the builder will take once loaded. */
  className?: string;
}

const DRAWER_ROWS = ['w-3/4', 'w-2/3', 'w-4/5', 'w-1/2', 'w-3/4', 'w-2/3'] as const;
const FIELD_ROWS = 4;

/**
 * Issue #1540 (UX audit 2026-11-17, CONTENT-23) — what a page builder (the CMS
 * page, block and template editors, the blog editors, the document-template
 * editor) shows while its config or its record is still on the way: the shape
 * of the builder that will replace it — a toolbar over three panes, the blocks
 * drawer, the canvas and the fields panel — so nothing shifts when Puck mounts.
 *
 * It is a first-load placeholder only, built on the kit's `Skeleton` (#1447):
 * every block is `aria-hidden`, the region is a polite `role="status"` marked
 * `aria-busy`, and its label is visually hidden text. Under
 * `prefers-reduced-motion` the pulse stops and the shape stays. The side panes
 * drop below `md`, where Puck collapses them too.
 */
export function PageBuilderLoadingSkeleton({ label, className }: PageBuilderLoadingSkeletonProps): ReactNode {
  const t = useTranslation('core');
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-slot="page-builder-skeleton"
      className={cn('flex min-h-[640px] flex-col overflow-hidden rounded-md border', className)}
    >
      <span className="sr-only">{label ?? t('common.state.loading')}</span>
      <div data-pane="toolbar" className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex gap-2">
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div data-pane="drawer" className="hidden w-60 shrink-0 space-y-3 border-r p-3 md:block">
          <Skeleton className="h-4 w-24" />
          {DRAWER_ROWS.map((width, index) => (
            <Skeleton key={index} className={cn('h-8', width)} />
          ))}
        </div>
        <div data-pane="canvas" className="flex min-w-0 flex-1 justify-center bg-muted/40 p-6">
          <div className="w-full max-w-3xl space-y-4 rounded-md bg-background p-6 shadow-sm">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="grid grid-cols-3 gap-4 pt-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </div>
        </div>
        <div data-pane="fields" className="hidden w-72 shrink-0 space-y-4 border-l p-3 md:block">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: FIELD_ROWS }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
