import Link from 'next/link';
import type { ReactNode } from 'react';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Cursor-style pagination — emits a "Next" link as a styled outline
 * button (matches the Industria toolbar buttons) when the API reports
 * `hasMore`. Cursor pagination is one-way; a previous-page link isn't
 * computable without server changes. Themes that want numbered
 * pagination need a total-count + page param on the backend listing.
 */
export function Pagination(props: {
  basePath: string;
  baseQuery: Record<string, string>;
  nextCursor: string | null;
  hasMore: boolean;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  if (!props.hasMore || !props.nextCursor) return null;
  const params = new URLSearchParams({
    ...props.baseQuery,
    cursor: props.nextCursor,
  });
  return (
    <nav className="industria-pagination" aria-label="Pagination">
      <span className="industria-pagination__hint" aria-hidden="true" />
      <div className="industria-pagination__pages">
        <Link
          href={`${props.basePath}?${params.toString()}` as never}
          rel="next"
          className="btn btn--outline btn--sm"
        >
          {t('pagination.next')} <ChevRightIcon />
        </Link>
      </div>
    </nav>
  );
}

function ChevRightIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
