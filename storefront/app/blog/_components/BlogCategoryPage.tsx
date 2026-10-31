import type { ReactNode } from 'react';
import type { BlogBySlugCategoryResponse } from '@endora-commerce/contracts';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { PageBuilderRender } from '../../../components/PageBuilderRender';
import { CategoryTree } from './CategoryTree';
import { Pagination } from './Pagination';
import { PostCard } from './PostCard';
import { tForLocale } from '../../../lib/i18n/messages';

const BLOG_PREFIX = '/blog';

export function BlogCategoryPage({
  payload,
  locale,
}: {
  payload: BlogBySlugCategoryResponse;
  /** The page language, for the page's own words and the cards' dates. */
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  const { category, posts } = payload;
  const description =
    category.description && category.description.languages
      ? Object.values(category.description.languages)[0]
      : null;

  return (
    <div className="space-y-8">
      <Breadcrumbs locale={locale}
        crumbs={category.breadcrumb.map((c) => ({ href: c.url, label: c.name }))}
      />

      <header className="space-y-4">
        <h1 className="text-4xl font-bold text-[--ink-700]">{category.name}</h1>
        {category.mainImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={category.mainImageUrl}
            alt=""
            className="aspect-[3/1] w-full rounded-lg object-cover"
          />
        ) : null}
        {description ? (
          <div className="prose prose-slate max-w-none">
            <PageBuilderRender data={description} />
          </div>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <main>
          {posts.data.length === 0 ? (
            <p className="text-[--ink-400]">{t('content.blog.category.empty')}</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {posts.data.map((post) => (
                <PostCard key={post.id} post={post} locale={locale} />
              ))}
            </div>
          )}
          <Pagination
            basePath={`${BLOG_PREFIX}/${category.slug}`}
            page={posts.pagination.page}
            totalPages={posts.pagination.totalPages}
            locale={locale}
          />
        </main>
        <aside>
          <CategoryTree
            children={category.childCategories}
            currentSlug={category.slug}
            locale={locale}
          />
        </aside>
      </div>
    </div>
  );
}
