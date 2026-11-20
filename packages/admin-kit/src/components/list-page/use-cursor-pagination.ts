import { useCallback, useMemo, useState } from 'react';
import type { PageSizeOption } from '../../lib/page-size-options.js';
import { usePageSizePreference } from '../../lib/use-page-size-preference.js';
import type { CursorPaginationFooterProps } from '../PaginationFooter.js';
import { fitPageSize, pageSizesUpTo, type UseListPaginationOptions } from './use-list-pagination.js';

/** What a cursor-paged endpoint answers about the page it returned (`paginationSchema`). */
export interface CursorPageInfo {
  /** The cursor of the next page; `null` once there is none. */
  cursor: string | null;
  hasMore: boolean;
}

export interface CursorListPagination {
  /** Zero-based index of the page on screen. */
  page: number;
  pageSize: PageSizeOption;
  pageSizes: readonly PageSizeOption[];
  /** The request parameters: the cursor of the page on screen (`null` for the first) and `limit`. */
  query: { cursor: string | null; limit: number };
  /** Back to the first page — call it whenever a filter or the search changes. */
  resetPage: () => void;
  /**
   * Report what a response answered: its `pagination`, and how many rows it
   * held. The next page's cursor is kept for *Next*; a later page that comes
   * back empty — its rows were deleted after the previous page said more
   * existed — steps back one page instead of showing nothing.
   */
  syncPage: (pagination: CursorPageInfo, rowCount: number) => void;
  /** The props `PaginationFooter` takes in cursor mode, for the rows on screen. */
  footer: (rowCount: number) => CursorPaginationFooterProps<PageSizeOption>;
}

interface TrailState {
  /** The cursors that led to the page on screen; empty on the first page. */
  trail: readonly string[];
  /** The cursor of the next page, once the page on screen answered one. */
  next: string | null;
}

const FIRST_PAGE: TrailState = { trail: [], next: null };

/**
 * Page state for a cursor-paged admin list (issue #1664): the counterpart of
 * `useListPagination` for an endpoint that answers `{ cursor, hasMore, limit }`
 * and no total, so it can only walk forward. *Previous* goes back along the
 * cursors already followed. The remembered page size is shared with
 * `useListPagination` (one preference per `scope`), fitted the same way, and a
 * size change goes back to the first page.
 */
export function useCursorPagination({ scope, maxPageSize }: UseListPaginationOptions): CursorListPagination {
  const { pageSize: preferred, setPageSize: setPreferred } = usePageSizePreference(scope);
  const pageSizes = useMemo(() => pageSizesUpTo(maxPageSize), [maxPageSize]);
  const pageSize = fitPageSize(preferred, pageSizes);
  const [state, setState] = useState<TrailState>(FIRST_PAGE);

  const resetPage = useCallback((): void => setState(FIRST_PAGE), []);
  const syncPage = useCallback((pagination: CursorPageInfo, rowCount: number): void => {
    setState((current) => {
      if (rowCount === 0 && current.trail.length > 0) {
        return { trail: current.trail.slice(0, -1), next: null };
      }
      const next = pagination.hasMore ? pagination.cursor : null;
      return current.next === next ? current : { trail: current.trail, next };
    });
  }, []);

  const footer = useCallback(
    (rowCount: number): CursorPaginationFooterProps<PageSizeOption> => ({
      mode: 'cursor',
      page: state.trail.length,
      pageSize,
      pageSizes,
      rowCount,
      hasNext: state.next !== null,
      onPageSizeChange: (next) => {
        setPreferred(next);
        setState(FIRST_PAGE);
      },
      onPrev: () => setState((current) => ({ trail: current.trail.slice(0, -1), next: null })),
      // The next cursor is spent in the same update, so a second press before
      // the page answers finds no cursor and cannot skip a page.
      onNext: () =>
        setState((current) => (current.next === null ? current : { trail: [...current.trail, current.next], next: null })),
    }),
    [state, pageSize, pageSizes, setPreferred],
  );

  return {
    page: state.trail.length,
    pageSize,
    pageSizes,
    query: { cursor: state.trail[state.trail.length - 1] ?? null, limit: pageSize },
    resetPage,
    syncPage,
    footer,
  };
}
