import type { ReactNode } from 'react';
import Link from 'next/link';

interface PaginationProps {
  basePath: string;
  page: number;
  totalPages: number;
}

/**
 * Crawlable pagination block. Each page number is a real `<a>` so search
 * engines + LLM crawlers can follow them; rel="prev" + rel="next"
 * surface the surrounding pages for SEO (Principle VII).
 */
export function Pagination({ basePath, page, totalPages }: PaginationProps): ReactNode {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className="mt-8 flex items-center justify-center gap-2 text-sm"
    >
      {page > 1 ? (
        <Link
          href={`${basePath}?page=${page - 1}`}
          rel="prev"
          className="rounded border border-[--line] px-3 py-1 hover:bg-[--surface-alt]"
        >
          ← Previous
        </Link>
      ) : null}
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-2 text-[--ink-300]">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={`${basePath}?page=${p}`}
            className={`min-w-[2.5rem] rounded border px-2 py-1 text-center font-mono ${
              p === page
                ? 'border-[--brand-700] bg-[--brand-700] text-white'
                : 'border-[--line] hover:bg-[--surface-alt]'
            }`}
          >
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link
          href={`${basePath}?page=${page + 1}`}
          rel="next"
          className="rounded border border-[--line] px-3 py-1 hover:bg-[--surface-alt]"
        >
          Next →
        </Link>
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
