import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '@/lib/use-page-size-preference';

export interface PaginationFooterProps {
  /** Zero-based page index. */
  page: number;
  /** Currently chosen page size; must be one of `PAGE_SIZE_OPTIONS`. */
  pageSize: PageSizeOption;
  /** Total number of items across all pages (post-filter). */
  total: number;
  /** Called when the user picks a different page size. The list owner
   *  is responsible for resetting `page` to 0 (we don't do it here so
   *  the footer stays a pure presentational component). */
  onPageSizeChange: (next: PageSizeOption) => void;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Pagination footer used by the admin list pages — renders a
 * "Showing X–Y of Z" summary, a rows-per-page dropdown wired to
 * `usePageSizePreference`, and Prev/Next buttons. Disabled-state on
 * the buttons reflects page bounds; the empty-list case still renders
 * (so the footer doesn't disappear and "wiggle" the layout).
 */
export function PaginationFooter(props: PaginationFooterProps): ReactNode {
  const { page, pageSize, total, onPageSizeChange, onPrev, onNext } = props;
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
          {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}
        </div>
        <label
          className="b2b-row"
          style={{ gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--fg-muted)' }}
        >
          Rows per page:
          <select
            className="b2b-field b2b-field--sm"
            value={pageSize}
            onChange={(e): void => {
              const next = Number.parseInt(e.target.value, 10) as PageSizeOption;
              if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(next)) {
                onPageSizeChange(next);
              }
            }}
            style={{ height: 28, padding: '0 24px 0 8px', fontSize: 12 }}
          >
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="b2b-muted" style={{ fontSize: 12 }}>
          Page {totalPages === 0 ? 0 : safePage + 1} of {totalPages}
        </span>
        <button
          type="button"
          className="b2b-btn b2b-btn--default b2b-btn--sm"
          onClick={onPrev}
          disabled={isFirst}
        >
          <ChevronLeft size={13} /> Previous
        </button>
        <button
          type="button"
          className="b2b-btn b2b-btn--default b2b-btn--sm"
          onClick={onNext}
          disabled={isLast}
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
