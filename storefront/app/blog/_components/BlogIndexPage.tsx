import type { ReactNode } from 'react';
import type { BlogIndexResponse } from '@endora-commerce/contracts';
import { CategoryTile } from './CategoryTile';
import { PostCard } from './PostCard';
import { tForLocale } from '../../../lib/i18n/messages';

export function BlogIndexPage({
  payload,
  locale,
}: {
  payload: BlogIndexResponse;
  /** The page language, for the page's own words and the cards' dates. */
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-4xl font-bold text-[--ink-700]">{t('content.blog.title')}</h1>
      </header>

      {payload.latestPosts.length > 0 ? (
        <section>
          <h2 className="mb-6 text-2xl font-semibold text-[--ink-700]">{t('content.blog.latestPosts')}</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {payload.latestPosts.map((post) => (
              <PostCard key={post.id} post={post} locale={locale} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-[--ink-400]">{t('content.blog.noPosts')}</p>
      )}

      {payload.topLevelCategories.length > 0 ? (
        <section>
          <h2 className="mb-6 text-2xl font-semibold text-[--ink-700]">{t('content.blog.categories')}</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {payload.topLevelCategories.map((category) => (
              <CategoryTile key={category.id} category={category} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
