import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '../lib/page-size-options.js';
import { useTranslation } from '../i18n/useTranslation.js';

export interface PaginationFooterProps<S extends number = PageSizeOption> {
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
 * Pagination footer used by the admin list pages — renders a
 * "Showing X–Y of Z" summary, a rows-per-page dropdown wired to
 * `usePageSizePreference`, and Prev/Next buttons. Disabled-state on
 * the buttons reflects page bounds; the empty-list case still renders
 * (so the footer doesn't disappear and "wiggle" the layout).
 */
export function PaginationFooter<S extends number = PageSizeOption>(props: PaginationFooterProps<S>): ReactNode {
  const { page, pageSize, total, onPageSizeChange, onPrev, onNext } = props;
  const sizes: readonly S[] = props.pageSizes ?? (PAGE_SIZE_OPTIONS as readonly number[] as readonly S[]);
  const t = useTranslation('core');
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.min(Math.max(0, page), Math.max(0, totalPages - 1));
  const start = total === 0 ? 0 : safePage * pageSize + 1;
  const end = Math.min((safePage + 1) * pageSize, total);
  const isFirst = safePage === 0;
  const isLast = safePage >= totalPages - 1;

  return (
    <div className="b2b-card__foot">
      <div className="b2b-row" style={{ gap: 12, alignItems: 'center' }}>
        <div className="b2b-muted" style={{ fontSize: 12 }}>
          {total === 0
            ? t('common.pagination.noResults')
            : t('common.pagination.showingRange', { start, end, total })}
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
          {t('common.pagination.pageXofY', {
            page: totalPages === 0 ? 0 : safePage + 1,
            total: totalPages,
          })}
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
