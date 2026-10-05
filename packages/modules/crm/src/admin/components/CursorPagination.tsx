import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '@endora-commerce/admin-kit/lib';
import { Button, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** The most rows the Opportunities endpoint returns in one page. */
export const MAX_PAGE_LIMIT = 200;

export interface CursorPaginationProps {
  /** One-based number of the page on screen. */
  page: number;
  pageSize: PageSizeOption;
  hasPrevious: boolean;
  hasNext: boolean;
  /** While a page is being fetched, so a second press cannot skip one. */
  busy?: boolean;
  onPageSizeChange: (next: PageSizeOption) => void;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * The footer of a cursor-paginated list: rows per page, the page number, and
 * Previous / Next.
 *
 * The kit's `PaginationFooter` is built for a list that knows its total — it
 * renders "Showing X–Y of Z" and "Page N of M". The Opportunities endpoint is
 * cursor-paginated (`{ cursor, hasMore, limit }`) and knows no total, so that
 * component could only be fed an invented one. This one says what the server
 * can actually answer, in the same place, with the kit's buttons and the shared
 * `common.pagination.*` copy.
 */
export function CursorPagination(props: CursorPaginationProps): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const sizes = PAGE_SIZE_OPTIONS.filter((size) => size <= MAX_PAGE_LIMIT);

  return (
    <nav
      aria-label={t('opportunity.list.pagination')}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {tCore('common.pagination.rowsPerPage')}
        <Select
          className="h-8 w-auto text-xs"
          value={props.pageSize}
          onChange={(event): void => {
            const next = Number.parseInt(event.target.value, 10) as PageSizeOption;
            if (sizes.includes(next)) props.onPageSizeChange(next);
          }}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t('opportunity.list.page', { page: props.page })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!props.hasPrevious || props.busy}
          onClick={props.onPrevious}
        >
          <ChevronLeft aria-hidden="true" />
          {tCore('common.pagination.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!props.hasNext || props.busy}
          onClick={props.onNext}
        >
          {tCore('common.pagination.next')}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
