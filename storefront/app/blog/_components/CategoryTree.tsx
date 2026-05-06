import type { ReactNode } from 'react';
import Link from 'next/link';
import type { BlogCategoryTile } from '@b2b/contracts';

const BLOG_PREFIX = '/blog';

interface CategoryTreeProps {
  /** Direct child categories of the current category (one level deep). */
  children: BlogCategoryTile[];
  currentSlug?: string;
}

export function CategoryTree({ children, currentSlug }: CategoryTreeProps): ReactNode {
  if (children.length === 0) return null;
  return (
    <nav aria-label="Subcategories" className="rounded border border-[--line] bg-[--surface] p-4">
      <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-[--ink-400]">
        Subcategories
      </h3>
      <ul className="space-y-1 text-sm">
        {children.map((c) => (
          <li key={c.id}>
            <Link
              href={`${BLOG_PREFIX}/${c.slug}`}
              className={`block rounded px-2 py-1 hover:bg-[--surface-alt] ${
                c.slug === currentSlug
                  ? 'border-l-2 border-[--brand-700] font-medium text-[--brand-700]'
                  : 'text-[--ink-700]'
              }`}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
