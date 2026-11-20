import type { ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Button } from '../../ui/button.js';
import { Card, CardContent } from '../../ui/card.js';
import { PageHeader } from '../../ui/page-header.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import type { PageSizeOption } from '../../lib/page-size-options.js';
import {
  PaginationFooter,
  type CursorPaginationFooterProps,
  type PaginationFooterProps,
} from '../PaginationFooter.js';

/**
 * Where a list's data is. `error` carries the message to show — the server's
 * own when it gave one; the kit's generic copy otherwise.
 */
export type ListPageLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message?: ReactNode }
  | { kind: 'ready' };

export interface ListPageProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * The header's actions: the **one** primary "New …" (Von Restorff), and at
   * most an overflow menu for screen-wide secondary actions. A create form is
   * never drawn open above the list — "New …" opens a `ModalDialog` (up to five
   * fields) or its own route.
   */
  actions?: ReactNode;
  /**
   * Section tabs under the header (`RouteTabs`) — for a list that is one of a
   * module's sections, as Invoices sits beside its templates (issue #1664).
   */
  tabs?: ReactNode;
  /**
   * The filters and the search: a plain row, not a card — a card around the
   * toolbar reads as a second, competing region (Common Region), and it is
   * what made every list here a different shape.
   */
  toolbar?: ReactNode;
  /**
   * The result count ("42 customers"), shown at the end of the toolbar row and
   * announced politely. The live region is mounted on the first render, before
   * it has any text, so a screen reader hears the count arrive (WCAG 4.1.3).
   */
  count?: ReactNode;
  /** A message about an action taken on the list — above the results, inside their region. */
  notice?: ReactNode;
  load: ListPageLoad;
  /** Offered beside a load error; the error has no way out without it. */
  onRetry?: () => void;
  /**
   * The pager — `useListPagination(...).footer(total)`, or
   * `useCursorPagination(...).footer(rowCount)` for a cursor-paged endpoint
   * that answers no total (issue #1664). Rendered only once the list is ready
   * and holds rows, so a first page of nothing does not draw a "Showing 0 of 0"
   * under the empty state.
   */
  pagination?: PaginationFooterProps<PageSizeOption> | CursorPaginationFooterProps<PageSizeOption> | null;
  /** The results — a `ResponsiveTable` with its `emptyState` and `renderActions`. */
  children: ReactNode;
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e'] as const;

/**
 * The admin list page (issue #1439, UX audit DS-05): `PageHeader` with the
 * "New …" action, a toolbar row without a card, one results region holding the
 * table, and the `PaginationFooter` under it. Row actions go through
 * `RowActionMenu`, destructive ones last and confirmed with `useConfirmDialog`.
 * The full pattern, and what is deliberately left to the screen, is in the kit
 * README's "List pages" section.
 */
export function ListPage(props: ListPageProps): ReactNode {
  const { title, description, actions, tabs, toolbar, count, notice, load, onRetry, pagination, children } = props;
  const t = useTranslation('core');
  const loading = load.kind === 'loading';

  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      {tabs}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {toolbar}
        <p role="status" aria-live="polite" className="ml-auto self-center text-sm text-muted-foreground">
          {loading ? t('common.state.loading') : load.kind === 'ready' ? count : null}
        </p>
      </div>
      <Card aria-busy={loading || undefined}>
        <CardContent className="space-y-4 p-4">
          {notice}
          {loading ? (
            <div aria-hidden="true" className="space-y-3" data-testid="list-page-skeleton">
              {SKELETON_ROWS.map((row) => (
                <div key={row} className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
              ))}
            </div>
          ) : null}
          {load.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{load.message ?? t('common.list.loadError')}</span>
                {onRetry ? (
                  <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                    <RotateCw size={14} aria-hidden="true" />
                    {t('common.action.retry')}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {load.kind === 'ready' ? children : null}
        </CardContent>
        {load.kind === 'ready' && pagination && hasRows(pagination) ? <PaginationFooter {...pagination} /> : null}
      </Card>
    </>
  );
}

/** Whether there is anything to page: rows in the list, or — cursor mode — a page past the first. */
function hasRows(
  pagination: PaginationFooterProps<PageSizeOption> | CursorPaginationFooterProps<PageSizeOption>,
): boolean {
  return pagination.mode === 'cursor' ? pagination.rowCount > 0 || pagination.page > 0 : pagination.total > 0;
}
