import type { ReactNode } from 'react';
import type { BlogTagByCodeResponse } from '@endora-commerce/contracts';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { Pagination } from './Pagination';
import { PostCard } from './PostCard';
import { tForLocale } from '../../../lib/i18n/messages';

const BLOG_PREFIX = '/blog';

export function BlogTagPage({
  payload,
  locale,
}: {
  payload: BlogTagByCodeResponse;
  /** The page language, for the page's own words and the cards' dates. */
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  const { tag, posts } = payload;
  return (
    <div className="space-y-8">
      <Breadcrumbs
        crumbs={payload.breadcrumb.map((c) => ({ href: c.url, label: c.name }))}
      />

      <header className="space-y-2">
        <h1 className="text-4xl font-bold text-[--ink-700]">#{tag.name}</h1>
        {tag.description ? (
          <p className="text-[--ink-400]">{tag.description}</p>
        ) : null}
      </header>

      {posts.data.length === 0 ? (
        <p className="text-[--ink-400]">{t('content.blog.tag.empty')}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.data.map((post) => (
            <PostCard key={post.id} post={post} locale={locale} />
          ))}
        </div>
      )}

      <Pagination
        basePath={`${BLOG_PREFIX}/tag/${tag.code}`}
        page={posts.pagination.page}
        totalPages={posts.pagination.totalPages}
        locale={locale}
      />
    </div>
  );
}
