import { useCallback, useMemo, useState } from 'react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '../../lib/page-size-options.js';
import { usePageSizePreference } from '../../lib/use-page-size-preference.js';
import type { PaginationFooterProps } from '../PaginationFooter.js';

/**
 * The page sizes a list can actually serve: the shared options up to the
 * endpoint's own maximum (issue #1439, DS-05).
 *
 * The shared options run to 500, and most admin list endpoints stop at 100 or
 * 200 — offering 500 there is a dropdown that answers "Showing 1–500" over 200
 * rows, or a 400. The smallest option always survives, so the dropdown is never
 * empty.
 */
export function pageSizesUpTo(max: number): PageSizeOption[] {
  const fitting = PAGE_SIZE_OPTIONS.filter((size) => size <= max);
  return fitting.length > 0 ? fitting : [PAGE_SIZE_OPTIONS[0]];
}

/**
 * The page size to use when the admin's remembered one is not offered here:
 * the largest offered size not above it, else the smallest offered. A
 * preference of 500 on a list that stops at 100 reads as 100, and the stored
 * preference is left alone for the lists that do serve 500.
 */
export function fitPageSize(preferred: PageSizeOption, sizes: readonly PageSizeOption[]): PageSizeOption {
  if (sizes.includes(preferred)) return preferred;
  const below = sizes.filter((size) => size <= preferred);
  return below.length > 0 ? below[below.length - 1]! : sizes[0]!;
}

/** The zero-based index of the last page; `0` for an empty list. */
export function lastPageIndex(total: number, pageSize: number): number {
  return total <= 0 ? 0 : Math.ceil(total / pageSize) - 1;
}

export interface UseListPaginationOptions {
  /**
   * The list's id for the admin's remembered page size
   * (`usePageSizePreference`) — `'customers'`, `'organizations'`. Two screens
   * naming one scope share the value.
   */
  scope: string;
  /** The largest page size the list's endpoint accepts. */
  maxPageSize: number;
}

export interface ListPagination {
  /** Zero-based page index, as `PaginationFooter` takes it. */
  page: number;
  pageSize: PageSizeOption;
  pageSizes: readonly PageSizeOption[];
  /** The request parameters: a **one-based** `page`, as every admin list endpoint pages. */
  query: { page: number; pageSize: number };
  /** Back to the first page — call it whenever a filter or the search changes. */
  resetPage: () => void;
  /**
   * Report the total a response carried. A page the total no longer reaches —
   * the last rows were deleted, or another administrator's change shrank the
   * list — moves back to the last page that exists instead of showing an empty
   * page with a "Next" that is disabled and a "Previous" the user has to find.
   */
  syncTotal: (total: number) => void;
  /** The props `PaginationFooter` takes, for the total the list last reported. */
  footer: (total: number) => PaginationFooterProps<PageSizeOption>;
}

/**
 * Page state for a server-paged admin list (issue #1439, DS-05; the
 * `ListPage` pattern in the kit README): the remembered page size, fitted to
 * what the endpoint serves; the page; the request parameters; and the
 * `PaginationFooter` props. A page-size change goes back to the first page,
 * because the old index points somewhere else under the new size.
 */
export function useListPagination({ scope, maxPageSize }: UseListPaginationOptions): ListPagination {
  const { pageSize: preferred, setPageSize: setPreferred } = usePageSizePreference(scope);
  const pageSizes = useMemo(() => pageSizesUpTo(maxPageSize), [maxPageSize]);
  const pageSize = fitPageSize(preferred, pageSizes);
  const [page, setPage] = useState(0);

  const resetPage = useCallback((): void => setPage(0), []);
  const syncTotal = useCallback(
    (total: number): void => {
      const last = lastPageIndex(total, pageSize);
      setPage((current) => (current > last ? last : current));
    },
    [pageSize],
  );
  const footer = useCallback(
    (total: number): PaginationFooterProps<PageSizeOption> => ({
      page,
      pageSize,
      total,
      pageSizes,
      onPageSizeChange: (next) => {
        setPreferred(next);
        setPage(0);
      },
      onPrev: () => setPage((current) => Math.max(0, current - 1)),
      onNext: () => setPage((current) => Math.min(lastPageIndex(total, pageSize), current + 1)),
    }),
    [page, pageSize, pageSizes, setPreferred],
  );

  return {
    page,
    pageSize,
    pageSizes,
    query: { page: page + 1, pageSize },
    resetPage,
    syncTotal,
    footer,
  };
}
