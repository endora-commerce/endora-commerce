import type { ReactNode } from 'react';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { tForLocale } from '../../../lib/i18n/messages';

interface PaginationProps {
  basePath: string;
  page: number;
  totalPages: number;
  /** The page language. */
  locale: string;
}

/**
 * Crawlable pagination block. Each page number is a real `<a>` so search
 * engines + LLM crawlers can follow them; rel="prev" + rel="next"
 * surface the surrounding pages for SEO (Principle VII).
 */
export function Pagination({ basePath, page, totalPages, locale }: PaginationProps): ReactNode {
  if (totalPages <= 1) return null;
  const t = tForLocale(locale);
  const pages = pageWindow(page, totalPages);

  return (
    <nav
      aria-label={t('content.blog.pagination.label')}
      className="mt-8 flex items-center justify-center gap-2 text-sm"
    >
      {page > 1 ? (
        <LocalizedLink
          href={`${basePath}?page=${page - 1}`}
          rel="prev"
          className="rounded border border-[--line] px-3 py-1 hover:bg-[--surface-alt]"
        >
          ← {t('content.blog.pagination.previous')}
        </LocalizedLink>
      ) : null}
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-2 text-[--ink-300]">
            …
          </span>
        ) : (
          <LocalizedLink
            key={p}
            href={`${basePath}?page=${p}`}
            className={`min-w-[2.5rem] rounded border px-2 py-1 text-center font-mono ${
              p === page
                ? 'border-[--brand-700] bg-[--brand-700] text-white'
                : 'border-[--line] hover:bg-[--surface-alt]'
            }`}
          >
            {p}
          </LocalizedLink>
        ),
      )}
      {page < totalPages ? (
        <LocalizedLink
          href={`${basePath}?page=${page + 1}`}
          rel="next"
          className="rounded border border-[--line] px-3 py-1 hover:bg-[--surface-alt]"
        >
          {t('content.blog.pagination.next')} →
        </LocalizedLink>
      ) : null}
    </nav>
  );
}

function pageWindow(page: number, totalPages: number): Array<number | '…'> {
  const window: Array<number | '…'> = [];
  const include = new Set<number>([
    1,
    totalPages,
    page - 1,
    page,
    page + 1,
  ]);
  let last = 0;
  for (let i = 1; i <= totalPages; i++) {
    if (!include.has(i)) continue;
    if (i - last > 1) window.push('…');
    window.push(i);
    last = i;
  }
  return window;
}
