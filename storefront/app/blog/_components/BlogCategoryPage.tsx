import type { ReactNode } from 'react';
import { Render } from '@measured/puck';
import { defaultPageBuilderConfig } from '@b2b/cms-components';
import type { BlogBySlugCategoryResponse } from '@b2b/contracts';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { CategoryTree } from './CategoryTree';
import { Pagination } from './Pagination';
import { PostCard } from './PostCard';

const BLOG_PREFIX = '/blog';

export function BlogCategoryPage({
  payload,
}: {
  payload: BlogBySlugCategoryResponse;
}): ReactNode {
  const { category, posts } = payload;
  const description =
    category.description && category.description.languages
      ? Object.values(category.description.languages)[0]
      : null;

  return (
    <div className="space-y-8">
      <Breadcrumbs
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
            <Render config={defaultPageBuilderConfig} data={description as never} />
          </div>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <main>
          {posts.data.length === 0 ? (
            <p className="text-[--ink-400]">No posts in this category yet.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {posts.data.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
          <Pagination
            basePath={`${BLOG_PREFIX}/${category.slug}`}
            page={posts.pagination.page}
            totalPages={posts.pagination.totalPages}
          />
        </main>
        <aside>
          <CategoryTree
            children={category.childCategories}
            currentSlug={category.slug}
          />
        </aside>
      </div>
    </div>
  );
}
