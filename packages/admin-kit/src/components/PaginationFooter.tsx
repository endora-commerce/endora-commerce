import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '../lib/page-size-options.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { cn } from '../lib/utils.js';
import { Button } from '../ui/button.js';
import { Select } from '../ui/select.js';

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
 * `usePageSizePreference`, and Prev/Next buttons. The page bounds mark
 * the buttons `aria-disabled`, not `disabled` (issue #1803, see
 * `PagerStepButton`); the empty-list case still renders
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

/**
 * The footer's one layout, shared by both modes so a cursor-paged list looks like every other.
 * The muted band across a card's foot, drawn from the same `--card-pad*` tokens
 * as the card it closes (issue #1492: kit primitives, no legacy classes).
 */
function PagerFrame<S extends number>(props: PagerFrameProps<S>): ReactNode {
  const { sizes, pageSize, onPageSizeChange, summary, position, onPrev, onNext, isFirst, isLast } = props;
  const t = useTranslation('core');
  return (
    <div
      data-slot="pagination-footer"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-b-lg border-t bg-muted px-(--card-pad) py-(--card-pad-sm) text-xs text-muted-foreground"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Focus stays on Previous / Next across a page change, so the new range is
            announced from here rather than by moving focus (WCAG 2.2 SC 4.1.3). */}
        <div aria-live="polite" aria-atomic="true">
          {summary}
        </div>
        <label className="flex items-center gap-1.5">
          {t('common.pagination.rowsPerPage')}
          <Select
            className="h-7 w-auto py-0 pl-2 pr-6 text-xs text-foreground"
            value={pageSize}
            onChange={(e): void => {
              const next = Number.parseInt(e.target.value, 10) as S;
              if (sizes.includes(next)) {
                onPageSizeChange(next);
              }
            }}
          >
            {sizes.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span>{position}</span>
        <PagerStepButton onClick={onPrev} unavailable={isFirst}>
          <ChevronLeft aria-hidden="true" /> {t('common.pagination.previous')}
        </PagerStepButton>
        <PagerStepButton onClick={onNext} unavailable={isLast}>
          {t('common.pagination.next')} <ChevronRight aria-hidden="true" />
        </PagerStepButton>
      </div>
    </div>
  );
}

export interface PagerStepButtonProps extends Omit<ComponentProps<typeof Button>, 'disabled' | 'onClick'> {
  /** The step goes nowhere — the end of the range, or a page still being fetched. */
  unavailable: boolean;
  onClick: () => void;
}

/**
 * A pager's Previous / Next (issue #1803). At the end of the range the button is
 * `aria-disabled`, never `disabled`: pressing Next onto the last page would
 * otherwise disable the very button holding focus, and the browser drops that
 * focus to `<body>` (WCAG 2.2 SC 2.4.3). It stays a tab stop, is announced as
 * unavailable (SC 4.1.2), and ignores activation. Kit-internal: shared by
 * `PaginationFooter` and `CursorPagination`, not exported from the barrel.
 */
export function PagerStepButton({ unavailable, onClick, className, children, ...rest }: PagerStepButtonProps): ReactNode {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      {...rest}
      className={cn(
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-foreground',
        className,
      )}
      aria-disabled={unavailable || undefined}
      onClick={(): void => {
        if (!unavailable) onClick();
      }}
    >
      {children}
    </Button>
  );
}
