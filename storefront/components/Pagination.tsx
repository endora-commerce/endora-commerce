import Link from 'next/link';
import type { ReactNode } from 'react';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Cursor-style pagination — emits a single "Next page" link when the API
 * reports `hasMore`. Intentionally minimal; themes can swap in numbered
 * pagination by reading the same `nextCursor` from the listing query.
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
  const params = new URLSearchParams({ ...props.baseQuery, cursor: props.nextCursor });
  return (
    <nav className="b2b-pagination" aria-label="Pagination">
      <Link href={`${props.basePath}?${params.toString()}` as never} rel="next">
        {t('pagination.next')}
      </Link>
    </nav>
  );
}
