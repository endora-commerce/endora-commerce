import type { ReactNode } from 'react';
import Link from 'next/link';
import type { BlogCategoryTile } from '@endora-commerce/contracts';

const BLOG_PREFIX = '/blog';

export function CategoryTile({ category }: { category: BlogCategoryTile }): ReactNode {
  return (
    <Link
      href={`${BLOG_PREFIX}/${category.slug}`}
      data-test="category-tile"
      className="group flex flex-col overflow-hidden rounded-lg border border-[--line] bg-[--surface] transition hover:shadow-lg"
    >
      {category.mainImageUrl ? (
        <div className="relative aspect-[16/9] overflow-hidden bg-[--surface-alt]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={category.mainImageUrl}
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex aspect-[16/9] items-center justify-center bg-[--surface-alt] text-[--ink-300]">
          <span className="text-3xl font-bold text-[--ink-300]">
            {category.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="p-4">
        <h3 className="text-base font-semibold leading-snug text-[--ink-700] group-hover:text-[--brand-700]">
          {category.name}
        </h3>
      </div>
    </Link>
  );
}
