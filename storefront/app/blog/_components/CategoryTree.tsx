import type { ReactNode } from 'react';
import type { BlogCategoryTile } from '@endora-commerce/contracts';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { tForLocale } from '../../../lib/i18n/messages';

// Feature 171 — the backend composes every blog URL (`blogPath`); the `/blog` fallback only
// serves a payload cached before it did.

interface CategoryTreeProps {
  /** Direct child categories of the current category (one level deep). */
  children: BlogCategoryTile[];
  currentSlug?: string;
  /** The page language. */
  locale: string;
}

export function CategoryTree({ children, currentSlug, locale }: CategoryTreeProps): ReactNode {
  if (children.length === 0) return null;
  const t = tForLocale(locale);
  return (
    <nav aria-label={t('content.blog.subcategories')} className="rounded border border-[--line] bg-[--surface] p-4">
      <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-[--ink-400]">
        {t('content.blog.subcategories')}
      </h3>
      <ul className="space-y-1 text-sm">
        {children.map((c) => (
          <li key={c.id}>
            <LocalizedLink
              href={c.url ?? `/blog/${c.slug}`}
              className={`block rounded px-2 py-1 hover:bg-[--surface-alt] ${
                c.slug === currentSlug
                  ? 'border-l-2 border-[--brand-700] font-medium text-[--brand-700]'
                  : 'text-[--ink-700]'
              }`}
            >
              {c.name}
            </LocalizedLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
