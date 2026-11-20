import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '../lib/page-size-options.js';
import { useTranslation } from '../i18n/useTranslation.js';

export interface PaginationFooterProps<S extends number = PageSizeOption> {
  /** A list that knows its total; the default. */
  mode?: 'total';
  /** Zero-based page index. */
  page: number;
  /** Currently chosen page size; one of `pageSizes`. */
  pageSize: S;
  /** Total number of items across all pages (post-filter). */
  total: number;
  /** Called when the user picks a different page size. The list owner
   *  is responsible for resetting `page` to 0 (we don't do it here so
   *  the footer stays a pure presentational component). */
  onPageSizeChange: (next: S) => void;
  onPrev: () => void;
  onNext: () => void;
  /**
   * The page sizes offered; the shared `PAGE_SIZE_OPTIONS` when omitted. For a
   * list whose API pages differently (feature 161: the price-book grid's
   * 50/100/200 lines).
   */
  pageSizes?: readonly S[];
}

/**
 * The footer of a list whose endpoint pages by an opaque cursor and answers no
 * total (issue #1664) — `useCursorPagination(...).footer(rowCount)`. There is
 * no "of Z" and no "Page N of M": the server cannot answer either. While a next
 * page exists the range says "of more than N", which is what the server does
 * know.
 */
export interface CursorPaginationFooterProps<S extends number = PageSizeOption> {
  mode: 'cursor';
  /** Zero-based page index. */
  page: number;
  /** Currently chosen page size; one of `pageSizes`. Every page before this one held this many rows. */
  pageSize: S;
  /** How many rows the page on screen holds. */
  rowCount: number;
  /** Whether the page on screen answered a cursor for the next one. */
  hasNext: boolean;
  onPageSizeChange: (next: S) => void;
  onPrev: () => void;
  onNext: () => void;
  pageSizes?: readonly S[];
}

/**
 * Pagination footer used by the admin list pages — renders a
 * "Showing X–Y of Z" summary, a rows-per-page dropdown wired to
 * `usePageSizePreference`, and Prev/Next buttons. Disabled-state on
 * the buttons reflects page bounds; the empty-list case still renders
 * (so the footer doesn't disappear and "wiggle" the layout).
 */
export function PaginationFooter<S extends number = PageSizeOption>(
  props: PaginationFooterProps<S> | CursorPaginationFooterProps<S>,
): ReactNode {
  const t = useTranslation('core');
  if (props.mode === 'cursor') {
    const { page, pageSize, rowCount, hasNext } = props;
    const start = rowCount === 0 ? 0 : page * pageSize + 1;
    const end = page * pageSize + rowCount;
    return (
      <PagerFrame
        sizes={props.pageSizes ?? (PAGE_SIZE_OPTIONS as readonly number[] as readonly S[])}
        pageSize={pageSize}
        onPageSizeChange={props.onPageSizeChange}
        summary={
          rowCount === 0
            ? t('common.pagination.noResults')
            : hasNext
              ? t('common.pagination.showingRangeMore', { start, end })
              : t('common.pagination.showingRangeOpen', { start, end })
        }
        position={t('cursorPagination.page', { page: page + 1 })}
        onPrev={props.onPrev}
        onNext={props.onNext}
        isFirst={page === 0}
        isLast={!hasNext}
      />
    );
  }
  const { page, pageSize, total, onPageSizeChange, onPrev, onNext } = props;
  const sizes: readonly S[] = props.pageSizes ?? (PAGE_SIZE_OPTIONS as readonly number[] as readonly S[]);
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.min(Math.max(0, page), Math.max(0, totalPages - 1));
  const start = total === 0 ? 0 : safePage * pageSize + 1;
  const end = Math.min((safePage + 1) * pageSize, total);
  const isFirst = safePage === 0;
  const isLast = safePage >= totalPages - 1;

  return (
    <PagerFrame
      sizes={sizes}
      pageSize={pageSize}
      onPageSizeChange={onPageSizeChange}
      summary={
        total === 0 ? t('common.pagination.noResults') : t('common.pagination.showingRange', { start, end, total })
      }
      position={t('common.pagination.pageXofY', {
        page: totalPages === 0 ? 0 : safePage + 1,
        total: totalPages,
      })}
      onPrev={onPrev}
      onNext={onNext}
      isFirst={isFirst}
      isLast={isLast}
    />
  );
}

interface PagerFrameProps<S extends number> {
  sizes: readonly S[];
  pageSize: S;
  onPageSizeChange: (next: S) => void;
  summary: ReactNode;
  position: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
}

/** The footer's one layout, shared by both modes so a cursor-paged list looks like every other. */
function PagerFrame<S extends number>(props: PagerFrameProps<S>): ReactNode {
  const { sizes, pageSize, onPageSizeChange, summary, position, onPrev, onNext, isFirst, isLast } = props;
  const t = useTranslation('core');
  return (
    <div className="b2b-card__foot">
      <div className="b2b-row" style={{ gap: 12, alignItems: 'center' }}>
        <div className="b2b-muted" style={{ fontSize: 12 }}>
          {summary}
        </div>
        <label
          className="b2b-row"
          style={{ gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--fg-muted)' }}
        >
          {t('common.pagination.rowsPerPage')}
          <select
            className="b2b-field b2b-field--sm"
            value={pageSize}
            onChange={(e): void => {
              const next = Number.parseInt(e.target.value, 10) as S;
              if (sizes.includes(next)) {
                onPageSizeChange(next);
              }
            }}
            style={{ height: 28, padding: '0 24px 0 8px', fontSize: 12 }}
          >
            {sizes.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="b2b-muted" style={{ fontSize: 12 }}>
          {position}
        </span>
        <button
          type="button"
          className="b2b-btn b2b-btn--default b2b-btn--sm"
          onClick={onPrev}
          disabled={isFirst}
        >
          <ChevronLeft size={13} /> {t('common.pagination.previous')}
        </button>
        <button
          type="button"
          className="b2b-btn b2b-btn--default b2b-btn--sm"
          onClick={onNext}
          disabled={isLast}
        >
          {t('common.pagination.next')} <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
